import { useState } from 'react';
import clsx from 'clsx';

const ProjectStatusCard = ({ projects, isLoading = false }) => {
  const [filter, setFilter] = useState('all'); // all, healthy, warning, error

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return (
          <svg className="w-3 h-3 text-success-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-3 h-3 text-warning-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-3 h-3 text-error-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'bg-success-100 text-success-800 border-success-200';
      case 'warning':
        return 'bg-warning-100 text-warning-800 border-warning-200';
      case 'error':
        return 'bg-error-100 text-error-800 border-error-200';
      default:
        return 'bg-primary-100 text-primary-800 border-primary-200';
    }
  };

  const getSuccessRateColor = (rate) => {
    if (rate >= 95) return 'text-success-600';
    if (rate >= 90) return 'text-warning-600';
    return 'text-error-600';
  };

  const filteredProjects = projects?.filter(project => {
    if (filter === 'all') return true;
    return project.status === filter;
  }) || [];

  const statusCounts = projects?.reduce((acc, project) => {
    acc[project.status] = (acc[project.status] || 0) + 1;
    return acc;
  }, { healthy: 0, warning: 0, error: 0 }) || { healthy: 0, warning: 0, error: 0 };

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-primary-900">프로젝트 상태</h3>
        </div>
        <div className="card-body">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 border border-primary-200 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-primary-300 rounded-full"></div>
                  <div>
                    <div className="h-4 bg-primary-300 rounded w-20 mb-1"></div>
                    <div className="h-3 bg-primary-200 rounded w-16"></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="h-4 bg-primary-300 rounded w-12 mb-1"></div>
                  <div className="h-3 bg-primary-200 rounded w-8"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary-900">프로젝트 상태</h3>
          <div className="flex items-center space-x-2 text-xs">
            <span className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-success-500 rounded-full"></div>
              <span className="text-primary-600">{statusCounts.healthy}</span>
            </span>
            <span className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-warning-500 rounded-full"></div>
              <span className="text-primary-600">{statusCounts.warning}</span>
            </span>
            <span className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-error-500 rounded-full"></div>
              <span className="text-primary-600">{statusCounts.error}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="px-6 py-3 border-b border-primary-200">
        <div className="flex space-x-1">
          {[
            { key: 'all', label: '전체', count: projects?.length || 0 },
            { key: 'healthy', label: '정상', count: statusCounts.healthy },
            { key: 'warning', label: '주의', count: statusCounts.warning },
            { key: 'error', label: '오류', count: statusCounts.error },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                filter === key
                  ? 'bg-primary-100 text-primary-900 border border-primary-200'
                  : 'text-primary-600 hover:bg-primary-50 hover:text-primary-900'
              )}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      <div className="card-body">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="mt-2 text-sm text-primary-600">
              {filter === 'all' ? '프로젝트가 없습니다' : `${filter} 상태의 프로젝트가 없습니다`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredProjects.map((project, index) => (
              <div
                key={project.id || index}
                className="group p-4 border border-primary-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-all duration-200"
              >
                {/* 첫 번째 줄: 프로젝트 이름과 상태 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    {/* 상태 아이콘 */}
                    <div className={clsx(
                      'flex items-center justify-center w-6 h-6 rounded-lg border flex-shrink-0',
                      getStatusColor(project.status)
                    )}>
                      {getStatusIcon(project.status)}
                    </div>

                    {/* 프로젝트 이름 */}
                    <h4 className="font-medium text-primary-900 text-sm truncate" title={project.name}>
                      {project.name}
                    </h4>
                  </div>

                  {/* 성공률 */}
                  <div className="text-right flex-shrink-0">
                    <span className={clsx(
                      'text-lg font-bold',
                      getSuccessRateColor(project.successRate)
                    )}>
                      {project.successRate.toFixed(1)}%
                    </span>
                    <p className="text-xs text-primary-500">성공률</p>
                  </div>
                </div>

                {/* 두 번째 줄: 상세 정보 */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-col space-y-1 text-xs text-primary-600">
                    <div className="flex items-center space-x-3">
                      <span>{project.deployments}개 배포</span>
                      <span>•</span>
                      <span>마지막: {project.lastDeployment || '없음'}</span>
                    </div>
                    {project.environment && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700 w-fit">
                        환경: {project.environment}
                      </span>
                    )}
                  </div>

                  {/* 최근 빌드 상태 */}
                  <div className="flex items-center space-x-3">
                    {project.recentBuilds && project.recentBuilds.length > 0 && (
                      <div className="flex flex-col items-end space-y-1">
                        <div className="flex space-x-1">
                          {project.recentBuilds.slice(0, 5).map((build, buildIndex) => (
                            <div
                              key={buildIndex}
                              className={clsx(
                                'w-2 h-2 rounded-full',
                                build === 'success' ? 'bg-success-500' :
                                build === 'failed' ? 'bg-error-500' : 'bg-primary-300'
                              )}
                              title={`빌드 ${buildIndex + 1}: ${build}`}
                            />
                          ))}
                        </div>
                        <span className="text-xs text-primary-500">최근 빌드</span>
                      </div>
                    )}

                    {/* 액션 버튼 */}
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 hover:text-primary-900 p-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 푸터 */}
      <div className="card-footer">
        <div className="flex items-center justify-between">
          <button className="btn-ghost text-sm">
            모든 프로젝트 보기 →
          </button>
          <div className="text-xs text-primary-500">
            마지막 업데이트: {new Date().toLocaleTimeString('ko-KR', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectStatusCard;