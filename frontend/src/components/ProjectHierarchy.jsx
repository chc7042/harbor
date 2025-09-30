import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  PlayCircle,
  Tag,
  Play,
  Package,
  ArrowRight,
  Edit3,
  Save,
  X as XIcon,
  MessageSquare,
  User
} from 'lucide-react';
import ProjectDetailModal from './ProjectDetailModal';

const ProjectHierarchy = ({ 
  projects = [], 
  deployments = [], 
  onJobClick,
  onDeploymentClick,
  className = '' 
}) => {
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [memos, setMemos] = useState({});
  const [editingMemo, setEditingMemo] = useState(null);
  const [memoText, setMemoText] = useState('');
  
  // 디버깅용 로그
  console.log('ProjectHierarchy props:', { projects, deployments });

  const toggleProject = (projectName) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectName)) {
      newExpanded.delete(projectName);
    } else {
      newExpanded.add(projectName);
    }
    setExpandedProjects(newExpanded);
  };

  const getJobStatus = (job) => {
    if (!job.lastBuild) return 'no_builds';
    return job.lastBuild.result === 'SUCCESS' ? 'success' : 
           job.lastBuild.result === 'FAILURE' ? 'failed' : 
           job.lastBuild.result === null ? 'in_progress' : 'unknown';
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'no_builds':
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
      default:
        return <div className="w-4 h-4 bg-gray-300 rounded-full" />;
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      success: 'bg-green-100 text-green-800 border-green-200',
      failed: 'bg-red-100 text-red-800 border-red-200',
      in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
      no_builds: 'bg-gray-100 text-gray-600 border-gray-200',
      unknown: 'bg-gray-100 text-gray-600 border-gray-200'
    };
    
    const labels = {
      success: '성공',
      failed: '실패',
      in_progress: '진행중',
      no_builds: '빌드없음',
      unknown: '알수없음'
    };

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${styles[status] || styles.unknown}`}>
        {labels[status] || status}
      </span>
    );
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return '-';
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 프로젝트의 작업들을 기반으로 배포 버전 카드 생성
  const createDeploymentCards = (project) => {
    if (!project.jobs || project.jobs.length === 0) return [];
    
    const deploymentCards = [];
    
    // 버전 정보 추출 (예: "3.0.0" 또는 "2.0.0")
    const versionMatch = project.name.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : project.name;
    
    // 1. V 파일 카드 생성 (메인 버전 파일 - 최우선)
    const mrJob = project.jobs.find(job => job.name.includes('mr') && job.name.includes('_release'));
    if (mrJob && mrJob.lastBuild && mrJob.lastBuild.number) {
      const vFileDeployment = {
        id: `${project.name}-V${version}-${mrJob.lastBuild.number}`,
        project_name: `${project.name}/mr${version}_release`,
        build_number: mrJob.lastBuild.number,
        status: mrJob.lastBuild.result === 'SUCCESS' ? 'success' : 
                mrJob.lastBuild.result === 'FAILURE' ? 'failed' : 
                mrJob.lastBuild.result === null ? 'in_progress' : 'unknown',
        created_at: mrJob.lastBuild.timestamp,
        duration: Math.floor((mrJob.lastBuild.duration || 0) / 1000),
        environment: 'production',
        deployed_by: 'Jenkins',
        branch: mrJob.lastBuild.branch || 'main',
        jenkins_url: mrJob.url,
        cardType: 'main',
        version: version
      };
      
      deploymentCards.push({
        title: `V${version} 메인 버전`,
        subtitle: `빌드 #${mrJob.lastBuild.number}`,
        deployment: vFileDeployment,
        timestamp: mrJob.lastBuild.timestamp,
        priority: 1, // 최우선
        cardType: 'main'
      });
    }
    
    // MR, FS 컴포넌트 카드는 제거됨 - 메인 버전만 표시
    
    // 메인 버전 카드들을 타임스탬프 순으로 정렬
    return deploymentCards.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
  };

  // 메모 관리 함수들
  const getCurrentUser = () => {
    // localStorage나 context에서 현재 사용자 정보 가져오기
    return localStorage.getItem('username') || 'admin';
  };

  const loadMemos = () => {
    const savedMemos = localStorage.getItem('projectMemos');
    if (savedMemos) {
      setMemos(JSON.parse(savedMemos));
    }
  };

  const saveMemos = (newMemos) => {
    localStorage.setItem('projectMemos', JSON.stringify(newMemos));
    setMemos(newMemos);
  };

  const handleStartEditMemo = (deploymentId) => {
    setEditingMemo(deploymentId);
    const currentMemo = memos[deploymentId];
    setMemoText(currentMemo ? currentMemo.text : '');
  };

  const handleSaveMemo = (deploymentId) => {
    const newMemos = {
      ...memos,
      [deploymentId]: {
        text: memoText,
        author: getCurrentUser(),
        timestamp: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    saveMemos(newMemos);
    setEditingMemo(null);
    setMemoText('');
  };

  const handleCancelMemo = () => {
    setEditingMemo(null);
    setMemoText('');
  };

  const handleDeploymentCardClick = (deployment) => {
    console.log('ProjectHierarchy - handleDeploymentCardClick deployment:', deployment);
    console.log('ProjectHierarchy - project_name:', deployment.project_name);
    console.log('ProjectHierarchy - build_number:', deployment.build_number);
    
    setSelectedDeployment(deployment);
    setIsModalOpen(true);
    
    // 기존 onDeploymentClick도 호출 (호환성)
    if (onDeploymentClick) {
      onDeploymentClick(deployment);
    }
  };

  useEffect(() => {
    loadMemos();
  }, []);

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
      <div className="p-4">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          프로젝트 계층 구조 ({projects.length}개 프로젝트)
        </h3>
        
        <div className="space-y-1">
          {projects.map((project) => {
            const isExpanded = expandedProjects.has(project.name);
            const hasJobs = project.jobs && project.jobs.length > 0;
            
            return (
              <div key={project.name} className="border border-gray-200 rounded-md">
                {/* 프로젝트 헤더 */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleProject(project.name)}
                >
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      {hasJobs && (
                        <button className="text-gray-400 hover:text-gray-600">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      
                      {isExpanded ? (
                        <FolderOpen className="w-5 h-5 text-blue-500" />
                      ) : (
                        <Folder className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">{project.name}</h4>
                      <p className="text-xs text-gray-500">
                        {hasJobs ? `${project.jobs.length}개 작업` : '작업 없음'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {hasJobs && (
                      <span className="text-sm text-gray-500">
                        총 {project.jobs.length}개 작업
                      </span>
                    )}
                  </div>
                </div>

                {/* 작업 목록 테이블 */}
                {isExpanded && hasJobs && (
                  <div className="border-t border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              작업 이름
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              상태
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              마지막 빌드
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              빌드 번호
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              소요 시간
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              액션
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {project.jobs.map((job) => {
                            const status = getJobStatus(job);
                            const lastBuild = job.lastBuild;
                            
                            return (
                              <tr 
                                key={job.fullName} 
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => onJobClick && onJobClick(job)}
                              >
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="flex items-center space-x-2">
                                    {getStatusIcon(status)}
                                    <span className="text-sm font-medium text-gray-900">
                                      {job.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center">
                                  {getStatusBadge(status)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">
                                  {lastBuild ? formatTimestamp(lastBuild.timestamp) : '-'}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">
                                  <div className="flex items-center justify-center space-x-1">
                                    <Tag className="w-3 h-3" />
                                    <span>#{lastBuild?.number || '-'}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">
                                  <div className="flex items-center justify-center space-x-1">
                                    <Clock className="w-3 h-3" />
                                    <span>{lastBuild ? formatDuration(lastBuild.duration) : '-'}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">
                                  {job.url && (
                                    <a
                                      href={job.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-400 hover:text-blue-500 transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Jenkins에서 보기"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 배포버전 카드들 */}
                    <div className="border-t border-gray-200 bg-gray-50 p-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">배포 버전</h4>
                      <div className="space-y-4">
                        {createDeploymentCards(project).map((card, index) => {
                          const isMainCard = card.cardType === 'main';
                          const cardStyle = isMainCard 
                            ? 'bg-blue-50 border-blue-200 hover:border-blue-400 hover:bg-blue-100'
                            : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm';
                          const iconColor = isMainCard ? 'text-blue-600' : 'text-blue-500';
                          const titleColor = isMainCard ? 'text-blue-900 font-semibold' : 'text-gray-900 font-medium';
                          const deploymentId = card.deployment.id;
                          const currentMemo = memos[deploymentId];
                          const isEditing = editingMemo === deploymentId;
                          
                          return (
                            <div key={index} className="space-y-3">
                              {/* 배포 카드 */}
                              <div
                                className={`rounded-lg border p-3 cursor-pointer transition-all duration-200 ${cardStyle}`}
                                onClick={() => handleDeploymentCardClick(card.deployment)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    <Package className={`w-4 h-4 ${iconColor}`} />
                                    <div>
                                      <p className={`text-sm ${titleColor}`}>{card.title}</p>
                                      <p className={`text-xs ${isMainCard ? 'text-blue-600' : 'text-gray-500'}`}>
                                        {card.subtitle}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    {getStatusIcon(card.deployment.status)}
                                    <ArrowRight className="w-3 h-3 text-gray-400" />
                                  </div>
                                </div>
                                <div className="mt-2 text-xs text-gray-400">
                                  {card.timestamp ? formatTimestamp(card.timestamp) : '-'}
                                </div>
                              </div>

                              {/* 메모 섹션 */}
                              <div className="bg-white border border-gray-200 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-1">
                                    <MessageSquare className="w-3 h-3 text-gray-400" />
                                    <span className="text-xs font-medium text-gray-600">메모</span>
                                  </div>
                                  {!isEditing && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStartEditMemo(deploymentId);
                                      }}
                                      className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                      <span>편집</span>
                                    </button>
                                  )}
                                </div>

                                {isEditing ? (
                                  <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                    <textarea
                                      value={memoText}
                                      onChange={(e) => setMemoText(e.target.value)}
                                      placeholder="배포에 대한 메모를 입력하세요..."
                                      className="w-full h-16 p-2 text-xs border border-gray-300 rounded-md bg-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent resize-none"
                                      autoFocus
                                    />
                                    <div className="flex items-center space-x-2">
                                      <button
                                        onClick={() => handleSaveMemo(deploymentId)}
                                        className="flex items-center space-x-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                                      >
                                        <Save className="w-3 h-3" />
                                        <span>저장</span>
                                      </button>
                                      <button
                                        onClick={handleCancelMemo}
                                        className="flex items-center space-x-1 px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors"
                                      >
                                        <XIcon className="w-3 h-3" />
                                        <span>취소</span>
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    {currentMemo ? (
                                      <div>
                                        <div className="text-xs text-gray-700 mb-1">
                                          {currentMemo.text}
                                        </div>
                                        <div className="flex items-center space-x-2 text-xs text-gray-400">
                                          <div className="flex items-center space-x-1">
                                            <User className="w-3 h-3" />
                                            <span>{currentMemo.author}</span>
                                          </div>
                                          <span>•</span>
                                          <span>{formatTimestamp(currentMemo.timestamp)}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-400 italic">
                                        메모가 없습니다. 편집 버튼을 클릭하여 메모를 추가하세요.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {projects.length === 0 && (
          <div className="text-center py-6 text-gray-500">
            <Folder className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">프로젝트가 없습니다.</p>
            <p className="text-xs mt-1">Jenkins 서버에서 프로젝트 정보를 가져오는 중이거나 프로젝트가 설정되지 않았습니다.</p>
          </div>
        )}
      </div>

      {/* 배포 상세 모달 */}
      <ProjectDetailModal
        key={selectedDeployment ? `${selectedDeployment.project_name}-${selectedDeployment.build_number}` : 'no-deployment'}
        deployment={selectedDeployment}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedDeployment(null);
        }}
      />
    </div>
  );
};

export default ProjectHierarchy;