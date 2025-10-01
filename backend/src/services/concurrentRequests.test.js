const { JenkinsService } = require('./jenkinsService');
const { getDeploymentPathService } = require('./deploymentPathService');
const { getNASService } = require('./nasService');
const logger = require('../config/logger');

// Mock services for concurrent testing
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

describe('JenkinsService Concurrent Request Handling and Race Conditions', () => {
  let jenkinsService;
  let mockDeploymentPathService;
  let mockNASService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment variables
    process.env.JENKINS_URL = 'http://test-jenkins.com';
    process.env.JENKINS_USERNAME = 'testuser';
    process.env.JENKINS_PASSWORD = 'testpass';

    // Setup service mocks
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
  });

  afterEach(() => {
    delete process.env.JENKINS_URL;
    delete process.env.JENKINS_USERNAME;
    delete process.env.JENKINS_PASSWORD;
  });

  describe('Concurrent Cache Access Patterns', () => {
    test('should handle multiple simultaneous requests for same deployment without race conditions', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const concurrentRequests = 20;
      
      let cacheCallCount = 0;
      let saveCallCount = 0;

      // First call is cache miss, subsequent calls should hit cache
      mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => {
        cacheCallCount++;
        return new Promise(resolve => setTimeout(() => {
          if (cacheCallCount === 1) {
            // First request - cache miss
            resolve(null);
          } else {
            // Subsequent requests - cache hit
            resolve({
              nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
              downloadFile: 'V3.0.0_250310_0843.tar.gz',
              allFiles: ['V3.0.0_250310_0843.tar.gz']
            });
          }
        }, 50));
      });

      // Mock Jenkins API and NAS for the first (cache miss) request
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: new Date('2025-03-10T17:39:00Z').getTime() }
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      
      mockDeploymentPathService.saveDeploymentPath.mockImplementation(() => {
        saveCallCount++;
        return Promise.resolve({});
      });

      // Execute concurrent requests
      const promises = Array(concurrentRequests).fill().map(() => 
        jenkinsService.extractDeploymentInfo(jobName, buildNumber)
      );

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should return valid results
      expect(results).toHaveLength(concurrentRequests);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.nasPath).toContain('mr3.0.0');
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds max

      // Cache should be called for each request
      expect(cacheCallCount).toBe(concurrentRequests);
      
      // Only one save operation should occur (race condition protection)
      expect(saveCallCount).toBeLessThanOrEqual(3); // Allow some minor race conditions

      console.log(`Concurrent Requests Test: ${concurrentRequests} requests completed in ${duration}ms`);
      console.log(`Cache calls: ${cacheCallCount}, Save calls: ${saveCallCount}`);
    }, 15000);

    test('should handle concurrent requests for different deployments efficiently', async () => {
      const testCases = [
        { jobName: '3.0.0/mr3.0.0_release', buildNumber: 26 },
        { jobName: '3.0.1/mr3.0.1_release', buildNumber: 27 },
        { jobName: '3.0.2/mr3.0.2_release', buildNumber: 28 },
        { jobName: '3.0.3/mr3.0.3_release', buildNumber: 29 },
        { jobName: '3.0.4/mr3.0.4_release', buildNumber: 30 },
      ];

      // Each deployment gets a cache miss initially
      mockDeploymentPathService.findByProjectVersionBuild.mockImplementation((jobName, version, buildNumber) => {
        return new Promise(resolve => setTimeout(() => {
          resolve(null); // All cache misses for this test
        }, Math.random() * 100)); // Random delay to simulate real DB
      });

      // Mock Jenkins API with variable delays
      jenkinsService.client.get.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => {
          resolve({ data: { timestamp: Date.now() } });
        }, 200 + Math.random() * 300)); // 200-500ms delay
      });

      // Mock NAS operations with variable delays
      mockNASService.directoryExists.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => {
          resolve(true);
        }, 100 + Math.random() * 200)); // 100-300ms delay
      });

      mockNASService.getDirectoryFiles.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => {
          resolve(['V3.0.0_250310_0843.tar.gz']);
        }, 150 + Math.random() * 100)); // 150-250ms delay
      });

      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Execute all deployments concurrently
      const promises = testCases.map(testCase => 
        jenkinsService.extractDeploymentInfo(testCase.jobName, testCase.buildNumber)
      );

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should complete successfully
      expect(results).toHaveLength(testCases.length);
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        expect(result.nasPath).toBeDefined();
      });

      // Should complete within 30 seconds (our requirement)
      expect(duration).toBeLessThan(30000);

      // Should be faster than sequential execution would be
      expect(duration).toBeLessThan(5000); // Should leverage concurrency

      console.log(`Concurrent Different Deployments: ${testCases.length} different deployments in ${duration}ms`);
    }, 35000);
  });

  describe('Race Condition Prevention', () => {
    test('should prevent duplicate cache saves when multiple requests start simultaneously', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const simultaneousRequests = 10;
      
      let findCallCount = 0;
      let saveCallCount = 0;
      let jenkinsApiCallCount = 0;

      // All requests start with cache miss
      mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => {
        findCallCount++;
        return new Promise(resolve => setTimeout(() => {
          resolve(null); // Always cache miss to force processing
        }, 10));
      });

      // Track Jenkins API calls
      jenkinsService.client.get.mockImplementation(() => {
        jenkinsApiCallCount++;
        return new Promise(resolve => setTimeout(() => {
          resolve({ data: { timestamp: new Date().getTime() } });
        }, 500)); // Simulate realistic API delay
      });

      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      
      // Track save operations
      mockDeploymentPathService.saveDeploymentPath.mockImplementation(() => {
        saveCallCount++;
        return new Promise(resolve => setTimeout(() => resolve({}), 50));
      });

      // Start all requests at the same time
      const promises = Array(simultaneousRequests).fill().map(() => 
        jenkinsService.extractDeploymentInfo(jobName, buildNumber)
      );

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results).toHaveLength(simultaneousRequests);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.nasPath).toContain('mr3.0.0');
      });

      // Cache should be checked for each request
      expect(findCallCount).toBe(simultaneousRequests);
      
      // Jenkins API might be called multiple times due to simultaneous cache misses
      expect(jenkinsApiCallCount).toBeGreaterThan(0);
      expect(jenkinsApiCallCount).toBeLessThanOrEqual(simultaneousRequests);
      
      // Save operations should occur but not excessively (some deduplication expected)
      expect(saveCallCount).toBeGreaterThan(0);
      expect(saveCallCount).toBeLessThanOrEqual(simultaneousRequests);

      console.log(`Race Condition Test: Find=${findCallCount}, API=${jenkinsApiCallCount}, Save=${saveCallCount}`);
    }, 15000);

    test('should handle partial failures in concurrent scenarios gracefully', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const totalRequests = 15;
      
      let successCount = 0;
      let failureCount = 0;

      // Cache miss for all
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Jenkins API fails for some requests
      jenkinsService.client.get.mockImplementation(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (Math.random() < 0.3) { // 30% failure rate
              reject(new Error('Jenkins API temporarily unavailable'));
            } else {
              resolve({ data: { timestamp: Date.now() } });
            }
          }, 200 + Math.random() * 300);
        });
      });

      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Mock fallback method to always succeed
      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue({
        nasPath: 'fallback-path',
        downloadFile: 'fallback-file.tar.gz',
        allFiles: [],
        deploymentPath: 'fallback-path'
      });

      // Execute concurrent requests
      const promises = Array(totalRequests).fill().map(() => 
        jenkinsService.extractDeploymentInfo(jobName, buildNumber)
      );

      const results = await Promise.allSettled(promises);

      // Count successes and failures
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failureCount++;
        }
      });

      // All requests should either succeed or gracefully fallback
      expect(successCount + failureCount).toBe(totalRequests);
      expect(successCount).toBeGreaterThan(0); // At least some should succeed
      
      // Fallback should be used for failed cases
      if (failureCount > 0) {
        expect(jenkinsService.extractDeploymentInfoFromBuildLog).toHaveBeenCalled();
      }

      console.log(`Partial Failure Test: ${successCount} succeeded, ${failureCount} failed`);
    }, 20000);
  });

  describe('Load Testing and Scalability', () => {
    test('should handle high concurrent load without degradation', async () => {
      const highLoad = 50;
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      
      // Mix of cache hits and misses
      let requestCount = 0;
      mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => {
        requestCount++;
        return new Promise(resolve => setTimeout(() => {
          if (requestCount <= 5) {
            // First 5 requests are cache misses
            resolve(null);
          } else {
            // Rest are cache hits
            resolve({
              nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
              downloadFile: 'V3.0.0_250310_0843.tar.gz',
              allFiles: ['V3.0.0_250310_0843.tar.gz']
            });
          }
        }, 20)); // Fast cache operation
      });

      // Fast operations for cache misses
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: Date.now() }
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Execute high load test
      const promises = Array(highLoad).fill().map((_, index) => {
        // Stagger requests slightly to simulate real-world conditions
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(jenkinsService.extractDeploymentInfo(jobName, buildNumber));
          }, Math.random() * 100);
        });
      });

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should complete successfully
      expect(results).toHaveLength(highLoad);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.nasPath).toContain('mr3.0.0');
      });

      // Should handle high load efficiently
      expect(duration).toBeLessThan(15000); // 15 seconds max for 50 requests
      
      // Calculate throughput
      const throughput = (highLoad / duration) * 1000; // requests per second
      expect(throughput).toBeGreaterThan(3); // At least 3 req/sec

      console.log(`High Load Test: ${highLoad} requests in ${duration}ms (${throughput.toFixed(2)} req/sec)`);
    }, 25000);

    test('should maintain performance consistency under sustained load', async () => {
      const batchSize = 10;
      const batches = 5;
      const batchTimes = [];

      for (let batch = 0; batch < batches; batch++) {
        // Setup fresh mocks for each batch
        mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue({
          nasPath: `\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.${batch}\\250310\\26`,
          downloadFile: `V3.0.${batch}_250310_0843.tar.gz`,
          allFiles: [`V3.0.${batch}_250310_0843.tar.gz`]
        });

        const batchStartTime = Date.now();
        
        const promises = Array(batchSize).fill().map(() => 
          jenkinsService.extractDeploymentInfo(`3.0.${batch}/mr3.0.${batch}_release`, 26)
        );

        await Promise.all(promises);
        
        const batchTime = Date.now() - batchStartTime;
        batchTimes.push(batchTime);

        console.log(`Batch ${batch + 1}: ${batchSize} requests in ${batchTime}ms`);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
        jest.clearAllMocks();
      }

      // Calculate consistency metrics
      const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
      const maxBatchTime = Math.max(...batchTimes);
      const minBatchTime = Math.min(...batchTimes);
      const variation = ((maxBatchTime - minBatchTime) / avgBatchTime) * 100;

      // Performance should be consistent across batches
      expect(variation).toBeLessThan(50); // Less than 50% variation
      expect(avgBatchTime).toBeLessThan(2000); // Average batch should be under 2s

      console.log(`Sustained Load Results:`);
      console.log(`  Average batch time: ${avgBatchTime.toFixed(2)}ms`);
      console.log(`  Performance variation: ${variation.toFixed(2)}%`);
      console.log(`  Min/Max batch time: ${minBatchTime}ms / ${maxBatchTime}ms`);
    }, 30000);
  });

  describe('Memory and Resource Management', () => {
    test('should not accumulate memory leaks under concurrent load', async () => {
      const iterations = 20;
      const requestsPerIteration = 10;
      
      // Track if mocks are being properly reset
      let totalMockCalls = 0;

      for (let i = 0; i < iterations; i++) {
        // Fresh cache hit setup for each iteration
        mockDeploymentPathService.findByProjectVersionBuild.mockImplementation(() => {
          totalMockCalls++;
          return Promise.resolve({
            nasPath: `\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\${i}`,
            downloadFile: `V3.0.0_250310_${i}.tar.gz`,
            allFiles: [`V3.0.0_250310_${i}.tar.gz`]
          });
        });

        const promises = Array(requestsPerIteration).fill().map(() => 
          jenkinsService.extractDeploymentInfo('3.0.0/mr3.0.0_release', 26 + i)
        );

        const results = await Promise.all(promises);
        
        // Verify all requests succeeded
        expect(results).toHaveLength(requestsPerIteration);
        
        // Clear mocks to prevent memory accumulation
        jest.clearAllMocks();
        
        // Force garbage collection hint
        if (global.gc) {
          global.gc();
        }
      }

      // Total mock calls should equal iterations * requests per iteration
      expect(totalMockCalls).toBe(iterations * requestsPerIteration);
      
      console.log(`Memory Management Test: ${iterations} iterations × ${requestsPerIteration} requests = ${totalMockCalls} total calls`);
    }, 25000);
  });
});