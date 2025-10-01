const { JenkinsService } = require('./jenkinsService');
const { getDeploymentPathService } = require('./deploymentPathService');
const { getNASService } = require('./nasService');
const logger = require('../config/logger');

// Mock logger to reduce test noise
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock external services
jest.mock('./deploymentPathService');
jest.mock('./nasService');

// Mock axios with controlled delays
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  })),
}));

describe('JenkinsService Performance Tests - 30 Second Timeout Requirement', () => {
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

  describe('Fast Path Performance (Cache Hit)', () => {
    it('should complete cache hit scenario within 100ms', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const cachedResult = {
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: ['V3.0.0_250310_0843.tar.gz'],
      };

      // Fast cache response
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(cachedResult);

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(100); // Should be very fast for cache hits
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalled();
      expect(jenkinsService.client.get).not.toHaveBeenCalled(); // Should not call Jenkins API
    });
  });

  describe('Full Fallback Chain Performance', () => {
    it('should complete full fallback chain within 30 seconds with normal response times', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      // Cache miss
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Jenkins API with realistic delay (500ms)
      jenkinsService.client.get.mockImplementation(() =>
        new Promise(resolve => setTimeout(() =>
          resolve({ data: { timestamp: buildTimestamp.getTime() } }), 500)),
      );

      // NAS operations with realistic delays
      mockNASService.directoryExists.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(true), 200)),
      );

      mockNASService.getDirectoryFiles.mockImplementation(() =>
        new Promise(resolve => setTimeout(() =>
          resolve(['V3.0.0_250310_0843.tar.gz']), 300)),
      );

      // DB save with small delay
      mockDeploymentPathService.saveDeploymentPath.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({}), 100)),
      );

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(30000); // Must complete within 30 seconds
      expect(durationMs).toBeGreaterThan(500); // Should take some time for full chain

      // Verify all steps were called
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalled();
      expect(jenkinsService.client.get).toHaveBeenCalled();
      expect(mockNASService.directoryExists).toHaveBeenCalled();
      expect(mockNASService.getDirectoryFiles).toHaveBeenCalled();
      expect(mockDeploymentPathService.saveDeploymentPath).toHaveBeenCalled();
    });

    it('should handle slow Jenkins API responses within timeout', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Very slow Jenkins API (10 seconds)
      jenkinsService.client.get.mockImplementation(() =>
        new Promise(resolve => setTimeout(() =>
          resolve({ data: { timestamp: buildTimestamp.getTime() } }), 10000)),
      );

      // Fast NAS operations
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(30000); // Must still complete within 30 seconds
      expect(durationMs).toBeGreaterThan(10000); // Should reflect the Jenkins delay
    }, 35000);

    it('should handle slow NAS operations within timeout', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Fast Jenkins API
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // Slow NAS operations (5 seconds each)
      mockNASService.directoryExists.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(true), 5000)),
      );

      mockNASService.getDirectoryFiles.mockImplementation(() =>
        new Promise(resolve => setTimeout(() =>
          resolve(['V3.0.0_250310_0843.tar.gz']), 5000)),
      );

      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(30000); // Must complete within 30 seconds
      expect(durationMs).toBeGreaterThan(10000); // Should reflect the NAS delays
    }, 35000);
  });

  describe('Multiple Path Candidates Performance', () => {
    it('should handle multiple failed path attempts within timeout', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // First two paths fail with delays, third succeeds
      mockNASService.directoryExists
        .mockImplementationOnce(() =>
          new Promise(resolve => setTimeout(() => resolve(false), 2000))) // 2s delay, then fail
        .mockImplementationOnce(() =>
          new Promise(resolve => setTimeout(() => resolve(false), 2000))) // 2s delay, then fail
        .mockImplementationOnce(() =>
          new Promise(resolve => setTimeout(() => resolve(true), 1000)));  // 1s delay, then succeed

      mockNASService.getDirectoryFiles.mockImplementation(() =>
        new Promise(resolve => setTimeout(() =>
          resolve(['V3.0.0_250310_0843.tar.gz']), 1000)),
      );

      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(30000); // Must complete within 30 seconds
      expect(durationMs).toBeGreaterThan(6000); // Should reflect multiple attempts (2+2+1+1 = 6s minimum)

      // Verify all three paths were tried
      expect(mockNASService.directoryExists).toHaveBeenCalledTimes(3);
    }, 35000);
  });

  describe('Retry Mechanism Performance', () => {
    it('should handle retries without exceeding timeout', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // NAS operation fails twice, then succeeds (with retry mechanism)
      mockNASService.directoryExists
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))  // First attempt fails
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))  // Retry fails
        .mockResolvedValueOnce(true);                      // Second retry succeeds

      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toBeDefined();
      expect(durationMs).toBeLessThan(30000); // Must complete within 30 seconds

      // Should have retried the failed operation
      expect(mockNASService.directoryExists).toHaveBeenCalledTimes(3); // Original + 2 retries
    }, 35000);
  });

  describe('Fallback to Legacy Method Performance', () => {
    it('should fallback to legacy method when new method times out', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // All new method steps fail
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockRejectedValue(new Error('Jenkins API timeout'));

      // Mock legacy method to return quickly
      const legacyResult = {
        nasPath: 'legacy-path',
        downloadFile: 'legacy-file.tar.gz',
        allFiles: [],
        deploymentPath: 'legacy-path',
      };
      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue(legacyResult);

      // Act
      const startTime = process.hrtime.bigint();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Assert
      expect(result).toEqual(legacyResult);
      expect(durationMs).toBeLessThan(30000); // Must complete within 30 seconds
      expect(durationMs).toBeLessThan(1000);  // Legacy fallback should be fast
      expect(jenkinsService.extractDeploymentInfoFromBuildLog).toHaveBeenCalled();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should benchmark different scenarios and log performance metrics', async () => {
      const scenarios = [
        {
          name: 'Cache Hit',
          setup: () => {
            mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue({
              nasPath: 'cached-path',
              downloadFile: 'cached-file.tar.gz',
              allFiles: [],
            });
          },
        },
        {
          name: 'Full Chain Success',
          setup: () => {
            mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
            jenkinsService.client.get.mockResolvedValue({
              data: { timestamp: new Date().getTime() },
            });
            mockNASService.directoryExists.mockResolvedValue(true);
            mockNASService.getDirectoryFiles.mockResolvedValue(['test.tar.gz']);
            mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});
          },
        },
        {
          name: 'Legacy Fallback',
          setup: () => {
            mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
            jenkinsService.client.get.mockRejectedValue(new Error('API Error'));
            jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue({
              nasPath: 'legacy-path',
              downloadFile: 'legacy.tar.gz',
              allFiles: [],
              deploymentPath: 'legacy-path',
            });
          },
        },
      ];

      const results = [];

      for (const scenario of scenarios) {
        // Reset mocks
        jest.clearAllMocks();
        scenario.setup();

        // Run benchmark
        const iterations = 5;
        const times = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = process.hrtime.bigint();
          await jenkinsService.extractDeploymentInfo('3.0.0/mr3.0.0_release', 26);
          const endTime = process.hrtime.bigint();
          times.push(Number(endTime - startTime) / 1_000_000);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);

        results.push({
          scenario: scenario.name,
          avgTime: avgTime.toFixed(2),
          maxTime: maxTime.toFixed(2),
          minTime: minTime.toFixed(2),
        });

        // All scenarios should complete within 30 seconds
        expect(maxTime).toBeLessThan(30000);
      }

      // Log performance results for debugging
      console.log('\n=== Performance Benchmark Results ===');
      results.forEach(result => {
        console.log(`${result.scenario}:`);
        console.log(`  Average: ${result.avgTime}ms`);
        console.log(`  Max: ${result.maxTime}ms`);
        console.log(`  Min: ${result.minTime}ms`);
      });
      console.log('=====================================\n');

      expect(results).toHaveLength(3);
    });
  });
});
