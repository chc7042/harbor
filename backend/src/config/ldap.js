const ldap = require('ldapjs');
const { promisify } = require('util');

/**
 * LDAP 설정 및 연결 관리
 */
class LDAPConfig {
  constructor() {
    this.config = {
      url: process.env.LDAP_URL || 'ldap://localhost:389',
      bindDN: process.env.LDAP_BIND_DN || 'cn=admin,dc=company,dc=com',
      bindCredentials: process.env.LDAP_BIND_CREDENTIALS || '',
      searchBase: process.env.LDAP_SEARCH_BASE || 'ou=users,dc=company,dc=com',
      searchFilter: process.env.LDAP_SEARCH_FILTER || '(uid={{username}})',

      // 연결 설정
      timeout: parseInt(process.env.LDAP_TIMEOUT, 10) || 5000,
      connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT, 10) || 3000,

      // TLS 설정
      tlsOptions: {
        rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.LDAP_TLS_CA ? [process.env.LDAP_TLS_CA] : undefined,
      },

      // 속성 매핑
      attributeMap: {
        username: process.env.LDAP_ATTR_USERNAME || 'uid',
        email: process.env.LDAP_ATTR_EMAIL || 'mail',
        fullName: process.env.LDAP_ATTR_FULL_NAME || 'cn',
        department: process.env.LDAP_ATTR_DEPARTMENT || 'ou',
        employeeId: process.env.LDAP_ATTR_EMPLOYEE_ID || 'employeeNumber',
      },

      // 그룹 필터링 (선택적)
      groupBase: process.env.LDAP_GROUP_BASE || 'ou=groups,dc=company,dc=com',
      groupFilter: process.env.LDAP_GROUP_FILTER || '(member={{dn}})',
      allowedGroups: process.env.LDAP_ALLOWED_GROUPS ?
        process.env.LDAP_ALLOWED_GROUPS.split(',').map(g => g.trim()) : [],
    };

    // 설정 검증
    this.validateConfig();
  }

  validateConfig() {
    // 개발 환경에서 모의 인증이 활성화된 경우 검증 건너뛰기
    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MOCK_AUTH === 'true') {
      console.log('LDAP configuration validation skipped for mock authentication');
      return;
    }

    const requiredFields = ['url', 'bindDN', 'bindCredentials', 'searchBase'];
    const missingFields = requiredFields.filter(field => !this.config[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required LDAP configuration: ${missingFields.join(', ')}`);
    }

    // URL 형식 검증
    try {
      new URL(this.config.url);
    } catch (error) {
      throw new Error(`Invalid LDAP URL: ${this.config.url}`);
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
      reconnect: {
        initialDelay: 100,
        maxDelay: 1000,
        failAfter: 3,
      },
      strictDN: false,
      bindDN: this.config.bindDN,
      bindCredentials: this.config.bindCredentials,
    };

    // LDAPS 또는 StartTLS 설정
    if (this.config.url.startsWith('ldaps://') || process.env.LDAP_START_TLS === 'true') {
      clientOptions.tlsOptions = this.config.tlsOptions;
    }

    const client = ldap.createClient(clientOptions);

    // 에러 이벤트 처리
    client.on('error', (err) => {
      console.error('LDAP client error:', err);
    });

    client.on('connect', () => {
      console.log('LDAP client connected');
    });

    client.on('close', () => {
      console.log('LDAP client disconnected');
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
   * 그룹 필터 생성
   */
  buildGroupFilter(userDN) {
    return this.config.groupFilter.replace('{{dn}}', this.escapeFilterValue(userDN));
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
  mapUserAttributes(ldapEntry) {
    const user = {
      username: this.getAttributeValue(ldapEntry, this.config.attributeMap.username),
      email: this.getAttributeValue(ldapEntry, this.config.attributeMap.email),
      fullName: this.getAttributeValue(ldapEntry, this.config.attributeMap.fullName),
      department: this.getAttributeValue(ldapEntry, this.config.attributeMap.department),
      employeeId: this.getAttributeValue(ldapEntry, this.config.attributeMap.employeeId),
      dn: ldapEntry.dn,
    };

    // username이 없으면 dn에서 추출
    if (!user.username && user.dn) {
      const dnParts = user.dn.split(',');
      for (const part of dnParts) {
        if (part.trim().startsWith('uid=')) {
          user.username = part.trim().substring(4);
          break;
        } else if (part.trim().startsWith('cn=')) {
          user.username = part.trim().substring(3);
          break;
        }
      }
    }

    // 이메일이 없는 경우 기본 도메인으로 생성
    if (!user.email && user.username && process.env.LDAP_DEFAULT_EMAIL_DOMAIN) {
      user.email = `${user.username}@${process.env.LDAP_DEFAULT_EMAIL_DOMAIN}`;
    }

    // fullName이 없으면 username 사용
    if (!user.fullName && user.username) {
      user.fullName = user.username.split('.').map(name =>
        name.charAt(0).toUpperCase() + name.slice(1),
      ).join(' ');
    }

    // department가 없으면 기본값 설정
    if (!user.department) {
      user.department = process.env.LDAP_DEFAULT_DEPARTMENT || 'Unknown';
    }

    // 빈 값 정리 (username은 필수이므로 제외)
    Object.keys(user).forEach(key => {
      if (key !== 'username' && (user[key] === undefined || user[key] === '')) {
        delete user[key];
      }
    });

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

    // 첫 번째 값 반환 (대부분의 속성이 단일 값)
    return attribute.values[0];
  }

  /**
   * 연결 테스트
   */
  async testConnection() {
    const client = this.createClient();

    try {
      // Promisify bind method
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(this.config.bindDN, this.config.bindCredentials);

      console.log('LDAP connection test successful');
      return true;
    } catch (error) {
      console.error('LDAP connection test failed:', error.message);
      throw new Error(`LDAP connection failed: ${error.message}`);
    } finally {
      client.unbind(() => {
        // Connection closed
      });
    }
  }

  /**
   * 헬스체크
   */
  async healthCheck() {
    try {
      await this.testConnection();
      return {
        status: 'healthy',
        url: this.config.url,
        searchBase: this.config.searchBase,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        url: this.config.url,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Getter for config (read-only access)
  getConfig() {
    // Return a copy to prevent external modifications
    return { ...this.config };
  }
}

// 싱글톤 인스턴스
let ldapConfig = null;

function getLDAPConfig() {
  if (!ldapConfig) {
    ldapConfig = new LDAPConfig();
  }
  return ldapConfig;
}

module.exports = {
  LDAPConfig,
  getLDAPConfig,
};
