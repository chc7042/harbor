import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  GitBranch,
  Hash,
  ExternalLink,
  Copy,
  CheckCircle,
  Download,
  RefreshCw,
  HardDrive,
  ChevronDown
} from 'lucide-react';
import { downloadFile } from '../services/api';

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

const ProjectDetailModal = ({
  deployment,
  isOpen,
  onClose,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState('logs');
  const [copySuccess, setCopySuccess] = useState('');
  const [currentDeploymentId, setCurrentDeploymentId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [deploymentInfo, setDeploymentInfo] = useState(null);
  const [loadingDeploymentInfo, setLoadingDeploymentInfo] = useState(false);
  const [selectedJobType, setSelectedJobType] = useState('mr'); // 기본값: 모로우
  const [jobLogs, setJobLogs] = useState({}); // 각 job별 로그 캐시
  const [downloadStatus, setDownloadStatus] = useState(null); // 다운로드 상태 관리

  const fetchDeploymentInfo = async () => {
    if (!deployment) return;
    
    console.log('ProjectDetailModal deployment object:', deployment);
    console.log('project_name:', deployment.project_name);
    console.log('build_number:', deployment.build_number);
    
    setLoadingDeploymentInfo(true);
    try {
      const response = await fetch(`/api/deployments/deployment-info/${encodeURIComponent(deployment.project_name)}/${deployment.build_number}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setDeploymentInfo(data.data);
      } else {
        console.error('Failed to fetch deployment info');
      }
    } catch (error) {
      console.error('Error fetching deployment info:', error);
    } finally {
      setLoadingDeploymentInfo(false);
    }
  };

  const fetchLogs = async (jobType = selectedJobType) => {
    if (!deployment) return;
    
    // 이미 해당 job의 로그가 캐시되어 있다면 사용
    if (jobLogs[jobType]) {
      setLogs(jobLogs[jobType]);
      return;
    }
    
    setLoadingLogs(true);
    try {
      let jobProjectName;
      
      if (jobType === 'mr') {
        // 모로우는 실제 데이터 사용 - 기존 deployment.project_name 사용
        jobProjectName = deployment.project_name;
      } else {
        // BE, FS는 아직 실제 Jenkins 데이터가 없으므로 빈 로그 반환
        console.log(`${jobType} job은 아직 실제 Jenkins 데이터가 준비되지 않았습니다.`);
        setLogs([]);
        setJobLogs(prev => ({
          ...prev,
          [jobType]: []
        }));
        return;
      }
      
      const response = await fetch(`/api/deployments/logs/${encodeURIComponent(jobProjectName)}/${deployment.build_number}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const fetchedLogs = data.data || [];
        
        // 로그 캐시에 저장
        setJobLogs(prev => ({
          ...prev,
          [jobType]: fetchedLogs
        }));
        
        setLogs(fetchedLogs);
      } else {
        console.error('Failed to fetch logs for job:', jobType);
        setLogs([]);
      }
    } catch (error) {
      console.error('Error fetching logs for job:', jobType, error);
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatFileDate = (mtime) => {
    if (!mtime) return '알 수 없음';
    try {
      const date = new Date(mtime * 1000); // Unix timestamp to JS Date
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '알 수 없음';
    }
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
      setJobLogs({});
      setSelectedJobType('mr');
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
      setJobLogs({});
      setSelectedJobType('mr');
    }
  }, [isOpen, deployment, currentDeploymentId]);

  // 로그 탭 활성화 시 로그 가져오기
  useEffect(() => {
    if (activeTab === 'logs' && isOpen && deployment && currentDeploymentId === deployment.id) {
      fetchLogs(selectedJobType);
    }
  }, [activeTab, isOpen, deployment, currentDeploymentId, selectedJobType]);
  
  // Job 타입 변경 시 해당 로그 가져오기
  useEffect(() => {
    if (activeTab === 'logs' && isOpen && deployment) {
      fetchLogs(selectedJobType);
    }
  }, [selectedJobType]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess('복사됨!');
      setTimeout(() => setCopySuccess(''), 2000);
    }).catch(err => {
      console.error('복사 실패:', err);
      setCopySuccess('복사 실패');
      setTimeout(() => setCopySuccess(''), 2000);
    });
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'success': return 'text-green-600 bg-green-100';
      case 'failure': case 'failed': return 'text-red-600 bg-red-100';
      case 'building': case 'in_progress': return 'text-blue-600 bg-blue-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'aborted': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  if (!isOpen || !deployment) return null;

  return (
    <div 
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 ${className}`}
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
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {deployment.project_name}
              </h2>
              <div className="flex items-center space-x-4 mt-1 text-sm text-gray-600">
                <div className="flex items-center space-x-1">
                  <Hash className="w-4 h-4" />
                  <span>빌드 #{deployment.build_number}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Calendar className="w-4 h-4" />
                  <span>{formatDate(deployment.created_at)}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Clock className="w-4 h-4" />
                  <span>{deployment.duration || 'N/A'}</span>
                </div>
                {deployment.user_name && (
                  <div className="flex items-center space-x-1">
                    <User className="w-4 h-4" />
                    <span>{deployment.user_name}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(deployment.status)}`}>
              {deployment.status}
            </span>
            
            {deployment.jenkins_url && (
              <a 
                href={deployment.jenkins_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                title="Jenkins에서 보기"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-sm">Jenkins</span>
              </a>
            )}

            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
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
{tab === 'logs' ? '로그' : '배포 버전'}
              </button>
            ))}
          </nav>
        </div>

        {/* 탭 내용 */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden" style={{ height: 'calc(90vh - 200px)' }}>
          {activeTab === 'logs' && (
            <div className="flex-1 flex flex-col space-y-4 h-full">
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center space-x-4">
                  <h3 className="text-lg font-medium text-gray-900">빌드 로그</h3>
                  
                  {/* Job 타입 선택 드롭다운 */}
                  <div className="relative">
                    <select
                      value={selectedJobType}
                      onChange={(e) => setSelectedJobType(e.target.value)}
                      className="appearance-none bg-white border border-gray-300 rounded-md px-3 py-2 pr-8 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="mr">모로우 (MR)</option>
                      <option value="fs">프런트엔드 (FS)</option>
                      <option value="be">백엔드 (BE)</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                
                <button
                  onClick={() => fetchLogs(selectedJobType)}
                  disabled={loadingLogs}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loadingLogs ? 'animate-spin' : ''}`} />
                  새로고침
                </button>
              </div>

              <div className="flex-1 flex flex-col space-y-3 min-h-0">
                <div className="text-sm text-gray-600 flex-shrink-0">
                  {selectedJobType === 'mr' ? '모로우 (MR)' : 
                   selectedJobType === 'fs' ? '프런트엔드 (FS)' : '백엔드 (BE)'} 빌드 로그
                </div>
                <div className="flex-1 flex flex-col min-h-0" ref={(el) => {
                  if (el) {
                    console.log(`로그 컨테이너 외부 높이: ${el.clientHeight}px, selectedJobType: ${selectedJobType}, logs.length: ${logs.length}, loadingLogs: ${loadingLogs}`);
                  }
                }}>
                  <div className="h-full bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-y-auto" ref={(el) => {
                    if (el) {
                      console.log(`로그 컨테이너 내부 높이: ${el.clientHeight}px, selectedJobType: ${selectedJobType}, logs.length: ${logs.length}, loadingLogs: ${loadingLogs}`);
                    }
                  }}>
                  {loadingLogs ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-gray-400">
                        {selectedJobType === 'mr' ? '모로우' : 
                         selectedJobType === 'fs' ? '프런트엔드' : '백엔드'} 로그 로딩 중...
                      </div>
                    </div>
                  ) : logs.length > 0 ? (
                    logs.map((log, index) => (
                      <div key={index} className="whitespace-pre-wrap break-words">
                        {log.message}
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center text-gray-400">
                        <div>
                          {selectedJobType === 'mr' ? '모로우' : 
                           selectedJobType === 'fs' ? '프런트엔드' : '백엔드'} 로그가 없습니다.
                        </div>
                        <div className="text-sm mt-1">
                          {selectedJobType === 'mr' 
                            ? '해당 job의 빌드가 완료되지 않았거나 로그가 생성되지 않았습니다.'
                            : '아직 실제 Jenkins 데이터가 연동되지 않았습니다.'}
                        </div>
                      </div>
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
                <h3 className="text-lg font-medium text-gray-900">배포 버전</h3>

                <div className="flex items-center space-x-4">
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

                  <button 
                    className={`text-sm flex items-center whitespace-nowrap ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0))
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-300 opacity-60 hover:bg-gray-300 hover:text-gray-500 px-4 py-2 rounded-md'
                        : 'btn-secondary'
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // 실제 배포 경로가 있을 때만 열기
                      const shareUrl = deploymentInfo?.synologyShareUrl;
                      
                      if (shareUrl) {
                        window.open(shareUrl, '_blank');
                      }
                    }}
                    disabled={
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0))
                    }
                  >
                    <HardDrive className={`w-4 h-4 mr-2 ${
                      loadingDeploymentInfo || 
                      (!deploymentInfo?.downloadFile && 
                       (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0))
                        ? 'text-gray-400'
                        : ''
                    }`} />
                    {loadingDeploymentInfo 
                      ? '경로 확인중...' 
                      : (!deploymentInfo?.downloadFile && 
                         (!deploymentInfo?.allFiles || deploymentInfo.allFiles.length === 0))
                        ? '파일 없음'
                        : '공유 폴더 열기'
                    }
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
                {loadingDeploymentInfo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-gray-500">배포 파일 로딩 중...</div>
                  </div>
                ) : (
                  <>
                    {/* 메인 버전 섹션 */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-gray-700 border-b pb-2">메인 버전</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* 실제 V 파일이 있으면 실제 V 파일 표시 */}
                        {(deploymentInfo?.allFiles && deploymentInfo.allFiles.some(file => file.startsWith('V'))) ? (
                          deploymentInfo.allFiles
                            .filter(file => file.startsWith('V'))
                            .map((file, index) => {
                              const isEncrypted = file.includes('.enc.');
                              const fileExists = deploymentInfo.verifiedFiles ? deploymentInfo.verifiedFiles.includes(file) : true;
                              const fileTypeColor = 'bg-blue-100 text-blue-800';
                              
                              return (
                                <div
                                  key={index}
                                  className={`p-4 rounded-lg border-2 transition-all duration-200 hover:shadow-lg ${
                                    fileExists ? 'border-blue-300 bg-blue-50 hover:border-blue-400 hover:bg-blue-100' : 'border-red-300 bg-red-50 hover:border-red-400'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center space-x-2 mb-2">
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${fileTypeColor}`}>
                                          메인버전
                                        </span>
                                        {isEncrypted && (
                                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                                            암호화
                                          </span>
                                        )}
                                        {!fileExists && (
                                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                                            파일없음
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-sm font-medium text-gray-900 mb-1 break-all">
                                        {file}
                                      </p>
                                      {/* 파일 정보 표시 */}
                                      {deploymentInfo?.fileInfoMap?.[file] && (
                                        <div className="flex items-center space-x-3 text-xs text-gray-500 mt-1">
                                          <span className="flex items-center">
                                            📦 {formatFileSize(deploymentInfo.fileInfoMap[file].size)}
                                          </span>
                                          <span className="flex items-center">
                                            📅 {formatFileDate(deploymentInfo.fileInfoMap[file].mtime)}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    
                                    <div className="flex items-center space-x-2 ml-2">
                                      {fileExists ? (
                                        <button
                                          className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200"
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            
                                            try {
                                              console.log('Download attempt for file:', file);
                                              console.log('Deployment data:', {
                                                project_name: deployment.project_name,
                                                build_number: deployment.build_number,
                                                version: deployment.version,
                                                artifacts: deployment.artifacts
                                              });
                                              
                                              // First, try to find the file in deployment.artifacts if available
                                              let downloadUrl = null;
                                              if (deployment.artifacts && deployment.artifacts.length > 0) {
                                                const artifact = deployment.artifacts.find(a => a.name === file || a.filename === file);
                                                console.log('Found artifact:', artifact);
                                                if (artifact && artifact.downloadUrl) {
                                                  downloadUrl = artifact.downloadUrl;
                                                  console.log('Using artifact downloadUrl:', downloadUrl);
                                                }
                                              }
                                              
                                              // If not found in artifacts, use deployment info from backend API
                                              if (!downloadUrl) {
                                                console.log('No artifact downloadUrl found, using deployment info from API');
                                                
                                                // Use deployment info from backend which contains the correct NAS path and date
                                                if (deploymentInfo && deploymentInfo.nasPath) {
                                                  // Extract the actual NAS path from deployment info
                                                  let nasPath = deploymentInfo.nasPath;
                                                  
                                                  // Convert Windows path to Unix path for API consumption
                                                  if (nasPath.includes('\\\\nas.roboetech.com\\')) {
                                                    nasPath = nasPath
                                                      .replace('\\\\nas.roboetech.com\\', '/nas/')
                                                      .replace(/\\/g, '/');
                                                  }
                                                  
                                                  // Ensure it starts with /nas/release_version/
                                                  if (!nasPath.startsWith('/nas/release_version/')) {
                                                    nasPath = '/nas/release_version/' + nasPath.replace(/^\/nas\//, '');
                                                  }
                                                  
                                                  const downloadPath = `${nasPath}/${file}`;
                                                  downloadUrl = `/files/download?path=${encodeURIComponent(downloadPath)}`;
                                                  
                                                  console.log('Using deployment info path:', {
                                                    originalNasPath: deploymentInfo.nasPath,
                                                    convertedPath: nasPath,
                                                    fullDownloadPath: downloadPath,
                                                    downloadUrl: downloadUrl
                                                  });
                                                } else {
                                                  // Fallback to manual construction only if deployment info is not available
                                                  console.log('No deployment info available, falling back to manual construction');
                                                  // Extract version from project name (e.g., "3.0.0/mr3.0.0_release" -> "3.0.0")
                                                  const versionMatch = deployment.project_name?.match(/^(\d+\.\d+\.\d+)/) || 
                                                                     deployment.version?.match(/(\d+\.\d+\.\d+)/) ||
                                                                     ['', '3.0.0']; // fallback
                                                  const version = versionMatch[1];
                                                  
                                                  // Use version-specific fallback dates
                                                  const versionFallbacks = {
                                                    '1.0.0': '240904',
                                                    '1.0.1': '250407', 
                                                    '1.1.0': '241204',
                                                    '1.2.0': '250929',
                                                    '2.0.0': '250116', // Correct date for 2.0.0
                                                    '3.0.0': '250310', // Correct date for 3.0.0
                                                    '4.0.0': '250904'
                                                  };
                                                  const fallbackDate = versionFallbacks[version] || '250310';
                                                  
                                                  const downloadPath = `/nas/release_version/release/product/mr${version}/${fallbackDate}/${deployment.build_number}/${file}`;
                                                  downloadUrl = `/files/download?path=${encodeURIComponent(downloadPath)}`;
                                                  
                                                  console.log('Fallback construction:', {
                                                    version,
                                                    fallbackDate,
                                                    build_number: deployment.build_number,
                                                    file,
                                                    fullPath: downloadPath
                                                  });
                                                }
                                              }
                                              
                                              // 다운로드 시작
                                              let result = await downloadFile(downloadUrl, file, (progress) => {
                                                setDownloadStatus(progress);
                                                
                                                // 토스트 알림으로 상태 표시
                                                if (progress.type === 'start') {
                                                  console.log('📥 다운로드 시작:', file);
                                                } else if (progress.type === 'progress') {
                                                  console.log(`📊 다운로드 진행률: ${progress.progress}% (${Math.round(progress.loaded/1024/1024)}MB/${Math.round(progress.total/1024/1024)}MB)`);
                                                } else if (progress.type === 'complete') {
                                                  console.log('✅다운로드 완료:', file);
                                                } else if (progress.type === 'error') {
                                                  console.error('❌ 다운로드 실패:', progress.message);
                                                }
                                              });
                                              
                                              // If the download failed, try to find the file by name in database
                                              console.log('Download result:', result);
                                              if (!result.success) {
                                                console.log('Download failed, attempting search fallback for file:', file);
                                                try {
                                                  // Try to get the file by searching the artifacts API
                                                  const searchResponse = await fetch(`/files/search?filename=${encodeURIComponent(file)}`, {
                                                    headers: {
                                                      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                                                    }
                                                  });
                                                  
                                                  console.log('Search API response status:', searchResponse.status);
                                                  
                                                  if (searchResponse.ok) {
                                                    const searchData = await searchResponse.json();
                                                    console.log('Search API data:', searchData);
                                                    
                                                    if (searchData.success && searchData.data && searchData.data.length > 0) {
                                                      const foundFile = searchData.data[0];
                                                      const correctPath = `/nas/release_version/${foundFile.nas_path}`;
                                                      const correctDownloadUrl = `/files/download?path=${encodeURIComponent(correctPath)}`;
                                                      console.log('Found correct path via search:', correctPath);
                                                      console.log('Retrying download with correct URL:', correctDownloadUrl);
                                                      result = await downloadFile(correctDownloadUrl, file);
                                                    } else {
                                                      console.log('No file found in search results');
                                                    }
                                                  } else {
                                                    console.log('Search API request failed with status:', searchResponse.status);
                                                    const errorText = await searchResponse.text();
                                                    console.log('Search API error:', errorText);
                                                  }
                                                } catch (searchError) {
                                                  console.error('Search fallback failed:', searchError);
                                                }
                                              }
                                              
                                              if (!result.success) {
                                                // Try to get available files for this deployment to suggest alternatives
                                                try {
                                                  const availableResponse = await fetch(`/api/deployments`, {
                                                    headers: {
                                                      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                                                    }
                                                  });
                                                  
                                                  if (availableResponse.ok) {
                                                    const deployData = await availableResponse.json();
                                                    const currentDeployment = deployData.data?.find(d => 
                                                      d.project_name === deployment.project_name && 
                                                      d.build_number === deployment.build_number
                                                    );
                                                    
                                                    if (currentDeployment?.artifacts && currentDeployment.artifacts.length > 0) {
                                                      const availableFiles = currentDeployment.artifacts.map(a => a.name || a.filename).join(', ');
                                                      alert(`다운로드 실패: ${result.error}\n\n사용 가능한 파일: ${availableFiles}`);
                                                    } else {
                                                      alert(`다운로드 실패: ${result.error}\n\n이 배포에는 다운로드 가능한 파일이 없습니다.`);
                                                    }
                                                  } else {
                                                    alert(`다운로드 실패: ${result.error}`);
                                                  }
                                                } catch (suggestionError) {
                                                  console.error('Failed to get file suggestions:', suggestionError);
                                                  alert(`다운로드 실패: ${result.error}`);
                                                }
                                              }
                                            } catch (error) {
                                              console.error('Download error:', error);
                                              alert('다운로드 중 오류가 발생했습니다.');
                                            }
                                          }}
                                        >
                                          <Download className="w-4 h-4 mr-1.5" />
                                          다운로드
                                        </button>
                                      ) : (
                                        <span className="text-xs text-red-500">파일 없음</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                        ) : (
                          /* 실제 V 파일이 없어도 기본 메인 버전 카드 표시 */
                          [(
                            <div
                              key="default-main-version"
                              className="p-4 rounded-lg border-2 border-blue-300 bg-blue-50 transition-all duration-200 hover:shadow-lg hover:border-blue-400 hover:bg-blue-100"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                                      메인버전
                                    </span>
                                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                      NAS 확인 필요
                                    </span>
                                  </div>
                                  <p className="text-sm font-medium text-gray-900 mb-1">
                                    V{deployment.version || deployment.project_name.match(/(\d+\.\d+\.\d+)/)?.[1] || '1.0.0'} 메인 버전
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    실제 배포 파일은 NAS에서 확인하세요
                                  </p>
                                </div>
                                
                                <div className="flex items-center space-x-2 ml-2">
                                  <button
                                    className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      
                                      // 공유 폴더 열기
                                      if (deploymentInfo?.synologyShareUrl) {
                                        window.open(deploymentInfo.synologyShareUrl, '_blank');
                                      }
                                    }}
                                  >
                                    <HardDrive className="w-4 h-4 mr-1.5" />
                                    NAS 확인
                                  </button>
                                </div>
                              </div>
                            </div>
                          )]
                        )}
                      </div>
                    </div>

                    {/* 배포 파일 섹션 (V 파일 제외) */}
                    <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
                      <h4 className="text-sm font-medium text-gray-700 border-b pb-2 flex-shrink-0">배포 파일</h4>
                      <div className="flex-1 overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* 실제 파일만 표시 (V 파일 제외) - 목 데이터 사용 안함 */}
                          {(deploymentInfo?.allFiles && deploymentInfo.allFiles.length > 0) ? 
                            deploymentInfo.allFiles
                              .filter(file => !file.startsWith('V')) // V 파일 제외
                              .sort((a, b) => {
                                // 모로우, 백엔드, 프런트엔드 순서로 정렬
                                const getOrder = (file) => {
                                  if (file.startsWith('mr')) return 1; // Morrow
                                  if (file.startsWith('be')) return 2; // Backend  
                                  if (file.startsWith('fe')) return 3; // Frontend
                                  return 4; // 기타
                                };
                                return getOrder(a) - getOrder(b);
                              }).map((file, index) => {
                                const isEncrypted = file.includes('.enc.');
                                const fileType = file.startsWith('mr') ? '모로우' :
                                                file.startsWith('be') ? '백엔드' :
                                                file.startsWith('fe') ? '프런트엔드' : '기타';
                                
                                // 파일이 실제로 NAS에 존재하는지 확인
                                const fileExists = deploymentInfo.verifiedFiles ? deploymentInfo.verifiedFiles.includes(file) : true;
                                
                                // 파일 타입별 색상 정의
                                const getFileTypeColors = (fileType) => {
                                  if (!fileExists) return {
                                    bg: 'bg-red-50',
                                    border: 'border-red-200',
                                    title: 'text-red-900',
                                    subtitle: 'text-red-700',
                                    description: 'text-red-600'
                                  };
                                  
                                  switch (fileType) {
                                    case '모로우':
                                      return {
                                        bg: 'bg-purple-50',
                                        border: 'border-purple-200',
                                        title: 'text-purple-900',
                                        subtitle: 'text-purple-700',
                                        description: 'text-purple-600'
                                      };
                                    case '백엔드':
                                      return {
                                        bg: 'bg-green-50',
                                        border: 'border-green-200',
                                        title: 'text-green-900',
                                        subtitle: 'text-green-700',
                                        description: 'text-green-600'
                                      };
                                    case '프런트엔드':
                                      return {
                                        bg: 'bg-orange-50',
                                        border: 'border-orange-200',
                                        title: 'text-orange-900',
                                        subtitle: 'text-orange-700',
                                        description: 'text-orange-600'
                                      };
                                    default:
                                      return {
                                        bg: 'bg-gray-50',
                                        border: 'border-gray-200',
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
                                        <Download className={`w-5 h-5 ${colors.description}`} />
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
                                        onClick={async (e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (!fileExists || !deploymentInfo.directoryVerified) {
                                            alert('파일이 NAS에 존재하지 않아 다운로드할 수 없습니다.');
                                            return;
                                          }
                                          // 실제 파일명을 기반으로 다운로드 링크 찾기
                                          const fileDownloadInfo = deploymentInfo.fileDownloadLinks?.[file];
                                          const downloadUrl = fileDownloadInfo?.downloadUrl ||
                                                            deploymentInfo.synologyShareUrl;
                                          
                                          if (downloadUrl) {
                                            const isDirectDownload = fileDownloadInfo?.isDirectDownload || false;
                                            
                                            // 직접 다운로드 링크면 authenticated download API 사용, 공유 링크면 새 탭에서 열기
                                            if (isDirectDownload) {
                                              // 직접 다운로드 - API 서비스를 통해 인증된 다운로드
                                              try {
                                                const fileName = downloadUrl.split('/').pop() || 'download';
                                                await downloadFile(downloadUrl, fileName, (progress) => {
                                                  console.log('Download progress:', progress);
                                                });
                                              } catch (error) {
                                                console.error('Download failed:', error);
                                                alert('다운로드 중 오류가 발생했습니다.');
                                              }
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
                              /* 실제 파일이 없으면 메시지 표시 - 목 데이터 사용 안함 */
                              [(
                                <div 
                                  key="no-files-message"
                                  className="col-span-full flex flex-col items-center justify-center py-12"
                                >
                                  <p className="text-gray-500 text-lg font-medium mb-2">배포 파일이 없습니다.</p>
                                  <p className="text-sm text-gray-400">
                                    실제 배포가 완료된 후 파일이 표시됩니다.
                                  </p>
                                </div>
                              )]}
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

export default ProjectDetailModal;