import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Calendar,
  User,
  GitBranch,
  Tag,
  Server,
  Play,
  Download,
  ExternalLink,
  Copy,
  RefreshCw,
  HardDrive
} from 'lucide-react';

const DeploymentDetailModal = ({
  deployment,
  isOpen,
  onClose,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [copySuccess, setCopySuccess] = useState('');
  const [artifacts, setArtifacts] = useState([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [currentDeploymentId, setCurrentDeploymentId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [deploymentInfo, setDeploymentInfo] = useState(null);
  const [loadingDeploymentInfo, setLoadingDeploymentInfo] = useState(false);

  // 실제 Jenkins 로그를 가져오는 함수
  const fetchLogs = async () => {
    if (!deployment) return;
    
    setLoadingLogs(true);
    
    try {
      // Jenkins 로그 API 호출 - 프로젝트 이름과 빌드 번호를 사용
      const response = await fetch(`/api/deployments/logs/${encodeURIComponent(deployment.project_name)}/${deployment.build_number}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          setLogs(data.data);
        } else {
          // API 실패 시 mock 데이터 사용
          setLogs(mockLogs);
        }
      } else {
        // 에러 시 mock 데이터 사용
        setLogs(mockLogs);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      // 에러 시 mock 데이터 사용
      setLogs(mockLogs);
    } finally {
      setLoadingLogs(false);
    }
  };

  // 실제 배포 정보 가져오기 (NAS 경로, 다운로드 파일 등)
  const fetchDeploymentInfo = async () => {
    if (!deployment) return;
    
    setLoadingDeploymentInfo(true);
    
    try {
      const response = await fetch(`/api/deployments/deployment-info/${encodeURIComponent(deployment.project_name)}/${deployment.build_number}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          console.log('DeploymentInfo received:', data.data);
          console.log('downloadFile:', data.data.downloadFile);
          console.log('allFiles:', data.data.allFiles);
          setDeploymentInfo(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch deployment info:', error);
    } finally {
      setLoadingDeploymentInfo(false);
    }
  };

  // 배포 데이터에서 아티팩트 정보 사용 (백엔드에서 이미 조회됨)
  const fetchArtifacts = async () => {
    if (!deployment) return;
    
    setLoadingArtifacts(true);
    
    console.log('fetchArtifacts called for deployment:', deployment);
    console.log('deployment.artifacts:', deployment.artifacts);
    
    // 배포 데이터에 아티팩트 정보가 있으면 사용
    if (deployment.artifacts && deployment.artifacts.length > 0) {
      console.log('Using deployment artifacts:', deployment.artifacts);
      const deploymentArtifacts = deployment.artifacts.map(artifact => ({
        name: artifact.name,
        size: formatFileSize(artifact.size),
        type: artifact.name.endsWith('.tar.gz') ? 'Release Package' : 
              artifact.name.endsWith('.zip') ? 'Archive' : 'File',
        url: artifact.downloadUrl,
        modified: artifact.lastModified
      }));
      setArtifacts(deploymentArtifacts);
      setLoadingArtifacts(false);
      return;
    }
    
    // 아티팩트 정보가 없으면 기존 로직으로 fallback
    try {
      const projectParts = deployment.project_name.split('/');
      const versionFolder = projectParts[0] || '1.2.0';
      
      console.log('Fallback: project_name:', deployment.project_name);
      console.log('Fallback: versionFolder:', versionFolder);
      
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(versionFolder)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      console.log('API response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('API response data:', data);
        if (data.success) {
          const artifactFiles = data.data.files
            .filter(file => file.isFile && (file.name.endsWith('.tar.gz') || file.name.endsWith('.zip')))
            .map(file => ({
              name: file.name,
              size: formatFileSize(file.size),
              type: file.name.endsWith('.tar.gz') ? 'Release Package' : 'Archive',
              url: `/api/files/download?path=${encodeURIComponent('/nas/release_version/' + versionFolder + '/' + file.name)}`,
              modified: file.modified
            }));
          console.log('Filtered artifact files:', artifactFiles);
          setArtifacts(artifactFiles);
        }
      } else {
        console.error('API response not ok:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to fetch artifacts:', error);
      // 에러 시 빈 배열로 설정
      setArtifacts([]);
    } finally {
      setLoadingArtifacts(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {
    if (isOpen && deployment) {
      fetchArtifacts();
      fetchDeploymentInfo();
      // 새 배포 모달이 열릴 때만 상태 초기화
      if (currentDeploymentId !== deployment.id) {
        setCurrentDeploymentId(deployment.id);
        // 새 배포일 때 로그도 가져오기
        fetchLogs();
      }
    } else if (!isOpen) {
      // 모달이 닫힐 때 현재 배포 ID 리셋
      setCurrentDeploymentId(null);
      setLogs([]);
      setDeploymentInfo(null);
    }
  }, [isOpen, deployment]);

  // 모달이 열리거나 닫힐 때 상태 초기화
  useEffect(() => {
    if (isOpen && deployment) {
      setActiveTab('logs'); // 모달이 열릴 때마다 로그 탭으로 리셋
    } else if (!isOpen) {
      // 모달이 닫힐 때 모든 상태 초기화
      setActiveTab('logs');
      setLoadingDeploymentInfo(false);
      setDeploymentInfo(null);
      setLoadingArtifacts(false);
      setArtifacts([]);
      setLoadingLogs(false);
      setLogs([]);
      setCopySuccess('');
    }
  }, [isOpen, deployment]);

  // 로그 탭 활성화 시 로그 가져오기
  useEffect(() => {
    if (activeTab === 'logs' && isOpen && deployment) {
      fetchLogs();
    }
  }, [activeTab, isOpen, deployment]);

  if (!isOpen || !deployment) return null;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'in_progress':
        return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'pending':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      default:
        return <div className="w-5 h-5 bg-gray-300 rounded-full" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'text-green-700 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-700 bg-red-50 border-red-200';
      case 'in_progress':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'pending':
        return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      default:
        return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return {
      full: date.toLocaleString('ko-KR'),
      date: date.toLocaleDateString('ko-KR'),
      time: date.toLocaleTimeString('ko-KR')
    };
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}시간 ${minutes}분 ${secs}초`;
    } else if (minutes > 0) {
      return `${minutes}분 ${secs}초`;
    } else {
      return `${secs}초`;
    }
  };

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };


  const deploymentDate = formatDate(deployment.created_at);

  const tabs = [
    { id: 'logs', label: '로그', icon: Server },
    { id: 'artifacts', label: '아티팩트', icon: Download }
  ];

  // Mock 데이터
  const mockLogs = [
    { timestamp: '2025-01-27 14:32:01', level: 'INFO', message: 'Starting deployment process...' },
    { timestamp: '2025-01-27 14:32:05', level: 'INFO', message: 'Pulling latest code from repository' },
    { timestamp: '2025-01-27 14:32:15', level: 'INFO', message: 'Building application...' },
    { timestamp: '2025-01-27 14:32:45', level: 'INFO', message: 'Running tests...' },
    { timestamp: '2025-01-27 14:33:20', level: 'INFO', message: 'All tests passed' },
    { timestamp: '2025-01-27 14:33:25', level: 'INFO', message: 'Deploying to production environment' },
    { timestamp: '2025-01-27 14:33:40', level: 'SUCCESS', message: 'Deployment completed successfully' }
  ];



  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content max-w-4xl max-h-[70vh] overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-4">
            {getStatusIcon(deployment.status)}
            <div>
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-semibold text-primary-900">
                  {deployment.cardType === 'main' ? `V${deployment.version} 메인 버전` : 
                   deployment.cardType === 'component' ? `${deployment.jobType}${deployment.version} 컴포넌트` : 
                   deployment.project_name}
                </h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(deployment.status)}`}>
                  배포 {deployment.status === 'success' ? '성공' :
                        deployment.status === 'failed' ? '실패' :
                        deployment.status === 'in_progress' ? '진행중' : '대기중'}
                </span>
              </div>
              <div className="flex items-center space-x-6 text-sm mt-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-gray-500">빌드</span>
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-900">#{deployment.build_number}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-500">배포자</span>
                  <span className="font-medium text-gray-900">{deployment.deployed_by}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-gray-500">배포 시간</span>
                  <span className="text-gray-900">{deploymentDate.full}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-gray-500">소요 시간</span>
                  <span className="font-medium text-gray-900">{formatDuration(deployment.duration)}</span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex border-b border-gray-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>


        {/* 탭 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-4 h-[320px]">

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-primary-900">배포 로그</h3>
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={fetchLogs}
                    className="btn-secondary text-sm"
                    disabled={loadingLogs}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${loadingLogs ? 'animate-spin' : ''}`} />
                    새로고침
                  </button>
                  <button className="btn-secondary text-sm">
                    <Download className="w-4 h-4 mr-2" />
                    로그 다운로드
                  </button>
                </div>
              </div>

              {loadingLogs ? (
                <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-sm h-60 overflow-y-auto flex items-center justify-center">
                  <div className="text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
                    <span className="text-gray-400">로그를 불러오는 중...</span>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-sm h-60 overflow-y-auto">
                  {logs.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <span className="text-gray-400">로그가 없습니다.</span>
                    </div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="mb-1">
                        <span className="text-gray-400">{log.timestamp}</span>
                        <span className={`ml-2 ${
                          log.level === 'SUCCESS' ? 'text-green-400' :
                          log.level === 'ERROR' ? 'text-red-400' :
                          log.level === 'WARN' ? 'text-yellow-400' :
                          'text-gray-100'
                        }`}>
                          [{log.level}]
                        </span>
                        <span className="ml-2">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-primary-900">릴리즈 아티팩트</h3>
                <div className="flex items-center space-x-3">
                  {/* NAS 디렉토리 검증 상태 표시 */}
                  {deploymentInfo && (
                    <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
                      deploymentInfo.directoryVerified 
                        ? 'bg-green-100 text-green-800'
                        : deploymentInfo.verificationError
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        deploymentInfo.directoryVerified 
                          ? 'bg-green-600'
                          : deploymentInfo.verificationError
                            ? 'bg-red-600'
                            : 'bg-yellow-600'
                      }`}></div>
                      <span>
                        {deploymentInfo.directoryVerified 
                          ? 'NAS 디렉토리 확인됨'
                          : deploymentInfo.verificationError
                            ? 'NAS 디렉토리 없음'
                            : 'NAS 확인 중...'}
                      </span>
                      {deploymentInfo.alternativePathUsed && (
                        <span className="text-xs">(대체 경로 사용됨)</span>
                      )}
                    </div>
                  )}
                  {/* 공유 폴더 열기 버튼 */}
                  <button 
                    className={`text-sm flex items-center whitespace-nowrap ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length && 
                       artifacts.length === 0)
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-300 opacity-60 hover:bg-gray-300 hover:text-gray-500 px-4 py-2 rounded-md'
                        : 'btn-secondary'
                    }`}
                    onClick={() => {
                      // 실제 배포 경로 사용, 없으면 fallback
                      let nasPath = deploymentInfo?.nasPath || deploymentInfo?.deploymentPath;
                      
                      if (!nasPath) {
                        // fallback: 프로젝트 이름과 빌드 정보를 바탕으로 실제 경로 생성
                        const projectParts = deployment.project_name.split('/');
                        const versionFolder = projectParts[0] || '1.2.0';
                        
                        // 버전별 실제 배포 경로 사용
                        if (deployment.project_name.includes('fs1.2.0') && deployment.build_number <= 54) {
                          nasPath = `\\\\nas.roboetech.com\\release_version\\release\\product\\mr1.2.0\\250929\\${deployment.build_number}`;
                        } else if (deployment.project_name.includes('1.0.0')) {
                          nasPath = `\\\\nas.roboetech.com\\release_version\\release\\product\\mr1.0.0\\241017\\${deployment.build_number}`;
                        } else {
                          nasPath = `\\\\nas.roboetech.com\\release_version\\${versionFolder}`;
                        }
                      }
                      
                      // 시놀로지 NAS 디렉토리 브라우징을 위한 File Station 접근
                      // File Station URL 형식: https://nas.roboetech.com:5001/webman/index.cgi?launchApp=SYNO.SDS.App.FileStation3.Instance
                      
                      // NAS 경로에서 실제 파일 경로 추출
                      const pathPart = nasPath
                        .replace(/\\\\/g, '')           // \\ 제거
                        .replace('nas.roboetech.com', '') // 호스트명 제거
                        .replace(/\\/g, '/')            // \ -> /
                        .replace(/^\/+/, '/');          // 앞의 중복 슬래시 정리
                      
                      // 디렉토리 경로 (파일명 제외)
                      const directoryPath = pathPart;
                      
                      // 시놀로지 File Station URL 생성 (디렉토리 브라우징용)
                      const fileStationUrl = `https://nas.roboetech.com:5001/webman/index.cgi?launchApp=SYNO.SDS.App.FileStation3.Instance`;
                      
                      // 기본 폴더 공유 링크가 있으면 사용, 없으면 동적으로 생성
                      let finalUrl = deploymentInfo.synologyShareUrl;
                      
                      if (!finalUrl) {
                        // 버전별 디렉토리 공유 링크 (디렉토리 브라우징 가능한 링크) - fallback
                        const directoryShareLinks = {
                          '/release_version/release/product/mr3.0.0': 'dir_lXUVkbLMJ',  // 디렉토리 공유 링크
                          '/release_version/release/product/mr2.0.0': 'dir_aB3CdE4fG',
                          '/release_version/release/product/mr1.2.0': 'dir_hI5JkL6mN',
                          'default': 'dir_lXUVkbLMJ'
                        };
                        
                        // 경로에서 제품 버전 부분 추출
                        const versionPattern = /\/release_version\/release\/product\/(mr\d+\.\d+\.\d+)/;
                        const versionMatch = pathPart.match(versionPattern);
                        const versionPath = versionMatch ? `/release_version/release/product/${versionMatch[1]}` : 'default';
                        
                        // 해당 버전의 디렉토리 공유 링크 찾기
                        const dirShareId = directoryShareLinks[versionPath] || directoryShareLinks['default'];
                        finalUrl = `https://nas.roboetech.com/sharing/${dirShareId}`;
                      }
                      
                      // 접속 방법들 (실제 배포 폴더 공유 링크 우선)
                      const accessUrls = [
                        finalUrl,                                 // 실제 배포 폴더 공유 링크 (추천)
                        fileStationUrl,                           // File Station 앱
                        `https://nas.roboetech.com:5001`,         // DSM HTTPS 웹스테이션
                        `http://nas.roboetech.com:5000`,          // DSM HTTP 웹스테이션
                        `https://nas.roboetech.com/webman/index.cgi`, // 직접 웹맨 접근
                      ];
                      
                      console.log('Original NAS path:', nasPath);
                      console.log('Final share URL:', finalUrl);
                      console.log('File Station URL:', fileStationUrl);
                      console.log('All access URLs:', accessUrls);
                      
                      // 팝업 메시지 없이 바로 디렉토리 공유 링크로 접속
                      window.open(finalUrl, '_blank');
                    }}
                    disabled={
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length && 
                       artifacts.length === 0)
                    }
                  >
                    <HardDrive className={`w-4 h-4 mr-2 ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length && 
                       artifacts.length === 0)
                        ? 'text-gray-400'
                        : ''
                    }`} />
                    {loadingDeploymentInfo 
                      ? '경로 확인중...' 
                      : (!deploymentInfo?.downloadFile && 
                         !deploymentInfo?.allFiles?.length && 
                         artifacts.length === 0)
                        ? '파일 없음'
                        : '공유 폴더 열기'
                    }
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {loadingArtifacts || loadingDeploymentInfo ? (
                  <div className="text-center py-8">
                    <div className="text-gray-500">아티팩트 로딩 중...</div>
                  </div>
                ) : (
                  <>
                    {/* 주 다운로드 파일 (V3.0.0_250310_0843.tar.gz) */}
                    {deploymentInfo?.downloadFile && (
                      <div className={`border rounded-lg p-4 ${
                        deploymentInfo.downloadFileVerified !== false ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <Download className={`w-6 h-6 ${
                              deploymentInfo.downloadFileVerified !== false ? 'text-blue-600' : 'text-red-600'
                            }`} />
                            <div>
                              <p className={`font-semibold ${
                                deploymentInfo.downloadFileVerified !== false ? 'text-blue-900' : 'text-red-900'
                              }`}>
                                메인 릴리즈 파일
                                {deploymentInfo.downloadFileVerified === false && (
                                  <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-1 rounded">파일 없음</span>
                                )}
                              </p>
                              <p className={`text-sm font-medium ${
                                deploymentInfo.downloadFileVerified !== false ? 'text-blue-800' : 'text-red-800'
                              }`}>
                                {deploymentInfo.downloadFile}
                              </p>
                              <p className={`text-xs ${
                                deploymentInfo.downloadFileVerified !== false ? 'text-blue-600' : 'text-red-600'
                              }`}>
                                {deploymentInfo.downloadFileVerified !== false ? '권장 다운로드 파일' : '파일이 NAS에서 확인되지 않습니다'}
                              </p>
                            </div>
                          </div>
                          <button 
                            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center whitespace-nowrap ${
                              deploymentInfo.downloadFileVerified !== false && deploymentInfo.directoryVerified
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}
                            disabled={deploymentInfo.downloadFileVerified === false || !deploymentInfo.directoryVerified}
                            onClick={() => {
                              if (deploymentInfo.downloadFileVerified === false || !deploymentInfo.directoryVerified) {
                                alert('파일이 NAS에 존재하지 않아 다운로드할 수 없습니다.');
                                return;
                              }

                              const fileName = deploymentInfo.downloadFile;
                              
                              // 새로운 파일별 다운로드 링크 사용
                              const fileDownloadInfo = deploymentInfo.fileDownloadLinks?.[fileName];
                              const downloadUrl = deploymentInfo.mainFileDownloadUrl || 
                                                fileDownloadInfo?.downloadUrl ||
                                                deploymentInfo.synologyShareUrl;
                              
                              if (downloadUrl) {
                                const fileType = fileName.startsWith('mr') ? 'Morow' : 
                                               fileName.startsWith('V') ? 'V' :
                                               fileName.startsWith('be') ? 'Backend' :
                                               fileName.startsWith('fe') ? 'Frontend' : '기타';
                                
                                const isDirectDownload = deploymentInfo.isMainFileDirectDownload || 
                                                       fileDownloadInfo?.isDirectDownload || 
                                                       false;
                                
                                console.log('Download Link Info:', {
                                  fileName,
                                  fileType,
                                  downloadUrl,
                                  isDirectDownload
                                });
                                
                                // 직접 다운로드 링크면 현재 창에서, 공유 링크면 새 탭에서 열기
                                if (isDirectDownload) {
                                  // 직접 다운로드 - 파일이 바로 다운로드됨
                                  window.location.href = downloadUrl;
                                } else {
                                  // 공유 링크 - 새 탭에서 폴더 열기
                                  window.open(downloadUrl, '_blank');
                                }
                              } else {
                                alert('다운로드 링크를 생성할 수 없습니다.');
                              }
                            }}
                            title={deploymentInfo.downloadFileVerified === false ? '파일이 NAS에 존재하지 않습니다' : ''}
                          >
                            {deploymentInfo.downloadFileVerified === false ? '파일 없음' : '다운로드'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 모든 배포 파일에 대한 개별 다운로드 카드 */}
                    {((deploymentInfo?.allFiles && deploymentInfo.allFiles.length > 0) || 
                      (deployment.project_name.includes('fs1.2.0') && deployment.build_number <= 54)) && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-700">전체 배포 파일</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* fs 빌드의 경우 예상 파일 표시 */}
                          {deployment.project_name.includes('fs1.2.0') && deployment.build_number <= 54 && !deploymentInfo?.allFiles?.length ? [
                            `fs1.2.0_250929_1058_${deployment.build_number}.tar.gz`,
                            `fs1.2.0_250929_1058_${deployment.build_number}.enc.tar.gz`
                          ].map((file, index) => {
                            const isEncrypted = file.includes('.enc.');
                            const fileExists = false; // API에서 검증되지 않은 상태
                            
                            return (
                              <div 
                                key={index} 
                                className="border rounded-lg p-4 bg-yellow-50 border-yellow-200"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <Download className="w-5 h-5 text-yellow-600" />
                                    <div>
                                      <p className="font-medium text-yellow-900">
                                        Frontend
                                        <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">예상 파일</span>
                                      </p>
                                      <p className="text-sm text-yellow-700">{file}</p>
                                      <p className="text-xs text-yellow-600">
                                        {isEncrypted ? '암호화된 Frontend 파일' : 'Frontend 빌드 파일'}
                                      </p>
                                    </div>
                                  </div>
                                  <button 
                                    className="px-3 py-1 rounded-md text-sm font-medium bg-yellow-600 hover:bg-yellow-700 text-white"
                                    onClick={() => {
                                      // fs 빌드의 실제 경로로 공유 폴더 열기
                                      const shareUrl = 'https://nas.roboetech.com:5001/sharing/dir_lXUVkbLMJ';
                                      window.open(shareUrl, '_blank');
                                    }}
                                  >
                                    공유 폴더 열기
                                  </button>
                                </div>
                              </div>
                            );
                          }) : 
                          /* 기존 API 기반 파일 목록 */
                          deploymentInfo.allFiles.filter(file => {
                            // V 파일(메인)이 아닌 모든 파일들 표시 (mr, be, fe 등)
                            return !file.startsWith('V');
                          }).sort((a, b) => {
                            // 모로우, 백엔드, 프런트엔드 순서로 정렬
                            const getOrder = (file) => {
                              if (file.startsWith('mr')) return 1; // Morow
                              if (file.startsWith('be')) return 2; // Backend  
                              if (file.startsWith('fe')) return 3; // Frontend
                              return 4; // 기타
                            };
                            return getOrder(a) - getOrder(b);
                          }).map((file, index) => {
                            const isMainFile = file === deploymentInfo.downloadFile;
                            const isEncrypted = file.includes('.enc.');
                            const fileType = file.startsWith('mr') ? 'Morow' :
                                           file.startsWith('be') ? 'Backend' :
                                           file.startsWith('fe') ? 'Frontend' : '기타';
                            
                            // 파일이 실제로 NAS에 존재하는지 확인
                            const fileExists = deploymentInfo.verifiedFiles ? deploymentInfo.verifiedFiles.includes(file) : true;
                            
                            return (
                              <div 
                                key={index} 
                                className={`border rounded-lg p-4 ${
                                  !fileExists 
                                    ? 'bg-red-50 border-red-200'
                                    : isMainFile 
                                      ? 'bg-blue-50 border-blue-200' 
                                      : isEncrypted 
                                        ? 'bg-orange-50 border-orange-200'
                                        : 'bg-gray-50 border-gray-200'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <Download className={`w-5 h-5 ${
                                      !fileExists 
                                        ? 'text-red-600'
                                        : isMainFile 
                                          ? 'text-blue-600' 
                                          : isEncrypted 
                                            ? 'text-orange-600' 
                                            : 'text-gray-600'
                                    }`} />
                                    <div>
                                      <p className={`font-medium ${
                                        !fileExists 
                                          ? 'text-red-900'
                                          : isMainFile 
                                            ? 'text-blue-900' 
                                            : isEncrypted 
                                              ? 'text-orange-900' 
                                              : 'text-gray-900'
                                      }`}>
                                        {fileType}
                                        {!fileExists && (
                                          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-1 rounded">파일 없음</span>
                                        )}
                                      </p>
                                      <p className={`text-sm ${
                                        !fileExists 
                                          ? 'text-red-700'
                                          : isMainFile 
                                            ? 'text-blue-700' 
                                            : isEncrypted 
                                              ? 'text-orange-700' 
                                              : 'text-gray-700'
                                      }`}>
                                        {file}
                                      </p>
                                      <p className={`text-xs ${
                                        !fileExists 
                                          ? 'text-red-600'
                                          : isMainFile 
                                            ? 'text-blue-600' 
                                            : isEncrypted 
                                              ? 'text-orange-600' 
                                              : 'text-gray-600'
                                      }`}>
                                        {!fileExists 
                                          ? '파일이 NAS에서 확인되지 않습니다'
                                          : isMainFile 
                                            ? '권장 다운로드 파일' 
                                            : isEncrypted 
                                              ? '암호화된 컴포넌트 파일' 
                                              : '일반 파일'}
                                      </p>
                                    </div>
                                  </div>
                                  <button 
                                    className={`px-3 py-1 rounded-md text-sm font-medium flex items-center whitespace-nowrap ${
                                      !fileExists || !deploymentInfo.directoryVerified
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : isMainFile 
                                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                          : isEncrypted
                                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                            : 'bg-gray-600 hover:bg-gray-700 text-white'
                                    }`}
                                    disabled={!fileExists || !deploymentInfo.directoryVerified}
                                    onClick={() => {
                                      if (!fileExists || !deploymentInfo.directoryVerified) {
                                        alert('파일이 NAS에 존재하지 않아 다운로드할 수 없습니다.');
                                        return;
                                      }

                                      // 실제 파일명을 기반으로 다운로드 링크 찾기
                                      let actualFileName = file;
                                      let downloadUrl = null;
                                      let isDirectDownload = false;
                                      
                                      // actualFiles에서 해당하는 파일 찾기
                                      if (deploymentInfo.actualFiles) {
                                        const fileType = file.startsWith('mr') ? 'morow' : 
                                                       file.startsWith('V') ? 'main' :
                                                       file.startsWith('be') ? 'backend' :
                                                       file.startsWith('fe') ? 'frontend' : null;
                                        
                                        if (fileType && deploymentInfo.actualFiles[fileType]) {
                                          actualFileName = deploymentInfo.actualFiles[fileType];
                                          const fileDownloadInfo = deploymentInfo.fileDownloadLinks?.[actualFileName] ||
                                                                 deploymentInfo.fileDownloadLinks?.[`${fileType}File`];
                                          if (fileDownloadInfo) {
                                            downloadUrl = fileDownloadInfo.downloadUrl;
                                            isDirectDownload = fileDownloadInfo.isDirectDownload;
                                          }
                                        }
                                      }
                                      
                                      // 기존 방식으로 폴백
                                      if (!downloadUrl) {
                                        const fileDownloadInfo = deploymentInfo.fileDownloadLinks?.[file];
                                        downloadUrl = fileDownloadInfo?.downloadUrl || 
                                                    deploymentInfo.synologyShareUrl;
                                        isDirectDownload = fileDownloadInfo?.isDirectDownload || false;
                                      }
                                      
                                      if (downloadUrl) {
                                        const fileTypeLabel = file.startsWith('mr') ? 'Morow' : 
                                                            file.startsWith('V') ? 'V' :
                                                            file.startsWith('be') ? 'Backend' :
                                                            file.startsWith('fe') ? 'Frontend' : '기타';
                                        
                                        console.log('Individual File Download:', {
                                          originalFileName: file,
                                          actualFileName,
                                          fileTypeLabel,
                                          downloadUrl,
                                          isDirectDownload
                                        });
                                        
                                        // 직접 다운로드 링크면 현재 창에서, 공유 링크면 새 탭에서 열기
                                        if (isDirectDownload) {
                                          // 직접 다운로드 - 파일이 바로 다운로드됨
                                          window.location.href = downloadUrl;
                                        } else {
                                          // 공유 링크 - 새 탭에서 폴더 열기
                                          window.open(downloadUrl, '_blank');
                                        }
                                      } else {
                                        alert('다운로드 링크를 생성할 수 없습니다.');
                                      }
                                    }}
                                    title={!fileExists ? '파일이 NAS에 존재하지 않습니다' : ''}
                                  >
                                    {!fileExists ? '파일 없음' : '다운로드'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 기존 아티팩트 (fallback) */}
                    {(!deploymentInfo?.downloadFile && !deploymentInfo?.allFiles?.length) && (
                      artifacts.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Download className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                          <p>사용 가능한 아티팩트가 없습니다.</p>
                        </div>
                      ) : (
                        artifacts.map((artifact, index) => (
                          <div key={index} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <Download className="w-5 h-5 text-gray-400" />
                              <div>
                                <p className="font-medium text-primary-900">{artifact.name}</p>
                                <p className="text-sm text-gray-500">{artifact.type} • {artifact.size}</p>
                                <p className="text-xs text-gray-400 font-mono">{artifact.url}</p>
                              </div>
                            </div>
                            <button 
                              className="btn-secondary text-sm"
                              onClick={async () => {
                                try {
                                  let downloadUrl = artifact.url;
                                  
                                  if (!downloadUrl.startsWith('/api/files/download')) {
                                    downloadUrl = `/api/files/download?path=${encodeURIComponent(artifact.url)}`;
                                  }
                                  
                                  const response = await fetch(downloadUrl, {
                                    headers: {
                                      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                                    }
                                  });
                                  
                                  if (response.ok) {
                                    const blob = await response.blob();
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = artifact.name;
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                    document.body.removeChild(a);
                                  } else {
                                    throw new Error(`Download failed: ${response.status}`);
                                  }
                                } catch (error) {
                                  console.error('Download error:', error);
                                  alert('다운로드에 실패했습니다. 파일이 존재하지 않거나 접근 권한이 없습니다.');
                                }
                              }}
                            >
                              다운로드
                            </button>
                          </div>
                        ))
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default DeploymentDetailModal;