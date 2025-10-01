# Tasks: NAS 경로 자동 탐지 및 DB 저장 시스템

## Relevant Files

- `database/migrations/004_create_deployment_paths.sql` - New migration to create deployment_paths table for caching verified NAS paths
- `backend/src/services/jenkinsService.js` - Main service that needs enhancement with new fallback logic (already partially exists)
- `backend/src/services/nasService.js` - NAS service for directory scanning and file verification (already exists)
- `backend/src/services/deploymentPathService.js` - New service for managing deployment path DB operations and caching
- `backend/src/routes/deployments.js` - Deployment routes that will utilize the new path detection logic (already exists)
- `backend/src/utils/pathDetection.js` - New utility module for path detection algorithms and date formatting
- `backend/src/utils/retryMechanism.js` - New utility for implementing retry logic with exponential backoff
- `backend/src/config/database.js` - Database configuration (already exists, may need updates)
- `backend/src/services/deploymentPathService.test.js` - Unit tests for deploymentPathService
- `backend/src/utils/pathDetection.test.js` - Unit tests for pathDetection utilities
- `backend/src/utils/retryMechanism.test.js` - Unit tests for retry mechanism

### Notes

- Unit tests should be placed alongside the code files they are testing
- Use `npx jest [optional/path/to/test/file]` to run tests
- Database migration should be run before testing the new functionality
- The existing jenkinsService.extractDeploymentInfo method will be refactored rather than replaced

## Tasks

- [x] 1.0 Database Schema Setup and Migration
  - [x] 1.1 Create deployment_paths table migration file with proper schema
  - [x] 1.2 Add indexes for optimal query performance (project_name, version, build_number)
  - [x] 1.3 Run migration and verify table creation
  - [x] 1.4 Add migration rollback capability

- [x] 2.0 Create Deployment Path Service
  - [x] 2.1 Create deploymentPathService.js with basic CRUD operations
  - [x] 2.2 Implement findByProjectVersionBuild method for cache lookup
  - [x] 2.3 Implement saveDeploymentPath method for storing verified paths
  - [x] 2.4 Add error handling and database connection management
  - [x] 2.5 Write comprehensive unit tests for the service

- [x] 3.0 Implement Path Detection Utilities
  - [x] 3.1 Create pathDetection.js utility module
  - [x] 3.2 Implement formatDateForNAS function (timestamp to YYMMDD)
  - [x] 3.3 Implement generatePathCandidates function (build date ±1 day range)
  - [x] 3.4 Implement constructNASPath function for path building
  - [x] 3.5 Add file pattern detection utilities (V*.tar.gz, mr*.enc.tar.gz, etc.)
  - [x] 3.6 Write unit tests for all utility functions

- [ ] 4.0 Implement Retry Mechanism
  - [ ] 4.1 Create retryMechanism.js with exponential backoff logic
  - [ ] 4.2 Implement retry wrapper for NAS operations
  - [ ] 4.3 Implement retry wrapper for Jenkins API calls
  - [ ] 4.4 Add configurable retry limits and timeout settings
  - [ ] 4.5 Write unit tests for retry scenarios

- [ ] 5.0 Enhance Jenkins Service with New Fallback Chain
  - [ ] 5.1 Refactor extractDeploymentInfo to use new fallback chain
  - [ ] 5.2 Integrate DB lookup as first step in fallback chain
  - [ ] 5.3 Add Jenkins build timestamp extraction via API
  - [ ] 5.4 Integrate path detection utilities for build-date-based paths
  - [ ] 5.5 Add NAS directory scanning integration
  - [ ] 5.6 Implement path verification and DB storage on success
  - [ ] 5.7 Remove hardcoded date mappings and replace with dynamic logic
  - [ ] 5.8 Update error handling to use retry mechanisms

- [ ] 6.0 Integration and Performance Testing
  - [ ] 6.1 Create integration test for complete fallback chain
  - [ ] 6.2 Test performance with 30-second timeout requirement
  - [ ] 6.3 Test DB caching effectiveness and hit rates
  - [ ] 6.4 Test concurrent request handling and race conditions
  - [ ] 6.5 Verify all existing functionality still works
  - [ ] 6.6 Load test with multiple simultaneous deployment queries

- [ ] 7.0 Error Handling and Monitoring
  - [ ] 7.1 Enhance logging for path detection steps with appropriate levels
  - [ ] 7.2 Add metrics collection for fallback chain performance
  - [ ] 7.3 Implement health check for deployment path detection
  - [ ] 7.4 Add alerting for repeated path detection failures
  - [ ] 7.5 Document troubleshooting guide for common issues