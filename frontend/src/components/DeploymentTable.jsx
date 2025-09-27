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
  MoreHorizontal
} from 'lucide-react';

const DeploymentTable = ({
  deployments = [],
  loading = false,
  sortConfig,
  onSort,
  onRowClick,
  className = ''
}) => {
  const [selectedRows, setSelectedRows] = useState(new Set());

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
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || 'bg-gray-100 text-gray-800 border-gray-200'}`}>
        {getStatusIcon(status)}
        <span className="ml-1">{labels[status] || status}</span>
      </span>
    );
  };

  const getEnvironmentBadge = (environment) => {
    const styles = {
      production: 'bg-red-100 text-red-800',
      staging: 'bg-yellow-100 text-yellow-800',
      development: 'bg-blue-100 text-blue-800'
    };

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${styles[environment] || 'bg-gray-100 text-gray-800'}`}>
        {environment}
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

  const handleRowSelect = (deploymentId) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(deploymentId)) {
      newSelected.delete(deploymentId);
    } else {
      newSelected.add(deploymentId);
    }
    setSelectedRows(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedRows.size === deployments.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(deployments.map(d => d.id)));
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
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={selectedRows.size === deployments.length && deployments.length > 0}
                onChange={handleSelectAll}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-600"
              />
              <span className="ml-2 text-sm text-gray-600">
                {selectedRows.size > 0 ? `${selectedRows.size}개 선택됨` : '전체 선택'}
              </span>
            </label>
            <span className="text-sm text-gray-500">
              총 {deployments.length}개 결과
            </span>
          </div>
          {selectedRows.size > 0 && (
            <div className="flex items-center space-x-2">
              <button className="btn-secondary text-sm">
                선택 항목 내보내기
              </button>
              <button className="btn-secondary text-sm">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="table-minimal">
          <thead>
            <tr>
              <th className="w-4">
                {/* 체크박스 컬럼 */}
              </th>
              <th>
                <button
                  onClick={() => handleSort('project_name')}
                  className="flex items-center space-x-1 hover:text-primary-900 transition-colors"
                >
                  <span>프로젝트</span>
                  {getSortIcon('project_name')}
                </button>
              </th>
              <th>
                <button
                  onClick={() => handleSort('build_number')}
                  className="flex items-center space-x-1 hover:text-primary-900 transition-colors"
                >
                  <span>빌드</span>
                  {getSortIcon('build_number')}
                </button>
              </th>
              <th>
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center space-x-1 hover:text-primary-900 transition-colors"
                >
                  <span>상태</span>
                  {getSortIcon('status')}
                </button>
              </th>
              <th>환경</th>
              <th>
                <button
                  onClick={() => handleSort('deployed_by')}
                  className="flex items-center space-x-1 hover:text-primary-900 transition-colors"
                >
                  <span>배포자</span>
                  {getSortIcon('deployed_by')}
                </button>
              </th>
              <th>브랜치</th>
              <th>
                <button
                  onClick={() => handleSort('created_at')}
                  className="flex items-center space-x-1 hover:text-primary-900 transition-colors"
                >
                  <span>배포 시간</span>
                  {getSortIcon('created_at')}
                </button>
              </th>
              <th>소요 시간</th>
              <th className="w-8">액션</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => {
              const isSelected = selectedRows.has(deployment.id);
              const dateInfo = formatDate(deployment.created_at);

              return (
                <tr
                  key={deployment.id}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-primary-50 border-primary-200' : ''
                  }`}
                  onClick={() => onRowClick?.(deployment)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleRowSelect(deployment.id)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-600"
                    />
                  </td>

                  <td>
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        {getStatusIcon(deployment.status)}
                      </div>
                      <div>
                        <div className="font-medium text-primary-900">
                          {deployment.project_name}
                        </div>
                        {deployment.description && (
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {deployment.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="flex items-center space-x-2">
                      <Tag className="w-3 h-3 text-gray-400" />
                      <span className="font-mono text-sm">
                        #{deployment.build_number}
                      </span>
                    </div>
                  </td>

                  <td>
                    {getStatusBadge(deployment.status)}
                  </td>

                  <td>
                    {deployment.environment && getEnvironmentBadge(deployment.environment)}
                  </td>

                  <td>
                    {deployment.deployed_by && (
                      <div className="flex items-center space-x-2">
                        <User className="w-3 h-3 text-gray-400" />
                        <span className="text-sm">{deployment.deployed_by}</span>
                      </div>
                    )}
                  </td>

                  <td>
                    {deployment.branch && (
                      <div className="flex items-center space-x-2">
                        <GitBranch className="w-3 h-3 text-gray-400" />
                        <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                          {deployment.branch}
                        </span>
                      </div>
                    )}
                  </td>

                  <td>
                    <div className="text-sm">
                      <div className="font-medium text-primary-900">
                        {dateInfo.date}
                      </div>
                      <div className="text-gray-500">
                        {dateInfo.time}
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="flex items-center space-x-1 text-sm text-gray-600">
                      <Clock className="w-3 h-3" />
                      <span>{formatDuration(deployment.duration)}</span>
                    </div>
                  </td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="p-1 text-gray-400 hover:text-primary-600 transition-colors rounded"
                      title="상세 정보"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
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