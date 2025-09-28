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
      // projects 폴더의 작업들만 조회
      const url = '/job/projects/api/json?tree=jobs[name,url,buildable,lastBuild[number,url,result,timestamp,duration,displayName]]';
      logger.debug(`Fetching Jenkins jobs from URL: ${url}`);

      const response = await this.client.get(url);
      const jobs = response.data.jobs || [];

      logger.info(`Found ${jobs.length} jobs in projects folder:`, jobs.map(job => job.name));
      return jobs;
    } catch (error) {
      logger.error('Failed to fetch Jenkins jobs from projects folder:', error.message);
      logger.error(`Error status: ${error.response?.status}, URL: /job/projects/api/json`);
      throw new Error('Jenkins projects 폴더의 작업 목록을 가져올 수 없습니다.');
    }
  }

  async getJobBuilds(jobName, limit = 20) {
    try {
      // projects 폴더 하위의 작업 빌드 조회
      const url = `/job/projects/job/${encodeURIComponent(jobName)}/api/json?tree=builds[number,url,result,timestamp,duration,displayName,actions[parameters[name,value]],changeSet[items[commitId,msg,author[fullName]]]]&depth=2`;
      logger.debug(`Fetching builds for job ${jobName} from URL: ${url}`);

      const response = await this.client.get(url);

      if (!response.data || !response.data.builds) {
        logger.warn(`No builds found for job ${jobName}`);
        return [];
      }

      const builds = response.data.builds.slice(0, limit);
      logger.info(`Found ${builds.length} builds for job ${jobName}`);

      return builds.map(build => ({
        id: build.number,
        projectName: jobName,
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
      logger.error(`Error status: ${error.response?.status}, URL: /job/projects/job/${encodeURIComponent(jobName)}/api/json`);

      // 404나 특정 에러의 경우 빈 배열 반환하여 다른 작업 조회에 영향주지 않음
      if (error.response?.status === 404) {
        logger.warn(`Job ${jobName} not found in projects folder, returning empty builds`);
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
          const builds = await this.getJobBuilds(job.name, 10);

          if (builds.length === 0) {
            // 빌드가 없는 경우 프로젝트 기본 정보 생성
            const projectEntry = {
              id: `${job.name}-no-builds`,
              projectName: job.name,
              buildNumber: null,
              status: 'no_builds',
              timestamp: new Date(),
              duration: null,
              displayName: `${job.name} (빌드 없음)`,
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
          logger.warn(`Failed to fetch builds for job ${job.name}:`, error.message);

          // 에러가 발생한 경우에도 프로젝트 정보 표시
          const errorEntry = {
            id: `${job.name}-error`,
            projectName: job.name,
            buildNumber: null,
            status: 'error',
            timestamp: new Date(),
            duration: null,
            displayName: `${job.name} (오류)`,
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