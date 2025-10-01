const { DeploymentPathService, getDeploymentPathService } = require('./deploymentPathService');
const { query, getPoolStatus } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../middleware/error');

// Mock dependencies
jest.mock('../config/database');
jest.mock('../config/logger');

// Mock the AppError import
jest.mock('../middleware/error', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'AppError';
    }
  },
}));

describe('DeploymentPathService', () => {
  let service;
  let mockQuery;
  let mockGetPoolStatus;
  let mockLogger;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock implementations
    mockQuery = query;
    mockGetPoolStatus = getPoolStatus;
    mockLogger = logger;
    
    // Create new service instance
    service = new DeploymentPathService();
    
    // Mock successful database connection by default
    mockGetPoolStatus.mockReturnValue({ status: 'active' });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(service.tableName).toBe('deployment_paths');
      expect(service.connectionTimeout).toBe(10000);
      expect(service.retryAttempts).toBe(3);
    });
  });

  describe('checkDatabaseConnection', () => {
    it('should return true when database pool is active and query succeeds', async () => {
      mockGetPoolStatus.mockReturnValue({ status: 'active' });
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      const result = await service.checkDatabaseConnection();

      expect(result).toBe(true);
      expect(mockGetPoolStatus).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return false when database pool is not active', async () => {
      mockGetPoolStatus.mockReturnValue({ status: 'inactive' });

      const result = await service.checkDatabaseConnection();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Database connection check failed')
      );
    });

    it('should return false when query fails', async () => {
      mockGetPoolStatus.mockReturnValue({ status: 'active' });
      mockQuery.mockRejectedValue(new Error('Connection failed'));

      const result = await service.checkDatabaseConnection();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Database connection check failed')
      );
    });
  });

  describe('validateParameters', () => {
    it('should pass validation with valid parameters', () => {
      const params = {
        projectName: 'test-project',
        version: '1.0.0',
        buildNumber: 123,
      };

      expect(() => {
        service.validateParameters(params, ['projectName', 'version', 'buildNumber']);
      }).not.toThrow();
    });

    it('should throw AppError for missing required parameters', () => {
      const params = {
        projectName: 'test-project',
        // version missing
        buildNumber: 123,
      };

      expect(() => {
        service.validateParameters(params, ['projectName', 'version', 'buildNumber']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['projectName', 'version', 'buildNumber']);
      } catch (error) {
        expect(error.message).toContain('Missing required parameters: version');
      }
    });

    it('should throw AppError for project name too long', () => {
      const params = {
        projectName: 'a'.repeat(101), // 101 characters
        version: '1.0.0',
        buildNumber: 123,
      };

      expect(() => {
        service.validateParameters(params, ['projectName']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['projectName']);
      } catch (error) {
        expect(error.message).toContain('Project name must be 100 characters or less');
      }
    });

    it('should throw AppError for version too long', () => {
      const params = {
        version: 'a'.repeat(21), // 21 characters
      };

      expect(() => {
        service.validateParameters(params, ['version']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['version']);
      } catch (error) {
        expect(error.message).toContain('Version must be 20 characters or less');
      }
    });

    it('should throw AppError for invalid build number', () => {
      const params = {
        buildNumber: -1,
      };

      expect(() => {
        service.validateParameters(params, ['buildNumber']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['buildNumber']);
      } catch (error) {
        expect(error.message).toContain('Build number must be a non-negative integer');
      }
    });

    it('should throw AppError for invalid NAS path type', () => {
      const params = {
        nasPath: 123, // should be string
      };

      expect(() => {
        service.validateParameters(params, ['nasPath']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['nasPath']);
      } catch (error) {
        expect(error.message).toContain('NAS path must be a string');
      }
    });

    it('should throw AppError for invalid date', () => {
      const params = {
        buildDate: 'invalid-date',
      };

      expect(() => {
        service.validateParameters(params, ['buildDate']);
      }).toThrow(AppError);

      try {
        service.validateParameters(params, ['buildDate']);
      } catch (error) {
        expect(error.message).toContain('Build date must be a valid date');
      }
    });
  });

  describe('handleDatabaseError', () => {
    it('should handle connection errors correctly', () => {
      const error = new Error('Connection failed');
      error.code = 'ECONNREFUSED';

      const result = service.handleDatabaseError(error, 'test operation');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Database connection failed. Please try again later.');
      expect(result.statusCode).toBe(503);
    });

    it('should handle unique constraint violation', () => {
      const error = new Error('Unique violation');
      error.code = '23505';

      const result = service.handleDatabaseError(error, 'test operation');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Record already exists');
      expect(result.statusCode).toBe(409);
    });

    it('should handle undefined table error', () => {
      const error = new Error('Table does not exist');
      error.code = '42P01';

      const result = service.handleDatabaseError(error, 'test operation');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Database schema error. Please contact administrator.');
      expect(result.statusCode).toBe(500);
    });

    it('should handle too many connections error', () => {
      const error = new Error('Too many connections');
      error.code = '53300';

      const result = service.handleDatabaseError(error, 'test operation');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Database is currently busy. Please try again later.');
      expect(result.statusCode).toBe(503);
    });

    it('should handle generic database errors', () => {
      const error = new Error('Generic database error');
      error.code = 'UNKNOWN';

      const result = service.handleDatabaseError(error, 'test operation');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Database operation failed: test operation');
      expect(result.statusCode).toBe(500);
    });
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockResult = { rows: [{ id: 1 }] };
      mockQuery.mockResolvedValue(mockResult);

      const result = await service.executeWithRetry('SELECT 1', [], 'test operation');

      expect(result).toBe(mockResult);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors and eventually succeed', async () => {
      const mockResult = { rows: [{ id: 1 }] };
      mockQuery
        .mockRejectedValueOnce(new Error('Temporary connection issue'))
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // checkDatabaseConnection call
        .mockResolvedValue(mockResult); // actual retry call
      
      mockGetPoolStatus.mockReturnValue({ status: 'active' });

      const result = await service.executeWithRetry('SELECT 1', [], 'test operation');

      expect(result).toBe(mockResult);
      expect(mockQuery).toHaveBeenCalledTimes(3); // Initial attempt + checkConnection + retry
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('test operation succeeded on retry attempt')
      );
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Unique violation');
      error.code = '23505';
      mockQuery.mockRejectedValue(error);

      await expect(
        service.executeWithRetry('INSERT INTO test', [], 'test operation')
      ).rejects.toThrow();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Non-retryable error')
      );
    });

    it('should exhaust retries and throw error', async () => {
      const error = new Error('Persistent connection issue');
      mockQuery.mockRejectedValue(error);
      mockGetPoolStatus.mockReturnValue({ status: 'active' });

      await expect(
        service.executeWithRetry('SELECT 1', [], 'test operation')
      ).rejects.toThrow();

      expect(mockQuery).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('test operation failed after 3 attempts')
      );
    });
  });

  describe('findByProjectVersionBuild', () => {
    it('should return cached deployment path when found', async () => {
      const mockRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_name: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        build_number: 26,
        build_date: new Date('2025-03-10'),
        nas_path: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        download_file: 'mr3.0.0_250310_1739_26.tar.gz',
        all_files: JSON.stringify(['file1.tar.gz', 'file2.enc.tar.gz']),
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await service.findByProjectVersionBuild('3.0.0/mr3.0.0_release', '3.0.0', 26);

      expect(result).toEqual({
        id: mockRow.id,
        projectName: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        buildNumber: 26,
        buildDate: mockRow.build_date,
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'mr3.0.0_250310_1739_26.tar.gz',
        allFiles: ['file1.tar.gz', 'file2.enc.tar.gz'],
        verifiedAt: mockRow.verified_at,
        createdAt: mockRow.created_at,
        updatedAt: mockRow.updated_at,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM deployment_paths'),
        ['3.0.0/mr3.0.0_release', '3.0.0', 26]
      );
    });

    it('should return null when no cached path found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.findByProjectVersionBuild('nonexistent', '1.0.0', 1);

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No cached path found')
      );
    });

    it('should throw AppError for invalid parameters', async () => {
      await expect(
        service.findByProjectVersionBuild('', '1.0.0', 1)
      ).rejects.toThrow(AppError);
    });
  });

  describe('saveDeploymentPath', () => {
    const validPathData = {
      projectName: '3.0.0/mr3.0.0_release',
      version: '3.0.0',
      buildNumber: 26,
      buildDate: new Date('2025-03-10'),
      nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
      downloadFile: 'mr3.0.0_250310_1739_26.tar.gz',
      allFiles: ['file1.tar.gz', 'file2.enc.tar.gz'],
    };

    it('should save deployment path successfully', async () => {
      const mockResult = {
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          project_name: validPathData.projectName,
          version: validPathData.version,
          build_number: validPathData.buildNumber,
          build_date: validPathData.buildDate,
          nas_path: validPathData.nasPath,
          download_file: validPathData.downloadFile,
          all_files: JSON.stringify(validPathData.allFiles),
          verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };

      mockQuery.mockResolvedValue(mockResult);

      const result = await service.saveDeploymentPath(validPathData);

      expect(result.projectName).toBe(validPathData.projectName);
      expect(result.version).toBe(validPathData.version);
      expect(result.buildNumber).toBe(validPathData.buildNumber);
      expect(result.allFiles).toEqual(validPathData.allFiles);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deployment_paths'),
        expect.arrayContaining([
          validPathData.projectName,
          validPathData.version,
          validPathData.buildNumber,
          validPathData.buildDate,
          validPathData.nasPath,
          validPathData.downloadFile,
          JSON.stringify(validPathData.allFiles),
        ])
      );
    });

    it('should handle string date input', async () => {
      const pathDataWithStringDate = {
        ...validPathData,
        buildDate: '2025-03-10T00:00:00.000Z',
      };

      const mockResult = {
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          project_name: pathDataWithStringDate.projectName,
          version: pathDataWithStringDate.version,
          build_number: pathDataWithStringDate.buildNumber,
          build_date: new Date(pathDataWithStringDate.buildDate),
          nas_path: pathDataWithStringDate.nasPath,
          download_file: pathDataWithStringDate.downloadFile,
          all_files: JSON.stringify(pathDataWithStringDate.allFiles),
          verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };

      mockQuery.mockResolvedValue(mockResult);

      const result = await service.saveDeploymentPath(pathDataWithStringDate);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deployment_paths'),
        expect.arrayContaining([
          pathDataWithStringDate.projectName,
          pathDataWithStringDate.version,
          pathDataWithStringDate.buildNumber,
          expect.any(Date),
          pathDataWithStringDate.nasPath,
          pathDataWithStringDate.downloadFile,
          JSON.stringify(pathDataWithStringDate.allFiles),
        ])
      );
    });

    it('should throw AppError for invalid allFiles', async () => {
      const invalidPathData = {
        ...validPathData,
        allFiles: 'not-an-array',
      };

      await expect(
        service.saveDeploymentPath(invalidPathData)
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError for allFiles too large', async () => {
      const largeFiles = Array(100000).fill('large-file-name.tar.gz');
      const invalidPathData = {
        ...validPathData,
        allFiles: largeFiles,
      };

      await expect(
        service.saveDeploymentPath(invalidPathData)
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError for missing required parameters', async () => {
      const invalidPathData = {
        projectName: validPathData.projectName,
        // missing version, buildNumber, buildDate, nasPath
      };

      await expect(
        service.saveDeploymentPath(invalidPathData)
      ).rejects.toThrow(AppError);
    });
  });

  describe('getRecentPathsByProject', () => {
    it('should return recent paths for project', async () => {
      const mockRows = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          project_name: '3.0.0/mr3.0.0_release',
          version: '3.0.0',
          build_number: 26,
          build_date: new Date('2025-03-10'),
          nas_path: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
          download_file: 'mr3.0.0_250310_1739_26.tar.gz',
          all_files: JSON.stringify(['file1.tar.gz']),
          verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await service.getRecentPathsByProject('3.0.0/mr3.0.0_release', 5);

      expect(result).toHaveLength(1);
      expect(result[0].projectName).toBe('3.0.0/mr3.0.0_release');
      expect(result[0].buildNumber).toBe(26);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE project_name = $1'),
        ['3.0.0/mr3.0.0_release', 5]
      );
    });

    it('should throw AppError for invalid limit', async () => {
      await expect(
        service.getRecentPathsByProject('test-project', 0)
      ).rejects.toThrow(AppError);

      await expect(
        service.getRecentPathsByProject('test-project', 1001)
      ).rejects.toThrow(AppError);
    });
  });

  describe('getPathsByDateRange', () => {
    it('should return paths within date range', async () => {
      const startDate = new Date('2025-03-01');
      const endDate = new Date('2025-03-31');
      
      const mockRows = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          project_name: '3.0.0/mr3.0.0_release',
          version: '3.0.0',
          build_number: 26,
          build_date: new Date('2025-03-10'),
          nas_path: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
          download_file: 'mr3.0.0_250310_1739_26.tar.gz',
          all_files: JSON.stringify(['file1.tar.gz']),
          verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await service.getPathsByDateRange(startDate, endDate);

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE build_date BETWEEN $1 AND $2'),
        [startDate, endDate]
      );
    });

    it('should handle string date inputs', async () => {
      const startDate = '2025-03-01';
      const endDate = '2025-03-31';

      mockQuery.mockResolvedValue({ rows: [] });

      await service.getPathsByDateRange(startDate, endDate);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE build_date BETWEEN $1 AND $2'),
        [new Date(startDate), new Date(endDate)]
      );
    });

    it('should throw AppError for invalid date format', async () => {
      await expect(
        service.getPathsByDateRange('invalid-date', '2025-03-31')
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError when start date is after end date', async () => {
      const startDate = new Date('2025-03-31');
      const endDate = new Date('2025-03-01');

      await expect(
        service.getPathsByDateRange(startDate, endDate)
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError for date range exceeding one year', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2025-12-31');

      await expect(
        service.getPathsByDateRange(startDate, endDate)
      ).rejects.toThrow(AppError);
    });
  });

  describe('deleteDeploymentPath', () => {
    it('should delete deployment path successfully', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await service.deleteDeploymentPath('3.0.0/mr3.0.0_release', '3.0.0', 26);

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted deployment path cache')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM deployment_paths'),
        ['3.0.0/mr3.0.0_release', '3.0.0', 26]
      );
    });

    it('should return false when no row was deleted', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await service.deleteDeploymentPath('nonexistent', '1.0.0', 1);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No deployment path found to delete')
      );
    });
  });

  describe('cleanupOldPaths', () => {
    it('should cleanup old paths successfully', async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 });

      const result = await service.cleanupOldPaths(90);

      expect(result).toBe(5);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 5 old deployment path cache entries')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE verified_at < CURRENT_TIMESTAMP'),
        ['90']
      );
    });

    it('should throw AppError for invalid daysOld parameter', async () => {
      await expect(
        service.cleanupOldPaths(0)
      ).rejects.toThrow(AppError);

      await expect(
        service.cleanupOldPaths(4000)
      ).rejects.toThrow(AppError);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const mockStats = {
        total_cached_paths: '150',
        unique_projects: '12',
        unique_versions: '8',
        oldest_build_date: new Date('2024-01-01'),
        newest_build_date: new Date('2025-03-10'),
        oldest_cache_entry: new Date('2024-01-01'),
        newest_cache_entry: new Date('2025-03-10'),
      };

      mockQuery.mockResolvedValue({ rows: [mockStats] });

      const result = await service.getCacheStats();

      expect(result.total_cached_paths).toBe(150);
      expect(result.unique_projects).toBe(12);
      expect(result.unique_versions).toBe(8);
      expect(result.oldest_build_date).toBe(mockStats.oldest_build_date);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Retrieved deployment path cache statistics'
      );
    });

    it('should handle invalid numeric values safely', async () => {
      const mockStats = {
        total_cached_paths: 'invalid',
        unique_projects: null,
        unique_versions: undefined,
        oldest_build_date: new Date('2024-01-01'),
        newest_build_date: new Date('2025-03-10'),
        oldest_cache_entry: new Date('2024-01-01'),
        newest_cache_entry: new Date('2025-03-10'),
      };

      mockQuery.mockResolvedValue({ rows: [mockStats] });

      const result = await service.getCacheStats();

      expect(result.total_cached_paths).toBe(0);
      expect(result.unique_projects).toBe(0);
      expect(result.unique_versions).toBe(0);
    });
  });

  describe('formatDeploymentPath', () => {
    it('should format deployment path correctly', () => {
      const mockRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_name: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        build_number: 26,
        build_date: new Date('2025-03-10'),
        nas_path: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        download_file: 'mr3.0.0_250310_1739_26.tar.gz',
        all_files: JSON.stringify(['file1.tar.gz', 'file2.enc.tar.gz']),
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = service.formatDeploymentPath(mockRow);

      expect(result).toEqual({
        id: mockRow.id,
        projectName: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        buildNumber: 26,
        buildDate: mockRow.build_date,
        nasPath: '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
        downloadFile: 'mr3.0.0_250310_1739_26.tar.gz',
        allFiles: ['file1.tar.gz', 'file2.enc.tar.gz'],
        verifiedAt: mockRow.verified_at,
        createdAt: mockRow.created_at,
        updatedAt: mockRow.updated_at,
      });
    });

    it('should handle already parsed JSON arrays', () => {
      const mockRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_name: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        build_number: 26,
        build_date: new Date('2025-03-10'),
        nas_path: '\\\\nas.roboetech.com\\release',
        download_file: 'test.tar.gz',
        all_files: ['file1.tar.gz', 'file2.enc.tar.gz'], // Already an array
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = service.formatDeploymentPath(mockRow);

      expect(result.allFiles).toEqual(['file1.tar.gz', 'file2.enc.tar.gz']);
    });

    it('should handle invalid JSON gracefully', () => {
      const mockRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_name: '3.0.0/mr3.0.0_release',
        version: '3.0.0',
        build_number: 26,
        build_date: new Date('2025-03-10'),
        nas_path: '\\\\nas.roboetech.com\\release',
        download_file: 'test.tar.gz',
        all_files: 'invalid-json{', // Invalid JSON
        verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = service.formatDeploymentPath(mockRow);

      expect(result.allFiles).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse all_files JSON')
      );
    });

    it('should return safe defaults when formatting fails', () => {
      const mockRow = null; // This will cause an error

      const result = service.formatDeploymentPath(mockRow);

      expect(result).toEqual({
        id: null,
        projectName: '',
        version: '',
        buildNumber: 0,
        buildDate: null,
        nasPath: '',
        downloadFile: null,
        allFiles: [],
        verifiedAt: null,
        createdAt: null,
        updatedAt: null,
      });
    });
  });

  describe('getDeploymentPathService singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getDeploymentPathService();
      const instance2 = getDeploymentPathService();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(DeploymentPathService);
    });
  });
});