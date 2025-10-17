const { promisify } = require('util');
const { getLDAPConfig } = require('../config/ldap');
const { query } = require('../config/database');
const logger = require('../config/logger');

/**
 * LDAP 인증 서비스
 */
class LDAPService {
  constructor() {
    this.config = getLDAPConfig();
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
      client = this.config.createClient();
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
    const client = this.config.createClient();
    
    try {
      // 관리자 바인드
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
      };

      const searchResult = await searchAsync(this.config.getConfig().searchBase, searchOptions);

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
            const user = await this.config.mapUserAttributes(userEntry, username);
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