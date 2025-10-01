const { JenkinsService } = require('./jenkinsService');
const { getDeploymentPathService } = require('./deploymentPathService');
const { getNASService } = require('./nasService');
const logger = require('../config/logger');

// Mock services for logging testing
jest.mock('./deploymentPathService');
jest.mock('./nasService');

// Mock logger to capture log calls
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
      timeout: 30000,
    },
  })),
}));

describe('JenkinsService Enhanced Logging', () => {
  let jenkinsService;
  let mockDeploymentPathService;
  let mockNASService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear the mocked logger functions
    logger.info.mockClear();
    logger.debug.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();

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

  describe('Structured Logging with Request IDs', () => {
    test('should log with unique request IDs for traceability', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Mock cache hit scenario
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue({
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: ['V3.0.0_250310_0843.tar.gz'],
        createdAt: new Date().toISOString(),
      });

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Check that logs contain request IDs
      const infoLogs = logger.info.mock.calls;
      expect(infoLogs.length).toBeGreaterThan(0);

      // First log should be the start log
      const startLog = infoLogs[0];
      expect(startLog[0]).toMatch(/\[.*#.*-.*\] Starting deployment info extraction/);
      expect(startLog[1]).toMatchObject({
        jobName,
        buildNumber,
        requestId: expect.stringMatching(/.+#.+-\d+/),
        timestamp: expect.any(String),
      });

      // Cache hit log should have consistent request ID
      const cacheHitLog = infoLogs[1];
      expect(cacheHitLog[0]).toMatch(/\[.*#.*-.*\] Cache hit - found cached deployment path/);
      expect(cacheHitLog[1]).toMatchObject({
        step: 'cache_hit',
        nasPath: expect.any(String),
        downloadFile: expect.any(String),
        cacheResponseTime: expect.stringMatching(/\d+ms/),
        totalTime: expect.stringMatching(/\d+ms/),
      });

      // Extract request IDs from both logs
      const startRequestId = startLog[1].requestId;
      const cacheRequestId = cacheHitLog[0].match(/\[(.*?)\]/)[1];

      expect(startRequestId).toBe(cacheRequestId.split('] ')[0]);
    });

    test('should log performance metrics for each step', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      // Mock full fallback chain
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Check for success log with performance metrics
      const successLog = logger.info.mock.calls.find(call =>
        call[1]?.step === 'complete_success',
      );

      expect(successLog).toBeDefined();
      expect(successLog[1]).toMatchObject({
        step: 'complete_success',
        nasPath: expect.any(String),
        downloadFile: expect.any(String),
        fileCount: expect.any(Number),
        performance: {
          totalTime: expect.stringMatching(/\d+ms/),
          cacheTime: expect.stringMatching(/\d+ms/),
          apiTime: expect.stringMatching(/\d+ms/),
          nasTime: expect.stringMatching(/\d+ms/),
          saveTime: expect.stringMatching(/\d+ms/),
        },
        pathCandidatesGenerated: expect.any(Number),
      });
    });
  });

  describe('Step-by-Step Operation Logging', () => {
    test('should log each fallback chain step with appropriate levels', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Mock cache miss scenario
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: new Date().getTime() },
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Check debug logs for each step
      const debugLogs = logger.debug.mock.calls;

      // Should have debug logs for each step
      const stepLogs = debugLogs.filter(call => call[1]?.step);
      expect(stepLogs.length).toBeGreaterThan(4); // At least 5 steps

      // Check specific steps
      const cacheStep = stepLogs.find(call => call[1]?.step === 'cache_lookup');
      const jenkinsStep = stepLogs.find(call => call[1]?.step === 'jenkins_api');
      const pathGenStep = stepLogs.find(call => call[1]?.step === 'path_generation');
      const nasStep = stepLogs.find(call => call[1]?.step === 'nas_verification');
      const saveStep = stepLogs.find(call => call[1]?.step === 'cache_save');

      expect(cacheStep).toBeDefined();
      expect(jenkinsStep).toBeDefined();
      expect(pathGenStep).toBeDefined();
      expect(nasStep).toBeDefined();
      expect(saveStep).toBeDefined();
    });

    test('should log fallback scenarios with warning level', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Mock Jenkins API failure
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockRejectedValue(new Error('Jenkins API timeout'));

      // Mock fallback method
      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue({
        nasPath: 'fallback-path',
        downloadFile: 'fallback.tar.gz',
        allFiles: [],
        deploymentPath: 'fallback-path',
      });

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Check for warning logs
      const warnLogs = logger.warn.mock.calls;
      expect(warnLogs.length).toBeGreaterThan(0);

      // Should have fallback warning
      const fallbackLog = warnLogs.find(call =>
        call[0].includes('Jenkins API failed - falling back to build log extraction'),
      );
      expect(fallbackLog).toBeDefined();
      expect(fallbackLog[1]).toMatchObject({
        step: 'jenkins_api_failed',
        apiResponseTime: expect.stringMatching(/\d+ms/),
        fallbackReason: 'no_build_timestamp',
      });
    });
  });

  describe('Database Cache Logging', () => {
    test('should log cache operations with detailed context', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Test cache hit
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue({
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: ['V3.0.0_250310_0843.tar.gz'],
        createdAt: '2025-03-10T17:39:00Z',
      });

      await jenkinsService.checkDatabaseCache(jobName, buildNumber);

      // Check debug logs for cache operations
      const debugLogs = logger.debug.mock.calls;

      const searchLog = debugLogs.find(call =>
        call[0].includes('Searching database cache'),
      );
      expect(searchLog).toBeDefined();
      expect(searchLog[1]).toMatchObject({
        jobName,
        version: '3.0.0',
        buildNumber,
        operation: 'cache_lookup',
      });

      const hitLog = debugLogs.find(call =>
        call[0].includes('Database cache hit found'),
      );
      expect(hitLog).toBeDefined();
      expect(hitLog[1]).toMatchObject({
        jobName,
        version: '3.0.0',
        buildNumber,
        cachedPath: expect.any(String),
        createdAt: expect.any(String),
        fileCount: expect.any(Number),
      });
    });

    test('should log cache miss with appropriate context', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Test cache miss
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      await jenkinsService.checkDatabaseCache(jobName, buildNumber);

      const debugLogs = logger.debug.mock.calls;

      const missLog = debugLogs.find(call =>
        call[0].includes('Database cache miss'),
      );
      expect(missLog).toBeDefined();
      expect(missLog[1]).toMatchObject({
        jobName,
        version: '3.0.0',
        buildNumber,
        operation: 'cache_miss',
      });
    });

    test('should log cache errors with full context', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Test cache error
      mockDeploymentPathService.findByProjectVersionBuild.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await jenkinsService.checkDatabaseCache(jobName, buildNumber);

      const errorLogs = logger.error.mock.calls;

      const errorLog = errorLogs.find(call =>
        call[0].includes('Database cache lookup failed with error'),
      );
      expect(errorLog).toBeDefined();
      expect(errorLog[1]).toMatchObject({
        jobName,
        buildNumber,
        error: 'Database connection failed',
        errorStack: expect.any(String),
        operation: 'cache_error',
      });
    });
  });

  describe('NAS Path Verification Logging', () => {
    test('should log detailed NAS verification steps', async () => {
      const pathCandidates = [
        {
          nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
          dateStr: '250310',
          buildNumber: 26,
        },
        {
          nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250311\\26',
          dateStr: '250311',
          buildNumber: 26,
        },
      ];

      // Mock first path fails, second succeeds
      mockNASService.directoryExists
        .mockResolvedValueOnce(false)  // First path doesn't exist
        .mockResolvedValueOnce(true);  // Second path exists

      mockNASService.getDirectoryFiles.mockResolvedValue([
        'V3.0.0_250311_0843.tar.gz',
        'mr3.0.0_250311_1000_26.enc.tar.gz',
      ]);

      await jenkinsService.verifyNASPaths(pathCandidates);

      // Check debug logs for path verification
      const debugLogs = logger.debug.mock.calls;

      // Should log each candidate check
      const pathCheckLogs = debugLogs.filter(call =>
        call[1]?.operation === 'nas_path_check',
      );
      expect(pathCheckLogs).toHaveLength(2);

      // Check first path (not found)
      const notFoundLog = debugLogs.find(call =>
        call[1]?.result === 'not_found',
      );
      expect(notFoundLog).toBeDefined();
      expect(notFoundLog[1]).toMatchObject({
        candidatePath: pathCandidates[0].nasPath,
        checkTime: expect.stringMatching(/\d+ms/),
        result: 'not_found',
        operation: 'nas_directory_check',
      });

      // Check second path (found)
      const foundLog = debugLogs.find(call =>
        call[1]?.result === 'found',
      );
      expect(foundLog).toBeDefined();
      expect(foundLog[1]).toMatchObject({
        candidatePath: pathCandidates[1].nasPath,
        checkTime: expect.stringMatching(/\d+ms/),
        result: 'found',
        operation: 'nas_directory_found',
      });

      // Check success log
      const successLog = logger.info.mock.calls.find(call =>
        call[1]?.operation === 'nas_verification_success',
      );
      expect(successLog).toBeDefined();
      expect(successLog[1]).toMatchObject({
        verifiedPath: pathCandidates[1].nasPath,
        fileCount: 2,
        mainDownloadFile: 'V3.0.0_250311_0843.tar.gz',
        categorizedFiles: {
          versionFiles: 1,
          mrFiles: 1,
          backendFiles: 0,
          frontendFiles: 0,
          otherFiles: 0,
        },
        verificationTime: expect.stringMatching(/\d+ms/),
        pathsChecked: 2,
        pathsSkipped: 1,
        operation: 'nas_verification_success',
      });
    });

    test('should log when no valid paths are found', async () => {
      const pathCandidates = [
        { nasPath: 'path1', dateStr: '250310', buildNumber: 26 },
        { nasPath: 'path2', dateStr: '250311', buildNumber: 26 },
      ];

      // All paths fail
      mockNASService.directoryExists.mockResolvedValue(false);

      await jenkinsService.verifyNASPaths(pathCandidates);

      const warnLogs = logger.warn.mock.calls;

      const noPathsLog = warnLogs.find(call =>
        call[0].includes('No valid NAS paths found after verification'),
      );
      expect(noPathsLog).toBeDefined();
      expect(noPathsLog[1]).toMatchObject({
        totalCandidates: 2,
        pathsChecked: 2,
        pathsSkipped: 2,
        verificationResults: expect.any(Array),
        operation: 'nas_verification_complete_failure',
      });
    });
  });

  describe('Error Logging and Recovery', () => {
    test('should log errors with full stack traces and context', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Mock critical error in extraction
      mockDeploymentPathService.findByProjectVersionBuild.mockRejectedValue(
        new Error('Critical database failure'),
      );

      // Mock fallback method
      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue({
        nasPath: 'fallback-path',
        downloadFile: 'fallback.tar.gz',
        allFiles: [],
        deploymentPath: 'fallback-path',
      });

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Check error logs
      const errorLogs = logger.error.mock.calls;

      expect(errorLogs.length).toBeGreaterThan(0);

      // Check that we have database cache error
      const dbErrorLog = errorLogs.find(call =>
        call[0].includes('Database cache lookup failed'),
      );
      expect(dbErrorLog).toBeDefined();
      expect(dbErrorLog[1]).toMatchObject({
        operation: 'cache_error',
        error: expect.any(String),
      });

      // Check that we have Jenkins API error
      const apiErrorLog = errorLogs.find(call =>
        call[0].includes('Failed to get build timestamp'),
      );
      expect(apiErrorLog).toBeDefined();
    });
  });

  describe('Log Correlation and Filtering', () => {
    test('should provide structured logs suitable for log aggregation', async () => {
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue({
        nasPath: 'cached-path',
        downloadFile: 'cached.tar.gz',
        allFiles: [],
      });

      await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // All logs should have structured format
      const allLogs = [
        ...logger.info.mock.calls,
        ...logger.debug.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ];

      allLogs.forEach(logCall => {
        // First parameter should be a string (message)
        expect(typeof logCall[0]).toBe('string');

        // Second parameter should be an object (structured data)
        if (logCall[1]) {
          expect(typeof logCall[1]).toBe('object');
          expect(logCall[1]).not.toBeNull();
        }
      });

      // Check that logs contain searchable fields
      const infoLogs = logger.info.mock.calls;
      infoLogs.forEach(logCall => {
        if (logCall[1]) {
          // Should have operation or step for filtering
          expect(
            logCall[1].step ||
            logCall[1].operation ||
            logCall[1].requestId,
          ).toBeDefined();
        }
      });
    });
  });
});
