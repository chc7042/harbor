const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getJenkinsService } = require('../services/jenkinsService');
const logger = require('../config/logger');

const router = express.Router();

// 모든 대시보드 라우트는 인증 필요
router.use(authenticateToken);

// 대시보드 메인 데이터 조회
router.get('/',
  async (req, res, next) => {
    try {
      const jenkinsService = getJenkinsService();
      
      // 실제 Jenkins 데이터 조회
      const [jobs, deployments] = await Promise.all([
        jenkinsService.getJobs(),
        jenkinsService.getRecentDeployments(168) // 지난 7일간 배포 이력
      ]);

      // 프로젝트별로 그룹화
      const projectMap = new Map();
      jobs.forEach(job => {
        const projectName = job.fullJobName || job.name;
        if (!projectMap.has(projectName)) {
          projectMap.set(projectName, {
            name: projectName,
            jobs: [],
            totalBuilds: 0,
            successBuilds: 0,
            failedBuilds: 0
          });
        }
        const project = projectMap.get(projectName);
        project.jobs.push(job);
        
        if (job.lastBuild) {
          project.totalBuilds++;
          if (job.lastBuild.result === 'SUCCESS') {
            project.successBuilds++;
          } else if (job.lastBuild.result === 'FAILURE') {
            project.failedBuilds++;
          }
        }
      });

      // 요약 통계 계산
      const totalDeployments = deployments.length;
      const successfulDeployments = deployments.filter(d => d.status === 'success').length;
      const failedDeployments = deployments.filter(d => d.status === 'failed').length;
      const successRate = totalDeployments > 0 ? (successfulDeployments / totalDeployments * 100) : 0;
      
      const validDurations = deployments.filter(d => d.duration && d.duration > 0);
      const averageDuration = validDurations.length > 0 ? 
        Math.round(validDurations.reduce((sum, d) => sum + d.duration, 0) / validDurations.length) : 0;

      // 최근 배포 목록 (최신 5개)
      const recentDeployments = deployments
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5)
        .map(deployment => ({
          id: deployment.id,
          projectName: deployment.projectName,
          environment: 'production', // Default environment
          version: deployment.buildNumber ? `#${deployment.buildNumber}` : 'Unknown',
          status: deployment.status?.toLowerCase() || 'unknown',
          deployedBy: 'Jenkins',
          deployedAt: deployment.timestamp,
          duration: deployment.duration || null
        }));

      // 프로젝트별 통계 (상위 5개)
      const projectStats = Array.from(projectMap.values())
        .map(project => ({
          name: project.name,
          deployments: project.totalBuilds,
          successRate: project.totalBuilds > 0 ? 
            Math.round((project.successBuilds / project.totalBuilds) * 100 * 10) / 10 : 0
        }))
        .sort((a, b) => b.deployments - a.deployments)
        .slice(0, 5);

      // 환경별 통계 계산
      const envStats = deployments.reduce((acc, deployment) => {
        const env = 'production'; // Default environment for all deployments
        if (!acc[env]) {
          acc[env] = { total: 0, success: 0 };
        }
        acc[env].total++;
        if (deployment.status === 'success') {
          acc[env].success++;
        }
        return acc;
      }, {});

      const environmentStats = Object.entries(envStats).map(([env, stats]) => ({
        environment: env,
        deployments: stats.total,
        successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100 * 10) / 10 : 0
      }));

      // 배포 트렌드 데이터 생성 (지난 7일)
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayDeployments = deployments.filter(d => {
          const deployDate = new Date(d.timestamp).toISOString().split('T')[0];
          return deployDate === dateStr;
        });
        
        daily.push({
          date: dateStr,
          deployments: dayDeployments.length,
          success: dayDeployments.filter(d => d.status === 'success').length,
          failed: dayDeployments.filter(d => d.status === 'failed').length
        });
      }

      const dashboardData = {
        summary: {
          totalDeployments,
          successfulDeployments,
          failedDeployments,
          successRate: Math.round(successRate * 10) / 10,
          averageDuration
        },
        recentDeployments,
        deploymentTrends: {
          daily,
          hourly: [] // 시간별 데이터는 복잡하므로 일단 비워둠
        },
        projectStats,
        environmentStats
      };

      logger.info(`대시보드 데이터 조회 - 사용자: ${req.user.username}, 프로젝트: ${projectStats.length}개, 총 배포: ${totalDeployments}개`);

      res.json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      logger.error('대시보드 데이터 조회 실패:', error.message);
      next(error);
    }
  }
);

// 실시간 배포 상태 조회
router.get('/status',
  async (req, res, next) => {
    try {
      const jenkinsService = getJenkinsService();
      
      // 실제 Jenkins 작업 상태 조회
      const jobs = await jenkinsService.getJobs();
      
      // 현재 진행 중인 빌드 찾기
      const activeDeployments = [];
      const queuedDeployments = [];
      
      for (const job of jobs) {
        if (job.lastBuild && job.lastBuild.building) {
          activeDeployments.push({
            id: job.lastBuild.number,
            projectName: job.fullJobName || job.name,
            environment: 'production', // 기본값
            version: `#${job.lastBuild.number}`,
            status: 'in_progress',
            deployedBy: 'Jenkins',
            startedAt: new Date(job.lastBuild.timestamp).toISOString(),
            progress: job.lastBuild.estimatedDuration ? 
              Math.min(Math.round(((Date.now() - job.lastBuild.timestamp) / job.lastBuild.estimatedDuration) * 100), 95) : 50,
            currentStep: job.lastBuild.building ? '빌드 진행 중' : '대기 중'
          });
        }
        
        // 대기열에 있는 작업 확인 (인큐된 빌드)
        if (job.inQueue) {
          queuedDeployments.push({
            id: `queue-${job.name}`,
            projectName: job.fullJobName || job.name,
            environment: 'production',
            version: `#${(job.nextBuildNumber || job.lastBuild?.number + 1)}`,
            queuedBy: 'Jenkins',
            queuedAt: new Date().toISOString(),
            estimatedStartTime: new Date(Date.now() + (job.queueTime || 60000)).toISOString()
          });
        }
      }

      // 시스템 상태 확인
      let jenkinsStatus = 'healthy';
      let nasStatus = 'healthy';
      let databaseStatus = 'healthy';
      
      try {
        // Jenkins 연결 상태 확인
        await jenkinsService.getSystemInfo();
      } catch (error) {
        jenkinsStatus = 'unhealthy';
        logger.warn('Jenkins 상태 확인 실패:', error.message);
      }
      
      // NAS 상태는 별도 확인 (간단히 healthy로 설정)
      // TODO: 실제 NAS 연결 상태 확인 구현
      
      const currentStatus = {
        activeDeployments,
        queuedDeployments,
        systemHealth: {
          jenkinsStatus,
          nasStatus,
          databaseStatus,
          lastHealthCheck: new Date().toISOString()
        }
      };

      logger.info(`실시간 배포 상태 조회 - 사용자: ${req.user.username}, 활성 배포: ${activeDeployments.length}개, 대기 중: ${queuedDeployments.length}개`);

      res.json({
        success: true,
        data: currentStatus
      });
    } catch (error) {
      logger.error('실시간 배포 상태 조회 실패:', error.message);
      
      // 에러 발생 시 기본 상태 반환
      res.json({
        success: true,
        data: {
          activeDeployments: [],
          queuedDeployments: [],
          systemHealth: {
            jenkinsStatus: 'unhealthy',
            nasStatus: 'unknown',
            databaseStatus: 'healthy',
            lastHealthCheck: new Date().toISOString()
          }
        }
      });
    }
  }
);

// 사용자별 배포 통계
router.get('/user-stats',
  async (req, res, next) => {
    try {
      const jenkinsService = getJenkinsService();
      
      // 실제 Jenkins 데이터 조회
      const [jobs, deployments] = await Promise.all([
        jenkinsService.getJobs(),
        jenkinsService.getRecentDeployments(720) // 지난 30일간 배포 이력
      ]);

      // 사용자별 배포 데이터 필터링 (모든 배포를 포함 - Jenkins는 기본적으로 모든 배포를 관리)
      const userDeployments = deployments.filter(d => 
        d.status !== 'no_builds' && d.status !== 'error' // 빌드가 없거나 에러인 경우 제외
      );

      // 사용자별 통계 계산
      const totalDeployments = userDeployments.length;
      const successfulDeployments = userDeployments.filter(d => d.status === 'success').length;
      const failedDeployments = userDeployments.filter(d => d.status === 'failed').length;
      const successRate = totalDeployments > 0 ? 
        Math.round((successfulDeployments / totalDeployments) * 100 * 10) / 10 : 0;

      // 마지막 배포 시간
      const lastDeployment = userDeployments.length > 0 ? 
        userDeployments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0].timestamp : 
        null;

      // 사용자가 참여한 프로젝트별 통계
      const projectMap = new Map();
      userDeployments.forEach(deployment => {
        const projectName = deployment.projectName;
        if (!projectMap.has(projectName)) {
          projectMap.set(projectName, {
            name: projectName,
            deployments: 0,
            lastDeployed: null
          });
        }
        const project = projectMap.get(projectName);
        project.deployments++;
        
        if (!project.lastDeployed || new Date(deployment.timestamp) > new Date(project.lastDeployed)) {
          project.lastDeployed = deployment.timestamp;
        }
      });

      const myProjects = Array.from(projectMap.values())
        .sort((a, b) => b.deployments - a.deployments)
        .slice(0, 10); // 상위 10개 프로젝트

      // 최근 활동 (최근 10개)
      const recentActivity = userDeployments
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
        .map(deployment => ({
          type: 'deployment',
          projectName: deployment.projectName,
          action: deployment.status === 'success' ? '배포 완료' : '배포 실패',
          environment: 'production',
          timestamp: deployment.timestamp
        }));

      const userStats = {
        myDeployments: {
          total: totalDeployments,
          successful: successfulDeployments,
          failed: failedDeployments,
          successRate,
          lastDeployment
        },
        myProjects,
        recentActivity
      };

      logger.info(`사용자별 배포 통계 조회 - 사용자: ${req.user.username}, 총 배포: ${totalDeployments}개, 프로젝트: ${myProjects.length}개`);

      res.json({
        success: true,
        data: userStats
      });
    } catch (error) {
      logger.error('사용자별 배포 통계 조회 실패:', error.message);
      next(error);
    }
  }
);

// 알림 목록 조회
router.get('/notifications',
  async (req, res, next) => {
    try {
      const jenkinsService = getJenkinsService();
      
      // 실제 Jenkins 데이터를 기반으로 알림 생성
      const [jobs, deployments] = await Promise.all([
        jenkinsService.getJobs(),
        jenkinsService.getRecentDeployments(24) // 지난 24시간 배포 이력
      ]);

      const notifications = [];
      let notificationId = 1;

      // 최근 배포 상황을 알림으로 변환
      deployments
        .filter(d => d.status !== 'no_builds' && d.status !== 'error') // 빌드가 없거나 에러인 경우 제외
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10) // 최신 10개
        .forEach(deployment => {
          const isSuccess = deployment.status === 'success';
          const timestamp = deployment.timestamp;
          const timeDiff = Date.now() - new Date(timestamp).getTime();
          
          notifications.push({
            id: notificationId++,
            type: isSuccess ? 'deployment_success' : 'deployment_failed',
            title: isSuccess ? '배포 성공' : '배포 실패',
            message: `${deployment.projectName} ${deployment.buildNumber ? `#${deployment.buildNumber}` : ''} ${isSuccess ? '배포가 성공적으로 완료되었습니다' : '배포가 실패했습니다. 로그를 확인해주세요'}.`,
            timestamp,
            read: timeDiff > 3600000 // 1시간 이전 알림은 읽음 처리
          });
        });

      // 현재 빌드 중인 작업에 대한 알림
      jobs.forEach(job => {
        if (job.lastBuild && job.lastBuild.building) {
          notifications.push({
            id: notificationId++,
            type: 'deployment_in_progress',
            title: '배포 진행 중',
            message: `${job.fullJobName || job.name} 빌드 #${job.lastBuild.number}가 현재 진행 중입니다.`,
            timestamp: new Date(job.lastBuild.timestamp).toISOString(),
            read: false
          });
        }
      });

      // 시스템 상태 확인 알림
      try {
        await jenkinsService.getSystemInfo();
      } catch (error) {
        notifications.unshift({
          id: notificationId++,
          type: 'system_warning',
          title: '시스템 경고',
          message: 'Jenkins 서버 연결에 문제가 발생했습니다. 시스템 관리자에게 문의하세요.',
          timestamp: new Date().toISOString(),
          read: false
        });
      }

      // 알림을 시간순으로 정렬 (최신순)
      notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      logger.info(`알림 목록 조회 - 사용자: ${req.user.username}, 알림 수: ${notifications.length}개`);

      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      logger.error('알림 목록 조회 실패:', error.message);
      
      // 에러 발생 시 시스템 경고 알림만 반환
      const errorNotifications = [{
        id: 1,
        type: 'system_error',
        title: '시스템 오류',
        message: '알림 데이터를 불러오는 중 오류가 발생했습니다.',
        timestamp: new Date().toISOString(),
        read: false
      }];

      res.json({
        success: true,
        data: errorNotifications
      });
    }
  }
);

// 알림 읽음 처리
router.put('/notifications/:id/read',
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // TODO: 실제 알림 읽음 처리 로직 구현
      // await notificationService.markAsRead(id, req.user.id);

      logger.info(`알림 읽음 처리 - 사용자: ${req.user.username}, 알림 ID: ${id}`);

      res.json({
        success: true,
        message: '알림이 읽음 처리되었습니다.'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;