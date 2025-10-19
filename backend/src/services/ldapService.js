const ldap = require('ldapjs');
const { promisify } = require('util');
const { query } = require('../config/database');
const logger = require('../config/logger');

/**
 * 통합 LDAP 인증 서비스
 */
class LDAPService {
  constructor() {
    this.config = {
      url: process.env.LDAP_URL || 'ldap://localhost:389',
      bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=company,dc=com',
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS || '',
      searchBase: process.env.LDAP_SEARCH_BASE || 'ou=users,dc=company,dc=com',
      searchFilter: process.env.LDAP_SEARCH_FILTER || '(uid={{username}})',
      timeout: parseInt(process.env.LDAP_TIMEOUT, 10) || 30000,
      connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT, 10) || 20000,
      attributeMap: {
        username: process.env.LDAP_ATTR_USERNAME || 'uid',
        email: process.env.LDAP_ATTR_EMAIL || 'mail',
        fullName: process.env.LDAP_ATTR_FULL_NAME || 'cn',
        department: process.env.LDAP_ATTR_DEPARTMENT || 'department',
      }
    };
  }

  /**
   * 사용자 인증
   */
  async authenticateUser(username, password) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    console.log(`🔥 LDAP AUTH START: ${username}`);
    
    let client = null;
    try {
      // 1. 사용자 검색
      const userInfo = await this.findUser(username);
      if (!userInfo) {
        throw new Error('User not found in LDAP directory');
      }

      console.log(`🔥 LDAP USER FOUND:`, userInfo);

      // 2. 비밀번호 인증
      client = this.createClient();
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(userInfo.dn, password);

      console.log(`🔥 LDAP AUTH SUCCESS: ${username}`);

      // 3. 데이터베이스 동기화
      const dbUser = await this.syncUserToDB(userInfo);
      
      console.log(`🔥 DB SYNC COMPLETE:`, dbUser);

      return dbUser;

    } catch (error) {
      console.error(`🔥 LDAP AUTH ERROR: ${username}`, error.message);
      throw error;
    } finally {
      if (client) {
        client.unbind(() => {});
      }
    }
  }

  /**
   * 사용자 검색
   */
  async findUser(username) {
    const client = this.createClient();
    
    try {
      // 연결 대기
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('LDAP connection timeout'));
        }, 10000);

        client.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // 관리자 바인드
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(this.config.bindDN, this.config.bindCredentials);

      // 사용자 검색
      const searchAsync = promisify(client.search).bind(client);
      const searchFilter = this.buildSearchFilter(username);
      const searchOptions = {
        filter: searchFilter,
        scope: 'sub',
        attributes: Object.values(this.config.attributeMap),
      };

      const searchResult = await searchAsync(this.config.searchBase, searchOptions);

      return new Promise((resolve, reject) => {
        let userEntry = null;
        let entryCount = 0;

        searchResult.on('searchEntry', (entry) => {
          entryCount++;
          if (entryCount === 1) {
            userEntry = entry;
          }
        });

        searchResult.on('error', (error) => {
          reject(error);
        });

        searchResult.on('end', async (result) => {
          if (entryCount === 0) {
            resolve(null);
          } else if (entryCount === 1) {
            const user = await this.mapUserAttributes(userEntry, username);
            resolve(user);
          } else {
            reject(new Error(`Multiple users found for username: ${username}`));
          }
        });
      });

    } catch (error) {
      throw error;
    } finally {
      client.unbind(() => {});
    }
  }

  /**
   * 데이터베이스 동기화
   */
  async syncUserToDB(ldapUser) {
    try {
      // 한국어 이름 매핑
      const usernameToKoreanMap = {
        'nicolas.choi': '최현창',
        'admin': '관리자',
      };
      
      const finalFullName = usernameToKoreanMap[ldapUser.username] || ldapUser.fullName || ldapUser.username;
      
      console.log(`🔥 FULLNAME MAPPING: ${ldapUser.username} -> ${finalFullName}`);

      // 기존 사용자 확인
      const findQuery = 'SELECT * FROM users WHERE username = $1';
      const findResult = await query(findQuery, [ldapUser.username]);

      let user;
      if (findResult.rows.length > 0) {
        // 업데이트
        const updateQuery = `
          UPDATE users 
          SET email = $2, full_name = $3, department = $4, last_login = NOW(), updated_at = NOW()
          WHERE username = $1 
          RETURNING *
        `;
        const updateResult = await query(updateQuery, [
          ldapUser.username,
          ldapUser.email || `${ldapUser.username}@roboetech.com`,
          finalFullName,
          ldapUser.department || 'Development'
        ]);
        user = updateResult.rows[0];
        console.log(`🔥 USER UPDATED:`, user);
      } else {
        // 새로 생성
        const insertQuery = `
          INSERT INTO users (username, email, full_name, department, is_active, created_at, updated_at, last_login)
          VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())
          RETURNING *
        `;
        const insertResult = await query(insertQuery, [
          ldapUser.username,
          ldapUser.email || `${ldapUser.username}@roboetech.com`,
          finalFullName,
          ldapUser.department || 'Development'
        ]);
        user = insertResult.rows[0];
        console.log(`🔥 USER CREATED:`, user);
      }

      return {
        username: user.username,
        email: user.email,
        fullName: user.full_name,  // DB에서 가져온 값
        department: user.department,
      };

    } catch (error) {
      console.error('🔥 DB SYNC ERROR:', error.message);
      throw error;
    }
  }

  /**
   * LDAP 클라이언트 생성
   */
  createClient() {
    const clientOptions = {
      url: this.config.url,
      timeout: this.config.timeout,
      connectTimeout: this.config.connectTimeout,
      reconnect: false,
      strictDN: false,
      bindWhenReady: true,
      keepAlive: true,
      keepAliveInitialDelay: 10000,
      maxConnections: 1,
      maxIdleTimeout: 30000,
    };

    const client = ldap.createClient(clientOptions);

    client.on('error', (err) => {
      console.debug('LDAP client error:', err.message);
    });

    client.on('connect', () => {
      console.debug('LDAP client connected successfully');
    });

    client.on('connectError', (err) => {
      console.error('LDAP client connection error:', err.message);
    });

    return client;
  }

  /**
   * 검색 필터 생성
   */
  buildSearchFilter(username) {
    return this.config.searchFilter.replace('{{username}}', this.escapeFilterValue(username));
  }

  /**
   * LDAP 필터 값 이스케이프
   */
  escapeFilterValue(value) {
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\x00/g, '\\00');
  }

  /**
   * 사용자 속성 매핑
   */
  async mapUserAttributes(ldapEntry, searchUsername = null) {
    console.log('=== LDAP Entry All Attributes ===');
    console.log('DN:', ldapEntry.dn);
    if (ldapEntry.attributes) {
      ldapEntry.attributes.forEach(attr => {
        console.log(`${attr.type}:`, attr.values);
      });
    }
    console.log('=== End LDAP Attributes ===');

    const user = {
      username: this.getAttributeValue(ldapEntry, this.config.attributeMap.username),
      email: this.getAttributeValue(ldapEntry, this.config.attributeMap.email),
      fullName: this.getAttributeValue(ldapEntry, this.config.attributeMap.fullName),
      department: this.getAttributeValue(ldapEntry, this.config.attributeMap.department),
      dn: ldapEntry.dn,
    };

    // DN에서 직접 한글 이름 추출 (LDAP 속성이 undefined인 경우)
    if (!user.fullName && ldapEntry.dn) {
      const dnParts = ldapEntry.dn.split(',');
      for (const part of dnParts) {
        const trimmedPart = part.trim();
        if (trimmedPart.toLowerCase().startsWith('cn=')) {
          const cnValue = trimmedPart.substring(3);
          if (/[\u3131-\uD79D]/.test(cnValue)) {
            user.fullName = cnValue;
            console.log(`Extracted Korean name from DN: ${cnValue}`);
            break;
          }
        }
      }
    }

    // 사용자명 결정
    if (searchUsername && /^[a-zA-Z0-9._-]+$/.test(searchUsername)) {
      user.username = searchUsername;
    } else if (!user.username && user.dn) {
      const dnParts = user.dn.split(',');
      for (const part of dnParts) {
        if (part.trim().startsWith('cn=')) {
          user.username = part.trim().substring(3);
          break;
        }
      }
    }

    // 이메일이 없는 경우 기본 도메인으로 생성
    if (!user.email && user.username && process.env.LDAP_DEFAULT_EMAIL_DOMAIN) {
      user.email = `${user.username}@${process.env.LDAP_DEFAULT_EMAIL_DOMAIN}`;
    }

    // 특정 사용자명을 한국어로 매핑 (우선적으로 적용)
    if (user.username) {
      const usernameToKoreanMap = {
        'nicolas.choi': '최현창',
        'admin': '관리자',
      };
      
      if (usernameToKoreanMap[user.username]) {
        user.fullName = usernameToKoreanMap[user.username];
        console.log(`🔥 FORCED Korean mapping: ${user.username} -> ${user.fullName}`);
      } else if (!user.fullName) {
        user.fullName = user.username.split('.').map(name =>
          name.charAt(0).toUpperCase() + name.slice(1),
        ).join(' ');
      }
    }

    // 부서 기본값
    if (!user.department) {
      user.department = process.env.LDAP_DEFAULT_DEPARTMENT || 'Development';
    }

    // 부서명 한국어 매핑
    const departmentMap = {
      'Development': '개발',
      'Sales': '영업',
      'Marketing': '마케팅',
      'HR': '인사',
      'Finance': '재무',
      'IT': 'IT',
      'Operations': '운영',
      'QA': '품질보증',
      'Support': '지원',
      'Management': '경영진',
      'Engineering': '엔지니어링',
      'Research': '연구',
      'Design': '디자인',
      'Unknown': '미분류'
    };

    if (departmentMap[user.department]) {
      user.department = departmentMap[user.department];
    }

    return user;
  }

  /**
   * LDAP 속성 값 추출
   */
  getAttributeValue(entry, attributeName) {
    if (!entry.attributes) return undefined;

    const attribute = entry.attributes.find(attr =>
      attr.type.toLowerCase() === attributeName.toLowerCase(),
    );

    if (!attribute || !attribute.values || attribute.values.length === 0) {
      return undefined;
    }

    let value = attribute.values[0];

    if (Buffer.isBuffer(value)) {
      try {
        value = value.toString('utf8');
      } catch (err) {
        console.warn(`Failed to decode UTF-8 for attribute ${attributeName}:`, err.message);
      }
    }

    if (typeof value === 'string' && value.length > 0) {
      try {
        if (/^[A-Za-z0-9+/]+=*$/.test(value) && value.length % 4 === 0) {
          const decoded = Buffer.from(value, 'base64').toString('utf8');
          if (decoded && /[\u3131-\uD79D]/.test(decoded)) {
            console.log(`Decoded base64 for ${attributeName}: ${value} -> ${decoded}`);
            value = decoded;
          }
        }
      } catch (err) {
        console.debug(`Base64 decode failed for ${attributeName}, using original value:`, err.message);
      }
    }

    return value;
  }
}

// 싱글톤
let ldapService = null;

function getLDAPService() {
  if (!ldapService) {
    ldapService = new LDAPService();
  }
  return ldapService;
}

module.exports = {
  LDAPService,
  getLDAPService,
};