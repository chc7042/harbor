const NodeCache = require('node-cache');
const logger = require('../config/logger');

/**
 * 중앙화된 캐싱 서비스
 * NAS 스캔 결과, Jenkins 데이터, 파일 메타데이터 캐싱 담당
 */
class CacheService {
  constructor() {
    // 다양한 TTL을 가진 캐시 인스턴스들
    this.caches = {
      // NAS 파일 목록 캐시 (15분)
      nasFiles: new NodeCache({ 
        stdTTL: 15 * 60,  // 15분
        checkperiod: 2 * 60,  // 2분마다 만료 체크
        useClones: false,
        maxKeys: 1000
      }),
      
      // NAS 스캔 결과 캐시 (30분)
      nasScanResults: new NodeCache({ 
        stdTTL: 30 * 60,  // 30분
        checkperiod: 5 * 60,  // 5분마다 만료 체크
        useClones: false,
        maxKeys: 500
      }),
      
      // Jenkins 빌드 정보 캐시 (5분)
      jenkinsBuilds: new NodeCache({ 
        stdTTL: 5 * 60,  // 5분
        checkperiod: 60,  // 1분마다 만료 체크
        useClones: false,
        maxKeys: 2000
      }),
      
      // 파일 메타데이터 캐시 (1시간)
      fileMetadata: new NodeCache({ 
        stdTTL: 60 * 60,  // 1시간
        checkperiod: 10 * 60,  // 10분마다 만료 체크
        useClones: false,
        maxKeys: 5000
      }),
      
      // 데이터베이스 쿼리 결과 캐시 (10분)
      dbQueries: new NodeCache({ 
        stdTTL: 10 * 60,  // 10분
        checkperiod: 2 * 60,  // 2분마다 만료 체크
        useClones: false,
        maxKeys: 1000
      })
    };

    // 캐시 이벤트 리스너 설정
    this.setupEventListeners();
    
    // 캐시 통계 초기화
    this.stats = {
      hits: {},
      misses: {},
      sets: {},
      deletes: {}
    };

    Object.keys(this.caches).forEach(cacheName => {
      this.stats.hits[cacheName] = 0;
      this.stats.misses[cacheName] = 0;
      this.stats.sets[cacheName] = 0;
      this.stats.deletes[cacheName] = 0;
    });

    logger.info('🚀 [CACHE] Cache service initialized with multiple cache instances');
  }

  /**
   * 캐시 이벤트 리스너 설정
   */
  setupEventListeners() {
    Object.entries(this.caches).forEach(([cacheName, cache]) => {
      cache.on('set', (key, value) => {
        this.stats.sets[cacheName]++;
        logger.debug(`🚀 [CACHE] Set key in ${cacheName}: ${key}`);
      });

      cache.on('del', (key, value) => {
        this.stats.deletes[cacheName]++;
        logger.debug(`🚀 [CACHE] Deleted key from ${cacheName}: ${key}`);
      });

      cache.on('expired', (key, value) => {
        logger.debug(`🚀 [CACHE] Expired key in ${cacheName}: ${key}`);
      });
    });
  }

  /**
   * 캐시에서 값 가져오기
   */
  get(cacheName, key) {
    if (!this.caches[cacheName]) {
      logger.warn(`🚀 [CACHE] Unknown cache: ${cacheName}`);
      return undefined;
    }

    const value = this.caches[cacheName].get(key);
    
    if (value !== undefined) {
      this.stats.hits[cacheName]++;
      logger.debug(`🚀 [CACHE] Hit in ${cacheName}: ${key}`);
    } else {
      this.stats.misses[cacheName]++;
      logger.debug(`🚀 [CACHE] Miss in ${cacheName}: ${key}`);
    }
    
    return value;
  }

  /**
   * 캐시에 값 저장
   */
  set(cacheName, key, value, ttl = null) {
    if (!this.caches[cacheName]) {
      logger.warn(`🚀 [CACHE] Unknown cache: ${cacheName}`);
      return false;
    }

    const success = ttl 
      ? this.caches[cacheName].set(key, value, ttl)
      : this.caches[cacheName].set(key, value);
    
    if (success) {
      this.stats.sets[cacheName]++;
      logger.debug(`🚀 [CACHE] Set in ${cacheName}: ${key}${ttl ? ` (TTL: ${ttl}s)` : ''}`);
    }
    
    return success;
  }

  /**
   * 캐시에서 값 삭제
   */
  del(cacheName, key) {
    if (!this.caches[cacheName]) {
      logger.warn(`🚀 [CACHE] Unknown cache: ${cacheName}`);
      return 0;
    }

    const deletedCount = this.caches[cacheName].del(key);
    if (deletedCount > 0) {
      this.stats.deletes[cacheName]++;
    }
    
    return deletedCount;
  }

  /**
   * 특정 캐시의 모든 키 삭제
   */
  flushCache(cacheName) {
    if (!this.caches[cacheName]) {
      logger.warn(`🚀 [CACHE] Unknown cache: ${cacheName}`);
      return false;
    }

    this.caches[cacheName].flushAll();
    logger.info(`🚀 [CACHE] Flushed cache: ${cacheName}`);
    return true;
  }

  /**
   * 모든 캐시 삭제
   */
  flushAll() {
    Object.keys(this.caches).forEach(cacheName => {
      this.caches[cacheName].flushAll();
    });
    
    // 통계 초기화
    Object.keys(this.stats.hits).forEach(cacheName => {
      this.stats.hits[cacheName] = 0;
      this.stats.misses[cacheName] = 0;
      this.stats.sets[cacheName] = 0;
      this.stats.deletes[cacheName] = 0;
    });

    logger.info('🚀 [CACHE] Flushed all caches');
  }

  /**
   * 캐시 통계 조회
   */
  getStats() {
    const stats = {
      ...this.stats,
      cacheInfo: {}
    };

    Object.entries(this.caches).forEach(([cacheName, cache]) => {
      const keys = cache.keys();
      stats.cacheInfo[cacheName] = {
        keyCount: keys.length,
        hitRate: this.stats.hits[cacheName] / (this.stats.hits[cacheName] + this.stats.misses[cacheName]) || 0,
        totalOperations: this.stats.hits[cacheName] + this.stats.misses[cacheName] + this.stats.sets[cacheName]
      };
    });

    return stats;
  }

  /**
   * NAS 파일 목록 캐싱 헬퍼
   */
  async getNASFiles(path, fetcher) {
    const cacheKey = `nas_files:${path}`;
    let files = this.get('nasFiles', cacheKey);
    
    if (!files) {
      logger.info(`🚀 [CACHE] Fetching NAS files for path: ${path}`);
      files = await fetcher();
      this.set('nasFiles', cacheKey, files);
    }
    
    return files;
  }

  /**
   * NAS 스캔 결과 캐싱 헬퍼
   */
  async getNASScanResult(scanId, fetcher) {
    const cacheKey = `scan_result:${scanId}`;
    let result = this.get('nasScanResults', cacheKey);
    
    if (!result) {
      logger.info(`🚀 [CACHE] Fetching NAS scan result: ${scanId}`);
      result = await fetcher();
      this.set('nasScanResults', cacheKey, result);
    }
    
    return result;
  }

  /**
   * Jenkins 빌드 정보 캐싱 헬퍼
   */
  async getJenkinsBuild(jobName, buildNumber, fetcher) {
    const cacheKey = `jenkins_build:${jobName}:${buildNumber}`;
    let build = this.get('jenkinsBuilds', cacheKey);
    
    if (!build) {
      logger.info(`🚀 [CACHE] Fetching Jenkins build: ${jobName}#${buildNumber}`);
      build = await fetcher();
      this.set('jenkinsBuilds', cacheKey, build);
    }
    
    return build;
  }

  /**
   * 파일 메타데이터 캐싱 헬퍼
   */
  async getFileMetadata(filePath, fetcher) {
    const cacheKey = `file_meta:${filePath}`;
    let metadata = this.get('fileMetadata', cacheKey);
    
    if (!metadata) {
      logger.info(`🚀 [CACHE] Fetching file metadata: ${filePath}`);
      metadata = await fetcher();
      this.set('fileMetadata', cacheKey, metadata);
    }
    
    return metadata;
  }

  /**
   * 데이터베이스 쿼리 결과 캐싱 헬퍼
   */
  async getDBQuery(queryKey, fetcher, ttl = null) {
    const cacheKey = `db_query:${queryKey}`;
    let result = this.get('dbQueries', cacheKey);
    
    if (!result) {
      logger.info(`🚀 [CACHE] Executing database query: ${queryKey}`);
      result = await fetcher();
      this.set('dbQueries', cacheKey, result, ttl);
    }
    
    return result;
  }

  /**
   * 캐시 무효화 - 관련된 캐시 항목들 삭제
   */
  invalidateRelated(pattern) {
    Object.entries(this.caches).forEach(([cacheName, cache]) => {
      const keys = cache.keys();
      const matchingKeys = keys.filter(key => key.includes(pattern));
      
      if (matchingKeys.length > 0) {
        matchingKeys.forEach(key => cache.del(key));
        logger.info(`🚀 [CACHE] Invalidated ${matchingKeys.length} keys matching pattern '${pattern}' in ${cacheName}`);
      }
    });
  }

  /**
   * 버전별 캐시 무효화
   */
  invalidateVersion(version) {
    this.invalidateRelated(version);
    logger.info(`🚀 [CACHE] Invalidated caches for version: ${version}`);
  }

  /**
   * 프로젝트별 캐시 무효화
   */
  invalidateProject(projectName) {
    this.invalidateRelated(projectName);
    logger.info(`🚀 [CACHE] Invalidated caches for project: ${projectName}`);
  }

  /**
   * 서비스 종료 시 정리 작업
   */
  destroy() {
    Object.values(this.caches).forEach(cache => {
      cache.close();
    });
    logger.info('🚀 [CACHE] Cache service destroyed');
  }
}

// 싱글톤 인스턴스
let cacheServiceInstance = null;

/**
 * CacheService 인스턴스 가져오기
 */
function getCacheService() {
  if (!cacheServiceInstance) {
    cacheServiceInstance = new CacheService();
  }
  return cacheServiceInstance;
}

module.exports = {
  CacheService,
  getCacheService,
};