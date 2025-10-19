const express = require('express');
const { getLDAPService } = require('../services/ldapService');
const { query } = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

/**
 * LDAP 로그인
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: { message: '사용자명과 비밀번호를 입력해주세요.' }
      });
    }

    console.log(`🔥 LOGIN ATTEMPT: ${username}`);

    // LDAP 인증
    const ldapService = getLDAPService();
    const ldapUser = await ldapService.authenticateUser(username, password);

    if (!ldapUser) {
      return res.status(401).json({
        success: false,
        error: { message: '사용자명 또는 비밀번호가 올바르지 않습니다.' }
      });
    }

    console.log(`🔥 LDAP SUCCESS: ${username}`, ldapUser);

    // 한국어 이름 매핑
    const usernameToKoreanMap = {
      'nicolas.choi': '최현창',
      'admin': '관리자',
    };

    const finalFullName = usernameToKoreanMap[username] || ldapUser.fullName || username;
    console.log(`🔥 FINAL FULLNAME: ${username} -> ${finalFullName}`);

    // 데이터베이스에 사용자 정보 저장/업데이트
    let dbUser;
    const findQuery = 'SELECT * FROM users WHERE username = $1';
    const findResult = await query(findQuery, [username]);

    if (findResult.rows.length > 0) {
      // 기존 사용자 업데이트
      const updateQuery = `
        UPDATE users 
        SET email = $2, full_name = $3, department = $4, last_login = NOW(), updated_at = NOW()
        WHERE username = $1 
        RETURNING *
      `;
      const updateResult = await query(updateQuery, [
        username,
        ldapUser.email || `${username}@roboetech.com`,
        finalFullName,
        ldapUser.department || 'Development'
      ]);
      dbUser = updateResult.rows[0];
      console.log(`🔥 UPDATED USER:`, dbUser);
    } else {
      // 새 사용자 생성
      const insertQuery = `
        INSERT INTO users (username, email, full_name, department, is_active, created_at, updated_at, last_login)
        VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())
        RETURNING *
      `;
      const insertResult = await query(insertQuery, [
        username,
        ldapUser.email || `${username}@roboetech.com`,
        finalFullName,
        ldapUser.department || 'Development'
      ]);
      dbUser = insertResult.rows[0];
      console.log(`🔥 CREATED USER:`, dbUser);
    }

    // 응답
    res.json({
      success: true,
      user: {
        userId: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        full_name: dbUser.full_name,  // DB에서 가져온 값 사용 (프런트엔드 기대값)
        department: dbUser.department,
      },
      token: 'dummy-token',  // 임시 토큰 (실제로는 JWT 생성)
      message: '로그인 성공'
    });

  } catch (error) {
    console.error('🔥 LOGIN ERROR:', error);
    res.status(500).json({
      success: false,
      error: { message: '서버 오류가 발생했습니다.' }
    });
  }
});

/**
 * 현재 사용자 정보 조회 (JWT 토큰 기반)
 */
router.get('/me', async (req, res) => {
  try {
    // 임시로 localStorage에서 전달받은 토큰 기반으로 사용자 조회
    // 실제로는 JWT 미들웨어에서 처리해야 하지만, 현재는 단순화
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: '인증 토큰이 필요합니다.' }
      });
    }

    // 임시로 admin 사용자 정보 반환 (실제로는 토큰에서 사용자 정보 추출)
    // TODO: JWT 토큰 검증 및 사용자 정보 추출 로직 구현
    const username = 'nicolas.choi'; // 임시로 하드코딩
    
    const findQuery = 'SELECT * FROM users WHERE username = $1';
    const findResult = await query(findQuery, [username]);
    
    if (findResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: '사용자를 찾을 수 없습니다.' }
      });
    }
    
    const dbUser = findResult.rows[0];
    
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
    
    const mappedDepartment = departmentMap[dbUser.department] || dbUser.department;
    
    res.json({
      success: true,
      user: {
        userId: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        full_name: dbUser.full_name,  // full_name으로 전송 (프런트엔드 기대값)
        department: mappedDepartment,
      }
    });

  } catch (error) {
    console.error('🔥 /auth/me ERROR:', error);
    res.status(500).json({
      success: false,
      error: { message: '서버 오류가 발생했습니다.' }
    });
  }
});

/**
 * 로그아웃 (단순히 성공 응답만)
 */
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: '로그아웃되었습니다.'
  });
});

module.exports = router;