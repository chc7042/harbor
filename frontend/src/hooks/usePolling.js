import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import pollingService from '../services/pollingService';
import api from '../services/api';
import toast from 'react-hot-toast';

/**
 * 배포 데이터 폴링 훅
 */
export const useDeploymentPolling = (initialDeployments = [], pollingInterval = 5000) => {
  const { user } = useAuth();
  const [deployments, setDeployments] = useState(initialDeployments);
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const previousDeployments = useRef(initialDeployments);
  // localStorage에서 알림 기록 복원
  const getNotificationCache = () => {
    try {
      const saved = localStorage.getItem('harbor_notified_deployments');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (error) {
      console.error('Failed to load notification cache:', error);
      return new Set();
    }
  };

  const saveNotificationCache = (cache) => {
    try {
      localStorage.setItem('harbor_notified_deployments', JSON.stringify([...cache]));
    } catch (error) {
      console.error('Failed to save notification cache:', error);
    }
  };

  const notifiedDeployments = useRef(getNotificationCache()); // 이미 알림을 보낸 배포 ID 추적
  
  // 초기 배포들을 알림 기록에 추가 (중복 알림 방지)
  useEffect(() => {
    let shouldSave = false;
    initialDeployments.forEach(deployment => {
      const notificationKey = `${deployment.id}-${deployment.status}`;
      if (!notifiedDeployments.current.has(notificationKey)) {
        notifiedDeployments.current.add(notificationKey);
        shouldSave = true;
      }
    });
    if (shouldSave) {
      saveNotificationCache(notifiedDeployments.current);
    }
  }, [initialDeployments]);

  // 배포 데이터 조회 함수
  const fetchDeployments = useCallback(async () => {
    try {
      setError(null);
      const response = await api.get('/deployments/recent?limit=20&hours=168'); // 최근 7일
      const deploymentData = response.data?.data || response.data || [];
      
      if (Array.isArray(deploymentData)) {
        const transformedData = deploymentData.map(deployment => ({
          id: deployment.id,
          project_name: deployment.projectName || deployment.project_name,
          build_number: deployment.buildNumber || deployment.build_number,
          status: deployment.status,
          environment: deployment.environment || 'development',
          deployed_by: deployment.deployedBy || deployment.deployed_by || 'Jenkins',
          branch: deployment.branch || 'main',
          created_at: deployment.deployedAt || deployment.created_at,
          duration: deployment.duration,
          description: deployment.commitMessage || deployment.description || `Build ${deployment.buildNumber || deployment.build_number} deployment`,
          jenkins_url: deployment.jenkinsUrl || deployment.jenkins_url,
          artifacts: deployment.artifacts || [],
          subJobs: deployment.subJobs || []
        }));

        // 새로운 배포나 상태 변경 감지
        const previous = previousDeployments.current;
        const newDeployments = transformedData.filter(deployment => 
          !previous.find(prev => prev.id === deployment.id)
        );
        
        const statusChanges = transformedData.filter(deployment => {
          const prev = previous.find(p => p.id === deployment.id);
          return prev && prev.status !== deployment.status;
        });

        // 새로운 배포 알림 (중복 방지)
        newDeployments.forEach(deployment => {
          const notificationKey = `${deployment.id}-${deployment.status}`;
          
          // 이미 알림을 보낸 배포는 건너뛰기
          if (notifiedDeployments.current.has(notificationKey)) {
            return;
          }
          
          if (deployment.status === 'success') {
            toast.success(`새 배포 완료: ${deployment.project_name} #${deployment.build_number}`);
            notifiedDeployments.current.add(notificationKey);
            saveNotificationCache(notifiedDeployments.current);
          } else if (deployment.status === 'failed') {
            toast.error(`배포 실패: ${deployment.project_name} #${deployment.build_number}`);
            notifiedDeployments.current.add(notificationKey);
            saveNotificationCache(notifiedDeployments.current);
          } else if (deployment.status === 'in_progress') {
            toast(`배포 시작: ${deployment.project_name} #${deployment.build_number}`, {
              icon: '⚡',
            });
            notifiedDeployments.current.add(notificationKey);
            saveNotificationCache(notifiedDeployments.current);
          }
          
          // 이벤트 발생
          pollingService.emit('deployment_update', deployment);
        });

        // 상태 변경 알림 (중복 방지)
        statusChanges.forEach(deployment => {
          const notificationKey = `${deployment.id}-${deployment.status}`;
          
          // 이미 알림을 보낸 배포는 건너뛰기
          if (notifiedDeployments.current.has(notificationKey)) {
            return;
          }
          
          const prev = previous.find(p => p.id === deployment.id);
          if (prev.status !== 'success' && deployment.status === 'success') {
            toast.success(`배포 성공: ${deployment.project_name} #${deployment.build_number}`);
            notifiedDeployments.current.add(notificationKey);
            saveNotificationCache(notifiedDeployments.current);
          } else if (prev.status !== 'failed' && deployment.status === 'failed') {
            toast.error(`배포 실패: ${deployment.project_name} #${deployment.build_number}`);
            notifiedDeployments.current.add(notificationKey);
            saveNotificationCache(notifiedDeployments.current);
          }
          
          // 이벤트 발생
          pollingService.emit('deployment_status_change', {
            deployment,
            previousStatus: prev.status
          });
        });

        setDeployments(transformedData);
        previousDeployments.current = transformedData;
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch deployments:', error);
      setError(error);
      // 에러 발생해도 토스트는 표시하지 않음 (너무 자주 발생할 수 있음)
    }
  }, []);

  // 초기 데이터 설정
  useEffect(() => {
    setDeployments(initialDeployments);
    previousDeployments.current = initialDeployments;
  }, [initialDeployments]);

  // 폴링 시작/중지
  useEffect(() => {
    if (!user) {
      setIsPolling(false);
      return;
    }

    const pollingKey = 'deployment_updates';
    
    // 폴링 시작
    pollingService.start(pollingKey, fetchDeployments, pollingInterval);
    setIsPolling(true);

    // 정리
    return () => {
      pollingService.stop(pollingKey);
      setIsPolling(false);
    };
  }, [user, fetchDeployments, pollingInterval]);

  // 수동 새로고침
  const refresh = useCallback(async () => {
    await fetchDeployments();
  }, [fetchDeployments]);

  // 폴링 간격 변경
  const changePollingInterval = useCallback((newInterval) => {
    const pollingKey = 'deployment_updates';
    pollingService.changeInterval(pollingKey, fetchDeployments, newInterval);
  }, [fetchDeployments]);

  return {
    deployments,
    isPolling,
    lastUpdate,
    error,
    refresh,
    changePollingInterval
  };
};

/**
 * 프로젝트 데이터 폴링 훅
 */
export const useProjectPolling = (pollingInterval = 5000) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  const fetchProjects = useCallback(async () => {
    try {
      setError(null);
      const response = await api.get('/projects');
      const projectData = response.data?.data || response.data || [];
      
      // 프로젝트를 버전 번호 기준으로 내림차순 정렬
      const sortedProjects = projectData.sort((a, b) => {
        const versionA = a.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        const versionB = b.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        
        if (versionA && versionB) {
          const parseVersion = (match) => {
            return [
              parseInt(match[1], 10) || 0,
              parseInt(match[2], 10) || 0, 
              parseInt(match[3], 10) || 0
            ];
          };
          
          const vA = parseVersion(versionA);
          const vB = parseVersion(versionB);
          
          for (let i = 0; i < 3; i++) {
            if (vA[i] !== vB[i]) {
              return vB[i] - vA[i];
            }
          }
          return 0;
        }
        
        return b.name.localeCompare(a.name);
      });
      
      setProjects(sortedProjects);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      setError(error);
    }
  }, []);

  // 폴링 시작/중지
  useEffect(() => {
    if (!user) {
      setIsPolling(false);
      return;
    }

    const pollingKey = 'project_updates';
    
    // 폴링 시작 (프로젝트는 덜 자주 업데이트됨)
    pollingService.start(pollingKey, fetchProjects, pollingInterval);
    setIsPolling(true);

    // 정리
    return () => {
      pollingService.stop(pollingKey);
      setIsPolling(false);
    };
  }, [user, fetchProjects, pollingInterval]);

  // 수동 새로고침
  const refresh = useCallback(async () => {
    await fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    isPolling,
    lastUpdate,
    error,
    refresh
  };
};

/**
 * 폴링 상태 관리 훅
 */
export const usePollingStatus = () => {
  const [isActive, setIsActive] = useState(false);
  const [activePolling, setActivePolling] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsActive(pollingService.isPollingActive());
      setActivePolling(pollingService.getActivePolling());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const stopAllPolling = useCallback(() => {
    pollingService.stopAll();
  }, []);

  return {
    isActive,
    activePolling,
    stopAllPolling
  };
};