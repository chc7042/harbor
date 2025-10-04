import React from 'react';
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
// import { downloadFile } from '../services/api'; // 스트리밍 다운로드로 변경

const DeploymentTable = ({
  deployments = [],
  loading = false,
  sortConfig,
  onSort,
  onRowClick,
  className = ''
}) => {

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
                  onClick={() => onRowClick?.(deployment)}
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

                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center space-x-1">
                      {/* 다운로드 버튼 - 임시로 모든 deployment에 표시 */}
                      {/* 모든 deployment 디버깅 로그 */}
                      {console.log(`Deployment debug - version: ${deployment.version}, artifacts:`, deployment.artifacts)}
                      {true && (
                        <div className="relative group">
                          <button
                            className="p-1 text-gray-400 hover:text-green-600 transition-colors rounded"
                            title={`${deployment.artifacts?.length || 0}개 아티팩트 다운로드`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              console.log('Download button clicked for version:', deployment.version);
                              console.log('Artifacts:', deployment.artifacts);
                              
                              if (!deployment.artifacts || deployment.artifacts.length === 0) {
                                alert(`${deployment.version} 버전에는 artifacts 데이터가 없습니다. 콘솔에서 디버깅 정보를 확인하세요.`);
                                return;
                              }
                              
                              if (deployment.artifacts.length === 1) {
                                // 아티팩트가 하나인 경우 바로 스트리밍 다운로드 (즉시 반응)
                                const artifact = deployment.artifacts[0];
                                
                                // 스트리밍 다운로드 - 브라우저가 즉시 다운로드 시작
                                const link = document.createElement('a');
                                link.href = artifact.downloadUrl;
                                link.download = artifact.fileName || 'download';
                                link.style.display = 'none';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                
                                console.log(`스트리밍 다운로드 시작: ${artifact.fileName}`);
                              } else {
                                // 여러 아티팩트가 있는 경우 모달 열기
                                onRowClick?.(deployment);
                              }
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {/* 아티팩트 수 표시 */}
                          {deployment.artifacts && deployment.artifacts.length > 1 && (
                            <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                              {deployment.artifacts.length}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* 상세 정보 버튼 */}
                      <button
                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors rounded"
                        title="상세 정보"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick?.(deployment);
                        }}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
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