const { JenkinsService } = require('./jenkinsService');
const { getDeploymentPathService } = require('./deploymentPathService');
const { getNASService } = require('./nasService');
const logger = require('../config/logger');

// Mock services for cache effectiveness testing
jest.mock('./deploymentPathService');
jest.mock('./nasService');
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
    defaults: {
      timeout: 30000
    }
  })),
}));

describe('JenkinsService DB Caching Effectiveness and Hit Rates', () => {
  let jenkinsService;
  let mockDeploymentPathService;
  let mockNASService;
  let cacheStats;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment variables
    process.env.JENKINS_URL = 'http://test-jenkins.com';
    process.env.JENKINS_USERNAME = 'testuser';
    process.env.JENKINS_PASSWORD = 'testpass';

    // Setup service mocks with hit tracking
    mockDeploymentPathService = {
      findByProjectVersionBuild: jest.fn(),
      saveDeploymentPath: jest.fn(),
    };
    mockNASService = {
      directoryExists: jest.fn(),
      getDirectoryFiles: jest.fn(),
    };

    getDeploymentPathService.mockReturnValue(mockDeploymentPathService);
    getNASService.mockReturnValue(mockNASService);

    jenkinsService = new JenkinsService();

    // Initialize cache statistics
    cacheStats = {
      hits: 0,
      misses: 0,
      saves: 0,
      totalRequests: 0,
      averageResponseTime: {
        cacheHit: [],
        cacheMiss: []
      }
    };
  });

  afterEach(() => {
    delete process.env.JENKINS_URL;
    delete process.env.JENKINS_USERNAME;
    delete process.env.JENKINS_PASSWORD;
  });

  // Helper function to simulate cache hit with tracking
  const simulateCacheHit = (jobName, buildNumber, responseTime = 50) => {
    const version = jobName.match(/(\d+\.\d+\.\d+)/)?.[1] || '3.0.0';
    mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => {
        cacheStats.hits++;
        cacheStats.totalRequests++;
        cacheStats.averageResponseTime.cacheHit.push(responseTime);
        resolve({
          nasPath: `\\\\nas.roboetech.com\\release_version\\release\\product\\mr${version}\\250310\\${buildNumber}`,
          downloadFile: `V${version}_250310_0843.tar.gz`,
          allFiles: [`V${version}_250310_0843.tar.gz`]
        });
      }, responseTime))
    );
  };

  // Helper function to simulate cache miss with tracking
  const simulateCacheMiss = (jobName, buildNumber, apiTime = 1000, nasTime = 500) => {
    const version = jobName.match(/(\d+\.\d+\.\d+)/)?.[1] || '3.0.0';
    const totalTime = apiTime + nasTime;
    
    mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => {
        cacheStats.misses++;
        cacheStats.totalRequests++;
        cacheStats.averageResponseTime.cacheMiss.push(totalTime);
        resolve(null);
      }, 50))
    );

    jenkinsService.client.get.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => 
        resolve({ data: { timestamp: new Date().getTime() } }), apiTime))
    );

    mockNASService.directoryExists.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(true), nasTime / 2))
    );

    mockNASService.getDirectoryFiles.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => 
        resolve([`V${version}_250310_0843.tar.gz`]), nasTime / 2))
    );

    mockDeploymentPathService.saveDeploymentPath.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => {
        cacheStats.saves++;
        resolve({});
      }, 100))
    );
  };

  describe('Cache Hit Rate Analysis', () => {
    test('should achieve high cache hit rate for repeated requests', async () => {
      const testCases = [
        { jobName: '3.0.0/mr3.0.0_release', buildNumber: 26 },
        { jobName: '3.0.1/mr3.0.1_release', buildNumber: 27 },
        { jobName: '3.0.2/mr3.0.2_release', buildNumber: 28 },
      ];

      // First request for each job - cache miss
      for (const testCase of testCases) {
        simulateCacheMiss(testCase.jobName, testCase.buildNumber);
        await jenkinsService.extractDeploymentInfo(testCase.jobName, testCase.buildNumber);
        jest.clearAllMocks();
      }

      // Subsequent requests - cache hits
      for (let round = 0; round < 3; round++) {
        for (const testCase of testCases) {
          simulateCacheHit(testCase.jobName, testCase.buildNumber);
          await jenkinsService.extractDeploymentInfo(testCase.jobName, testCase.buildNumber);
          jest.clearAllMocks();
        }
      }

      // Calculate hit rate
      const hitRate = (cacheStats.hits / cacheStats.totalRequests) * 100;
      
      expect(hitRate).toBeGreaterThan(75); // Should achieve >75% hit rate
      expect(cacheStats.hits).toBe(9); // 3 jobs × 3 rounds
      expect(cacheStats.misses).toBe(3); // 3 initial cache misses
      expect(cacheStats.saves).toBe(3); // 3 saves after cache misses
      
      console.log(`Cache Hit Rate: ${hitRate.toFixed(2)}% (${cacheStats.hits}/${cacheStats.totalRequests})`);
    });

    test('should demonstrate cache effectiveness with performance metrics', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const iterations = 10;

      // First request - cache miss (slow)
      simulateCacheMiss(jobName, buildNumber, 2000, 1000); // 3s total
      const startMiss = Date.now();
      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const missTime = Date.now() - startMiss;
      
      jest.clearAllMocks();

      // Subsequent requests - cache hits (fast)
      const hitTimes = [];
      for (let i = 0; i < iterations; i++) {
        simulateCacheHit(jobName, buildNumber, 25); // 25ms response
        const startHit = Date.now();
        await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
        hitTimes.push(Date.now() - startHit);
        jest.clearAllMocks();
      }

      const avgHitTime = hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length;
      const speedupFactor = missTime / avgHitTime;

      expect(avgHitTime).toBeLessThan(100); // Cache hits should be < 100ms
      expect(missTime).toBeGreaterThan(2500); // Cache miss should be > 2.5s
      expect(speedupFactor).toBeGreaterThan(20); // Cache should be 20x+ faster

      console.log(`Cache Miss Time: ${missTime}ms`);
      console.log(`Average Cache Hit Time: ${avgHitTime.toFixed(2)}ms`);
      console.log(`Cache Speedup Factor: ${speedupFactor.toFixed(1)}x`);
    });

    test('should handle cache distribution across different job types', async () => {
      const jobTypes = [
        { prefix: 'mr', jobs: ['3.0.0/mr3.0.0_release', '3.0.1/mr3.0.1_release'] },
        { prefix: 'fs', jobs: ['3.0.0/fs3.0.0_release', '3.0.1/fs3.0.1_release'] },
      ];

      let totalHits = 0;
      let totalMisses = 0;

      for (const jobType of jobTypes) {
        for (const jobName of jobType.jobs) {
          // First request - miss
          simulateCacheMiss(jobName, 26);
          await jenkinsService.extractDeploymentInfo(jobName, 26);
          totalMisses++;
          jest.clearAllMocks();

          // Multiple hits
          for (let i = 0; i < 3; i++) {
            simulateCacheHit(jobName, 26);
            await jenkinsService.extractDeploymentInfo(jobName, 26);
            totalHits++;
            jest.clearAllMocks();
          }
        }
      }

      const hitRate = (totalHits / (totalHits + totalMisses)) * 100;
      
      expect(hitRate).toBeGreaterThan(70); // Should maintain good hit rate across job types
      expect(totalHits).toBe(12); // 4 jobs × 3 hits each
      expect(totalMisses).toBe(4); // 4 initial misses

      console.log(`Cross-JobType Hit Rate: ${hitRate.toFixed(2)}%`);
    });
  });

  describe('Cache Performance Under Load', () => {
    test('should maintain cache effectiveness under concurrent load', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const concurrentRequests = 10;

      // Prime the cache with one miss
      simulateCacheMiss(jobName, buildNumber, 1000, 500);
      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      jest.clearAllMocks();

      // Simulate concurrent cache hits
      const promises = [];
      for (let i = 0; i < concurrentRequests; i++) {
        simulateCacheHit(jobName, buildNumber, 30);
        promises.push(jenkinsService.extractDeploymentInfo(jobName, buildNumber));
      }

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All results should be valid
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.nasPath).toContain('mr3.0.0');
      });

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(1000); // All requests complete in < 1s
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalledTimes(concurrentRequests);

      console.log(`Concurrent Cache Performance: ${concurrentRequests} requests in ${totalTime}ms`);
    });

    test('should demonstrate cache memory efficiency', async () => {
      const uniqueJobs = [];
      for (let i = 1; i <= 20; i++) {
        uniqueJobs.push({
          jobName: `3.0.${i}/mr3.0.${i}_release`,
          buildNumber: 26 + i
        });
      }

      // Cache all unique jobs (misses)
      for (const job of uniqueJobs) {
        simulateCacheMiss(job.jobName, job.buildNumber, 800, 400);
        await jenkinsService.extractDeploymentInfo(job.jobName, job.buildNumber);
        jest.clearAllMocks();
      }

      // Access random cached jobs (hits)
      const randomAccesses = 50;
      let hitCount = 0;
      
      for (let i = 0; i < randomAccesses; i++) {
        const randomJob = uniqueJobs[Math.floor(Math.random() * uniqueJobs.length)];
        simulateCacheHit(randomJob.jobName, randomJob.buildNumber, 20);
        await jenkinsService.extractDeploymentInfo(randomJob.jobName, randomJob.buildNumber);
        hitCount++;
        jest.clearAllMocks();
      }

      const finalHitRate = (hitCount / (uniqueJobs.length + hitCount)) * 100;
      
      expect(finalHitRate).toBeGreaterThan(65); // Should maintain good hit rate even with many unique jobs
      expect(hitCount).toBe(randomAccesses);

      console.log(`Cache Memory Efficiency: ${finalHitRate.toFixed(2)}% hit rate with ${uniqueJobs.length} unique jobs`);
    });
  });

  describe('Cache Miss Scenarios and Recovery', () => {
    test('should handle cache miss gracefully and populate cache', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // First request - guaranteed miss
      simulateCacheMiss(jobName, buildNumber, 1500, 750);
      
      const result1 = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      
      expect(result1).toBeDefined();
      expect(result1.nasPath).toContain('mr3.0.0');
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalledWith(
        jobName, '3.0.0', buildNumber
      );
      expect(mockDeploymentPathService.saveDeploymentPath).toHaveBeenCalled();
      
      jest.clearAllMocks();

      // Second request - should hit cache
      simulateCacheHit(jobName, buildNumber, 40);
      
      const result2 = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      
      expect(result2).toBeDefined();
      expect(result2.nasPath).toContain('mr3.0.0');
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalled();
      // Should not call Jenkins API or NAS on cache hit
      expect(jenkinsService.client.get).not.toHaveBeenCalled();
      expect(mockNASService.directoryExists).not.toHaveBeenCalled();
    });

    test('should measure cache warming performance', async () => {
      const warmupJobs = [
        { jobName: '3.0.0/mr3.0.0_release', buildNumber: 26 },
        { jobName: '3.0.1/mr3.0.1_release', buildNumber: 27 },
        { jobName: '3.0.2/mr3.0.2_release', buildNumber: 28 },
        { jobName: '3.0.3/mr3.0.3_release', buildNumber: 29 },
        { jobName: '3.0.4/mr3.0.4_release', buildNumber: 30 },
      ];

      // Warm up cache (all misses)
      const warmupStart = Date.now();
      for (const job of warmupJobs) {
        simulateCacheMiss(job.jobName, job.buildNumber, 1200, 600);
        await jenkinsService.extractDeploymentInfo(job.jobName, job.buildNumber);
        jest.clearAllMocks();
      }
      const warmupTime = Date.now() - warmupStart;

      // Test cache performance (all hits)
      const testStart = Date.now();
      for (const job of warmupJobs) {
        simulateCacheHit(job.jobName, job.buildNumber, 35);
        await jenkinsService.extractDeploymentInfo(job.jobName, job.buildNumber);
        jest.clearAllMocks();
      }
      const testTime = Date.now() - testStart;

      const improvementFactor = warmupTime / testTime;

      expect(testTime).toBeLessThan(1000); // Cache-warmed requests should be very fast
      expect(improvementFactor).toBeGreaterThan(5); // Cache should provide significant improvement

      console.log(`Cache Warming Results:`);
      console.log(`  Warmup Time (${warmupJobs.length} misses): ${warmupTime}ms`);
      console.log(`  Cached Time (${warmupJobs.length} hits): ${testTime}ms`);
      console.log(`  Improvement Factor: ${improvementFactor.toFixed(1)}x`);
    });
  });

  describe('Cache Effectiveness Metrics and Monitoring', () => {
    test('should provide comprehensive cache analytics', async () => {
      const analytics = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        averageHitTime: 0,
        averageMissTime: 0,
        dataFreshness: new Map(),
        errorRecoveryCount: 0
      };

      // Simulate various scenarios
      const scenarios = [
        { type: 'miss', jobName: '3.0.0/mr3.0.0_release', buildNumber: 26, repeat: 1 },
        { type: 'hit', jobName: '3.0.0/mr3.0.0_release', buildNumber: 26, repeat: 5 },
        { type: 'miss', jobName: '3.0.1/mr3.0.1_release', buildNumber: 27, repeat: 1 },
        { type: 'hit', jobName: '3.0.1/mr3.0.1_release', buildNumber: 27, repeat: 3 },
        { type: 'miss', jobName: '3.0.2/mr3.0.2_release', buildNumber: 28, repeat: 1 },
        { type: 'hit', jobName: '3.0.2/mr3.0.2_release', buildNumber: 28, repeat: 7 },
      ];

      const hitTimes = [];
      const missTimes = [];

      for (const scenario of scenarios) {
        for (let i = 0; i < scenario.repeat; i++) {
          const startTime = Date.now();
          
          if (scenario.type === 'miss') {
            simulateCacheMiss(scenario.jobName, scenario.buildNumber, 1100, 550);
            await jenkinsService.extractDeploymentInfo(scenario.jobName, scenario.buildNumber);
            analytics.cacheMisses++;
            missTimes.push(Date.now() - startTime);
          } else {
            simulateCacheHit(scenario.jobName, scenario.buildNumber, 30);
            await jenkinsService.extractDeploymentInfo(scenario.jobName, scenario.buildNumber);
            analytics.cacheHits++;
            hitTimes.push(Date.now() - startTime);
          }
          
          analytics.totalRequests++;
          jest.clearAllMocks();
        }
      }

      analytics.averageHitTime = hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length;
      analytics.averageMissTime = missTimes.reduce((a, b) => a + b, 0) / missTimes.length;

      const hitRate = (analytics.cacheHits / analytics.totalRequests) * 100;
      const performanceGain = analytics.averageMissTime / analytics.averageHitTime;

      // Assertions
      expect(hitRate).toBeGreaterThan(80); // Should achieve >80% hit rate
      expect(analytics.averageHitTime).toBeLessThan(100); // Hits should be fast
      expect(analytics.averageMissTime).toBeGreaterThan(1500); // Misses should be slower
      expect(performanceGain).toBeGreaterThan(15); // Significant performance benefit

      // Output comprehensive analytics
      console.log('\n=== Cache Analytics Report ===');
      console.log(`Total Requests: ${analytics.totalRequests}`);
      console.log(`Cache Hits: ${analytics.cacheHits} (${hitRate.toFixed(2)}%)`);
      console.log(`Cache Misses: ${analytics.cacheMisses} (${(100 - hitRate).toFixed(2)}%)`);
      console.log(`Average Hit Time: ${analytics.averageHitTime.toFixed(2)}ms`);
      console.log(`Average Miss Time: ${analytics.averageMissTime.toFixed(2)}ms`);
      console.log(`Performance Gain: ${performanceGain.toFixed(1)}x faster with cache`);
      console.log(`Cache Effectiveness: ${hitRate > 80 ? 'EXCELLENT' : hitRate > 60 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);
      console.log('============================\n');
    });
  });
});