const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { AppError } = require('../middleware/error');
const logger = require('../config/logger');
const { getNASService } = require('../services/nasService');

const router = express.Router();

// 인증 미들웨어 제거됨 - 간소화된 LDAP 인증 사용

// NAS Archive API - Scan for deployments
router.post('/scan', [
  body('version').optional().isString().withMessage('버전은 문자열이어야 합니다'),
  body('scanAll').optional().isBoolean().withMessage('scanAll은 불린값이어야 합니다'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('입력 데이터가 올바르지 않습니다', 400, errors.array());
    }

    const { version, scanAll = false } = req.body;
    const nasService = getNASService();

    logger.info(`NAS 아카이브 스캔 시작 - 사용자: ${req.user.username}, 버전: ${version || 'ALL'}`);

    const discoveredDeployments = [];

    if (scanAll) {
      // 모든 버전 스캔
      const versionDirs = await scanVersionDirectories(nasService);
      for (const versionDir of versionDirs) {
        const deployments = await scanVersionDeployments(nasService, versionDir);
        discoveredDeployments.push(...deployments);
      }
    } else if (version) {
      // 특정 버전만 스캔
      const deployments = await scanVersionDeployments(nasService, version);
      discoveredDeployments.push(...deployments);
    } else {
      throw new AppError('version 또는 scanAll 중 하나는 필수입니다', 400);
    }

    logger.info(`NAS 아카이브 스캔 완료 - 발견된 배포: ${discoveredDeployments.length}개`);

    res.json({
      success: true,
      data: discoveredDeployments,
      message: `${discoveredDeployments.length}개의 아카이브 배포를 발견했습니다.`,
    });

  } catch (error) {
    logger.error('NAS 아카이브 스캔 실패:', error);
    next(error);
  }
});

// NAS Archive API - Generate deployment info for specific version/build
router.post('/generate-info/:version/:buildNumber', [
  param('version').isString().withMessage('버전은 문자열이어야 합니다'),
  param('buildNumber').isInt({ min: 1 }).withMessage('빌드 번호는 1 이상의 정수여야 합니다'),
  body('deploymentDate').optional().matches(/^\d{6}$/).withMessage('배포 날짜는 YYMMDD 형식이어야 합니다'),
  body('projectName').optional().isString().withMessage('프로젝트명은 문자열이어야 합니다'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('입력 데이터가 올바르지 않습니다', 400, errors.array());
    }

    const { version, buildNumber } = req.params;
    const { deploymentDate, projectName } = req.body;

    const deploymentInfo = await generateNASBasedDeploymentInfo(version, parseInt(buildNumber), deploymentDate, projectName);

    if (!deploymentInfo) {
      throw new AppError('NAS에서 해당 버전/빌드의 파일을 찾을 수 없습니다', 404);
    }

    logger.info(`NAS 기반 배포 정보 생성 완료 - 버전: ${version}, 빌드: ${buildNumber}`);

    res.json({
      success: true,
      data: deploymentInfo,
      message: 'NAS 기반 배포 정보를 성공적으로 생성했습니다.',
    });

  } catch (error) {
    logger.error('NAS 기반 배포 정보 생성 실패:', error);
    next(error);
  }
});

// Helper Functions

async function scanVersionDirectories(nasService) {
  try {
    const baseNASPath = '/release_version/release/product';
    const items = await nasService.listDirectory(baseNASPath);

    // mr로 시작하는 버전 디렉토리만 필터링
    return items
      .filter(item => item.type === 'directory' && item.name.startsWith('mr'))
      .map(item => item.name.replace('mr', '')); // mr1.0.0 -> 1.0.0
  } catch (error) {
    logger.warn('버전 디렉토리 스캔 실패:', error.message);
    return [];
  }
}

async function scanVersionDeployments(nasService, version) {
  const deployments = [];

  try {
    const versionPath = `/release_version/release/product/mr${version}`;
    const dateItems = await nasService.listDirectory(versionPath);

    for (const dateItem of dateItems) {
      if (dateItem.type !== 'directory') continue;

      try {
        const datePath = `${versionPath}/${dateItem.name}`;
        const buildItems = await nasService.listDirectory(datePath);

        for (const buildItem of buildItems) {
          if (buildItem.type !== 'directory') continue;

          const buildNumber = parseInt(buildItem.name);
          if (isNaN(buildNumber)) continue;

          // 해당 빌드의 파일들 스캔
          const buildPath = `${datePath}/${buildItem.name}`;
          const files = await nasService.listDirectory(buildPath);

          if (files.length > 0) {
            deployments.push({
              version: version,
              buildNumber: buildNumber,
              deploymentDate: dateItem.name,
              nasPath: buildPath.replace(/\//g, '\\\\nas.roboetech.com\\'),
              files: files.map(f => f.name),
              fileCount: files.length,
              source: 'nas_scan',
              projectName: `mr${version}_release`, // 추정 프로젝트명
            });
          }
        }
      } catch (error) {
        logger.debug(`날짜 디렉토리 스캔 실패: ${dateItem.name}`, error.message);
      }
    }
  } catch (error) {
    logger.warn(`버전 ${version} 배포 스캔 실패:`, error.message);
  }

  return deployments;
}

async function generateNASBasedDeploymentInfo(version, buildNumber, deploymentDate, projectName) {
  const nasService = getNASService();

  // 가능한 날짜들 생성 (제공된 날짜가 있으면 우선 사용)
  const possibleDates = [];

  if (deploymentDate) {
    possibleDates.push(deploymentDate);
  }

  // 버전별 알려진 배포 날짜들 추가
  if (version === '1.0.0') {
    possibleDates.push('241017');
  } else if (version === '1.2.0') {
    possibleDates.push('250929');
  }

  // 최근 30일 날짜들도 시도해볼 수 있음 (필요시)

  for (const dateStr of possibleDates) {
    const buildPath = `/release_version/release/product/mr${version}/${dateStr}/${buildNumber}`;
    try {
      const files = await nasService.listDirectory(buildPath);

      if (files.length > 0) {
        const deploymentInfo = {
          nasPath: `\\\\nas.roboetech.com\\${buildPath.replace(/\//g, '\\')}`,
          deploymentPath: `\\\\nas.roboetech.com\\${buildPath.replace(/\//g, '\\')}`,
          allFiles: files.map(f => f.name),
          verifiedFiles: files.map(f => f.name),
          directoryVerified: true,
          deploymentDate: dateStr,
          version: version,
          buildNumber: buildNumber,
          projectName: projectName || `mr${version}_release`,
          source: 'nas_direct',
          fileCount: files.length,
        };

        // 메인 다운로드 파일 찾기
        const mainFile = files.find(f =>
          f.name.includes('.tar.gz') &&
          !f.name.includes('.enc.') &&
          !f.name.includes('fs'),
        );

        if (mainFile) {
          deploymentInfo.downloadFile = mainFile.name;
          deploymentInfo.downloadFileVerified = true;
        }

        logger.info(`NAS 직접 스캔으로 배포 정보 생성: ${buildPath}`);
        return deploymentInfo;
      }
    } catch (error) {
      logger.debug(`경로 스캔 실패: ${buildPath}`, error.message);
    }
  }

  return null;
}

module.exports = router;
