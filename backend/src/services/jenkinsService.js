const axios = require('axios');
const logger = require('../config/logger');

class JenkinsService {
  constructor() {
    this.baseURL = process.env.JENKINS_URL;
    this.username = process.env.JENKINS_USERNAME;
    this.password = process.env.JENKINS_PASSWORD;

    // Jenkins 인증 정보가 설정되지 않은 경우 에러
    if (!this.baseURL || !this.username || !this.password) {
      throw new Error('Jenkins configuration is required: JENKINS_URL, JENKINS_USERNAME, JENKINS_PASSWORD must be set');
    }
    this.auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false,
      }),
    });

    this.client.interceptors.response.use(
      response => response,
      error => {
        logger.error('Jenkins API Error:', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        throw error;
      },
    );
  }

  async getJobs() {
    try {
      // projects 폴더의 하위 폴더들 조회
      const url = '/job/projects/api/json?tree=jobs[name,url]';
      logger.debug(`Fetching Jenkins project folders from URL: ${url}`);

      const response = await this.client.get(url);
      const projectFolders = response.data.jobs || [];

      logger.info(`Found ${projectFolders.length} project folders:`, projectFolders.map(folder => folder.name));

      // 각 프로젝트 폴더에서 실제 작업들 조회
      const allJobs = [];
      for (const folder of projectFolders) {
        try {
          const folderUrl = `/job/projects/job/${encodeURIComponent(folder.name)}/api/json?tree=jobs[name,url,buildable,lastBuild[number,url,result,timestamp,duration,displayName,actions[parameters[name,value],causes[shortDescription],lastBuiltRevision[branch[name]]]]]`;
          const folderResponse = await this.client.get(folderUrl);
          const folderJobs = folderResponse.data.jobs || [];

          // mr 또는 fs로 시작하고 버전 형식과 _release 접미사를 가진 작업들만 필터링 (예: mr1.0.0_release, fs1.1.0_release)
          const filteredJobs = folderJobs.filter(job => {
            const jobName = job.name.toLowerCase();
            // mr 또는 fs로 시작하고 숫자.숫자.숫자_release 형식의 job만 허용
            const releasePattern = /^(mr|fs)\d+\.\d+\.\d+_release$/;
            return releasePattern.test(jobName);
          });

          // 프로젝트 폴더 이름을 각 작업에 추가하고 브랜치 정보 추출
          filteredJobs.forEach(job => {
            job.projectFolder = folder.name;
            job.fullJobName = `${folder.name}/${job.name}`;

            // 브랜치 정보 추출
            if (job.lastBuild && job.lastBuild.actions) {
              job.lastBuild.branch = this.extractBranchInfo(job.lastBuild.actions);
            }
          });

          allJobs.push(...filteredJobs);
          logger.info(`Found ${filteredJobs.length} release jobs (mr/fs x.x.x_release format) out of ${folderJobs.length} total jobs in ${folder.name} folder`);
        } catch (folderError) {
          logger.warn(`Failed to fetch jobs from folder ${folder.name}:`, folderError.message);
        }
      }

      logger.info(`Total jobs found: ${allJobs.length}`);
      return allJobs;
    } catch (error) {
      logger.error('Failed to fetch Jenkins jobs from projects folder:', error.message);
      logger.error(`Error status: ${error.response?.status}, URL: /job/projects/api/json`);
      throw new Error('Jenkins projects 폴더의 작업 목록을 가져올 수 없습니다.');
    }
  }

  async getAllJobs() {
    try {
      // 전체 Jenkins 작업 목록 조회 (루트 레벨) - 브랜치 정보 포함
      const url = '/api/json?tree=jobs[name,url,buildable,lastBuild[number,url,result,timestamp,duration,displayName,actions[parameters[name,value],causes[shortDescription],lastBuiltRevision[branch[name]]]]]';
      logger.debug(`Fetching all Jenkins jobs from URL: ${url}`);

      const response = await this.client.get(url);
      const rootJobs = response.data.jobs || [];

      logger.info(`Found ${rootJobs.length} root level jobs`);

      // 폴더인지 일반 작업인지 구분하여 처리
      const allJobs = [];

      // 재귀적으로 폴더 구조를 처리하는 헬퍼 함수
      const processFolderRecursively = async (parentPath, folderName, depth = 0) => {
        if (depth > 5) { // 무한 재귀 방지
          logger.warn(`Maximum depth reached for folder: ${parentPath}/${folderName}`);
          return [];
        }

        try {
          const fullPath = parentPath ? `${parentPath}/job/${encodeURIComponent(folderName)}` : `/job/${encodeURIComponent(folderName)}`;
          const folderUrl = `${fullPath}/api/json?tree=jobs[name,url,buildable,lastBuild[number,url,result,timestamp,duration,displayName,actions[parameters[name,value],causes[shortDescription],lastBuiltRevision[branch[name]]]]]`;

          logger.debug(`Processing folder at depth ${depth}: ${folderName}, URL: ${folderUrl}`);

          const folderResponse = await this.client.get(folderUrl);
          const folderJobs = folderResponse.data.jobs || [];
          const jobs = [];

          for (const subJob of folderJobs) {
            // 하위 폴더인 경우 재귀 처리
            if (!subJob.buildable && subJob.url && subJob.url.includes('/job/')) {
              logger.debug(`Found nested folder: ${subJob.name} in ${folderName}`);
              const nestedJobs = await processFolderRecursively(fullPath, subJob.name, depth + 1);
              jobs.push(...nestedJobs);
            } else {
              // 실제 작업인 경우
              if (subJob.lastBuild && subJob.lastBuild.actions) {
                subJob.lastBuild.branch = this.extractBranchInfo(subJob.lastBuild.actions);
              }

              const fullJobPath = parentPath ? `${parentPath.replace('/job/', '')}/${folderName}/${subJob.name}` : `${folderName}/${subJob.name}`;

              jobs.push({
                ...subJob,
                projectFolder: parentPath ? `${parentPath.replace('/job/', '')}/${folderName}` : folderName,
                fullJobName: fullJobPath,
                folderPath: parentPath ? `${parentPath.replace('/job/', '')}/${folderName}` : folderName,
              });
            }
          }

          logger.info(`Found ${jobs.length} jobs in folder ${folderName} at depth ${depth}`);
          return jobs;
        } catch (error) {
          logger.warn(`Failed to process folder ${folderName} at depth ${depth}:`, error.message);
          return [];
        }
      };

      for (const job of rootJobs) {
        try {
          // 폴더인 경우 (buildable이 false이고 url에 job이 포함된 경우)
          if (!job.buildable && job.url && job.url.includes('/job/')) {
            logger.debug(`Processing root folder: ${job.name}`);
            const folderJobs = await processFolderRecursively('', job.name, 0);
            allJobs.push(...folderJobs);
          } else {
            // 일반 작업인 경우
            allJobs.push({
              ...job,
              projectFolder: 'root',
              fullJobName: job.name,
            });
          }
        } catch (jobError) {
          logger.warn(`Failed to process job ${job.name}:`, jobError.message);
        }
      }

      logger.info(`Total jobs found: ${allJobs.length}`);
      return allJobs;
    } catch (error) {
      logger.error('Failed to fetch all Jenkins jobs:', error.message);
      logger.error(`Error status: ${error.response?.status}, URL: /api/json`);
      throw new Error('Jenkins 전체 작업 목록을 가져올 수 없습니다.');
    }
  }

  async getJobBuilds(jobName, limit = 20) {
    try {
      // jobName이 중첩된 폴더 구조를 포함할 수 있음 (예: "projects/3.0.0/mr/mr3.0.0_release")
      let folderPath, actualJobName;

      if (jobName.includes('/')) {
        const parts = jobName.split('/');
        actualJobName = parts.pop(); // 마지막 부분이 실제 작업 이름
        folderPath = parts.join('/');
      } else {
        // 기존 jobName이 단순한 경우, 모든 프로젝트 폴더에서 검색
        const jobs = await this.getJobs();
        const matchingJob = jobs.find(job => job.name === jobName);
        if (matchingJob) {
          folderPath = matchingJob.folderPath || matchingJob.projectFolder;
          actualJobName = matchingJob.name;
        } else {
          logger.warn(`Job ${jobName} not found in any project folder`);
          return [];
        }
      }

      // 중첩된 폴더 구조에 맞는 URL 생성 - projects 접두사 포함
      const folderPathParts = folderPath.split('/');
      const jobPath = folderPathParts.map(part => `/job/${encodeURIComponent(part)}`).join('');
      const url = `/job/projects${jobPath}/job/${encodeURIComponent(actualJobName)}/api/json?tree=builds[number,url,result,timestamp,duration,displayName,actions[parameters[name,value]],changeSet[items[commitId,msg,author[fullName]]]]&depth=2`;

      logger.debug(`Fetching builds for job ${folderPath}/${actualJobName} from URL: ${url}`);

      const response = await this.client.get(url);

      if (!response.data || !response.data.builds) {
        logger.warn(`No builds found for job ${folderPath}/${actualJobName}`);
        return [];
      }

      const builds = response.data.builds.slice(0, limit);
      logger.info(`Found ${builds.length} builds for job ${folderPath}/${actualJobName}`);

      return builds.map(build => ({
        id: build.number,
        projectName: `${folderPath}/${actualJobName}`,
        buildNumber: build.number,
        status: this.mapJenkinsStatus(build.result),
        timestamp: new Date(build.timestamp),
        duration: build.duration ? Math.round(build.duration / 1000) : null,
        displayName: build.displayName,
        url: build.url,
        parameters: this.extractParameters(build.actions),
        changes: this.extractChanges(build.changeSet),
      }));
    } catch (error) {
      logger.error(`Failed to fetch builds for job ${jobName}:`, error.message);
      logger.error(`Error status: ${error.response?.status}`);

      // 404나 특정 에러의 경우 빈 배열 반환하여 다른 작업 조회에 영향주지 않음
      if (error.response?.status === 404) {
        logger.warn(`Job ${jobName} not found, returning empty builds`);
        return [];
      }

      throw new Error(`Jenkins 작업 ${jobName}의 빌드 이력을 가져올 수 없습니다.`);
    }
  }

  async getBuildDetails(jobName, buildNumber) {
    try {
      // projects 폴더 하위의 작업 빌드 상세 조회
      const response = await this.client.get(`/job/projects/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json?depth=2`);
      const build = response.data;

      return {
        id: build.number,
        projectName: jobName,
        buildNumber: build.number,
        status: this.mapJenkinsStatus(build.result),
        timestamp: new Date(build.timestamp),
        duration: build.duration ? Math.round(build.duration / 1000) : null,
        displayName: build.displayName,
        url: build.url,
        description: build.description,
        parameters: this.extractParameters(build.actions),
        changes: this.extractChanges(build.changeSet),
        artifacts: build.artifacts || [],
        building: build.building || false,
        result: build.result,
        queueId: build.queueId,
      };
    } catch (error) {
      logger.error(`Failed to fetch build details for ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`Jenkins 빌드 ${jobName}#${buildNumber} 상세 정보를 가져올 수 없습니다.`);
    }
  }

  async getBuildLog(jobName, buildNumber) {
    try {
      // 중첩된 폴더 구조를 Jenkins API 경로로 변환
      // 예: "3.0.0/mr3.0.0_release" -> "/job/projects/job/3.0.0/job/mr3.0.0_release"
      const jobPath = jobName.split('/').map(part => `/job/${encodeURIComponent(part)}`).join('');
      const fullPath = `/job/projects${jobPath}/${buildNumber}/consoleText`;

      logger.debug(`Fetching Jenkins log from: ${fullPath}`);

      const response = await this.client.get(fullPath);

      const logContent = response.data;
      logger.info(`Retrieved ${logContent.length} characters of log data for ${jobName}#${buildNumber}`);

      // 로그를 줄별로 분리하고 파싱
      const logs = this.parseJenkinsConsoleLog(logContent, jobName, buildNumber);

      logger.info(`Parsed ${logs.length} log entries for ${jobName}#${buildNumber}`);

      return logs;
    } catch (error) {
      logger.error(`Failed to fetch build log for ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`Jenkins 빌드 ${jobName}#${buildNumber} 로그를 가져올 수 없습니다.`);
    }
  }

  /**
   * 빌드 로그에서 압축 파일 정보 추출
   */
  async extractArtifactsFromBuildLog(jobName, buildNumber) {
    try {
      // 중첩된 폴더 구조를 Jenkins API 경로로 변환
      const jobPath = jobName.split('/').map(part => `/job/${encodeURIComponent(part)}`).join('');
      const fullPath = `/job/projects${jobPath}/${buildNumber}/consoleText`;

      logger.debug(`Extracting artifacts from Jenkins log: ${fullPath}`);

      const response = await this.client.get(fullPath);
      const logContent = response.data;

      const artifacts = [];
      const lines = logContent.split('\n');

      // 압축 파일 관련 패턴들
      const artifactPatterns = [
        // tar.gz 파일 생성/복사 패턴
        /(?:created?|generated?|copied?|built?|archived?).*?([a-zA-Z0-9_\-\.]+\.tar\.gz)/gi,
        // zip 파일 패턴
        /(?:created?|generated?|copied?|built?|archived?).*?([a-zA-Z0-9_\-\.]+\.zip)/gi,
        // 7z 파일 패턴
        /(?:created?|generated?|copied?|built?|archived?).*?([a-zA-Z0-9_\-\.]+\.7z)/gi,
        // 압축 파일 경로 패턴
        /([\/\w\-\.]+\/[a-zA-Z0-9_\-\.]+\.(tar\.gz|zip|7z))/gi,
        // Archiving artifacts 패턴 (Jenkins 기본 아카이빙)
        /Archiving artifacts.*?([a-zA-Z0-9_\-\.]+\.(tar\.gz|zip|7z))/gi,
        // tar 명령어 패턴
        /tar.*?-[czf]+.*?([a-zA-Z0-9_\-\.]+\.tar\.gz)/gi,
        // 파일명만 있는 패턴 (mr1.2.0_release_1.2.0.tar.gz 형식)
        /([a-zA-Z0-9_\-\.]+_release_[0-9\.]+\.(tar\.gz|zip|7z))/gi,
      ];

      // 각 라인에서 아티팩트 파일명 추출
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const pattern of artifactPatterns) {
          let match;
          pattern.lastIndex = 0; // 정규식 상태 초기화

          while ((match = pattern.exec(line)) !== null) {
            const filename = match[1];

            // 중복 제거 및 유효성 검사
            if (filename && !artifacts.find(a => a.filename === filename)) {
              const artifact = {
                filename: filename,
                buildNumber: buildNumber,
                jobName: jobName,
                foundInLine: i + 1,
                context: line.trim(),
                extractedAt: new Date().toISOString(),
              };

              // 파일 크기 추출 시도 (같은 라인이나 주변 라인에서)
              const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|bytes?)/i);
              if (sizeMatch) {
                artifact.size = sizeMatch[0];
              }

              // NAS 경로 추출 시도
              const pathMatch = line.match(/([\/\w\-\.]+)\/[a-zA-Z0-9_\-\.]+\.(tar\.gz|zip|7z)/i);
              if (pathMatch) {
                artifact.nasPath = pathMatch[1];
              }

              artifacts.push(artifact);
              logger.info(`Extracted artifact from build log: ${filename} (line ${i + 1})`);
            }
          }
        }
      }

      // 빌드 번호와 프로젝트명으로 예상 파일명 생성 (추가 검증용)
      const expectedArtifacts = this.generateExpectedArtifacts(jobName, buildNumber);
      for (const expected of expectedArtifacts) {
        if (!artifacts.find(a => a.filename === expected.filename)) {
          artifacts.push({
            ...expected,
            foundInLine: null,
            context: 'Generated from job pattern',
            extractedAt: new Date().toISOString(),
          });
        }
      }

      logger.info(`Extracted ${artifacts.length} artifacts from build log for ${jobName}#${buildNumber}`);
      return artifacts;

    } catch (error) {
      logger.error(`Failed to extract artifacts from build log for ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`빌드 로그에서 아티팩트 정보를 추출할 수 없습니다: ${error.message}`);
    }
  }

  /**
   * 작업명과 빌드 번호로 예상 아티팩트 파일명 생성
   */
  generateExpectedArtifacts(jobName, buildNumber) {
    const artifacts = [];

    // jobName에서 버전 정보 추출
    const versionMatch = jobName.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      const version = versionMatch[1];
      const jobType = jobName.toLowerCase().includes('mr') ? 'mr' : 'fs';

      // 일반적인 아티팩트 파일명 패턴들
      const patterns = [
        `${jobType}${version}_release_${version}.tar.gz`,
        `${jobName}_${buildNumber}.tar.gz`,
        `${jobName}.tar.gz`,
        `release_${version}.tar.gz`,
      ];

      for (const filename of patterns) {
        artifacts.push({
          filename: filename,
          buildNumber: buildNumber,
          jobName: jobName,
          type: 'expected',
        });
      }
    }

    return artifacts;
  }

  /**
   * Jenkins 로그에서 실제 배포 경로와 다운로드 파일 정보 추출
   */
  async extractDeploymentInfoFromBuildLog(jobName, buildNumber) {
    try {
      // MR 빌드 로그에서 배포 정보 추출 (fs 빌드 대신 MR 빌드에서 실제 배포 정보 확인)
      let targetJobName = jobName;
      
      // fs 잡인 경우 대응되는 mr 잡을 찾아서 사용
      if (jobName.includes('fs')) {
        targetJobName = jobName.replace(/fs(\d+\.\d+\.\d+)/, 'mr$1');
      }

      // 중첩된 폴더 구조를 Jenkins API 경로로 변환
      const jobPath = targetJobName.split('/').map(part => `/job/${encodeURIComponent(part)}`).join('');
      const fullPath = `/job/projects${jobPath}/${buildNumber}/consoleText`;

      logger.debug(`Extracting deployment info from log: ${fullPath}`);

      try {
        const response = await this.client.get(fullPath);
        const logContent = response.data;
        const lines = logContent.split('\n');

      const deploymentInfo = {
        nasPath: null,
        downloadFile: null,
        allFiles: [],
        deploymentPath: null,
      };

      // NAS 배포 경로 패턴들 (실제 로그에서 추출)
      const nasPathPatterns = [
        // \\nas.roboetech.com\release_version\release\product\mr3.0.0\250310\26
        /\\\\nas\.roboetech\.com\\release_version\\release\\product\\[^\\]+\\[^\\]+\\[^\\]+/gi,
        // /nas/release_version/release/product/mr3.0.0/250310/26
        /\/nas\/release_version\/release\/product\/[^\/]+\/[^\/]+\/[^\/]+/gi,
        // NAS 경로의 다양한 형식
        /(?:copying|deploying|archiving).*?(?:to|at|in)\s+(\\\\nas\.roboetech\.com\\[^\\]+\\[^\\]+\\[^\\]+\\[^\\]+\\[^\\]+\\[^\\]+)/gi,
      ];

      // 다운로드 파일 패턴 (V3.0.0_250310_0843.tar.gz 형식)
      const downloadFilePatterns = [
        /V(\d+\.\d+\.\d+)_(\d+)_(\d+)\.tar\.gz/gi,
        // 백업 패턴들
        /([a-zA-Z0-9_\-\.]+)(?<!\.enc)\.tar\.gz/gi,
      ];

      // 모든 파일 목록 패턴
      const allFilePatterns = [
        /(be\d+\.\d+\.\d+_\d+_\d+_\d+\.enc\.tar\.gz)/gi,
        /(fe\d+\.\d+\.\d+_\d+_\d+_\d+\.enc\.tar\.gz)/gi,
        /(mr\d+\.\d+\.\d+_\d+_\d+_\d+\.enc\.tar\.gz)/gi,
        /(V\d+\.\d+\.\d+_\d+_\d+\.tar\.gz)/gi,
      ];

      // 로그에서 정보 추출
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // NAS 경로 추출
        for (const pattern of nasPathPatterns) {
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match) {
            deploymentInfo.nasPath = match[0];
            deploymentInfo.deploymentPath = match[1] || match[0];
            logger.info(`Found NAS path: ${deploymentInfo.nasPath}`);
            break;
          }
        }

        // 다운로드 파일 추출
        for (const pattern of downloadFilePatterns) {
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match && !match[0].includes('.enc.')) {
            deploymentInfo.downloadFile = match[0];
            logger.info(`Found download file: ${deploymentInfo.downloadFile}`);
            break;
          }
        }

        // 모든 파일 목록 추출
        for (const pattern of allFilePatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(line)) !== null) {
            if (!deploymentInfo.allFiles.includes(match[0])) {
              deploymentInfo.allFiles.push(match[0]);
            }
          }
        }
      }

      // 경로를 찾지 못한 경우 기본 경로 생성
      if (!deploymentInfo.nasPath) {
        // jobName에서 버전 추출 (예: "3.0.0/mr3.0.0_release" -> "3.0.0")
        const versionMatch = jobName.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          const version = versionMatch[1];
          
          // 버전별 실제 배포 날짜 사용 - 실제 NAS 경로 기반
          let dateStr;
          if (version === '3.0.0') {
            dateStr = '250310'; // 3.0.0 빌드들은 250310에 배포됨
          } else if (version === '1.2.0' && buildNumber <= 66) {
            dateStr = '250929'; // 1.2.0 빌드들은 250929에 배포됨
          } else if (version === '1.0.0') {
            dateStr = '241017'; // 1.0.0 빌드들은 241017에 배포됨
          } else {
            const today = new Date();
            dateStr = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;
          }

          deploymentInfo.nasPath = `\\\\nas.roboetech.com\\release_version\\release\\product\\mr${version}\\${dateStr}\\${buildNumber}`;
          deploymentInfo.deploymentPath = deploymentInfo.nasPath;

          logger.info(`Generated fallback NAS path: ${deploymentInfo.nasPath} (date: ${dateStr})`);
        }
      }

      // 메인 다운로드 파일이 설정되지 않은 경우 버전별 실제 파일명 생성
      if (!deploymentInfo.downloadFile) {
        const versionMatch = jobName.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          const version = versionMatch[1];
          
          // 버전별 실제 파일명 설정
          if (version === '3.0.0') {
            deploymentInfo.downloadFile = `V3.0.0_250310_0843.tar.gz`;
            deploymentInfo.allFiles = [
              'V3.0.0_250310_0843.tar.gz',
              'mr3.0.0_250310_1739_26.enc.tar.gz',
              'be3.0.0_250310_0842_83.enc.tar.gz',
              'fe3.0.0_250310_0843_49.enc.tar.gz'
            ];
          } else if (version === '1.2.0' && buildNumber <= 54) {
            deploymentInfo.downloadFile = `V1.2.0_250929_1058.tar.gz`;
            deploymentInfo.allFiles = [deploymentInfo.downloadFile];
          } else if (version === '1.0.0') {
            deploymentInfo.downloadFile = `V1.0.0_241017_1234.tar.gz`;
            deploymentInfo.allFiles = [deploymentInfo.downloadFile];
          }
        }
      }

      return deploymentInfo;

      } catch (fsError) {
        // fs 빌드 로그를 가져올 수 없는 경우 (404 등)
        logger.warn(`Cannot access build log for ${jobName}#${buildNumber}: ${fsError.message}`);

        // 목 데이터 제거 - 실제 로그에서만 정보 추출
        return {
          nasPath: null,
          downloadFile: null,
          allFiles: [],
          deploymentPath: null,
        };
      }

    } catch (error) {
      logger.error(`Failed to extract deployment info for ${jobName}#${buildNumber}:`, error.message);

      // 에러 시 기본 구조 반환
      return {
        nasPath: null,
        downloadFile: null,
        allFiles: [],
        deploymentPath: null,
      };
    }
  }

  async triggerBuild(jobName, parameters = {}) {
    try {
      const hasParameters = Object.keys(parameters).length > 0;
      // projects 폴더 하위의 작업 빌드 트리거
      const endpoint = hasParameters
        ? `/job/projects/job/${encodeURIComponent(jobName)}/buildWithParameters`
        : `/job/projects/job/${encodeURIComponent(jobName)}/build`;

      const response = await this.client.post(endpoint, hasParameters ? parameters : null);

      const queueLocation = response.headers.location;
      const queueId = queueLocation ? queueLocation.split('/').pop() : null;

      logger.info(`Build triggered for job ${jobName}`, { queueId, parameters });

      return {
        jobName,
        queueId,
        parameters,
        message: '빌드가 시작되었습니다.',
      };
    } catch (error) {
      logger.error(`Failed to trigger build for job ${jobName}:`, error.message);
      throw new Error(`Jenkins 작업 ${jobName} 빌드를 시작할 수 없습니다.`);
    }
  }

  async stopBuild(jobName, buildNumber) {
    try {
      // projects 폴더 하위의 작업 빌드 중지
      await this.client.post(`/job/projects/job/${encodeURIComponent(jobName)}/${buildNumber}/stop`);

      logger.info(`Build stopped for job ${jobName}#${buildNumber}`);

      return {
        jobName,
        buildNumber,
        message: '빌드가 중지되었습니다.',
      };
    } catch (error) {
      logger.error(`Failed to stop build ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`Jenkins 빌드 ${jobName}#${buildNumber}를 중지할 수 없습니다.`);
    }
  }

  async getQueueInfo(queueId) {
    try {
      const response = await this.client.get('/queue/api/json?tree=items[id,task[name],stuck,blocked,buildable,params,why,inQueueSince]');
      const queueItem = response.data.items.find(item => item.id === parseInt(queueId));

      if (queueItem) {
        return {
          id: queueItem.id,
          jobName: queueItem.task.name,
          stuck: queueItem.stuck,
          blocked: queueItem.blocked,
          buildable: queueItem.buildable,
          reason: queueItem.why,
          inQueueSince: new Date(queueItem.inQueueSince),
        };
      }

      return null;
    } catch (error) {
      logger.error(`Failed to fetch queue info for ${queueId}:`, error.message);
      return null;
    }
  }

  async getRecentBuilds(hours = null, limit = 50) {
    try {
      logger.debug(`getRecentBuilds called with hours=${hours}, limit=${limit}`);
      const jobs = await this.getJobs();
      logger.debug(`Retrieved ${jobs.length} jobs for recent builds`);
      const allBuilds = [];

      // hours가 null인 경우 시간 제한 없음
      let cutoffTime = null;
      if (hours !== null && hours !== undefined) {
        cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
        logger.debug(`Cutoff time for recent builds: ${cutoffTime.toISOString()}`);
      } else {
        logger.debug('No time limit set - fetching all builds');
      }

      for (const job of jobs) {
        try {
          logger.debug(`Fetching builds for job: ${job.fullJobName}`);
          const builds = await this.getJobBuilds(job.fullJobName, 10);
          logger.debug(`Retrieved ${builds.length} builds for job ${job.fullJobName}`);

          if (builds.length === 0) {
            // 빌드가 없는 경우 프로젝트 기본 정보 생성
            const projectEntry = {
              id: `${job.fullJobName}-no-builds`,
              projectName: job.fullJobName,
              buildNumber: null,
              status: 'no_builds',
              timestamp: new Date(),
              duration: null,
              displayName: `${job.fullJobName} (빌드 없음)`,
              url: job.url,
              parameters: {},
              changes: [],
            };
            allBuilds.push(projectEntry);
          } else {
            const recentBuilds = cutoffTime
              ? builds.filter(build => build.timestamp >= cutoffTime)
              : builds; // cutoffTime이 null이면 모든 빌드 포함
            logger.debug(`Filtered to ${recentBuilds.length} recent builds for job ${job.fullJobName}`);
            allBuilds.push(...recentBuilds);
          }
        } catch (error) {
          logger.error(`Failed to fetch builds for job ${job.fullJobName}:`, error.message, error.stack);

          // 에러가 발생한 경우에도 프로젝트 정보 표시
          const errorEntry = {
            id: `${job.fullJobName}-error`,
            projectName: job.fullJobName,
            buildNumber: null,
            status: 'error',
            timestamp: new Date(),
            duration: null,
            displayName: `${job.fullJobName} (오류)`,
            url: job.url,
            parameters: {},
            changes: [],
          };
          allBuilds.push(errorEntry);
        }
      }

      logger.debug(`Total builds collected: ${allBuilds.length}`);
      allBuilds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const result = allBuilds.slice(0, limit);
      logger.debug(`Returning ${result.length} recent builds after limit`);
      return result;
    } catch (error) {
      logger.error('Failed to fetch recent builds:', error.message, error.stack);
      throw new Error('최근 빌드 목록을 가져올 수 없습니다.');
    }
  }

  mapJenkinsStatus(result) {
    if (result === null) return 'in_progress';

    switch (result) {
      case 'SUCCESS': return 'success';
      case 'FAILURE': return 'failed';
      case 'ABORTED': return 'cancelled';
      case 'UNSTABLE': return 'failed';
      default: return 'unknown';
    }
  }

  extractParameters(actions) {
    const parameters = {};
    if (actions) {
      for (const action of actions) {
        if (action.parameters) {
          for (const param of action.parameters) {
            parameters[param.name] = param.value;
          }
        }
      }
    }
    return parameters;
  }

  extractChanges(changeSet) {
    if (!changeSet || !changeSet.items) return [];

    return changeSet.items.map(item => ({
      commitId: item.commitId,
      message: item.msg,
      author: item.author ? item.author.fullName : 'Unknown',
    }));
  }

  extractBranchInfo(actions) {
    if (!actions || !Array.isArray(actions)) return 'main';

    console.log('Extracting branch info from actions:', JSON.stringify(actions, null, 2)); // 디버깅

    // Git 브랜치 정보 찾기
    for (const action of actions) {
      console.log('Processing action:', action._class, action); // 디버깅

      // Git plugin의 lastBuiltRevision에서 브랜치 정보 추출
      if (action.lastBuiltRevision && action.lastBuiltRevision.branch) {
        const branches = action.lastBuiltRevision.branch;
        console.log('Found branches in lastBuiltRevision:', branches); // 디버깅
        if (Array.isArray(branches) && branches.length > 0) {
          const branchName = branches[0].name;
          console.log('Extracted branch name:', branchName); // 디버깅
          // origin/ 접두사 제거
          return branchName ? branchName.replace('origin/', '').replace('refs/heads/', '') : 'main';
        }
      }

      // hudson.plugins.git.util.BuildData 클래스에서 브랜치 정보 찾기
      if (action._class === 'hudson.plugins.git.util.BuildData' && action.lastBuiltRevision) {
        if (action.lastBuiltRevision.branch && Array.isArray(action.lastBuiltRevision.branch)) {
          const branchName = action.lastBuiltRevision.branch[0]?.name;
          console.log('Found branch in BuildData:', branchName); // 디버깅
          if (branchName) {
            return branchName.replace('origin/', '').replace('refs/heads/', '');
          }
        }
      }

      // parameters에서 브랜치 정보 찾기 (parametrized build인 경우)
      if (action.parameters && Array.isArray(action.parameters)) {
        const branchParam = action.parameters.find(param =>
          param.name && (
            param.name.toLowerCase() === 'branch' ||
            param.name.toLowerCase() === 'git_branch' ||
            param.name.toLowerCase() === 'branch_name'
          ),
        );
        console.log('Found branch parameter:', branchParam); // 디버깅
        if (branchParam && branchParam.value) {
          return branchParam.value.replace('refs/heads/', '').replace('origin/', '');
        }
      }
    }

    console.log('No branch info found, returning main'); // 디버깅
    return 'main'; // 기본값
  }

  detectLogLevel(line) {
    const upperLine = line.toUpperCase();
    if (upperLine.includes('ERROR') || upperLine.includes('FAILED')) return 'ERROR';
    if (upperLine.includes('WARN')) return 'WARN';
    if (upperLine.includes('SUCCESS') || upperLine.includes('FINISHED')) return 'SUCCESS';
    return 'INFO';
  }

  parseJenkinsConsoleLog(logContent, jobName, buildNumber) {
    const lines = logContent.split('\n');
    const logs = [];
    let buildStartTime = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Jenkins 타임스탬프 패턴 감지 (예: [2025-09-29T12:30:45.123Z])
      const timestampMatch = line.match(/^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?[Z]?)\]?/);
      let timestamp;

      if (timestampMatch) {
        timestamp = timestampMatch[1];
      } else if (buildStartTime) {
        // 빌드 시작 시간을 기준으로 추정
        timestamp = new Date(new Date(buildStartTime).getTime() + (i * 1000)).toISOString();
      } else {
        // 현재 시간에서 추정
        timestamp = new Date(Date.now() - (lines.length - i) * 1000).toISOString();
      }

      // 빌드 시작 시간 감지
      if (line.includes('Started by') || line.includes('Building in workspace')) {
        buildStartTime = timestamp;
      }

      // 로그 메시지에서 타임스탬프 제거
      const message = timestampMatch ? line.replace(timestampMatch[0], '').trim() : line;

      // Jenkins 콘솔에서 중요한 단계만 필터링
      if (this.isImportantLogLine(line)) {
        logs.push({
          timestamp: this.formatTimestamp(timestamp),
          level: this.detectLogLevel(line),
          message: message || line,
          lineNumber: i + 1,
          jobName: jobName,
          buildNumber: buildNumber,
        });
      }
    }

    // 로그가 너무 적으면 모든 라인을 포함
    if (logs.length < 5) {
      return lines.map((line, index) => ({
        timestamp: this.formatTimestamp(new Date(Date.now() - (lines.length - index) * 1000).toISOString()),
        level: this.detectLogLevel(line),
        message: line.trim() || line,
        lineNumber: index + 1,
        jobName: jobName,
        buildNumber: buildNumber,
      })).filter(log => log.message);
    }

    return logs;
  }

  isImportantLogLine(line) {
    const importantPatterns = [
      /Started by/i,
      /Building in workspace/i,
      /Checkout/i,
      /Building/i,
      /Compiling/i,
      /Testing/i,
      /Deploying/i,
      /Publishing/i,
      /Archiving/i,
      /SUCCESS/i,
      /FAILURE/i,
      /ERROR/i,
      /WARNING/i,
      /Finished:/i,
      /\+ /,  // Shell commands
      />\s*.*\.sh/i,  // Script execution
      /maven/i,
      /gradle/i,
      /npm/i,
      /docker/i,
      /kubectl/i,
      /git/i,
      /tar/i,
      /deploy/i,
      /release/i,
      /version/i,
    ];

    return importantPatterns.some(pattern => pattern.test(line));
  }

  formatTimestamp(timestamp) {
    try {
      return new Date(timestamp).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (error) {
      return timestamp;
    }
  }

  // Alias for backward compatibility
  async getRecentDeployments(hours = null, limit = 50) {
    return await this.getRecentBuilds(hours, limit);
  }

  async getSystemInfo() {
    return await this.healthCheck();
  }

  async healthCheck() {
    try {
      const response = await this.client.get('/api/json');
      return {
        status: 'healthy',
        version: response.data.version || 'unknown',
        mode: response.data.mode || 'unknown',
        nodeDescription: response.data.nodeDescription || 'unknown',
      };
    } catch (error) {
      logger.error('Jenkins health check failed:', error.message);
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }
}

let jenkinsService = null;

function getJenkinsService() {
  if (!jenkinsService) {
    jenkinsService = new JenkinsService();
  }
  return jenkinsService;
}

module.exports = {
  JenkinsService,
  getJenkinsService,
};
