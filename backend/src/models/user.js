const { query, withTransaction } = require('../config/database');
const crypto = require('crypto');

/**
 * 사용자 모델 클래스
 */
class UserModel {
  /**
   * 사용자 생성
   * @param {Object} userData - 사용자 데이터
   * @returns {Promise<Object>} - 생성된 사용자 정보
   */
  static async create(userData) {
    const {
      username,
      email,
      fullName,
      department,
      employeeId,
    } = userData;

    try {
      const insertQuery = `
        INSERT INTO users (username, email, full_name, department)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email, full_name, department, is_active, created_at, updated_at
      `;

      const result = await query(insertQuery, [
        username,
        email || null,
        fullName || null,
        department || null,
      ]);

      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error(`User with username '${username}' already exists`);
      }
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  /**
   * 사용자 조회 (ID)
   * @param {string} userId - 사용자 ID
   * @returns {Promise<Object|null>} - 사용자 정보
   */
  static async findById(userId) {
    try {
      const result = await query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      throw new Error(`Failed to find user by ID: ${error.message}`);
    }
  }

  /**
   * 사용자 조회 (사용자명)
   * @param {string} username - 사용자명
   * @returns {Promise<Object|null>} - 사용자 정보
   */
  static async findByUsername(username) {
    try {
      const result = await query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      throw new Error(`Failed to find user by username: ${error.message}`);
    }
  }

  /**
   * 사용자 정보 업데이트
   * @param {string} userId - 사용자 ID
   * @param {Object} updateData - 업데이트할 데이터
   * @returns {Promise<Object>} - 업데이트된 사용자 정보
   */
  static async update(userId, updateData) {
    const allowedFields = ['email', 'full_name', 'department', 'is_active'];
    const updates = [];
    const values = [];
    let paramCount = 1;

    // 허용된 필드만 업데이트
    Object.keys(updateData).forEach(key => {
      const dbField = key === 'fullName' ? 'full_name' :
                      key === 'isActive' ? 'is_active' : key;

      if (allowedFields.includes(dbField)) {
        updates.push(`${dbField} = $${paramCount++}`);
        values.push(updateData[key]);
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    // updated_at 자동 갱신
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    try {
      const updateQuery = `
        UPDATE users
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, username, email, full_name, department, is_active, last_login, created_at, updated_at
      `;

      const result = await query(updateQuery, values);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  /**
   * 사용자 활성/비활성 상태 변경
   * @param {string} userId - 사용자 ID
   * @param {boolean} isActive - 활성 상태
   * @returns {Promise<Object>} - 업데이트된 사용자 정보
   */
  static async setActiveStatus(userId, isActive) {
    return this.update(userId, { isActive });
  }

  /**
   * 마지막 로그인 시간 업데이트
   * @param {string} userId - 사용자 ID
   * @returns {Promise<void>}
   */
  static async updateLastLogin(userId) {
    try {
      await query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [userId]
      );
    } catch (error) {
      console.error('Failed to update last login:', error.message);
      // 로그인 시간 업데이트 실패는 치명적이지 않으므로 에러를 throw하지 않음
    }
  }

  /**
   * 사용자 목록 조회 (페이지네이션)
   * @param {Object} options - 조회 옵션
   * @returns {Promise<Object>} - 사용자 목록과 페이지네이션 정보
   */
  static async findMany(options = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      department = null,
      isActive = null,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = options;

    const offset = (page - 1) * limit;
    const conditions = [];
    const values = [];
    let paramCount = 1;

    // 검색 조건
    if (search) {
      conditions.push(`(
        username ILIKE $${paramCount} OR
        full_name ILIKE $${paramCount} OR
        email ILIKE $${paramCount}
      )`);
      values.push(`%${search}%`);
      paramCount++;
    }

    if (department) {
      conditions.push(`department = $${paramCount++}`);
      values.push(department);
    }

    if (isActive !== null) {
      conditions.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      // 총 개수 조회
      const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
      const countResult = await query(countQuery, values);
      const total = parseInt(countResult.rows[0].total, 10);

      // 사용자 목록 조회
      const usersQuery = `
        SELECT
          id, username, email, full_name, department, is_active,
          last_login, created_at, updated_at
        FROM users
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramCount++} OFFSET $${paramCount}
      `;

      values.push(limit, offset);
      const usersResult = await query(usersQuery, values);

      const totalPages = Math.ceil(total / limit);

      return {
        users: usersResult.rows,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      throw new Error(`Failed to get user list: ${error.message}`);
    }
  }

  /**
   * 부서별 사용자 통계
   * @returns {Promise<Array>} - 부서별 통계
   */
  static async getDepartmentStats() {
    try {
      const result = await query(`
        SELECT
          department,
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
          COUNT(CASE WHEN last_login >= CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 1 END) as recent_logins
        FROM users
        WHERE department IS NOT NULL
        GROUP BY department
        ORDER BY total_users DESC
      `);

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get department stats: ${error.message}`);
    }
  }

  /**
   * 사용자 활동 통계
   * @param {number} days - 통계 기간 (일)
   * @returns {Promise<Object>} - 활동 통계
   */
  static async getActivityStats(days = 30) {
    try {
      const statsQuery = `
        SELECT
          DATE(last_login) as date,
          COUNT(DISTINCT id) as unique_logins
        FROM users
        WHERE last_login >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
        GROUP BY DATE(last_login)
        ORDER BY date ASC
      `;

      const dailyStats = await query(statsQuery);

      const summaryQuery = `
        SELECT
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
          COUNT(CASE WHEN last_login >= CURRENT_TIMESTAMP - INTERVAL '${days} days' THEN 1 END) as recent_users,
          COUNT(CASE WHEN created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days' THEN 1 END) as new_users
        FROM users
      `;

      const summaryResult = await query(summaryQuery);

      return {
        summary: summaryResult.rows[0],
        dailyActivity: dailyStats.rows,
        period: `${days} days`,
      };
    } catch (error) {
      throw new Error(`Failed to get activity stats: ${error.message}`);
    }
  }

  /**
   * 사용자 삭제 (소프트 삭제 - 비활성화)
   * @param {string} userId - 사용자 ID
   * @returns {Promise<Object>} - 삭제된 사용자 정보
   */
  static async softDelete(userId) {
    return withTransaction(async (client) => {
      // 사용자 비활성화
      const userResult = await client.query(
        'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      // 모든 세션 삭제
      await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);

      return userResult.rows[0];
    });
  }

  /**
   * 사용자 완전 삭제 (하드 삭제)
   * @param {string} userId - 사용자 ID
   * @returns {Promise<boolean>} - 삭제 성공 여부
   */
  static async hardDelete(userId) {
    return withTransaction(async (client) => {
      // 외래키 제약조건으로 인해 관련 데이터가 자동으로 삭제됨 (CASCADE)
      const result = await client.query('DELETE FROM users WHERE id = $1', [userId]);
      return result.rowCount > 0;
    });
  }

  /**
   * 사용자 검색 (전체 텍스트 검색)
   * @param {string} searchTerm - 검색어
   * @param {number} limit - 결과 제한
   * @returns {Promise<Array>} - 검색 결과
   */
  static async search(searchTerm, limit = 10) {
    try {
      const searchQuery = `
        SELECT
          id, username, email, full_name, department, is_active, last_login,
          ts_rank(to_tsvector('english', COALESCE(full_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(department, '')), plainto_tsquery('english', $1)) as rank
        FROM users
        WHERE
          is_active = true AND
          (
            username ILIKE $2 OR
            full_name ILIKE $2 OR
            email ILIKE $2 OR
            department ILIKE $2 OR
            to_tsvector('english', COALESCE(full_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(department, '')) @@ plainto_tsquery('english', $1)
          )
        ORDER BY rank DESC, username ASC
        LIMIT $3
      `;

      const result = await query(searchQuery, [
        searchTerm,
        `%${searchTerm}%`,
        limit,
      ]);

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to search users: ${error.message}`);
    }
  }

  /**
   * 비활성 사용자 정리
   * @param {number} inactiveDays - 비활성 기간 (일)
   * @returns {Promise<number>} - 정리된 사용자 수
   */
  static async cleanupInactiveUsers(inactiveDays = 365) {
    try {
      const result = await query(`
        UPDATE users
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE is_active = true
          AND (last_login IS NULL OR last_login < CURRENT_TIMESTAMP - INTERVAL '${inactiveDays} days')
          AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
        RETURNING id
      `);

      const cleanedCount = result.rows.length;

      if (cleanedCount > 0) {
        // 비활성화된 사용자들의 세션 정리
        const userIds = result.rows.map(row => row.id);
        await query('DELETE FROM user_sessions WHERE user_id = ANY($1)', [userIds]);
      }

      return cleanedCount;
    } catch (error) {
      throw new Error(`Failed to cleanup inactive users: ${error.message}`);
    }
  }
}

module.exports = UserModel;