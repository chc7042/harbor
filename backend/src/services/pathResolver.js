const path = require('path');
const logger = require('../config/logger');

/**
 * 중앙화된 경로 탐색 및 해결 서비스
 * 모든 NAS 경로 관련 로직을 통합 관리
 */
class PathResolver {
  constructor() {
    // NAS 기본 경로 설정
    this.baseNasPath = 'release_version/release/product';
    this.nasHost = 'nas.roboetech.com';
    this.releaseBasePath = process.env.NAS_RELEASE_PATH || 'release_version';
  }

  /**
   * 경로 정규화 - 모든 경로 형식을 표준 형식으로 변환
   * @param {string} inputPath 입력 경로
   * @returns {string} 정규화된 경로
   */
  normalizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      return '/release_version';
    }

    logger.info(`🔧 [PATH-RESOLVER] Original path: ${inputPath}`);

    let cleanPath = inputPath.replace(/\\/g, '/');
    logger.info(`🔧 [PATH-RESOLVER] After replacing backslashes: ${cleanPath}`);

    // NAS 호스트 경로 패턴 제거 및 중복 경로 처리
    if (cleanPath.includes('nas.roboetech.com')) {
      // nas.roboetech.com이 포함된 경우 모든 패턴 처리
      cleanPath = cleanPath.replace(/^.*nas\.roboetech\.com[\\\/]/, '/');

      // 중복된 release_version 제거
      cleanPath = cleanPath.replace(/^\/release_version\/release_version/, '/release_version');

      // release_version으로 시작하지 않으면 추가
      if (!cleanPath.startsWith('/release_version')) {
        cleanPath = '/release_version' + (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath);
      }
    } else if (!cleanPath.startsWith('/release_version')) {
      // release_version으로 시작하지 않는 경우 추가
      cleanPath = '/release_version' + (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath);
    }

    // 연속된 슬래시 정리
    cleanPath = cleanPath.replace(/\/+/g, '/');

    logger.info(`🔧 [PATH-RESOLVER] Final normalized path: ${cleanPath}`);
    return cleanPath;
  }

  /**
   * 버전에서 정확한 NAS 폴더 경로 생성
   * @param {string} version 버전 (예: 4.0.0, 1.2.0)
   * @returns {string} NAS 버전 폴더 경로
   */
  getVersionFolderPath(version) {
    const cleanVersion = version.startsWith('mr') ? version.substring(2) : version;
    const versionFolderName = `mr${cleanVersion}`;
    return '/' + path.posix.join(this.baseNasPath, versionFolderName);
  }

  /**
   * 파일 유형 분류
   * @param {string} filename 파일명
   * @returns {string|null} 파일 유형
   */
  classifyFileType(filename) {
    const lowerName = filename.toLowerCase();

    // 메인 버전 파일 (V로 시작하는 tar.gz 파일)
    if (lowerName.match(/^v\d+\.\d+\.\d+.*\.tar\.gz$/)) {
      return 'main';
    }

    // 모로우 관련 파일 (mr로 시작하는 파일과 morrow 포함 파일)
    if (lowerName.match(/^mr\d+\.\d+\.\d+.*\.(tar\.gz|enc\.tar\.gz)$/) || lowerName.includes('morrow')) {
      return 'morrow';
    }

    // 백엔드 파일 (be로 시작하거나 adam 포함)
    if (lowerName.match(/^be\d+\.\d+\.\d+.*\.(tar\.gz|enc\.tar\.gz)$/) || lowerName.includes('adam')) {
      return 'backend';
    }

    // 프론트엔드 파일 (fe로 시작)
    if (lowerName.match(/^fe\d+\.\d+\.\d+.*\.(tar\.gz|enc\.tar\.gz)$/)) {
      return 'frontend';
    }

    // 풀스택 파일 (fs로 시작하거나 fullstack 포함)
    if (lowerName.match(/^fs\d+\.\d+\.\d+.*\.(tar\.gz|enc\.tar\.gz)$/) || lowerName.includes('fullstack')) {
      return 'fullstack';
    }

    // 기타 압축 파일
    if (lowerName.match(/\.(tar\.gz|zip|7z|enc\.tar\.gz)$/)) {
      return 'other';
    }

    return null;
  }

  /**
   * 파일명 또는 경로에서 버전 추출
   * @param {string} input 파일명 또는 경로
   * @returns {string|null} 추출된 버전
   */
  extractVersion(input) {
    // V 버전 패턴 (V4.0.0)
    let versionMatch = input.match(/V(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    // MR 버전 패턴 (mr4.0.0)
    versionMatch = input.match(/mr(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    // 일반 버전 패턴 (4.0.0)
    versionMatch = input.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    return null;
  }

  /**
   * 스마트 파일 검색 - 버전 기반 정확한 파일 위치 찾기
   * @param {string} version 버전
   * @param {string} filename 찾을 파일명 (선택적)
   * @param {string} pattern 검색 패턴 (선택적)
   * @returns {Promise<Array>} 찾은 파일들의 배열
   */
  async findArtifactsByVersion(version, filename = null, pattern = null) {
    try {
      const { getNASService } = require('./nasService');
      const nasService = getNASService();

      logger.info(`🔍 [PATH-RESOLVER] Starting smart search for version: ${version}`);

      const versionPath = this.getVersionFolderPath(version);
      logger.info(`🔍 [PATH-RESOLVER] Version path: ${versionPath}`);

      const allArtifacts = [];

      // 1. 버전 폴더 내의 날짜 폴더들 검색
      const dateDirectories = await nasService.listDirectory(versionPath);
      logger.info(`🔍 [PATH-RESOLVER] Found ${dateDirectories.length} date directories`);

      for (const dateDir of dateDirectories) {
        if (dateDir.match(/^\d{6}$/)) { // YYMMDD 형식
          const datePath = path.posix.join(versionPath, dateDir);

          // 2. 날짜 폴더 내의 빌드번호 폴더들 검색
          const buildDirectories = await nasService.listDirectory(datePath);

          for (const buildDir of buildDirectories) {
            if (buildDir.match(/^\d+$/)) { // 숫자 빌드번호
              const buildPath = path.posix.join(datePath, buildDir);

              // 3. 빌드 폴더 내의 파일들 검색
              const buildFiles = await nasService.searchFiles(buildPath);

              for (const file of buildFiles) {
                // 파일 유형 분류
                const fileType = this.classifyFileType(file.name);

                if (fileType && file.name.match(/\.(tar\.gz|zip|7z|enc\.tar\.gz)$/i)) {
                  // 파일명 매칭
                  if (filename && file.name !== filename) {
                    continue;
                  }

                  // 패턴 매칭
                  if (pattern && !file.name.toLowerCase().includes(pattern.toLowerCase())) {
                    continue;
                  }

                  allArtifacts.push({
                    filename: file.name,
                    filePath: file.path,
                    nasPath: file.path,
                    fileSize: file.size,
                    lastModified: file.modified,
                    buildNumber: buildDir,
                    buildDate: dateDir,
                    version: version,
                    versionFolder: `mr${version}`,
                    fileType: fileType,
                    searchPath: buildPath,
                    verified: true,
                  });
                }
              }
            }
          }
        }
      }

      // 최신 날짜, 최신 빌드 순으로 정렬
      allArtifacts.sort((a, b) => {
        if (a.buildDate !== b.buildDate) {
          return b.buildDate.localeCompare(a.buildDate);
        }
        return parseInt(b.buildNumber) - parseInt(a.buildNumber);
      });

      logger.info(`🔍 [PATH-RESOLVER] Found ${allArtifacts.length} artifacts for version ${version}`);
      return allArtifacts;

    } catch (error) {
      logger.error(`🔍 [PATH-RESOLVER] Smart search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 정확한 파일 경로 찾기 - 1000 패턴이나 부정확한 경로 해결
   * @param {string} inputFilePath 입력 파일 경로
   * @returns {Promise<string|null>} 정확한 파일 경로
   */
  async resolveFilePath(inputFilePath) {
    try {
      logger.info(`🔍 [PATH-RESOLVER] Resolving file path: ${inputFilePath}`);

      // 1. 경로 정규화
      const normalizedPath = this.normalizePath(inputFilePath);

      // 2. 파일명과 디렉토리 분리
      const pathParts = normalizedPath.split('/');
      const fileName = pathParts.pop();

      // 3. 버전 추출
      const version = this.extractVersion(inputFilePath);
      if (!version) {
        logger.warn(`🔍 [PATH-RESOLVER] Could not extract version from: ${inputFilePath}`);
        return null;
      }

      // 4. 스마트 검색으로 정확한 파일 찾기
      const artifacts = await this.findArtifactsByVersion(version);

      // 5. 파일명 매칭
      let targetFile = null;

      // 정확한 파일명 매칭
      targetFile = artifacts.find(artifact => artifact.filename === fileName);

      if (!targetFile && fileName.includes('_1000.')) {
        // 1000 패턴인 경우 비슷한 패턴 찾기
        const basePattern = fileName.replace('_1000.', '_');
        targetFile = artifacts.find(artifact =>
          artifact.filename.startsWith(basePattern.substring(0, basePattern.lastIndexOf('_')))
        );
      }

      if (!targetFile) {
        // 파일 유형으로 매칭
        const fileType = this.classifyFileType(fileName);
        if (fileType === 'main') {
          targetFile = artifacts.find(artifact => artifact.fileType === 'main');
        }
      }

      if (targetFile) {
        logger.info(`🔍 [PATH-RESOLVER] Resolved to: ${targetFile.filePath}`);
        return targetFile.filePath;
      }

      logger.warn(`🔍 [PATH-RESOLVER] Could not resolve file path: ${inputFilePath}`);
      return null;

    } catch (error) {
      logger.error(`🔍 [PATH-RESOLVER] Error resolving file path: ${error.message}`);
      return null;
    }
  }

  /**
   * 동적 경로 생성 - 젠킨스 정보 기반
   * @param {string} jobName 젠킨스 잡 이름
   * @param {string} buildNumber 빌드 번호
   * @param {string} buildDate 빌드 날짜 (YYMMDD)
   * @returns {string} 생성된 경로
   */
  generateDynamicPath(jobName, buildNumber, buildDate = null) {
    const version = this.extractVersion(jobName);
    if (!version) {
      throw new Error(`Cannot extract version from job name: ${jobName}`);
    }

    const versionPath = this.getVersionFolderPath(version);

    if (buildDate && buildNumber) {
      return path.posix.join(versionPath, buildDate, buildNumber);
    } else if (buildNumber) {
      // 날짜가 없으면 최신 날짜 폴더에서 해당 빌드 찾기
      return path.posix.join(versionPath, '*', buildNumber);
    } else {
      return versionPath;
    }
  }
}

// 싱글톤 인스턴스
let pathResolverInstance = null;

/**
 * PathResolver 인스턴스 가져오기
 */
function getPathResolver() {
  if (!pathResolverInstance) {
    pathResolverInstance = new PathResolver();
  }
  return pathResolverInstance;
}

module.exports = {
  PathResolver,
  getPathResolver,
};