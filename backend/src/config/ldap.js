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

      // 연결 설정 (OpenLDAP 서버 응답 지연을 고려한 더 긴 타임아웃)
      timeout: parseInt(process.env.LDAP_TIMEOUT, 10) || 30000,
      connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT, 10) || 20000,

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
        department: process.env.LDAP_ATTR_DEPARTMENT || 'department',
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
    if (process.env.ENABLE_MOCK_AUTH === 'true') {
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
      reconnect: false, // 자동 재연결 비활성화 (수동으로 관리)
      strictDN: false,
    };

    // LDAPS 또는 StartTLS 설정
    if (this.config.url.startsWith('ldaps://') || process.env.LDAP_START_TLS === 'true') {
      clientOptions.tlsOptions = this.config.tlsOptions;
    }

    const client = ldap.createClient(clientOptions);

    // 에러 이벤트 처리 (로그 레벨을 낮춤)
    client.on('error', (err) => {
      console.debug('LDAP client error:', err.message);
    });

    client.on('connect', () => {
      console.debug('LDAP client connected to', this.config.url);
    });

    client.on('close', () => {
      console.debug('LDAP client disconnected from', this.config.url);
    });

    // 연결 실패 처리
    client.on('connectError', (err) => {
      console.debug('LDAP connection error:', err.message);
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
   * 사용자 속성 매핑 (그룹 기반 부서 매핑 포함)
   */
  async mapUserAttributes(ldapEntry, searchUsername = null) {
    const user = {
      username: this.getAttributeValue(ldapEntry, this.config.attributeMap.username),
      email: this.getAttributeValue(ldapEntry, this.config.attributeMap.email),
      fullName: this.getAttributeValue(ldapEntry, this.config.attributeMap.fullName),
      department: this.getDepartmentValue(ldapEntry),
      employeeId: this.getAttributeValue(ldapEntry, this.config.attributeMap.employeeId),
      dn: ldapEntry.dn,
    };

    // 사용자명 결정 우선순위: searchUsername > UID from DN > existing username > CN from DN
    const uidFromDN = this.getUidFromDN(user.dn);
    
    if (searchUsername && /^[a-zA-Z0-9._-]+$/.test(searchUsername)) {
      // 검색에 사용된 username이 영문이면 이를 사용 (nicolas.choi 같은 경우)
      user.username = searchUsername;
    } else if (uidFromDN) {
      // DN에서 UID 추출 가능하면 사용
      user.username = uidFromDN;
    } else if (!user.username && user.dn) {
      // 위의 모든 방법이 실패하면 DN에서 CN 추출
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

    // fullName이 없으면 username 사용
    if (!user.fullName && user.username) {
      user.fullName = user.username.split('.').map(name =>
        name.charAt(0).toUpperCase() + name.slice(1),
      ).join(' ');
    }

    // 부서 정보가 없으면 그룹 멤버십을 기반으로 부서 결정
    if (!user.department && user.dn) {
      try {
        const departmentFromGroup = await this.getDepartmentFromGroups(user.dn);
        if (departmentFromGroup) {
          user.department = departmentFromGroup;
        }
      } catch (error) {
        console.debug('Failed to get department from groups:', error.message);
      }
    }

    // 여전히 department가 없으면 사용자 이름 기반으로 임시 매핑 (실제 그룹 설정 전까지)
    if (!user.department) {
      // 임시 사용자 이름 기반 부서 매핑
      const nameToDepartmentMap = {
        '우일': 'Development',
        'il.woo': 'Development',
        'Hieu Dao': 'Development',
        '고지성': 'Sales',
        '김갑겸': 'Sales', 
        '김경민': 'Finance',
        '김대진': 'Development',
        '김범관': 'Development',
        '김정한': 'Sales',
        '도대국': 'Finance',
        'nicolas.choi': 'Development',
        '최현창': 'Development'
      };
      
      const mappedDepartment = nameToDepartmentMap[user.username] || nameToDepartmentMap[user.fullName];
      if (mappedDepartment) {
        user.department = mappedDepartment;
        console.log(`Mapped user ${user.username} to department: ${mappedDepartment}`);
      } else {
        user.department = process.env.LDAP_DEFAULT_DEPARTMENT || 'IT';
      }
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
   * 부서 정보 추출 (여러 속성 시도 + 그룹 기반 매핑)
   */
  getDepartmentValue(ldapEntry) {
    // 가능한 부서 속성들을 순서대로 시도
    const departmentAttributes = [
      'department',
      'departmentNumber', 
      'ou',
      'organizationalUnit',
      'division',
      'businessCategory'
    ];

    for (const attr of departmentAttributes) {
      const value = this.getAttributeValue(ldapEntry, attr);
      if (value && value.trim()) {
        return value.trim();
      }
    }

    // DN에서 OU 추출 시도
    if (ldapEntry.dn) {
      const dnParts = ldapEntry.dn.split(',');
      for (const part of dnParts) {
        const trimmedPart = part.trim();
        if (trimmedPart.toLowerCase().startsWith('ou=')) {
          const ouValue = trimmedPart.substring(3);
          // 일반적인 구조 OU (users, groups 등) 제외
          if (!['users', 'groups', 'people', 'computers'].includes(ouValue.toLowerCase())) {
            return ouValue;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * 사용자의 그룹 멤버십을 기반으로 부서 결정
   */
  async getDepartmentFromGroups(userDN) {
    // 그룹명과 부서명 매핑
    const groupToDepartmentMap = {
      'dev_team': 'Development',
      'sales': 'Sales',
      'financial': 'Finance'
    };

    const client = this.createClient();
    
    try {
      const bindAsync = promisify(client.bind).bind(client);
      await bindAsync(this.config.bindDN, this.config.bindCredentials);

      // 각 그룹을 확인하여 사용자가 속한 그룹 찾기
      for (const [groupName, departmentName] of Object.entries(groupToDepartmentMap)) {
        try {
          const searchAsync = promisify(client.search).bind(client);
          const groupDN = `cn=${groupName},ou=groups,dc=roboetech,dc=com`;
          
          const searchResult = await searchAsync(groupDN, {
            scope: 'base',
            filter: `(|(member=${userDN})(memberUid=${this.getUidFromDN(userDN)}))`,
            attributes: ['cn']
          });

          const found = await new Promise((resolve, reject) => {
            let hasEntry = false;
            
            searchResult.on('searchEntry', () => {
              hasEntry = true;
            });
            
            searchResult.on('end', () => {
              resolve(hasEntry);
            });
            
            searchResult.on('error', (err) => {
              reject(err);
            });
          });

          if (found) {
            console.log(`User ${userDN} found in group ${groupName}, mapped to department: ${departmentName}`);
            return departmentName;
          }
        } catch (groupError) {
          console.debug(`Error checking group ${groupName}:`, groupError.message);
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error('Error determining department from groups:', error.message);
      return null;
    } finally {
      if (client) {
        client.unbind(() => {});
      }
    }
  }

  /**
   * DN에서 UID 추출
   */
  getUidFromDN(dn) {
    const match = dn.match(/uid=([^,]+)/i);
    return match ? match[1] : null;
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
