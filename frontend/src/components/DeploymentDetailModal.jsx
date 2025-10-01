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

// 파일 크기 포맷팅 함수
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 파일 날짜 포맷팅 함수
const formatFileDate = (timestamp) => {
  if (!timestamp) return '알 수 없음';
  const date = new Date(timestamp * 1000); // Unix timestamp를 JS Date로 변환
  return date.toLocaleString('ko-KR');
};

const DeploymentDetailModal = ({
  deployment,
  isOpen,
  onClose,
  className = '',
  source = 'deployments' // 'deployments', 'hierarchy', 'dashboard'
}) => {
  const [activeTab, setActiveTab] = useState('logs');
  const [copySuccess, setCopySuccess] = useState('');
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
          setLogs([]);
        }
      } else {
        setLogs([]);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs([]);
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


  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {
    if (isOpen && deployment) {
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
      // 새로운 배포일 때만 탭을 초기화 (같은 배포라면 현재 탭 유지)
      if (currentDeploymentId !== deployment.id) {
        setActiveTab('logs'); // 새 배포일 때만 로그 탭으로 리셋
      }
    } else if (!isOpen) {
      // 모달이 닫힐 때 모든 상태 초기화
      setActiveTab('logs');
      setLoadingDeploymentInfo(false);
      setDeploymentInfo(null);
      setLoadingLogs(false);
      setLogs([]);
      setCopySuccess('');
    }
  }, [isOpen, deployment, currentDeploymentId]);

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

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        // 백드롭 클릭 시에만 모달 닫기
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden"
        onClick={(e) => {
          // 모달 내부 클릭 시 이벤트 전파 중단
          e.stopPropagation();
        }}
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
                  <span className="font-noto-sans-kr">배포 {deployment.status === 'success' ? '성공' :
                        deployment.status === 'failed' ? '실패' :
                        deployment.status === 'in_progress' ? '진행중' : '대기중'}</span>
                </span>
              </div>
              <div className="flex items-center space-x-6 text-sm mt-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-gray-500 font-noto-sans-kr">빌드</span>
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-900">#{deployment.build_number}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-500 font-noto-sans-kr">배포자</span>
                  <span className="font-medium text-gray-900">{deployment.deployed_by}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-gray-500 font-noto-sans-kr">배포 시간</span>
                  <span className="text-gray-900">{deploymentDate.full}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-gray-500 font-noto-sans-kr">소요 시간</span>
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
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {['logs', 'artifacts'].map((tab) => (
              <button
                key={tab}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveTab(tab);
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="font-noto-sans-kr">{tab === 'logs' ? '로그' : '빌드 결과'}</span>
              </button>
            ))}
          </nav>
        </div>


        {/* 탭 콘텐츠 */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden" style={{ height: 'calc(90vh - 200px)' }}>

          {activeTab === 'logs' && (
            <div className="flex-1 flex flex-col space-y-4 h-full">
              <div className="flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-medium text-primary-900 font-noto-sans-kr">배포 로그</h3>
                <button 
                  onClick={() => {
                    console.log('새로고침 버튼 클릭됨');
                    fetchLogs();
                  }}
                  className="btn-secondary text-sm"
                  disabled={loadingLogs}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loadingLogs ? 'animate-spin' : ''}`} />
                  <span className="font-noto-sans-kr">새로고침</span>
                </button>
              </div>

              <div className="flex-1 flex flex-col space-y-3 min-h-0">
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="h-full bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-sm overflow-y-auto">
                    {loadingLogs ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
                          <span className="text-gray-400 font-noto-sans-kr">로그를 불러오는 중...</span> 
                        </div>
                      </div>
                    ) : logs.length > 0 ? (
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
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <span className="text-gray-400 font-noto-sans-kr">로그가 없습니다.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="flex-1 flex flex-col space-y-4 h-full">
              <div className="flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-medium text-primary-900 font-noto-sans-kr">빌드 결과</h3>
                <div className="flex items-center space-x-3">
                  {/* NAS 디렉토리 검증 상태 표시 */}
                  {deploymentInfo && (
                    <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
                      deploymentInfo?.directoryVerified 
                        ? 'bg-green-100 text-green-800'
                        : deploymentInfo?.verificationError
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        deploymentInfo?.directoryVerified 
                          ? 'bg-green-600'
                          : deploymentInfo?.verificationError
                            ? 'bg-red-600'
                            : 'bg-yellow-600'
                      }`}></div>
                      <span>
                        {deploymentInfo?.directoryVerified 
                          ? 'NAS 디렉토리 확인됨'
                          : deploymentInfo?.verificationError
                            ? 'NAS 디렉토리 없음'
                            : 'NAS 확인 중...'}
                      </span>
                      {deploymentInfo?.alternativePathUsed && (
                        <span className="text-xs">(대체 경로 사용됨)</span>
                      )}
                    </div>
                  )}
                  {/* 공유 폴더 열기 버튼 */}
                  <button 
                    className={`text-sm flex items-center whitespace-nowrap ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length)
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-300 opacity-60 hover:bg-gray-300 hover:text-gray-500 px-4 py-2 rounded-md'
                        : 'btn-secondary'
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // 실제 배포 경로 사용, 없으면 fallback
                      let nasPath = deploymentInfo?.nasPath || deploymentInfo?.deploymentPath;
                      
                      if (!nasPath) {
                        return;
                      }
                      
                      // 시놀로지 NAS 디렉토리 브라우징을 위한 File Station 접근
                      // File Station URL 형식: https://nas.roboetech.com:5001/webman/index.cgi?launchApp=SYNO.SDS.App.FileStation3.Instance
                      
                      // NAS 경로에서 실제 파일 경로 추출
                      const pathPart = nasPath
                        .replace(/\\\\/g, '')           // \\ 제거
                        .replace('nas.roboetech.com', '') // 호스트명 제거
                        .replace(/\\/g, '/')            // \ -> /
                        .replace(/^\/+/, '/');          // 앞의 중복 슬래시 정리
                      
                      // 디렉토리 경로 정리됨
                      
                      // 시놀로지 File Station URL 생성 (디렉토리 브라우징용)
                      const fileStationUrl = `https://nas.roboetech.com:5001/webman/index.cgi?launchApp=SYNO.SDS.App.FileStation3.Instance`;
                      
                      // 공유 링크가 있을 때만 열기
                      let finalUrl = deploymentInfo.synologyShareUrl;
                      
                      if (!finalUrl) {
                        return;
                      }
                      
                      
                      
                      // 공유 링크로 접속
                      window.open(finalUrl, '_blank');
                    }}
                    disabled={
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length)
                    }
                  >
                    <HardDrive className={`w-4 h-4 mr-2 ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       !deploymentInfo?.allFiles?.length)
                        ? 'text-gray-400'
                        : ''
                    }`} />
                    {loadingDeploymentInfo 
                      ? '경로 확인중...' 
                      : (!deploymentInfo?.downloadFile && 
                         !deploymentInfo?.allFiles?.length)
                        ? '파일 없음'
                        : '공유 폴더 열기'
                    }
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
                {loadingDeploymentInfo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-gray-500 font-noto-sans-kr">배포 파일 로딩 중...</div>
                  </div>
                ) : (
                  <>
                    {/* 배포 파일에 대한 개별 다운로드 카드 - 빌드 타입별 표시 */}
                    <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
                      <h4 className="text-sm font-medium text-gray-700 border-b pb-2 flex-shrink-0">배포 파일</h4>
                      <div className="flex-1 overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* 실제 파일이 있으면 실제 파일 표시, 없으면 기본 컴포넌트 카드 표시 */}
                          {(deploymentInfo?.allFiles && deploymentInfo.allFiles.length > 0) ? 
                          /* 기존 API 기반 파일 목록 - V 파일(메인버전) 제외 및 빌드 타입별 필터링 */
                          deploymentInfo.allFiles.filter(file => {
                            const projectName = deployment.project_name || '';
                            
                            // 빌드 타입 식별 - 프로젝트 이름의 마지막 부분을 분석
                            const projectParts = projectName.split('/');
                            const buildType = projectParts[projectParts.length - 1] || '';
                            
                            // 각 빌드별 해당 파일만 표시 (V 파일은 메인 버전이므로 제외)
                            if (buildType.includes('mr') && buildType.includes('_release')) {
                              // MR 빌드: mr로 시작하는 파일만 표시
                              return file.startsWith('mr');
                            } else if (buildType.includes('fs') && buildType.includes('_release')) {
                              // FS 빌드: fe로 시작하는 파일만 표시 (frontend)
                              return file.startsWith('fe');
                            } else if (buildType.includes('be') && buildType.includes('_release')) {
                              // BE 빌드: be로 시작하는 파일만 표시 (backend)
                              return file.startsWith('be');
                            } else {
                              // 기타 빌드나 프로젝트 계층구조에서는 V 파일(메인버전) 제외하고 모든 컴포넌트 파일 표시
                              return !file.startsWith('V');
                            }
                          }).sort((a, b) => {
                            // 모로우, 백엔드, 프런트엔드 순서로 정렬
                            const getOrder = (file) => {
                              if (file.startsWith('mr')) return 1; // Morrow
                              if (file.startsWith('be')) return 2; // Backend  
                              if (file.startsWith('fe')) return 3; // Frontend
                              return 4; // 기타
                            };
                            return getOrder(a) - getOrder(b);
                          }).map((file, index) => {
                            // const isMainFile = file === deploymentInfo.downloadFile; // 사용되지 않음
                            const isEncrypted = file.includes('.enc.');
                            const fileType = file.startsWith('mr') ? '모로우' :
                                           file.startsWith('be') ? '백엔드' :
                                           file.startsWith('fe') ? '프런트엔드' : 
                                           file.startsWith('V') ? '메인버전' : '기타';
                            
                            // 파일이 실제로 NAS에 존재하는지 확인
                            const fileExists = deploymentInfo.verifiedFiles ? deploymentInfo.verifiedFiles.includes(file) : true;
                            
                            // 파일 타입별 색상 정의 (버전 히스토리와 동일한 규칙 적용)
                            const getFileTypeColors = (fileType) => {
                              if (!fileExists) return {
                                bg: 'bg-red-50',
                                border: 'border-red-200',
                                icon: 'text-red-600',
                                title: 'text-red-900',
                                subtitle: 'text-red-700',
                                description: 'text-red-600'
                              };
                              
                              switch (fileType) {
                                case '메인버전':
                                  return {
                                    bg: 'bg-blue-50',
                                    border: 'border-blue-200',
                                    icon: 'text-blue-600',
                                    title: 'text-blue-900',
                                    subtitle: 'text-blue-700',
                                    description: 'text-blue-600'
                                  };
                                case '모로우':
                                  return {
                                    bg: 'bg-purple-50',
                                    border: 'border-purple-200',
                                    icon: 'text-purple-600',
                                    title: 'text-purple-900',
                                    subtitle: 'text-purple-700',
                                    description: 'text-purple-600'
                                  };
                                case '백엔드':
                                  return {
                                    bg: 'bg-green-50',
                                    border: 'border-green-200',
                                    icon: 'text-green-600',
                                    title: 'text-green-900',
                                    subtitle: 'text-green-700',
                                    description: 'text-green-600'
                                  };
                                case '프런트엔드':
                                  return {
                                    bg: 'bg-orange-50',
                                    border: 'border-orange-200',
                                    icon: 'text-orange-600',
                                    title: 'text-orange-900',
                                    subtitle: 'text-orange-700',
                                    description: 'text-orange-600'
                                  };
                                default:
                                  return {
                                    bg: 'bg-gray-50',
                                    border: 'border-gray-200',
                                    icon: 'text-gray-600',
                                    title: 'text-gray-900',
                                    subtitle: 'text-gray-700',
                                    description: 'text-gray-600'
                                  };
                              }
                            };
                            
                            const colors = getFileTypeColors(fileType);
                            
                            return (
                              <div 
                                key={index} 
                                className={`border rounded-lg p-4 ${colors.bg} ${colors.border}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <Download className={`w-5 h-5 ${colors.icon}`} />
                                    <div>
                                      <p className={`font-medium ${colors.title}`}>
                                        {fileType}
                                        {!fileExists && (
                                          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-1 rounded">파일 없음</span>
                                        )}
                                      </p>
                                      <p className={`text-sm ${colors.subtitle}`}>
                                        {file}
                                      </p>
                                      <p className={`text-xs ${colors.description}`}>
                                        {!fileExists 
                                          ? '파일이 NAS에서 확인되지 않습니다'
                                          : fileType === '메인버전'
                                            ? '메인 릴리즈 파일' 
                                            : isEncrypted 
                                              ? '암호화된 컴포넌트 파일' 
                                              : '컴포넌트 파일'}
                                      </p>
                                      {/* 파일 정보 표시 */}
                                      {fileExists && deploymentInfo?.fileInfoMap?.[file] && (
                                        <div className={`flex items-center space-x-3 text-xs mt-1 ${colors.description}`}>
                                          <span className="flex items-center">
                                            📦 {formatFileSize(deploymentInfo.fileInfoMap[file].size)}
                                          </span>
                                          <span className="flex items-center">
                                            📅 {formatFileDate(deploymentInfo.fileInfoMap[file].mtime)}
                                          </span>
                                        </div>
                                      )}
                                      {/* 디버깅용 */}
                                      {console.log('DeploymentDetailModal - File info debug:', file, deploymentInfo?.fileInfoMap?.[file])}
                                    </div>
                                  </div>
                                  <button 
                                    className={`px-3 py-1 rounded-md text-sm font-medium flex items-center whitespace-nowrap ${
                                      !fileExists || !deploymentInfo.directoryVerified
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : fileType === '메인버전'
                                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                          : fileType === '모로우'
                                            ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                            : fileType === '백엔드'
                                              ? 'bg-green-600 hover:bg-green-700 text-white'
                                              : fileType === '프런트엔드'
                                                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                                : 'bg-gray-600 hover:bg-gray-700 text-white'
                                    }`}
                                    disabled={!fileExists || !deploymentInfo.directoryVerified}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
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
                                        const fileType = file.startsWith('mr') ? 'morrow' : 
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
                                        const fileTypeLabel = file.startsWith('mr') ? 'Morrow' : 
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
                                        
                                        // 직접 다운로드 링크면 iframe으로, 공유 링크면 새 탭에서 열기
                                        if (isDirectDownload) {
                                          // 직접 다운로드 - iframe으로 다운로드하여 모달이 사라지지 않게 함
                                          const iframe = document.createElement('iframe');
                                          iframe.style.display = 'none';
                                          iframe.src = downloadUrl;
                                          document.body.appendChild(iframe);
                                          setTimeout(() => document.body.removeChild(iframe), 5000);
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
                          }) : 
                          /* 파일이 없을 때 메시지 표시 */
                          <div className="text-center py-8">
                            <div className="text-gray-500 font-noto-sans-kr">배포 파일이 없습니다.</div>
                          </div>}
                        </div>
                      </div>
                    </div>
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