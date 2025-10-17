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
        fullName: dbUser.full_name,  // DB에서 가져온 값 사용
        department: dbUser.department,
      },
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
 * 로그아웃 (단순히 성공 응답만)
 */
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: '로그아웃되었습니다.'
  });
});

module.exports = router;