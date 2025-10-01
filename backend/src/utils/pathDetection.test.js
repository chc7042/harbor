const {
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
} = require('./pathDetection');

describe('pathDetection utilities', () => {
  describe('formatDateForNAS', () => {
    it('should format Date object to YYMMDD', () => {
      const date = new Date('2025-03-10T00:00:00Z');
      expect(formatDateForNAS(date)).toBe('250310');
    });

    it('should format string timestamp to YYMMDD', () => {
      expect(formatDateForNAS('2025-03-10T00:00:00Z')).toBe('250310');
      expect(formatDateForNAS('2025-12-25')).toBe('251225');
    });

    it('should format numeric timestamp to YYMMDD', () => {
      const timestamp = new Date('2025-03-10T00:00:00Z').getTime();
      expect(formatDateForNAS(timestamp)).toBe('250310');
    });

    it('should handle edge cases for dates', () => {
      expect(formatDateForNAS('2025-01-01')).toBe('250101');
      expect(formatDateForNAS('2025-12-31')).toBe('251231');
      expect(formatDateForNAS('2025-02-28')).toBe('250228');
    });

    it('should throw error for missing timestamp', () => {
      expect(() => formatDateForNAS()).toThrow('Timestamp is required');
      expect(() => formatDateForNAS(null)).toThrow('Timestamp is required');
      expect(() => formatDateForNAS('')).toThrow('Timestamp is required');
    });

    it('should throw error for invalid timestamp format', () => {
      expect(() => formatDateForNAS({})).toThrow('Invalid timestamp format');
      expect(() => formatDateForNAS([])).toThrow('Invalid timestamp format');
      expect(() => formatDateForNAS(true)).toThrow('Invalid timestamp format');
    });

    it('should throw error for invalid date', () => {
      expect(() => formatDateForNAS('invalid-date')).toThrow('Invalid date');
      expect(() => formatDateForNAS('2025-13-01')).toThrow('Invalid date');
      expect(() => formatDateForNAS('not-a-date-string')).toThrow('Invalid date');
    });
  });

  describe('generatePathCandidates', () => {
    it('should generate date candidates with default range (±1 day)', () => {
      const buildDate = new Date('2025-03-10');
      const candidates = generatePathCandidates(buildDate);

      expect(candidates).toEqual(['250310', '250309', '250311']);
    });

    it('should generate date candidates with custom range', () => {
      const buildDate = new Date('2025-03-10');
      const candidates = generatePathCandidates(buildDate, 2);

      expect(candidates).toEqual(['250310', '250309', '250311', '250308', '250312']);
    });

    it('should handle month boundaries correctly', () => {
      const buildDate = new Date('2025-03-01');
      const candidates = generatePathCandidates(buildDate);

      expect(candidates).toEqual(['250301', '250228', '250302']);
    });

    it('should handle year boundaries correctly', () => {
      const buildDate = new Date('2025-01-01');
      const candidates = generatePathCandidates(buildDate);

      expect(candidates).toEqual(['250101', '241231', '250102']);
    });

    it('should handle leap year boundaries', () => {
      const buildDate = new Date('2024-02-29'); // 2024 is a leap year
      const candidates = generatePathCandidates(buildDate);

      expect(candidates).toEqual(['240229', '240228', '240301']);
    });

    it('should remove duplicate dates', () => {
      // Edge case where the same date might be generated multiple times
      const buildDate = new Date('2025-03-10');
      const candidates = generatePathCandidates(buildDate, 0);

      expect(candidates).toEqual(['250310']);
    });

    it('should accept string date input', () => {
      const candidates = generatePathCandidates('2025-03-10');
      expect(candidates).toEqual(['250310', '250309', '250311']);
    });

    it('should throw error for missing build date', () => {
      expect(() => generatePathCandidates()).toThrow('Build date is required');
      expect(() => generatePathCandidates(null)).toThrow('Build date is required');
    });

    it('should throw error for invalid build date', () => {
      expect(() => generatePathCandidates('invalid-date')).toThrow('Invalid build date');
    });
  });

  describe('constructNASPath', () => {
    it('should construct standard NAS path', () => {
      const path = constructNASPath('3.0.0', '250310', 26);
      expect(path).toBe('\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26');
    });

    it('should construct NAS path with custom options', () => {
      const options = {
        baseUrl: '\\\\custom-nas\\release',
        prefix: 'rel',
      };
      const path = constructNASPath('1.2.0', '250929', 54, options);
      expect(path).toBe('\\\\custom-nas\\release\\rel1.2.0\\250929\\54');
    });

    it('should handle build number 0', () => {
      const path = constructNASPath('1.0.0', '241017', 0);
      expect(path).toBe('\\\\nas.roboetech.com\\release_version\\release\\product\\mr1.0.0\\241017\\0');
    });

    it('should throw error for missing required parameters', () => {
      expect(() => constructNASPath()).toThrow('Version, dateStr, and buildNumber are required');
      expect(() => constructNASPath('3.0.0')).toThrow('Version, dateStr, and buildNumber are required');
      expect(() => constructNASPath('3.0.0', '250310')).toThrow('Version, dateStr, and buildNumber are required');
    });

    it('should throw error for invalid build number', () => {
      expect(() => constructNASPath('3.0.0', '250310', -1)).toThrow('Build number must be a non-negative number');
      expect(() => constructNASPath('3.0.0', '250310', 'invalid')).toThrow('Build number must be a non-negative number');
    });

    it('should throw error for invalid date format', () => {
      expect(() => constructNASPath('3.0.0', '25031', 26)).toThrow('DateStr must be in YYMMDD format');
      expect(() => constructNASPath('3.0.0', '2503101', 26)).toThrow('DateStr must be in YYMMDD format');
      expect(() => constructNASPath('3.0.0', 'invalid', 26)).toThrow('DateStr must be in YYMMDD format');
    });

    it('should throw error for invalid version format', () => {
      expect(() => constructNASPath('3.0', '250310', 26)).toThrow('Version must be in semantic version format');
      expect(() => constructNASPath('v3.0.0', '250310', 26)).toThrow('Version must be in semantic version format');
      expect(() => constructNASPath('invalid', '250310', 26)).toThrow('Version must be in semantic version format');
    });
  });

  describe('matchesPattern', () => {
    it('should match VERSION_FILE pattern', () => {
      expect(matchesPattern('V3.0.0_250310_0843.tar.gz', 'VERSION_FILE')).toBe(true);
      expect(matchesPattern('V1.2.0_250929_1058.tar.gz', 'VERSION_FILE')).toBe(true);
      expect(matchesPattern('invalid.tar.gz', 'VERSION_FILE')).toBe(false);
    });

    it('should match MR_RELEASE pattern', () => {
      expect(matchesPattern('mr3.0.0_250310_1739_26.enc.tar.gz', 'MR_RELEASE')).toBe(true);
      expect(matchesPattern('mr1.2.0_250929_1200_54.enc.tar.gz', 'MR_RELEASE')).toBe(true);
      expect(matchesPattern('mr3.0.0_250310_1739.tar.gz', 'MR_RELEASE')).toBe(false);
    });

    it('should match BACKEND_FILE pattern', () => {
      expect(matchesPattern('be3.0.0_250310_0842_83.enc.tar.gz', 'BACKEND_FILE')).toBe(true);
      expect(matchesPattern('be1.2.0_250929_1200_100.enc.tar.gz', 'BACKEND_FILE')).toBe(true);
      expect(matchesPattern('be3.0.0_250310_0842.tar.gz', 'BACKEND_FILE')).toBe(false);
    });

    it('should match FRONTEND_FILE pattern', () => {
      expect(matchesPattern('fe3.0.0_250310_0843_49.enc.tar.gz', 'FRONTEND_FILE')).toBe(true);
      expect(matchesPattern('fe1.2.0_250929_1200_200.enc.tar.gz', 'FRONTEND_FILE')).toBe(true);
      expect(matchesPattern('fe3.0.0_250310_0843.tar.gz', 'FRONTEND_FILE')).toBe(false);
    });

    it('should match TAR_FILE pattern', () => {
      expect(matchesPattern('any-file.tar.gz', 'TAR_FILE')).toBe(true);
      expect(matchesPattern('V3.0.0_250310_0843.tar.gz', 'TAR_FILE')).toBe(true);
      expect(matchesPattern('file.zip', 'TAR_FILE')).toBe(false);
    });

    it('should match ENCRYPTED_TAR pattern', () => {
      expect(matchesPattern('mr3.0.0_250310_1739_26.enc.tar.gz', 'ENCRYPTED_TAR')).toBe(true);
      expect(matchesPattern('any-file.enc.tar.gz', 'ENCRYPTED_TAR')).toBe(true);
      expect(matchesPattern('file.tar.gz', 'ENCRYPTED_TAR')).toBe(false);
    });

    it('should return false for invalid filename', () => {
      expect(matchesPattern('', 'VERSION_FILE')).toBe(false);
      expect(matchesPattern(null, 'VERSION_FILE')).toBe(false);
      expect(matchesPattern(123, 'VERSION_FILE')).toBe(false);
    });

    it('should throw error for unknown pattern type', () => {
      expect(() => matchesPattern('file.tar.gz', 'UNKNOWN_PATTERN')).toThrow('Unknown pattern type: UNKNOWN_PATTERN');
    });
  });

  describe('categorizeFiles', () => {
    it('should categorize files correctly', () => {
      const files = [
        'V3.0.0_250310_0843.tar.gz',
        'mr3.0.0_250310_1739_26.enc.tar.gz',
        'be3.0.0_250310_0842_83.enc.tar.gz',
        'fe3.0.0_250310_0843_49.enc.tar.gz',
        'other-file.txt',
      ];

      const categorized = categorizeFiles(files);

      expect(categorized).toEqual({
        versionFiles: ['V3.0.0_250310_0843.tar.gz'],
        mrFiles: ['mr3.0.0_250310_1739_26.enc.tar.gz'],
        backendFiles: ['be3.0.0_250310_0842_83.enc.tar.gz'],
        frontendFiles: ['fe3.0.0_250310_0843_49.enc.tar.gz'],
        otherFiles: ['other-file.txt'],
      });
    });

    it('should handle empty file list', () => {
      const categorized = categorizeFiles([]);
      expect(categorized).toEqual({
        versionFiles: [],
        mrFiles: [],
        backendFiles: [],
        frontendFiles: [],
        otherFiles: [],
      });
    });

    it('should ignore invalid file entries', () => {
      const files = [
        'V3.0.0_250310_0843.tar.gz',
        null,
        123,
        '',
        'valid-file.txt',
      ];

      const categorized = categorizeFiles(files);

      expect(categorized.versionFiles).toEqual(['V3.0.0_250310_0843.tar.gz']);
      expect(categorized.otherFiles).toEqual(['valid-file.txt']); // empty string is filtered out
    });

    it('should throw error for non-array input', () => {
      expect(() => categorizeFiles('not-array')).toThrow('Files must be an array');
      expect(() => categorizeFiles(null)).toThrow('Files must be an array');
    });
  });

  describe('determineMainDownloadFile', () => {
    it('should prioritize VERSION_FILE', () => {
      const files = [
        'mr3.0.0_250310_1739_26.enc.tar.gz',
        'V3.0.0_250310_0843.tar.gz',
        'other-file.txt',
      ];

      expect(determineMainDownloadFile(files)).toBe('V3.0.0_250310_0843.tar.gz');
    });

    it('should choose MR_RELEASE if no VERSION_FILE', () => {
      const files = [
        'be3.0.0_250310_0842_83.enc.tar.gz',
        'mr3.0.0_250310_1739_26.enc.tar.gz',
        'other-file.txt',
      ];

      expect(determineMainDownloadFile(files)).toBe('mr3.0.0_250310_1739_26.enc.tar.gz');
    });

    it('should choose first file if no pattern matches', () => {
      const files = [
        'first-file.txt',
        'second-file.txt',
      ];

      expect(determineMainDownloadFile(files)).toBe('first-file.txt');
    });

    it('should return null for empty or invalid input', () => {
      expect(determineMainDownloadFile([])).toBeNull();
      expect(determineMainDownloadFile(null)).toBeNull();
      expect(determineMainDownloadFile([null, undefined, 123])).toBeNull();
    });
  });

  describe('generateExpectedFilenames', () => {
    it('should generate expected filenames', () => {
      const expected = generateExpectedFilenames('3.0.0', '250310', 26);

      expect(expected).toEqual({
        versionFile: 'V3.0.0_250310_*.tar.gz',
        mrFile: 'mr3.0.0_250310_*_26.enc.tar.gz',
        backendFile: 'be3.0.0_250310_*_*.enc.tar.gz',
        frontendFile: 'fe3.0.0_250310_*_*.enc.tar.gz',
      });
    });

    it('should handle different versions and build numbers', () => {
      const expected = generateExpectedFilenames('1.2.0', '250929', 54);

      expect(expected).toEqual({
        versionFile: 'V1.2.0_250929_*.tar.gz',
        mrFile: 'mr1.2.0_250929_*_54.enc.tar.gz',
        backendFile: 'be1.2.0_250929_*_*.enc.tar.gz',
        frontendFile: 'fe1.2.0_250929_*_*.enc.tar.gz',
      });
    });

    it('should throw error for missing parameters', () => {
      expect(() => generateExpectedFilenames()).toThrow('Version, dateStr, and buildNumber are required');
      expect(() => generateExpectedFilenames('3.0.0')).toThrow('Version, dateStr, and buildNumber are required');
      expect(() => generateExpectedFilenames('3.0.0', '250310')).toThrow('Version, dateStr, and buildNumber are required');
    });
  });

  describe('extractBuildInfoFromFilename', () => {
    it('should extract info from VERSION_FILE', () => {
      const info = extractBuildInfoFromFilename('V3.0.0_250310_0843.tar.gz');

      expect(info).toEqual({
        version: '3.0.0',
        date: '250310',
        time: '0843',
        type: 'v',
        encrypted: false,
      });
    });

    it('should extract info from MR_RELEASE file', () => {
      const info = extractBuildInfoFromFilename('mr3.0.0_250310_1739_26.enc.tar.gz');

      expect(info).toEqual({
        version: '3.0.0',
        date: '250310',
        time: '1739',
        buildNumber: '26',
        type: 'mr',
        encrypted: true,
      });
    });

    it('should extract info from BACKEND_FILE', () => {
      const info = extractBuildInfoFromFilename('be3.0.0_250310_0842_83.enc.tar.gz');

      expect(info).toEqual({
        version: '3.0.0',
        date: '250310',
        time: '0842',
        buildNumber: '83',
        type: 'be',
        encrypted: true,
      });
    });

    it('should extract info from FRONTEND_FILE', () => {
      const info = extractBuildInfoFromFilename('fe3.0.0_250310_0843_49.enc.tar.gz');

      expect(info).toEqual({
        version: '3.0.0',
        date: '250310',
        time: '0843',
        buildNumber: '49',
        type: 'fe',
        encrypted: true,
      });
    });

    it('should return null for unrecognized patterns', () => {
      expect(extractBuildInfoFromFilename('unknown-file.txt')).toBeNull();
      expect(extractBuildInfoFromFilename('invalid_format.tar.gz')).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(extractBuildInfoFromFilename('')).toBeNull();
      expect(extractBuildInfoFromFilename(null)).toBeNull();
      expect(extractBuildInfoFromFilename(123)).toBeNull();
    });
  });

  describe('prioritizePathCandidates', () => {
    it('should prioritize paths with matching build date', () => {
      const candidates = [
        '\\\\nas\\product\\mr3.0.0\\250311\\26',
        '\\\\nas\\product\\mr3.0.0\\250310\\26',
        '\\\\nas\\product\\mr3.0.0\\250309\\26',
      ];
      const buildDate = new Date('2025-03-10');

      const prioritized = prioritizePathCandidates(candidates, buildDate);

      expect(prioritized[0]).toBe('\\\\nas\\product\\mr3.0.0\\250310\\26');
    });

    it('should handle empty or invalid input', () => {
      expect(prioritizePathCandidates([], new Date())).toEqual([]);
      expect(prioritizePathCandidates(null, new Date())).toEqual([]);
    });

    it('should maintain original order when no build date provided', () => {
      const candidates = [
        '\\\\nas\\product\\mr3.0.0\\250311\\26',
        '\\\\nas\\product\\mr3.0.0\\250310\\26',
      ];

      const result = prioritizePathCandidates(candidates);
      expect(result).toEqual(candidates);
    });

    it('should handle paths without extractable dates', () => {
      const candidates = [
        'invalid-path-format',
        'another-invalid-path',
      ];
      const buildDate = new Date('2025-03-10');

      const result = prioritizePathCandidates(candidates, buildDate);
      expect(result).toEqual(candidates);
    });
  });

  describe('FILE_PATTERNS', () => {
    it('should export all required pattern constants', () => {
      expect(FILE_PATTERNS).toHaveProperty('VERSION_FILE');
      expect(FILE_PATTERNS).toHaveProperty('MR_RELEASE');
      expect(FILE_PATTERNS).toHaveProperty('BACKEND_FILE');
      expect(FILE_PATTERNS).toHaveProperty('FRONTEND_FILE');
      expect(FILE_PATTERNS).toHaveProperty('TAR_FILE');
      expect(FILE_PATTERNS).toHaveProperty('ENCRYPTED_TAR');
    });

    it('should have RegExp patterns', () => {
      Object.values(FILE_PATTERNS).forEach(pattern => {
        expect(pattern).toBeInstanceOf(RegExp);
      });
    });
  });

  describe('integration tests', () => {
    it('should work together for complete path detection workflow', () => {
      const version = '3.0.0';
      const buildDate = new Date('2025-03-10T00:00:00Z');
      const buildNumber = 26;

      // 1. Generate date candidates
      const dateCandidates = generatePathCandidates(buildDate);
      expect(dateCandidates).toContain('250310');

      // 2. Construct NAS paths
      const pathCandidates = dateCandidates.map(dateStr =>
        constructNASPath(version, dateStr, buildNumber),
      );
      expect(pathCandidates).toContain(
        '\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26',
      );

      // 3. Prioritize paths
      const prioritized = prioritizePathCandidates(pathCandidates, buildDate);
      expect(prioritized[0]).toContain('250310');

      // 4. Generate expected filenames
      const expectedFiles = generateExpectedFilenames(version, '250310', buildNumber);
      expect(expectedFiles.versionFile).toBe('V3.0.0_250310_*.tar.gz');

      // 5. Test file categorization with real files
      const files = [
        'V3.0.0_250310_0843.tar.gz',
        'mr3.0.0_250310_1739_26.enc.tar.gz',
        'be3.0.0_250310_0842_83.enc.tar.gz',
        'fe3.0.0_250310_0843_49.enc.tar.gz',
      ];

      const categorized = categorizeFiles(files);
      expect(categorized.versionFiles).toHaveLength(1);
      expect(categorized.mrFiles).toHaveLength(1);

      // 6. Determine main download file
      const mainFile = determineMainDownloadFile(files);
      expect(mainFile).toBe('V3.0.0_250310_0843.tar.gz');

      // 7. Extract build info from filename
      const buildInfo = extractBuildInfoFromFilename(mainFile);
      expect(buildInfo.version).toBe('3.0.0');
      expect(buildInfo.date).toBe('250310');
    });
  });
});
