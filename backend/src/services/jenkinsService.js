const axios = require('axios');
const logger = require('../config/logger');

class JenkinsService {
  constructor() {
    this.baseURL = process.env.JENKINS_URL || 'https://jenkins.roboetech.com';
    this.username = process.env.JENKINS_USERNAME || 'admin';
    this.password = process.env.JENKINS_PASSWORD || 'jenkins';
    this.auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.client.interceptors.response.use(
      response => response,
      error => {
        logger.error('Jenkins API Error:', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message
        });
        throw error;
      }
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
          const folderUrl = `/job/projects/job/${encodeURIComponent(folder.name)}/api/json?tree=jobs[name,url,buildable,lastBuild[number,url,result,timestamp,duration,displayName]]`;
          const folderResponse = await this.client.get(folderUrl);
          const folderJobs = folderResponse.data.jobs || [];
          
          // mr 또는 fs로 시작하고 버전 형식과 _release 접미사를 가진 작업들만 필터링 (예: mr1.0.0_release, fs1.1.0_release)
          const filteredJobs = folderJobs.filter(job => {
            const jobName = job.name.toLowerCase();
            // mr 또는 fs로 시작하고 숫자.숫자.숫자_release 형식의 job만 허용
            const releasePattern = /^(mr|fs)\d+\.\d+\.\d+_release$/;
            return releasePattern.test(jobName);
          });
          
          // 프로젝트 폴더 이름을 각 작업에 추가
          filteredJobs.forEach(job => {
            job.projectFolder = folder.name;
            job.fullJobName = `${folder.name}/${job.name}`;
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

  async getJobBuilds(jobName, limit = 20) {
    try {
      // jobName이 "projectFolder/jobName" 형태인지 확인
      let projectFolder, actualJobName;
      if (jobName.includes('/')) {
        [projectFolder, actualJobName] = jobName.split('/');
      } else {
        // 기존 jobName이 단순한 경우, 모든 프로젝트 폴더에서 검색
        const jobs = await this.getJobs();
        const matchingJob = jobs.find(job => job.name === jobName);
        if (matchingJob) {
          projectFolder = matchingJob.projectFolder;
          actualJobName = matchingJob.name;
        } else {
          logger.warn(`Job ${jobName} not found in any project folder`);
          return [];
        }
      }

      // projects 폴더 하위의 작업 빌드 조회
      const url = `/job/projects/job/${encodeURIComponent(projectFolder)}/job/${encodeURIComponent(actualJobName)}/api/json?tree=builds[number,url,result,timestamp,duration,displayName,actions[parameters[name,value]],changeSet[items[commitId,msg,author[fullName]]]]&depth=2`;
      logger.debug(`Fetching builds for job ${projectFolder}/${actualJobName} from URL: ${url}`);

      const response = await this.client.get(url);

      if (!response.data || !response.data.builds) {
        logger.warn(`No builds found for job ${projectFolder}/${actualJobName}`);
        return [];
      }

      const builds = response.data.builds.slice(0, limit);
      logger.info(`Found ${builds.length} builds for job ${projectFolder}/${actualJobName}`);

      return builds.map(build => ({
        id: build.number,
        projectName: `${projectFolder}/${actualJobName}`,
        buildNumber: build.number,
        status: this.mapJenkinsStatus(build.result),
        timestamp: new Date(build.timestamp),
        duration: build.duration ? Math.round(build.duration / 1000) : null,
        displayName: build.displayName,
        url: build.url,
        parameters: this.extractParameters(build.actions),
        changes: this.extractChanges(build.changeSet)
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
        queueId: build.queueId
      };
    } catch (error) {
      logger.error(`Failed to fetch build details for ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`Jenkins 빌드 ${jobName}#${buildNumber} 상세 정보를 가져올 수 없습니다.`);
    }
  }

  async getBuildLog(jobName, buildNumber) {
    try {
      // projects 폴더 하위의 작업 빌드 로그 조회
      const response = await this.client.get(`/job/projects/job/${encodeURIComponent(jobName)}/${buildNumber}/consoleText`);

      const logs = response.data.split('\n').map((line, index) => ({
        timestamp: new Date().toISOString(),
        level: this.detectLogLevel(line),
        message: line,
        lineNumber: index + 1
      }));

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
      // projects 폴더 하위의 작업 빌드 로그 조회
      const response = await this.client.get(`/job/projects/job/${encodeURIComponent(jobName)}/${buildNumber}/consoleText`);
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
        /([a-zA-Z0-9_\-\.]+_release_[0-9\.]+\.(tar\.gz|zip|7z))/gi
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
                extractedAt: new Date().toISOString()
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
            extractedAt: new Date().toISOString()
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
        `release_${version}.tar.gz`
      ];

      for (const filename of patterns) {
        artifacts.push({
          filename: filename,
          buildNumber: buildNumber,
          jobName: jobName,
          type: 'expected'
        });
      }
    }

    return artifacts;
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
        message: '빌드가 시작되었습니다.'
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
        message: '빌드가 중지되었습니다.'
      };
    } catch (error) {
      logger.error(`Failed to stop build ${jobName}#${buildNumber}:`, error.message);
      throw new Error(`Jenkins 빌드 ${jobName}#${buildNumber}를 중지할 수 없습니다.`);
    }
  }

  async getQueueInfo(queueId) {
    try {
      const response = await this.client.get(`/queue/api/json?tree=items[id,task[name],stuck,blocked,buildable,params,why,inQueueSince]`);
      const queueItem = response.data.items.find(item => item.id === parseInt(queueId));

      if (queueItem) {
        return {
          id: queueItem.id,
          jobName: queueItem.task.name,
          stuck: queueItem.stuck,
          blocked: queueItem.blocked,
          buildable: queueItem.buildable,
          reason: queueItem.why,
          inQueueSince: new Date(queueItem.inQueueSince)
        };
      }

      return null;
    } catch (error) {
      logger.error(`Failed to fetch queue info for ${queueId}:`, error.message);
      return null;
    }
  }

  async getRecentBuilds(hours = 24, limit = 50) {
    try {
      const jobs = await this.getJobs();
      const allBuilds = [];

      const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));

      for (const job of jobs) {
        try {
          const builds = await this.getJobBuilds(job.fullJobName, 10);

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
              changes: []
            };
            allBuilds.push(projectEntry);
          } else {
            const recentBuilds = builds.filter(build => build.timestamp >= cutoffTime);
            allBuilds.push(...recentBuilds);
          }
        } catch (error) {
          logger.warn(`Failed to fetch builds for job ${job.fullJobName}:`, error.message);

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
            changes: []
          };
          allBuilds.push(errorEntry);
        }
      }

      allBuilds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return allBuilds.slice(0, limit);
    } catch (error) {
      logger.error('Failed to fetch recent builds:', error.message);
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
      author: item.author ? item.author.fullName : 'Unknown'
    }));
  }

  detectLogLevel(line) {
    const upperLine = line.toUpperCase();
    if (upperLine.includes('ERROR') || upperLine.includes('FAILED')) return 'ERROR';
    if (upperLine.includes('WARN')) return 'WARN';
    if (upperLine.includes('SUCCESS') || upperLine.includes('FINISHED')) return 'SUCCESS';
    return 'INFO';
  }

  // Alias for backward compatibility
  async getRecentDeployments(hours = 24, limit = 50) {
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
        nodeDescription: response.data.nodeDescription || 'unknown'
      };
    } catch (error) {
      logger.error('Jenkins health check failed:', error.message);
      return {
        status: 'unhealthy',
        error: error.message
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
  getJenkinsService
};