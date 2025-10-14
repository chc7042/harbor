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
          'Authorization': `Bearer ${localStorage.getItem('token')}`
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
    console.log('fetchDeploymentInfo called with deployment:', deployment);
    if (!deployment) {
      console.log('No deployment, returning early');
      return;
    }
    
    console.log('Setting loadingDeploymentInfo to true');
    setLoadingDeploymentInfo(true);
    
    try {
      const url = `/api/deployments/deployment-info/${encodeURIComponent(deployment.project_name)}/${deployment.build_number}`;
      console.log('Making fetch request to:', url);
      
      // 2초 타임아웃을 추가하여 빠른 실패 보장
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      console.log('Response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          console.log('DeploymentInfo received:', data.data);
          console.log('downloadFile:', data.data.downloadFile);
          console.log('allFiles:', data.data.allFiles);
          setDeploymentInfo(data.data);
        }
      } else {
        // API 호출은 성공했지만 응답이 실패인 경우
        console.warn('Deployment info API returned non-success response:', response.status);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('Deployment info request timed out after 2 seconds');
      } else {
        console.error('Failed to fetch deployment info:', error);
      }
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
    console.log('useEffect triggered - isOpen:', isOpen, 'deployment:', deployment?.project_name, 'build:', deployment?.build_number);
    if (isOpen && deployment) {
      console.log('Calling fetchDeploymentInfo...');
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

  // Artifacts 탭 활성화 시 배포 정보 가져오기
  useEffect(() => {
    if (activeTab === 'artifacts' && isOpen && deployment && !deploymentInfo) {
      console.log('Artifacts tab activated, fetching deployment info...');
      fetchDeploymentInfo();
    }
  }, [activeTab, isOpen, deployment, deploymentInfo]);

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
                  <div className="h-full bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-sm overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
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
                          <span className={`ml-2 ${
                            log.level === 'SUCCESS' ? 'text-green-400' :
                            log.level === 'ERROR' ? 'text-red-400' :
                            log.level === 'WARN' ? 'text-yellow-400' :
                            'text-gray-100'
                          }`}>{log.message}</span>
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
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0)) ||
                      (!deploymentInfo?.directoryVerified)
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
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0)) ||
                      (!deploymentInfo?.directoryVerified)
                    }
                  >
                    <HardDrive className={`w-4 h-4 mr-2 ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0)) ||
                      (!deploymentInfo?.directoryVerified)
                        ? 'text-gray-400'
                        : ''
                    }`} />
                    {loadingDeploymentInfo 
                      ? '경로 확인중...' 
                      : (!deploymentInfo?.downloadFile && 
                         (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0))
                        ? '파일 없음'
                        : !deploymentInfo?.directoryVerified
                          ? 'NAS 접근 불가'
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
                          {/* 새로운 구조: deploymentInfo.artifacts 사용 (V, MR, FE, BE 타입별 카드) */}
                          {(deploymentInfo?.artifacts) ? 
                          /* deployment-info API에서 제공하는 artifacts 객체를 타입별 카드로 변환 */
                          Object.entries(deploymentInfo.artifacts)
                            .filter(([type, files]) => files && files.length > 0)
                            .sort(([typeA], [typeB]) => {
                              // 타입 정렬 순서: V > MR > FE > BE
                              const order = { 'V': 1, 'MR': 2, 'FE': 3, 'BE': 4 };
                              return (order[typeA] || 99) - (order[typeB] || 99);
                            })
                            .map(([type, files], index) => {
                            // 타입별 한국어 이름과 색상 매핑
                            const typeInfoMap = {
                              'V': { name: '메인버전', colors: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', title: 'text-blue-900', subtitle: 'text-blue-700' } },
                              'MR': { name: 'MR빌드', colors: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', title: 'text-green-900', subtitle: 'text-green-700' } },
                              'FE': { name: '프론트엔드', colors: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', title: 'text-purple-900', subtitle: 'text-purple-700' } },
                              'BE': { name: '백엔드', colors: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600', title: 'text-orange-900', subtitle: 'text-orange-700' } }
                            };
                            
                            const typeInfo = typeInfoMap[type] || { name: type, colors: { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600', title: 'text-gray-900', subtitle: 'text-gray-700' } };
                            const representativeFile = files[0];
                            const fileCount = files.length;
                            
                            return (
                              <div key={`${type}-${index}`} className={`border rounded-lg p-4 ${typeInfo.colors.bg} ${typeInfo.colors.border}`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <HardDrive className={`w-5 h-5 ${typeInfo.colors.icon}`} />
                                    <div>
                                      <p className={`font-medium ${typeInfo.colors.title}`}>
                                        {typeInfo.name}
                                        <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{fileCount}개 파일</span>
                                      </p>
                                      <p className={`text-sm ${typeInfo.colors.subtitle}`}>{representativeFile}</p>
                                      <p className={`text-xs ${typeInfo.colors.subtitle}`}>NAS에서 검색됨</p>
                                    </div>
                                  </div>
                                  <button className={`px-3 py-1 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700`}>
                                    다운로드
                                  </button>
                                </div>
                              </div>
                            );
                          }) : deploymentInfo?.allFiles && deploymentInfo.allFiles.length > 0 ? (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center space-x-3">
                                <HardDrive className="w-5 h-5 text-gray-600" />
                                <div>
                                  <p className="font-medium text-gray-900">메인버전 NAS 확인 메세지</p>
                                  <p className="text-sm text-gray-600">{deploymentInfo.allFiles.length}개 파일 발견</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="col-span-full flex flex-col items-center justify-center h-full min-h-[300px] text-gray-500">
                              <HardDrive className="w-12 h-12 text-gray-300 mb-4" />
                              <p className="text-center font-noto-sans-kr">배포 파일을 찾을 수 없습니다</p>
                            </div>
                          )}
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