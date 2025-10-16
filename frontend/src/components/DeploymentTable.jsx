import React, { useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Clock,
  User,
  GitBranch,
  Tag,
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  Download
} from 'lucide-react';
import downloadService from '../services/downloadService';
import { loadArtifacts } from '../services/api';

const DeploymentTable = ({
  deployments = [],
  loading = false,
  sortConfig,
  onSort,
  onRowClick,
  onDeploymentUpdate, // 새 prop: 배포 정보 업데이트를 위한 콜백
  className = ''
}) => {
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [loadingArtifacts, setLoadingArtifacts] = useState(new Set()); // 아티팩트 로딩 중인 배포들

  // 아티팩트 지연 로딩 함수
  const handleLoadArtifacts = async (deployment) => {
    const deploymentKey = `${deployment.version}-${deployment.buildNumber}`;
    
    console.log(`🔍 [ARTIFACT-LOADING] 아티팩트 로딩 시작: ${deploymentKey}`);
    console.log(`🔍 [ARTIFACT-LOADING] deployment 정보:`, deployment);

    if (loadingArtifacts.has(deploymentKey)) {
      console.log(`🔍 [ARTIFACT-LOADING] 이미 로딩 중: ${deploymentKey}`);
      return; // 이미 로딩 중인 경우
    }

    setLoadingArtifacts(prev => new Set(prev).add(deploymentKey));

    try {
      console.log(`🔍 [ARTIFACT-LOADING] API 호출: loadArtifacts(${deployment.version}, ${deployment.buildNumber})`);
      const response = await loadArtifacts(deployment.version, deployment.buildNumber);
      console.log(`🔍 [ARTIFACT-LOADING] API 응답:`, response);

      if (response.success && onDeploymentUpdate) {
        // 부모 컴포넌트에 업데이트된 아티팩트 정보 전달
        const updatedDeployment = {
          ...deployment,
          artifacts: response.data.artifacts || [],
        };
        console.log(`🔍 [ARTIFACT-LOADING] 업데이트된 deployment:`, updatedDeployment);
        console.log(`🔍 [ARTIFACT-LOADING] artifacts 개수: ${updatedDeployment.artifacts.length}`);
        onDeploymentUpdate(updatedDeployment);

      }
    } catch (error) {
      console.error(`[ARTIFACT-LOADING] ❌ 아티팩트 로딩 실패:`, error);
    } finally {
      setLoadingArtifacts(prev => {
        const newSet = new Set(prev);
        newSet.delete(deploymentKey);
        return newSet;
      });
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <div className="w-4 h-4 bg-gray-300 rounded-full" />;
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      success: 'bg-green-100 text-green-800 border-green-200',
      failed: 'bg-red-100 text-red-800 border-red-200',
      in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200'
    };

    const labels = {
      success: '성공',
      failed: '실패',
      in_progress: '진행중',
      pending: '대기중'
    };

    return (
      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${styles[status] || 'bg-gray-100 text-gray-800 border-gray-200'}`} style={{display: 'inline-block', whiteSpace: 'nowrap'}}>
        <span className="inline-flex items-center">
          {getStatusIcon(status)}
          <span className="ml-1">{labels[status] || status}</span>
        </span>
      </span>
    );
  };


  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('ko-KR'),
      time: date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${seconds}초`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}분 ${remainingSeconds}초`;
  };

  const handleSort = (field) => {
    if (sortConfig?.field === field) {
      onSort({
        field,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc'
      });
    } else {
      onSort({
        field,
        direction: 'asc'
      });
    }
  };

  const getSortIcon = (field) => {
    if (sortConfig?.field !== field) {
      return <div className="w-4 h-4" />; // 빈 공간
    }
    return sortConfig.direction === 'asc' ?
      <ChevronUp className="w-4 h-4 text-primary-600" /> :
      <ChevronDown className="w-4 h-4 text-primary-600" />;
  };

  // 통합 다운로드 처리 함수
  const handleDownload = async (artifact, deploymentId) => {
    const downloadKey = `${deploymentId}-${artifact.filename}`;

    if (downloadingFiles.has(downloadKey)) {
      return;
    }

    try {
      setDownloadingFiles(prev => new Set([...prev, downloadKey]));


      const result = await downloadService.downloadFile(
        artifact.filePath || artifact.nasPath,
        artifact.filename,
        {
          onProgress: (progress) => {
            // 여기서 UI 업데이트 가능 (토스트, 진행바 등)
          },
          strategy: 'redirect' // 기본적으로 리다이렉트 사용 (가장 빠름)
        }
      );

      if (result.success) {
      } else {
        console.error(`[DEPLOYMENT-TABLE] ❌ 다운로드 실패: ${result.error}`);
        // 에러는 downloadService에서 토스트로 표시됨
      }
    } catch (error) {
      console.error(`[DEPLOYMENT-TABLE] ❌ 다운로드 오류:`, error);
      // 에러는 downloadService에서 처리됨
    } finally {
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(downloadKey);
        return newSet;
      });
    }
  };


  if (loading) {
    return (
      <div className={`card-minimal overflow-hidden ${className}`}>
        <div className="p-6">
          <div className="space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 animate-pulse">
                <div className="w-4 h-4 bg-gray-200 rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
                <div className="w-16 h-6 bg-gray-200 rounded" />
                <div className="w-12 h-6 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!deployments.length) {
    return (
      <div className={`card-minimal ${className}`}>
        <div className="p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">배포 이력이 없습니다</h3>
          <p className="text-gray-500">검색 조건을 변경하거나 필터를 초기화해보세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`card-minimal overflow-hidden ${className}`}>
      {/* 테이블 헤더 */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center">
          <span className="text-sm text-gray-500">
            총 {deployments.length}개 결과
          </span>
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="table-minimal">
          <thead>
            <tr>
              <th>
                <button
                  onClick={() => handleSort('project_name')}
                  className="flex items-center justify-center space-x-1 hover:text-primary-900 transition-colors w-full"
                >
                  <span>프로젝트</span>
                  {getSortIcon('project_name')}
                </button>
              </th>
              <th>
                <button
                  onClick={() => handleSort('build_number')}
                  className="flex items-center justify-center space-x-1 hover:text-primary-900 transition-colors w-full"
                >
                  <span>빌드</span>
                  {getSortIcon('build_number')}
                </button>
              </th>
              <th>
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center justify-center space-x-1 hover:text-primary-900 transition-colors w-full"
                >
                  <span>상태</span>
                  {getSortIcon('status')}
                </button>
              </th>
              <th className="w-24">
                <button
                  onClick={() => handleSort('deployed_by')}
                  className="flex items-center justify-center space-x-1 hover:text-primary-900 transition-colors w-full"
                >
                  <span>배포자</span>
                  {getSortIcon('deployed_by')}
                </button>
              </th>
              <th className="text-center w-32">브랜치</th>
              <th className="w-32">
                <button
                  onClick={() => handleSort('created_at')}
                  className="flex items-center justify-center space-x-1 hover:text-primary-900 transition-colors w-full"
                >
                  <span>배포 시간</span>
                  {getSortIcon('created_at')}
                </button>
              </th>
              <th className="text-center w-20">소요 시간</th>
              <th className="w-16 text-center">액션</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => {
              const dateInfo = formatDate(deployment.created_at);

              return (
                <tr
                  key={deployment.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={(e) => {
                    // Jenkins 링크나 ExternalLink 아이콘 클릭인지 확인 (더 정확한 방법)
                    const jenkinsLink = e.target.closest('a[title="Jenkins에서 보기"]');
                    const isJenkinsRelated = jenkinsLink || 
                                           e.target.closest('svg')?.closest('a[title="Jenkins에서 보기"]') ||
                                           e.target.tagName === 'svg' && e.target.closest('a[title="Jenkins에서 보기"]');
                    
                    if (isJenkinsRelated) {
                      // Jenkins 링크는 그대로 동작하게 하고 모달만 차단
                      return;
                    }
                    
                    // 액션 컬럼(마지막 td) 클릭 차단 - 다운로드 버튼이나 Jenkins 링크 영역
                    const clickedCell = e.target.closest('td');
                    const allCells = e.currentTarget.querySelectorAll('td');
                    const isLastCell = clickedCell === allCells[allCells.length - 1];
                    
                    if (isLastCell) {
                      // 액션 영역 클릭은 모달 열기 차단
                      return;
                    }
                    
                    // 테이블 행의 다른 부분 클릭이면 모달 열기
                    onRowClick?.(deployment);
                  }}
                >

                  <td>
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        {getStatusIcon(deployment.status)}
                      </div>
                      <div>
                        <div className="font-medium text-primary-900">
                          {deployment.project_name}
                          {/* Jenkins job 구조 표시 - subJobs가 있는 경우 */}
                          {deployment.subJobs && deployment.subJobs.length > 0 && (
                            <span className="ml-2">
                              {deployment.subJobs.map((subJob, index) => (
                                <span key={index}>
                                  <span className={`inline-block px-1 py-0.5 rounded text-xs font-medium ${
                                    subJob.status === 'success'
                                      ? 'bg-green-100 text-green-700'
                                      : subJob.status === 'failed'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {subJob.prefix}
                                  </span>
                                  {index < deployment.subJobs.length - 1 && (
                                    <span className="mx-0.5 text-gray-400 text-xs">→</span>
                                  )}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                        {deployment.description && (
                          <div className="text-sm text-gray-500 truncate max-w-xs mt-1">
                            {deployment.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="flex items-center space-x-2">
                      <Tag className="w-3 h-3 text-gray-400" />
                      <span className="font-mono text-sm whitespace-nowrap">
                        #{deployment.build_number}
                      </span>
                    </div>
                  </td>

                  <td>
                    {getStatusBadge(deployment.status)}
                  </td>


                  <td>
                    {deployment.deployed_by && (
                      <div className="flex items-center space-x-1">
                        <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-sm truncate max-w-20" title={deployment.deployed_by}>{deployment.deployed_by}</span>
                      </div>
                    )}
                  </td>

                  <td>
                    {deployment.branch && (
                      <div className="flex items-center space-x-2">
                        <GitBranch className="w-3 h-3 text-gray-400" />
                        <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded whitespace-nowrap">
                          {deployment.branch}
                        </span>
                      </div>
                    )}
                  </td>

                  <td>
                    <div className="text-xs whitespace-nowrap">
                      <div className="font-medium text-primary-900">
                        {dateInfo.date}
                      </div>
                      <div className="text-gray-500">
                        {dateInfo.time}
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="flex items-center space-x-1 text-xs text-gray-600 whitespace-nowrap">
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      <span>{formatDuration(deployment.duration)}</span>
                    </div>
                  </td>

                  <td>
                    <div className="flex items-center space-x-1">
                      {/* 아티팩트 관련 버튼 - 지연 로딩 지원 */}
                      {(() => {
                        console.log(`🔍 [RENDER] deployment ${deployment.id}:`, {
                          hasArtifacts: deployment.hasArtifacts,
                          artifacts: deployment.artifacts,
                          artifactsLength: deployment.artifacts?.length || 0,
                          showLoadButton: deployment.hasArtifacts && deployment.artifacts && deployment.artifacts.length === 0,
                          showDownloadButton: deployment.artifacts && deployment.artifacts.length > 0
                        });
                        return null;
                      })()}
                      {!deployment.artifacts || (deployment.artifacts && deployment.artifacts.length === 0) ? (
                        // 아티팩트가 있지만 아직 로딩되지 않은 경우 - 로드 버튼 표시
                        <div className="relative group">
                          <button
                            className={`p-1 transition-colors rounded text-xs px-2 py-1 ${
                              loadingArtifacts.has(`${deployment.version}-${deployment.buildNumber}`)
                                ? 'bg-blue-100 text-blue-600 animate-pulse'
                                : 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300 border border-yellow-400'
                            }`}
                            title="아티팩트 정보 로드"
                            disabled={loadingArtifacts.has(`${deployment.version}-${deployment.buildNumber}`)}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleLoadArtifacts(deployment);
                            }}
                          >
                            {loadingArtifacts.has(`${deployment.version}-${deployment.buildNumber}`) ? 'Loading...' : 'Load'}
                          </button>
                        </div>
                      ) : deployment.artifacts && deployment.artifacts.length > 0 ? (
                        // 아티팩트가 이미 로딩된 경우 - 다운로드 버튼 표시
                        <div className="relative group">
                          <button
                            className={`p-1 transition-colors rounded ${
                              downloadingFiles.has(`${deployment.id}-${deployment.artifacts[0]?.filename}`)
                                ? 'text-blue-500 animate-pulse'
                                : 'bg-green-200 text-green-800 hover:bg-green-300 border border-green-400'
                            }`}
                            title={`${deployment.artifacts.length}개 아티팩트 다운로드`}
                            disabled={downloadingFiles.has(`${deployment.id}-${deployment.artifacts[0]?.filename}`)}
                            onClick={async (e) => {
                              e.stopPropagation();

                              if (deployment.artifacts.length === 1) {
                                // 단일 아티팩트 - 통합 다운로드 서비스 사용
                                const artifact = deployment.artifacts[0];
                                await handleDownload(artifact, deployment.id);
                              } else {
                                // 여러 아티팩트가 있는 경우 모달 열기
                                onRowClick?.(deployment);
                              }
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {/* 아티팩트 수 표시 */}
                          {deployment.artifacts.length > 1 && (
                            <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                              {deployment.artifacts.length}
                            </span>
                          )}
                          {/* 다운로드 중 표시 */}
                          {downloadingFiles.has(`${deployment.id}-${deployment.artifacts[0]?.filename}`) && (
                            <span className="absolute -bottom-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-2 h-2 animate-ping">
                            </span>
                          )}
                        </div>
                      ) : null}

                      {/* Jenkins 링크 버튼 */}
                      {deployment.jenkins_url && (
                        <a
                          href={deployment.jenkins_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-gray-400 hover:text-blue-600 transition-colors rounded inline-block"
                          title="Jenkins에서 보기"
                          onClick={(e) => {
                            // 이벤트 전파 차단으로 테이블 행 클릭 방지
                            e.stopPropagation();
                          }}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DeploymentTable;