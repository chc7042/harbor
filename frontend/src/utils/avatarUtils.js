/**
 * 사용자 아바타 관련 유틸리티
 */
import CryptoJS from 'crypto-js';

/**
 * MD5 해시 생성 (Gravatar용)
 * @param {string} email - 이메일 주소
 * @returns {string} - MD5 해시
 */
const generateMD5Hash = (email) => {
  const normalizedEmail = email.toLowerCase().trim();
  return CryptoJS.MD5(normalizedEmail).toString();
};

/**
 * Gravatar URL 생성
 * @param {string} email - 이메일 주소
 * @param {number} size - 이미지 크기 (기본값: 32)
 * @returns {string} - Gravatar 이미지 URL
 */
export const getGravatarUrl = (email, size = 32) => {
  if (!email) return null;
  
  const hash = generateMD5Hash(email);
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
};


/**
 * 사용자 이니셜 추출
 * @param {Object} user - 사용자 정보 객체
 * @returns {string} - 추출된 이니셜
 */
export const getUserInitials = (user) => {
  if (!user) return 'U';

  // fullName 또는 name이 있으면 사용
  const fullName = user.full_name || user.name;
  if (fullName) {
    const names = fullName.trim().split(' ');
    if (names.length >= 2) {
      return names[0].charAt(0) + names[names.length - 1].charAt(0);
    }
    return names[0].charAt(0);
  }

  // username에서 추출
  const username = user.username;
  if (username) {
    if (username.includes('.')) {
      const parts = username.split('.');
      return parts[0].charAt(0) + parts[1].charAt(0);
    }
    return username.charAt(0);
  }

  return 'U';
};

/**
 * 사용자별 색상 생성 (사용자명 기반 해시)
 * @param {string} username - 사용자명
 * @returns {string} - 색상 코드
 */
export const generateUserColor = (username) => {
  if (!username) return '#1e40af';

  // 간단한 해시 함수로 사용자별 고유 색상 생성
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  // HSL 색상으로 변환 (채도와 밝기는 고정, 색조만 변경)
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
};