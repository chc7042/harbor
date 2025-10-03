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

        // 실제 LDAP에서 사용자 정보 조회 시도
        let ldapUserInfo = null;
        try {
          ldapUserInfo = await this.findUser(username);
          console.log(`Found LDAP user info for ${username}:`, ldapUserInfo);
        } catch (ldapError) {
          console.log(`LDAP lookup failed for ${username}, using mock data:`, ldapError.message);
        }

        // LDAP에서 찾은 정보가 있으면 사용, 없으면 모의 정보 생성
        const defaultDomain = process.env.LDAP_DEFAULT_EMAIL_DOMAIN || 'roboetech.com';
        const mockDnTemplate = process.env.LDAP_DN_TEMPLATE || 'uid={{username}},ou=users,dc=roboetech,dc=com';
        const mockDefaultDepartment = process.env.LDAP_DEFAULT_DEPARTMENT_FALLBACK || 'Development';
        const mockUserInfo = ldapUserInfo || {
          dn: mockDnTemplate.replace('{{username}}', username),
          username: username,
          email: `${username}@${defaultDomain}`,
          fullName: username.split('.').map(name =>
            name.charAt(0).toUpperCase() + name.slice(1),
          ).join(' '),
          department: mockDefaultDepartment,
        };

        // 모의 사용자 정보로 사용자 동기화
        let user;
        try {
          user = await this.syncUserToDatabase(mockUserInfo);
        } catch (dbError) {
          console.error('데이터베이스 사용자 동기화 실패:', dbError.message);
          throw new Error(`Database connection failed: ${dbError.message}`);
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
      // 사용자 검색 (이미 재시도 로직이 포함됨)
      const userInfo = await this.findUser(username);
      if (!userInfo) {
        throw new Error('User not found in LDAP directory');
      }

      // 비밀번호 인증 (재시도 로직 추가)
      let authRetryCount = 0;
      const authMaxRetries = 2;
      
      while (authRetryCount <= authMaxRetries) {
        try {
          client = this.config.createClient();
          client.timeout = 10000; // 10초 타임아웃
          client.connectTimeout = 5000; // 5초 연결 타임아웃
          
          const bindAsync = promisify(client.bind).bind(client);
          await bindAsync(userInfo.dn, password);
          break; // 성공 시 루프 탈출
          
        } catch (bindError) {
          if (client) {
            try {
              client.unbind(() => {});
            } catch (unbindError) {
              // 무시
            }
          }
          
          if (bindError.name === 'InvalidCredentialsError') {
            throw new Error('Invalid username or password');
          }
          
          authRetryCount++;
          const isRetryableError = bindError.message.includes('closed') || 
                                  bindError.message.includes('timeout') ||
                                  bindError.message.includes('ECONNREFUSED') ||
                                  bindError.message.includes('ETIMEDOUT');
          
          if (authRetryCount <= authMaxRetries && isRetryableError) {
            console.warn(`LDAP authentication failed (attempt ${authRetryCount}/${authMaxRetries + 1}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500 * authRetryCount));
            continue;
          }
          
          throw new Error(`Authentication failed: ${bindError.message}`);
        }
      }

      // 그룹 확인 (설정된 경우)
      if (this.config.getConfig().allowedGroups.length > 0) {
        const hasAccess = await this.checkUserGroups(userInfo.dn);
        if (!hasAccess) {
          throw new Error('User does not have access to this application');
        }
      }

      // 사용자 정보 업데이트/생성
      let user;
      try {
        user = await this.syncUserToDatabase(userInfo);
      } catch (dbError) {
        console.error('데이터베이스 사용자 동기화 실패:', dbError.message);
        throw new Error(`Database connection failed: ${dbError.message}`);
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
    let client = null;
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 1000; // 1초

    while (retryCount <= maxRetries) {
      try {
        client = this.config.createClient();
        
        // 연결 타임아웃 설정
        client.timeout = 15000; // 15초
        client.connectTimeout = 10000; // 10초

        // 관리자 계정으로 바인드 (재시도 로직 포함)
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
          timeLimit: 15, // 검색 시간 제한 증가
          sizeLimit: 1,
        };

        const searchResult = await searchAsync(this.config.getConfig().searchBase, searchOptions);

        return new Promise((resolve, reject) => {
          let user = null;
          let entryCount = 0;
          let searchCompleted = false;

          const cleanup = () => {
            if (!searchCompleted) {
              searchCompleted = true;
              if (client && !client.destroyed) {
                client.unbind(() => {
                  // Connection cleaned up
                });
              }
            }
          };

          searchResult.on('searchEntry', (entry) => {
            entryCount++;
            if (entryCount === 1) {
              user = this.config.mapUserAttributes(entry);
            }
          });

          searchResult.on('error', (error) => {
            cleanup();
            const errorMsg = `LDAP search error (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}`;
            console.error(errorMsg);
            reject(new Error(errorMsg));
          });

          searchResult.on('end', (result) => {
            cleanup();
            
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

          // 타임아웃 설정 (더 긴 시간으로 조정)
          setTimeout(() => {
            if (!searchCompleted) {
              cleanup();
              reject(new Error(`LDAP search timeout after 15 seconds (attempt ${retryCount + 1}/${maxRetries + 1})`));
            }
          }, 15000);
        });

      } catch (error) {
        // 연결 정리
        if (client && !client.destroyed) {
          try {
            client.unbind(() => {
              // Connection closed
            });
          } catch (unbindError) {
            console.warn('Error during client unbind:', unbindError.message);
          }
        }

        retryCount++;
        const isConnectionError = error.message.includes('closed') || 
                                 error.message.includes('timeout') || 
                                 error.message.includes('ECONNREFUSED') ||
                                 error.message.includes('ETIMEDOUT');

        if (retryCount <= maxRetries && isConnectionError) {
          console.warn(`LDAP connection failed (attempt ${retryCount}/${maxRetries + 1}), retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount)); // 지수 백오프
          continue;
        }

        console.error(`LDAP user search failed after ${retryCount} attempts:`, error.message);
        throw error;
      }
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
