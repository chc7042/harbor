import React, { useState, useEffect } from 'react';
import { Clock, Calendar, User, GitBranch, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';
import { useDeploymentUpdates } from '../hooks/useWebSocket';
import api from '../services/api';

const DeploymentTimeline = ({ className = '' }) => {
  const [initialDeployments, setInitialDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('24h');

  // 실시간 업데이트 적용된 배포 데이터
  const deployments = useDeploymentUpdates(initialDeployments);

  useEffect(() => {
    fetchRecentDeployments();
  }, [timeRange]);

  const fetchRecentDeployments = async () => {
    try {
      setLoading(true);
      const hours = timeRange === '24h' ? 24 : timeRange === '12h' ? 12 : 6;
      const response = await api.get(`/deployments/recent?hours=${hours}&limit=20`);

      if (response.data.success) {
        setInitialDeployments(response.data.data || []);
      } else {
        throw new Error(response.data.error?.message || '배포 이력 조회 실패');
      }
    } catch (err) {
      console.error('Failed to fetch deployments:', err);
      setError(err.message);
      // 개발환경에서 mock 데이터 사용
      setInitialDeployments(generateMockDeployments());
    } finally {
      setLoading(false);
    }
  };

  const generateMockDeployments = () => {
    const statuses = ['success', 'failed', 'in_progress', 'pending'];
    const projects = ['harbor-frontend', 'harbor-backend', 'mobile-app', 'api-gateway'];
    const users = ['john.doe', 'jane.smith', 'nicolas.choi', 'mike.wilson'];

    return Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      project_name: projects[Math.floor(Math.random() * projects.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
      created_at: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString(),
      build_number: Math.floor(Math.random() * 100) + 1,
      environment: ['production', 'staging', 'development'][Math.floor(Math.random() * 3)],
      deployed_by: users[Math.floor(Math.random() * users.length)],
      branch: ['main', 'develop', 'feature/auth', 'hotfix/login'][Math.floor(Math.random() * 4)],
      duration: Math.floor(Math.random() * 600) + 30 // 30초 ~ 10분
    }));
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
        return <Info className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'border-green-200 bg-green-50';
      case 'failed':
        return 'border-red-200 bg-red-50';
      case 'in_progress':
        return 'border-blue-200 bg-blue-50';
      case 'pending':
        return 'border-yellow-200 bg-yellow-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const formatTimeAgo = (dateString) => {
    const now = new Date();
    const deployTime = new Date(dateString);
    const diffMs = now - deployTime;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return deployTime.toLocaleDateString();
  };

  const formatDuration = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-900">Recent Deployments</h3>
          <div className="w-16 h-4 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-3 animate-pulse">
              <div className="w-4 h-4 bg-gray-200 rounded-full" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-2 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-900">Recent Deployments</h3>
          </div>

          {/* Time Range Selector */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            {['6h', '12h', '24h'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  timeRange === range
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <p className="text-sm text-yellow-800">Using mock data (API unavailable)</p>
            </div>
          </div>
        )}

        {deployments.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No deployments in the last {timeRange}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deployments.map((deployment, index) => (
              <div
                key={deployment.id}
                className={`flex items-start space-x-3 p-3 rounded-lg border ${getStatusColor(deployment.status)} transition-colors hover:shadow-sm`}
              >
                {/* Status Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {getStatusIcon(deployment.status)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {deployment.project_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        #{deployment.build_number}
                      </span>
                      {deployment.environment && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          deployment.environment === 'production'
                            ? 'bg-red-100 text-red-800'
                            : deployment.environment === 'staging'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {deployment.environment}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {formatTimeAgo(deployment.created_at)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                    {deployment.deployed_by && (
                      <div className="flex items-center space-x-1">
                        <User className="w-3 h-3" />
                        <span>{deployment.deployed_by}</span>
                      </div>
                    )}
                    {deployment.branch && (
                      <div className="flex items-center space-x-1">
                        <GitBranch className="w-3 h-3" />
                        <span>{deployment.branch}</span>
                      </div>
                    )}
                    {deployment.duration && (
                      <div className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDuration(deployment.duration)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Timeline Line */}
                {index < deployments.length - 1 && (
                  <div className="absolute left-8 mt-6 w-px h-6 bg-gray-200" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* View All Link */}
        {deployments.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              View all deployments →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeploymentTimeline;