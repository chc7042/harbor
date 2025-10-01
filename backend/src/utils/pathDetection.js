// const logger = require('../config/logger'); // Not currently used, but may be needed for future debugging

/**
 * Path detection utilities for NAS 경로 자동 탐지
 * 빌드 타임스탬프 기반으로 NAS 경로 후보들을 생성하고 검증하는 유틸리티
 */

/**
 * Jenkins 빌드 타임스탬프를 NAS 날짜 형식(YYMMDD)으로 변환
 * @param {Date|string|number} timestamp - Jenkins 빌드 타임스탬프
 * @returns {string} - YYMMDD 형식의 날짜 문자열
 * @example
 * formatDateForNAS(new Date('2025-03-10T17:39:00Z')) // returns '250310'
 * formatDateForNAS('2025-03-10T17:39:00Z') // returns '250310'
 * formatDateForNAS(1710087540000) // returns '250310'
 */
function formatDateForNAS(timestamp) {
  if (!timestamp) {
    throw new Error('Timestamp is required');
  }

  let date;
  if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === 'string') {
    date = new Date(timestamp);
  } else if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else {
    throw new Error('Invalid timestamp format. Must be Date, string, or number');
  }

  if (isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  return `${year}${month}${day}`;
}

/**
 * 빌드 날짜 기준으로 ±1일 범위의 날짜 후보들을 생성
 * @param {Date|string|number} buildDate - 빌드 날짜
 * @param {number} [dayRange=1] - 날짜 범위 (기본값: ±1일)
 * @returns {string[]} - YYMMDD 형식의 날짜 후보 배열 (우선순위 순)
 * @example
 * generatePathCandidates(new Date('2025-03-10'))
 * // returns ['250310', '250309', '250311']
 */
function generatePathCandidates(buildDate, dayRange = 1) {
  if (!buildDate) {
    throw new Error('Build date is required');
  }

  const candidates = [];
  const baseDate = new Date(buildDate);

  if (isNaN(baseDate.getTime())) {
    throw new Error('Invalid build date');
  }

  // 빌드 날짜 자체를 첫 번째 후보로 추가
  candidates.push(formatDateForNAS(baseDate));

  // ±dayRange 범위 내에서 날짜 후보들 생성
  for (let i = 1; i <= dayRange; i++) {
    // 하루 전
    const prevDate = new Date(baseDate);
    prevDate.setDate(baseDate.getDate() - i);
    candidates.push(formatDateForNAS(prevDate));

    // 하루 후
    const nextDate = new Date(baseDate);
    nextDate.setDate(baseDate.getDate() + i);
    candidates.push(formatDateForNAS(nextDate));
  }

  // 중복 제거 (같은 달의 첫날/마지막날 경계에서 발생할 수 있음)
  return [...new Set(candidates)];
}

/**
 * NAS 경로를 구성하는 함수
 * @param {string} version - 버전 정보 (예: "3.0.0")
 * @param {string} dateStr - YYMMDD 형식의 날짜
 * @param {number} buildNumber - 빌드 번호
 * @param {Object} [options] - 추가 옵션
 * @param {string} [options.baseUrl] - 기본 NAS URL (기본값: "\\\\nas.roboetech.com\\release_version\\release\\product")
 * @param {string} [options.prefix] - 버전 접두사 (기본값: "mr")
 * @returns {string} - 완성된 NAS 경로
 * @example
 * constructNASPath('3.0.0', '250310', 26)
 * // returns '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26'
 */
function constructNASPath(version, dateStr, buildNumber, options = {}) {
  if (!version || !dateStr || buildNumber === undefined || buildNumber === null) {
    throw new Error('Version, dateStr, and buildNumber are required');
  }

  if (typeof buildNumber !== 'number' || buildNumber < 0) {
    throw new Error('Build number must be a non-negative number');
  }

  if (!/^\d{6}$/.test(dateStr)) {
    throw new Error('DateStr must be in YYMMDD format (6 digits)');
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Version must be in semantic version format (e.g., "3.0.0")');
  }

  const {
    baseUrl = '\\\\nas.roboetech.com\\release_version\\release\\product',
    prefix = 'mr',
  } = options;

  return `${baseUrl}\\${prefix}${version}\\${dateStr}\\${buildNumber}`;
}

/**
 * 파일 패턴 정의 및 검출 유틸리티
 */
const FILE_PATTERNS = {
  // V버전 파일 패턴 (메인 다운로드 파일)
  VERSION_FILE: /^V\d+\.\d+\.\d+_\d{6}_\d{4}\.tar\.gz$/,

  // MR 릴리즈 파일 패턴
  MR_RELEASE: /^mr\d+\.\d+\.\d+_\d{6}_\d{4}_\d+\.enc\.tar\.gz$/,

  // BE 백엔드 파일 패턴
  BACKEND_FILE: /^be\d+\.\d+\.\d+_\d{6}_\d{4}_\d+\.enc\.tar\.gz$/,

  // FE 프론트엔드 파일 패턴
  FRONTEND_FILE: /^fe\d+\.\d+\.\d+_\d{6}_\d{4}_\d+\.enc\.tar\.gz$/,

  // 일반 tar.gz 파일 패턴
  TAR_FILE: /\.tar\.gz$/,

  // 암호화된 tar.gz 파일 패턴
  ENCRYPTED_TAR: /\.enc\.tar\.gz$/,
};

/**
 * 파일명이 특정 패턴과 일치하는지 확인
 * @param {string} filename - 확인할 파일명
 * @param {string} patternType - 패턴 타입 (FILE_PATTERNS의 키)
 * @returns {boolean} - 패턴 일치 여부
 * @example
 * matchesPattern('V3.0.0_250310_0843.tar.gz', 'VERSION_FILE') // returns true
 * matchesPattern('mr3.0.0_250310_1739_26.enc.tar.gz', 'MR_RELEASE') // returns true
 */
function matchesPattern(filename, patternType) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }

  const pattern = FILE_PATTERNS[patternType];
  if (!pattern) {
    throw new Error(`Unknown pattern type: ${patternType}`);
  }

  return pattern.test(filename);
}

/**
 * 파일 목록에서 패턴별로 파일들을 분류
 * @param {string[]} files - 파일명 배열
 * @returns {Object} - 패턴별로 분류된 파일 객체
 * @example
 * categorizeFiles(['V3.0.0_250310_0843.tar.gz', 'mr3.0.0_250310_1739_26.enc.tar.gz'])
 * // returns {
 * //   versionFiles: ['V3.0.0_250310_0843.tar.gz'],
 * //   mrFiles: ['mr3.0.0_250310_1739_26.enc.tar.gz'],
 * //   backendFiles: [],
 * //   frontendFiles: [],
 * //   otherFiles: []
 * // }
 */
function categorizeFiles(files) {
  if (!Array.isArray(files)) {
    throw new Error('Files must be an array');
  }

  const categorized = {
    versionFiles: [],
    mrFiles: [],
    backendFiles: [],
    frontendFiles: [],
    otherFiles: [],
  };

  files.forEach(file => {
    if (typeof file !== 'string' || file === '') {
      return; // 잘못된 파일명 또는 빈 문자열은 무시
    }

    if (matchesPattern(file, 'VERSION_FILE')) {
      categorized.versionFiles.push(file);
    } else if (matchesPattern(file, 'MR_RELEASE')) {
      categorized.mrFiles.push(file);
    } else if (matchesPattern(file, 'BACKEND_FILE')) {
      categorized.backendFiles.push(file);
    } else if (matchesPattern(file, 'FRONTEND_FILE')) {
      categorized.frontendFiles.push(file);
    } else {
      categorized.otherFiles.push(file);
    }
  });

  return categorized;
}

/**
 * 파일 목록에서 메인 다운로드 파일을 결정
 * 우선순위: VERSION_FILE > MR_RELEASE > 첫 번째 파일
 * @param {string[]} files - 파일명 배열
 * @returns {string|null} - 메인 다운로드 파일명 또는 null
 * @example
 * determineMainDownloadFile(['mr3.0.0_250310_1739_26.enc.tar.gz', 'V3.0.0_250310_0843.tar.gz'])
 * // returns 'V3.0.0_250310_0843.tar.gz'
 */
function determineMainDownloadFile(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }

  const categorized = categorizeFiles(files);

  // VERSION_FILE이 있으면 우선 선택
  if (categorized.versionFiles.length > 0) {
    return categorized.versionFiles[0];
  }

  // MR_RELEASE 파일이 있으면 선택
  if (categorized.mrFiles.length > 0) {
    return categorized.mrFiles[0];
  }

  // 그 외의 경우 첫 번째 파일 선택
  return files.find(file => typeof file === 'string') || null;
}

/**
 * 버전과 날짜 정보를 바탕으로 예상 파일명들을 생성
 * @param {string} version - 버전 정보 (예: "3.0.0")
 * @param {string} dateStr - YYMMDD 형식의 날짜
 * @param {number} buildNumber - 빌드 번호
 * @returns {Object} - 예상 파일명들
 * @example
 * generateExpectedFilenames('3.0.0', '250310', 26)
 * // returns {
 * //   versionFile: 'V3.0.0_250310_*.tar.gz',
 * //   mrFile: 'mr3.0.0_250310_*_26.enc.tar.gz',
 * //   backendFile: 'be3.0.0_250310_*_*.enc.tar.gz',
 * //   frontendFile: 'fe3.0.0_250310_*_*.enc.tar.gz'
 * // }
 */
function generateExpectedFilenames(version, dateStr, buildNumber) {
  if (!version || !dateStr || buildNumber === undefined) {
    throw new Error('Version, dateStr, and buildNumber are required');
  }

  return {
    versionFile: `V${version}_${dateStr}_*.tar.gz`,
    mrFile: `mr${version}_${dateStr}_*_${buildNumber}.enc.tar.gz`,
    backendFile: `be${version}_${dateStr}_*_*.enc.tar.gz`,
    frontendFile: `fe${version}_${dateStr}_*_*.enc.tar.gz`,
  };
}

/**
 * 파일명에서 빌드 정보를 추출
 * @param {string} filename - 파일명
 * @returns {Object|null} - 추출된 빌드 정보 또는 null
 * @example
 * extractBuildInfoFromFilename('mr3.0.0_250310_1739_26.enc.tar.gz')
 * // returns {
 * //   version: '3.0.0',
 * //   date: '250310',
 * //   time: '1739',
 * //   buildNumber: '26',
 * //   type: 'mr',
 * //   encrypted: true
 * // }
 */
function extractBuildInfoFromFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return null;
  }

  // 다양한 파일 패턴에 대한 정규식
  const patterns = [
    // V3.0.0_250310_0843.tar.gz
    /^(V)(\d+\.\d+\.\d+)_(\d{6})_(\d{4})(\.tar\.gz)$/,
    // mr3.0.0_250310_1739_26.enc.tar.gz
    /^(mr|be|fe)(\d+\.\d+\.\d+)_(\d{6})_(\d{4})_(\d+)(\.enc\.tar\.gz)$/,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const isEncrypted = filename.includes('.enc.');
      const result = {
        version: match[2],
        date: match[3],
        time: match[4],
        type: match[1].toLowerCase(),
        encrypted: isEncrypted,
      };

      // 빌드 번호가 있는 경우 추가
      if (match[5] && /^\d+$/.test(match[5])) {
        result.buildNumber = match[5];
      }

      return result;
    }
  }

  return null;
}

/**
 * 경로 후보들을 우선순위에 따라 정렬
 * @param {string[]} pathCandidates - 경로 후보 배열
 * @param {Date} buildDate - 빌드 날짜 (우선순위 결정용)
 * @returns {string[]} - 우선순위 정렬된 경로 후보 배열
 */
function prioritizePathCandidates(pathCandidates, buildDate) {
  if (!Array.isArray(pathCandidates) || pathCandidates.length === 0) {
    return [];
  }

  if (!buildDate) {
    return pathCandidates; // 빌드 날짜가 없으면 원본 순서 유지
  }

  const baseDateStr = formatDateForNAS(buildDate);

  return pathCandidates.sort((a, b) => {
    // 경로에서 날짜 부분 추출
    const aDateMatch = a.match(/\\(\d{6})\\[^\\]*$/);
    const bDateMatch = b.match(/\\(\d{6})\\[^\\]*$/);

    if (!aDateMatch || !bDateMatch) {
      return 0; // 날짜를 추출할 수 없으면 원본 순서 유지
    }

    const aDate = aDateMatch[1];
    const bDate = bDateMatch[1];

    // 기준 날짜와 같은 날짜가 최우선
    if (aDate === baseDateStr && bDate !== baseDateStr) return -1;
    if (bDate === baseDateStr && aDate !== baseDateStr) return 1;

    // 둘 다 기준 날짜가 아니면 원본 순서 유지
    return 0;
  });
}

module.exports = {
  formatDateForNAS,
  generatePathCandidates,
  constructNASPath,
  matchesPattern,
  categorizeFiles,
  determineMainDownloadFile,
  generateExpectedFilenames,
  extractBuildInfoFromFilename,
  prioritizePathCandidates,
  FILE_PATTERNS,
};
