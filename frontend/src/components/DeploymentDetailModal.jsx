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
  RefreshCw
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

  // 배포 데이터에서 아티팩트 정보 사용 (백엔드에서 이미 조회됨)
  const fetchArtifacts = async () => {
    if (!deployment) return;
    
    setLoadingArtifacts(true);
    
    // 배포 데이터에 아티팩트 정보가 있으면 사용
    if (deployment.artifacts && deployment.artifacts.length > 0) {
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
      
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(versionFolder)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
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
          setArtifacts(artifactFiles);
        }
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
    }
  }, [isOpen, deployment]);

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
    { id: 'overview', label: '개요', icon: Calendar },
    { id: 'logs', label: '로그', icon: Server },
    { id: 'artifacts', label: '아티팩트', icon: Download },
    { id: 'environment', label: '환경', icon: Server }
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


  const mockEnvironmentVars = [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'API_URL', value: 'https://api.harbor.com' },
    { key: 'DB_HOST', value: 'db.production.harbor.com' },
    { key: 'REDIS_URL', value: 'redis://cache.production.harbor.com:6379' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content max-w-4xl max-h-[90vh] overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-4">
            {getStatusIcon(deployment.status)}
            <div>
              <h2 className="text-xl font-semibold text-primary-900">
                {deployment.project_name}
              </h2>
              <p className="text-sm text-gray-600">
                빌드 #{deployment.build_number} • {deploymentDate.full}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 상태 배너 */}
        <div className={`px-6 py-4 border-b border-gray-200 ${getStatusColor(deployment.status)}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {getStatusIcon(deployment.status)}
              <div>
                <p className="font-medium">
                  배포 {deployment.status === 'success' ? '성공' :
                        deployment.status === 'failed' ? '실패' :
                        deployment.status === 'in_progress' ? '진행중' : '대기중'}
                </p>
                <p className="text-sm opacity-80">
                  소요 시간: {formatDuration(deployment.duration)}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button 
                className="btn-secondary text-sm opacity-50 cursor-not-allowed" 
                disabled
                title="재배포 기능은 현재 비활성화되어 있습니다"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                재배포
              </button>
              <button 
                className="btn-secondary text-sm"
                onClick={() => {
                  if (deployment.jenkins_url) {
                    window.open(deployment.jenkins_url, '_blank');
                  } else {
                    // Jenkins URL이 없는 경우 기본 Jenkins 빌드 URL 생성
                    const baseUrl = process.env.REACT_APP_JENKINS_URL || 'https://jenkins.roboetech.com';
                    const jenkinsUrl = `${baseUrl}/job/projects/job/${deployment.project_name.split('/')[0]}/job/${deployment.project_name.split('/')[1]}/${deployment.build_number}/`;
                    window.open(jenkinsUrl, '_blank');
                  }
                }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Jenkins 보기
              </button>
            </div>
          </div>
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
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* 기본 정보 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-primary-900">배포 정보</h3>

                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">빌드 번호:</span>
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                        #{deployment.build_number}
                      </span>
                      <button
                        onClick={() => copyToClipboard(deployment.build_number.toString(), 'build')}
                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {copySuccess === 'build' && (
                        <span className="text-xs text-green-600">복사됨!</span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3">
                      <Server className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">환경:</span>
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        deployment.environment === 'production'
                          ? 'bg-red-100 text-red-800'
                          : deployment.environment === 'staging'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {deployment.environment}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">배포자:</span>
                      <span className="text-sm">{deployment.deployed_by}</span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <GitBranch className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">브랜치:</span>
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                        {deployment.branch}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-primary-900">타임라인</h3>

                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm font-medium">배포 시작</p>
                        <p className="text-xs text-gray-500">{deploymentDate.full}</p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm font-medium">배포 완료</p>
                        <p className="text-xs text-gray-500">
                          {new Date(new Date(deployment.created_at).getTime() + deployment.duration * 1000).toLocaleString('ko-KR')}
                        </p>
                      </div>
                    </div>

                    <div className="pl-5 border-l-2 border-gray-200 ml-1 pt-2">
                      <p className="text-sm text-gray-600">
                        총 소요 시간: <span className="font-medium">{formatDuration(deployment.duration)}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 설명 */}
              {deployment.description && (
                <div>
                  <h3 className="text-lg font-medium text-primary-900 mb-3">설명</h3>
                  <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-lg">
                    {deployment.description}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-primary-900">배포 로그</h3>
                <button className="btn-secondary text-sm">
                  <Download className="w-4 h-4 mr-2" />
                  로그 다운로드
                </button>
              </div>

              <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
                {mockLogs.map((log, index) => (
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
                ))}
              </div>
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-primary-900">릴리즈 아티팩트</h3>

              <div className="space-y-3">
                {loadingArtifacts ? (
                  <div className="text-center py-8">
                    <div className="text-gray-500">아티팩트 로딩 중...</div>
                  </div>
                ) : artifacts.length === 0 ? (
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
                          // artifact.url이 이미 완전한 다운로드 URL인 경우 직접 사용
                          let downloadUrl = artifact.url;
                          
                          // 상대 경로인 경우 API 경로로 변환
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
                )}
              </div>
            </div>
          )}

          {activeTab === 'environment' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-primary-900">환경 변수</h3>

              <div className="space-y-2">
                {mockEnvironmentVars.map((envVar, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-sm font-medium text-primary-900">
                        {envVar.key}
                      </span>
                      <span className="text-gray-400">=</span>
                      <span className="font-mono text-sm text-gray-600">
                        {envVar.value}
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(`${envVar.key}=${envVar.value}`, `env-${index}`)}
                      className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeploymentDetailModal;