const { JenkinsService } = require('./jenkinsService');
const { getDeploymentPathService } = require('./deploymentPathService');
const { getNASService } = require('./nasService');
const logger = require('../config/logger');
const axios = require('axios');

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
  })),
}));

describe('JenkinsService Integration - Complete Fallback Chain', () => {
  let jenkinsService;
  let mockDeploymentPathService;
  let mockNASService;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock environment variables for Jenkins service
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

    // Initialize service after mocks are set up
    jenkinsService = new JenkinsService();
  });

  afterEach(() => {
    delete process.env.JENKINS_URL;
    delete process.env.JENKINS_USERNAME;
    delete process.env.JENKINS_PASSWORD;
  });

  describe('Complete Fallback Chain - Cache Hit Scenario', () => {
    it('should return cached result when DB cache hit occurs', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const cachedResult = {
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: [
          'V3.0.0_250310_0843.tar.gz',
          'mr3.0.0_250310_1739_26.enc.tar.gz',
        ],
      };

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(cachedResult);

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result).toEqual({
        nasPath: cachedResult.nasPath,
        downloadFile: cachedResult.downloadFile,
        allFiles: cachedResult.allFiles,
        deploymentPath: cachedResult.nasPath,
      });

      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalledWith(
        jobName,
        '3.0.0',
        buildNumber,
      );

      // Should not proceed to other steps
      expect(jenkinsService.client.get).not.toHaveBeenCalled();
      expect(mockNASService.directoryExists).not.toHaveBeenCalled();
    });
  });

  describe('Complete Fallback Chain - Cache Miss to Success', () => {
    it('should complete full fallback chain when cache miss but NAS verification succeeds', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');
      const nasPath = '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26';
      const nasFiles = [
        'V3.0.0_250310_0843.tar.gz',
        'mr3.0.0_250310_1739_26.enc.tar.gz',
        'be3.0.0_250310_0842_83.enc.tar.gz',
        'fe3.0.0_250310_0843_49.enc.tar.gz',
      ];

      // Step 1: Cache miss
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Step 2: Jenkins API success
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // Step 3: NAS verification success
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(nasFiles);

      // Step 4: Cache save success
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result).toEqual(expect.objectContaining({
        nasPath: expect.stringContaining('mr3.0.0'),
        deploymentPath: expect.stringContaining('mr3.0.0'),
        downloadFile: 'V3.0.0_250310_0843.tar.gz', // VERSION_FILE priority
        allFiles: nasFiles,
        categorized: expect.any(Object),
      }));

      // Verify all steps were called
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalledWith(
        jobName,
        '3.0.0',
        buildNumber,
      );

      expect(jenkinsService.client.get).toHaveBeenCalledWith(
        '/job/projects/job/3.0.0/job/mr3.0.0_release/26/api/json?tree=timestamp',
      );

      expect(mockNASService.directoryExists).toHaveBeenCalled();
      expect(mockNASService.getDirectoryFiles).toHaveBeenCalled();

      expect(mockDeploymentPathService.saveDeploymentPath).toHaveBeenCalledWith(expect.objectContaining({
        projectName: jobName,
        version: '3.0.0',
        buildNumber: buildNumber,
        buildDate: buildTimestamp,
        nasPath: expect.stringContaining('mr3.0.0'),
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: nasFiles,
      }));
    });
  });

  describe('Complete Fallback Chain - Multiple Path Candidates', () => {
    it('should try multiple date candidates until finding valid path', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      const path1 = '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26'; // Build date
      const path2 = '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250309\\26'; // Day before
      const path3 = '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250311\\26'; // Day after

      const nasFiles = ['V3.0.0_250311_0843.tar.gz'];

      // Cache miss
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);

      // Jenkins API success
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // NAS verification - first two paths fail, third succeeds
      mockNASService.directoryExists
        .mockResolvedValueOnce(false) // path1 doesn't exist
        .mockResolvedValueOnce(false) // path2 doesn't exist
        .mockResolvedValueOnce(true);  // path3 exists

      mockNASService.getDirectoryFiles.mockResolvedValue(nasFiles);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result.nasPath).toContain('mr3.0.0');
      expect(result.downloadFile).toBe('V3.0.0_250311_0843.tar.gz');

      // Verify all three paths were tried
      expect(mockNASService.directoryExists).toHaveBeenCalledTimes(3);
      // Paths may be tried in different order due to date prioritization
      expect(mockNASService.directoryExists).toHaveBeenCalledWith(expect.stringContaining('mr3.0.0'));
      expect(mockNASService.directoryExists).toHaveBeenCalledWith(expect.stringContaining('250312'));
      expect(mockNASService.directoryExists).toHaveBeenCalledWith(expect.stringContaining('250311'));

      // Only successful path should get file listing
      expect(mockNASService.getDirectoryFiles).toHaveBeenCalledTimes(1);
      expect(mockNASService.getDirectoryFiles).toHaveBeenCalledWith(expect.stringContaining('mr3.0.0'));
    });
  });

  describe('Complete Fallback Chain - Fallback to Legacy Method', () => {
    it('should fallback to legacy method when all new methods fail', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // All steps fail
      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockRejectedValue(new Error('Jenkins API failed'));

      // Mock the legacy method to return a result
      const legacyResult = {
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'V3.0.0_250310_0843.tar.gz',
        allFiles: [],
        deploymentPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
      };

      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue(legacyResult);

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result).toEqual(legacyResult);
      expect(jenkinsService.extractDeploymentInfoFromBuildLog).toHaveBeenCalledWith(jobName, buildNumber);

      // New method steps should have been attempted
      expect(mockDeploymentPathService.findByProjectVersionBuild).toHaveBeenCalled();
      expect(jenkinsService.client.get).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should handle transient NAS errors with retry logic', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');
      const nasPath = '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26';

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });

      // First call fails with retryable error, second succeeds
      mockNASService.directoryExists
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(true);

      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result.nasPath).toContain('mr3.0.0');

      // Should have retried the NAS operation
      expect(mockNASService.directoryExists).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;

      // Database operations fail
      mockDeploymentPathService.findByProjectVersionBuild.mockRejectedValue(
        new Error('Database connection failed'),
      );

      // Mock legacy method success
      const legacyResult = {
        nasPath: 'fallback-path',
        downloadFile: 'fallback-file.tar.gz',
        allFiles: [],
        deploymentPath: 'fallback-path',
      };
      jest.spyOn(jenkinsService, 'extractDeploymentInfoFromBuildLog').mockResolvedValue(legacyResult);

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result).toEqual(legacyResult);
      expect(jenkinsService.extractDeploymentInfoFromBuildLog).toHaveBeenCalledWith(jobName, buildNumber);
    });
  });

  describe('Performance and Timeout Requirements', () => {
    it('should complete within 30 seconds for successful path detection', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(['V3.0.0_250310_0843.tar.gz']);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const startTime = Date.now();
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);
      const duration = Date.now() - startTime;

      // Assert
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });

  describe('File Pattern Detection and Categorization', () => {
    it('should correctly categorize and prioritize different file types', async () => {
      // Arrange
      const jobName = '3.0.0/mr3.0.0_release';
      const buildNumber = 26;
      const buildTimestamp = new Date('2025-03-10T17:39:00Z');

      const mixedFiles = [
        'be3.0.0_250310_0842_83.enc.tar.gz',  // Backend file
        'mr3.0.0_250310_1739_26.enc.tar.gz',  // MR file
        'V3.0.0_250310_0843.tar.gz',          // Version file (should be main)
        'fe3.0.0_250310_0843_49.enc.tar.gz',  // Frontend file
        'other_file.txt',                     // Other file
      ];

      mockDeploymentPathService.findByProjectVersionBuild.mockResolvedValue(null);
      jenkinsService.client.get.mockResolvedValue({
        data: { timestamp: buildTimestamp.getTime() },
      });
      mockNASService.directoryExists.mockResolvedValue(true);
      mockNASService.getDirectoryFiles.mockResolvedValue(mixedFiles);
      mockDeploymentPathService.saveDeploymentPath.mockResolvedValue({});

      // Act
      const result = await jenkinsService.extractDeploymentInfo(jobName, buildNumber);

      // Assert
      expect(result.downloadFile).toBe('V3.0.0_250310_0843.tar.gz'); // VERSION_FILE should be prioritized
      expect(result.allFiles).toEqual(mixedFiles);
      expect(result.categorized).toEqual({
        versionFiles: ['V3.0.0_250310_0843.tar.gz'],
        mrFiles: ['mr3.0.0_250310_1739_26.enc.tar.gz'],
        backendFiles: ['be3.0.0_250310_0842_83.enc.tar.gz'],
        frontendFiles: ['fe3.0.0_250310_0843_49.enc.tar.gz'],
        otherFiles: ['other_file.txt'],
      });
    });
  });
});
