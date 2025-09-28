const express = require('express');
const router = express.Router();
const { getJenkinsService } = require('../services/jenkinsService');
const logger = require('../config/logger');

// GET /api/projects - 프로젝트 목록 조회
router.get('/', async (req, res) => {
  try {
    logger.info('프로젝트 목록 조회 요청');
    
    // Jenkins에서 프로젝트 작업 목록 가져오기
    const jenkinsService = getJenkinsService();
    const jobs = await jenkinsService.getJobs();
    
    // 프로젝트별로 그룹화하여 정리
    const projectMap = new Map();
    
    jobs.forEach(job => {
      const projectName = job.projectFolder || job.name;
      
      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          name: projectName,
          jobs: [],
          totalJobs: 0,
          lastBuild: null,
          status: 'unknown'
        });
      }
      
      const project = projectMap.get(projectName);
      project.jobs.push({
        name: job.name,
        fullName: job.fullJobName || job.name,
        buildable: job.buildable,
        url: job.url,
        lastBuild: job.lastBuild
      });
      
      project.totalJobs++;
      
      // 프로젝트의 최신 빌드 정보 업데이트
      if (job.lastBuild && job.lastBuild.timestamp) {
        if (!project.lastBuild || 
            new Date(job.lastBuild.timestamp) > new Date(project.lastBuild.timestamp)) {
          project.lastBuild = job.lastBuild;
          project.status = job.lastBuild.result || 'unknown';
        }
      }
    });
    
    // Map을 배열로 변환
    const projects = Array.from(projectMap.values()).map(project => ({
      ...project,
      lastBuildDate: project.lastBuild ? new Date(project.lastBuild.timestamp).toISOString() : null
    }));
    
    // 최신 빌드 시간 기준으로 정렬 (최신 순)
    projects.sort((a, b) => {
      if (!a.lastBuildDate && !b.lastBuildDate) return 0;
      if (!a.lastBuildDate) return 1;
      if (!b.lastBuildDate) return -1;
      return new Date(b.lastBuildDate) - new Date(a.lastBuildDate);
    });
    
    logger.info(`프로젝트 목록 조회 성공: ${projects.length}개 프로젝트`);
    
    res.json({
      success: true,
      data: projects,
      message: '프로젝트 목록을 성공적으로 조회했습니다.'
    });
    
  } catch (error) {
    logger.error('프로젝트 목록 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '프로젝트 목록 조회에 실패했습니다.',
      error: error.message
    });
  }
});

// GET /api/projects/:projectName - 특정 프로젝트 상세 정보
router.get('/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    logger.info(`프로젝트 상세 정보 조회: ${projectName}`);
    
    // Jenkins에서 모든 작업 가져오기
    const jenkinsService = getJenkinsService();
    const jobs = await jenkinsService.getJobs();
    
    // 특정 프로젝트의 작업들만 필터링
    const projectJobs = jobs.filter(job => 
      job.projectFolder === projectName || job.name === projectName
    );
    
    if (projectJobs.length === 0) {
      return res.status(404).json({
        success: false,
        message: '프로젝트를 찾을 수 없습니다.'
      });
    }
    
    // 프로젝트 정보 구성
    const project = {
      name: projectName,
      totalJobs: projectJobs.length,
      jobs: projectJobs.map(job => ({
        name: job.name,
        fullName: job.fullJobName || job.name,
        buildable: job.buildable,
        url: job.url,
        lastBuild: job.lastBuild
      })),
      lastBuild: null,
      status: 'unknown'
    };
    
    // 최신 빌드 정보 찾기
    projectJobs.forEach(job => {
      if (job.lastBuild && job.lastBuild.timestamp) {
        if (!project.lastBuild || 
            new Date(job.lastBuild.timestamp) > new Date(project.lastBuild.timestamp)) {
          project.lastBuild = job.lastBuild;
          project.status = job.lastBuild.result || 'unknown';
        }
      }
    });
    
    project.lastBuildDate = project.lastBuild ? 
      new Date(project.lastBuild.timestamp).toISOString() : null;
    
    logger.info(`프로젝트 상세 정보 조회 성공: ${projectName}`);
    
    res.json({
      success: true,
      data: project,
      message: '프로젝트 상세 정보를 성공적으로 조회했습니다.'
    });
    
  } catch (error) {
    logger.error('프로젝트 상세 정보 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '프로젝트 상세 정보 조회에 실패했습니다.',
      error: error.message
    });
  }
});

// GET /api/projects/:projectName/jobs - 프로젝트의 작업 목록
router.get('/:projectName/jobs', async (req, res) => {
  try {
    const { projectName } = req.params;
    logger.info(`프로젝트 작업 목록 조회: ${projectName}`);
    
    // Jenkins에서 모든 작업 가져오기
    const jenkinsService = getJenkinsService();
    const jobs = await jenkinsService.getJobs();
    
    // 특정 프로젝트의 작업들만 필터링
    const projectJobs = jobs.filter(job => 
      job.projectFolder === projectName || job.name === projectName
    );
    
    if (projectJobs.length === 0) {
      return res.status(404).json({
        success: false,
        message: '프로젝트의 작업을 찾을 수 없습니다.'
      });
    }
    
    // 작업 목록 정리
    const jobList = projectJobs.map(job => ({
      name: job.name,
      fullName: job.fullJobName || job.name,
      buildable: job.buildable,
      url: job.url,
      lastBuild: job.lastBuild ? {
        number: job.lastBuild.number,
        result: job.lastBuild.result,
        timestamp: job.lastBuild.timestamp,
        duration: job.lastBuild.duration,
        displayName: job.lastBuild.displayName,
        url: job.lastBuild.url
      } : null
    }));
    
    // 최신 빌드 시간 기준으로 정렬
    jobList.sort((a, b) => {
      if (!a.lastBuild && !b.lastBuild) return 0;
      if (!a.lastBuild) return 1;
      if (!b.lastBuild) return -1;
      return new Date(b.lastBuild.timestamp) - new Date(a.lastBuild.timestamp);
    });
    
    logger.info(`프로젝트 작업 목록 조회 성공: ${projectName}, ${jobList.length}개 작업`);
    
    res.json({
      success: true,
      data: jobList,
      message: '프로젝트 작업 목록을 성공적으로 조회했습니다.'
    });
    
  } catch (error) {
    logger.error('프로젝트 작업 목록 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '프로젝트 작업 목록 조회에 실패했습니다.',
      error: error.message
    });
  }
});

module.exports = router;