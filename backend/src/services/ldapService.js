const { promisify } = require('util');
const { getLDAPConfig } = require('../config/ldap');
const { query } = require('../config/database');

/**
 * LDAP 인증 서비스
 * 사용자 인증, 정보 조회, 그룹 확인 등의 기능 제공
 */
class LDAPService {
  constructor() {
    this.config = getLDAPConfig();
    this.connectionPool = new Map(); // 연결 풀 관리
    this.maxConnections = 10;
    this.connectionTimeout = 30000; // 30초
  }

  /**
   * 사용자 인증
   * @param {string} username - 사용자명
   * @param {string} password - 비밀번호
   * @returns {Promise<Object>} - 인증된 사용자 정보
   */
  async authenticateUser(username, password) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const startTime = Date.now();
    let client = null;

    try {
      // 개발 환경에서 모의 인증 사용
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MOCK_AUTH === 'true') {
        console.log(`Using mock authentication for development - user: ${username}`);
        
        // 모의 사용자 정보 생성
        const mockUserInfo = {
          dn: `uid=${username},ou=users,dc=dev,dc=com`,
          username: username,
          email: `${username}@dev.com`,
          fullName: username.split('.').map(name => 
            name.charAt(0).toUpperCase() + name.slice(1)
          ).join(' '),
          department: 'Development'
        };

        // 모의 사용자 정보로 사용자 동기화
        let user;
        try {
          user = await this.syncUserToDatabase(mockUserInfo);
        } catch (dbError) {
          console.warn('데이터베이스 사용자 동기화 실패 (개발환경에서 무시):', dbError.message);
          // 사용자 정보 없이는 인증 실패 처리
          throw new Error('Failed to create or retrieve user from database');
        }

        const authDuration = Date.now() - startTime;
        console.log(`Mock user ${username} authenticated successfully in ${authDuration}ms`);

        return {
          ...user,
          ldapDN: mockUserInfo.dn,
          authenticationTime: authDuration,
        };
      }

      // 실제 LDAP 인증
      // 사용자 검색
      const userInfo = await this.findUser(username);
      if (!userInfo) {
        throw new Error('User not found in LDAP directory');
      }

      // 비밀번호 인증
      client = this.config.createClient();
      const bindAsync = promisify(client.bind).bind(client);

      try {
        await bindAsync(userInfo.dn, password);
      } catch (bindError) {
        if (bindError.name === 'InvalidCredentialsError') {
          throw new Error('Invalid username or password');
        }
        throw new Error(`Authentication failed: ${bindError.message}`);
      }

      // 그룹 확인 (설정된 경우)
      if (this.config.getConfig().allowedGroups.length > 0) {
        const hasAccess = await this.checkUserGroups(userInfo.dn);
        if (!hasAccess) {
          throw new Error('User does not have access to this application');
        }
      }

      // 사용자 정보 업데이트/생성 (개발환경에서는 DB 오류 무시)
      let user;
      try {
        user = await this.syncUserToDatabase(userInfo);
      } catch (dbError) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('데이터베이스 사용자 동기화 실패 (개발환경에서 무시):', dbError.message);
          // 데이터베이스 동기화 실패 시 인증 실패
          throw dbError;
        } else {
          throw dbError;
        }
      }

      const authDuration = Date.now() - startTime;
      console.log(`User ${username} authenticated successfully in ${authDuration}ms`);

      return {
        ...user,
        ldapDN: userInfo.dn,
        authenticationTime: authDuration,
      };

    } catch (error) {
      const authDuration = Date.now() - startTime;
      console.error(`Authentication failed for ${username} after ${authDuration}ms:`, error.message);
      throw error;
    } finally {
      if (client) {
        client.unbind(() => {
          // Connection closed
        });
      }
    }
  }

  /**
   * 사용자 검색
   * @param {string} username - 검색할 사용자명
   * @returns {Promise<Object|null>} - 사용자 정보 또는 null
   */
  async findUser(username) {
    const client = this.config.createClient();

    try {
      // 관리자 계정으로 바인드
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(
        this.config.getConfig().bindDN,
        this.config.getConfig().bindCredentials,
      );

      // 사용자 검색
      const searchAsync = promisify(client.search).bind(client);
      const searchFilter = this.config.buildSearchFilter(username);
      const searchOptions = {
        filter: searchFilter,
        scope: 'sub',
        attributes: Object.values(this.config.getConfig().attributeMap),
        timeLimit: 10,
        sizeLimit: 1,
      };

      const searchResult = await searchAsync(this.config.getConfig().searchBase, searchOptions);

      return new Promise((resolve, reject) => {
        let user = null;
        let entryCount = 0;

        searchResult.on('searchEntry', (entry) => {
          entryCount++;
          if (entryCount === 1) {
            user = this.config.mapUserAttributes(entry);
          }
        });

        searchResult.on('error', (error) => {
          reject(new Error(`LDAP search error: ${error.message}`));
        });

        searchResult.on('end', (result) => {
          if (result.status !== 0) {
            reject(new Error(`LDAP search failed with status: ${result.status}`));
            return;
          }

          if (entryCount === 0) {
            resolve(null);
          } else if (entryCount === 1) {
            resolve(user);
          } else {
            reject(new Error(`Multiple users found for username: ${username}`));
          }
        });

        // 타임아웃 설정
        setTimeout(() => {
          reject(new Error('LDAP search timeout'));
        }, 10000);
      });

    } catch (error) {
      console.error('LDAP user search error:', error.message);
      throw error;
    } finally {
      client.unbind(() => {
        // Connection closed
      });
    }
  }

  /**
   * 사용자 그룹 확인
   * @param {string} userDN - 사용자 DN
   * @returns {Promise<boolean>} - 접근 권한 여부
   */
  async checkUserGroups(userDN) {
    const {allowedGroups} = this.config.getConfig();
    if (allowedGroups.length === 0) {
      return true; // 그룹 제한이 없으면 허용
    }

    const client = this.config.createClient();

    try {
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(
        this.config.getConfig().bindDN,
        this.config.getConfig().bindCredentials,
      );

      const searchAsync = promisify(client.search).bind(client);
      const groupFilter = this.config.buildGroupFilter(userDN);
      const searchOptions = {
        filter: groupFilter,
        scope: 'sub',
        attributes: ['cn', 'name'],
      };

      const searchResult = await searchAsync(this.config.getConfig().groupBase, searchOptions);

      return new Promise((resolve) => {
        let hasAccess = false;

        searchResult.on('searchEntry', (entry) => {
          const groupName = this.config.getAttributeValue(entry, 'cn') ||
                            this.config.getAttributeValue(entry, 'name');

          if (groupName && allowedGroups.includes(groupName)) {
            hasAccess = true;
          }
        });

        searchResult.on('error', (error) => {
          console.warn('LDAP group search error:', error.message);
          resolve(false);
        });

        searchResult.on('end', () => {
          resolve(hasAccess);
        });
      });

    } catch (error) {
      console.warn('LDAP group check error:', error.message);
      return false; // 그룹 확인 실패 시 접근 거부
    } finally {
      client.unbind(() => {
        // Connection closed
      });
    }
  }

  /**
   * 사용자 정보를 데이터베이스에 동기화
   * @param {Object} ldapUser - LDAP에서 가져온 사용자 정보
   * @returns {Promise<Object>} - 데이터베이스 사용자 정보
   */
  async syncUserToDatabase(ldapUser) {
    try {
      const existingUserResult = await query(
        'SELECT * FROM users WHERE username = $1',
        [ldapUser.username],
      );

      let user;

      if (existingUserResult.rows.length > 0) {
        // 기존 사용자 업데이트
        const updateQuery = `
          UPDATE users
          SET email = $2, full_name = $3, department = $4, updated_at = CURRENT_TIMESTAMP
          WHERE username = $1
          RETURNING *
        `;

        const updateResult = await query(updateQuery, [
          ldapUser.username,
          ldapUser.email || null,
          ldapUser.fullName || null,
          ldapUser.department || null,
        ]);

        user = updateResult.rows[0];
        console.log(`Updated existing user: ${ldapUser.username}`);
      } else {
        // 새 사용자 생성
        const insertQuery = `
          INSERT INTO users (username, email, full_name, department)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `;

        const insertResult = await query(insertQuery, [
          ldapUser.username,
          ldapUser.email || null,
          ldapUser.fullName || null,
          ldapUser.department || null,
        ]);

        user = insertResult.rows[0];
        console.log(`Created new user: ${ldapUser.username}`);
      }

      return user;
    } catch (error) {
      console.error('Database user sync error:', error.message);
      throw new Error('Failed to sync user information to database');
    }
  }

  /**
   * 사용자 정보 갱신 (LDAP에서 최신 정보 가져오기)
   * @param {string} username - 사용자명
   * @returns {Promise<Object>} - 갱신된 사용자 정보
   */
  async refreshUserInfo(username) {
    try {
      const ldapUser = await this.findUser(username);
      if (!ldapUser) {
        throw new Error('User not found in LDAP directory');
      }

      const user = await this.syncUserToDatabase(ldapUser);
      return user;
    } catch (error) {
      console.error(`Failed to refresh user info for ${username}:`, error.message);
      throw error;
    }
  }

  /**
   * LDAP 연결 상태 확인
   * @returns {Promise<Object>} - 상태 정보
   */
  async getConnectionStatus() {
    try {
      await this.config.testConnection();
      return {
        status: 'connected',
        server: this.config.getConfig().url,
        searchBase: this.config.getConfig().searchBase,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'disconnected',
        server: this.config.getConfig().url,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 인증 통계 조회
   * @param {number} days - 조회할 일수
   * @returns {Promise<Object>} - 통계 정보
   */
  async getAuthenticationStats(days = 30) {
    try {
      const statsQuery = `
        SELECT
          DATE(last_login) as date,
          COUNT(*) as login_count,
          COUNT(DISTINCT username) as unique_users
        FROM users
        WHERE last_login >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
        GROUP BY DATE(last_login)
        ORDER BY date DESC
      `;

      const result = await query(statsQuery);

      const totalQuery = `
        SELECT
          COUNT(*) as total_users,
          COUNT(CASE WHEN last_login >= CURRENT_TIMESTAMP - INTERVAL '${days} days' THEN 1 END) as active_users
        FROM users
        WHERE is_active = true
      `;

      const totalResult = await query(totalQuery);

      return {
        dailyStats: result.rows,
        totalUsers: parseInt(totalResult.rows[0].total_users, 10),
        activeUsers: parseInt(totalResult.rows[0].active_users, 10),
        period: `${days} days`,
      };
    } catch (error) {
      console.error('Failed to get authentication stats:', error.message);
      throw error;
    }
  }
}

// 싱글톤 인스턴스
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
