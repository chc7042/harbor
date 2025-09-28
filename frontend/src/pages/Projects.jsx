import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import api from '../services/api';
import toast from 'react-hot-toast';

const Projects = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await api.get('/projects');
      
      if (response.data.success) {
        setProjects(response.data.data || []);
      } else {
        toast.error('프로젝트 목록을 불러오는데 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      toast.error('프로젝트 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return 'text-green-600 bg-green-100';
      case 'failure':
      case 'failed':
        return 'text-red-600 bg-red-100';
      case 'unstable':
        return 'text-yellow-600 bg-yellow-100';
      case 'aborted':
        return 'text-gray-600 bg-gray-100';
      default:
        return 'text-blue-600 bg-blue-100';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '없음';
    try {
      return new Date(dateString).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '잘못된 날짜';
    }
  };

  const formatDuration = (duration) => {
    if (!duration) return '없음';
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분`;
    } else if (minutes > 0) {
      return `${minutes}분 ${seconds % 60}초`;
    } else {
      return `${seconds}초`;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-primary-50">
        <Header />
        <main className="container-max section-padding">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-900"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary-50">
      <Header />

      <main className="container-max section-padding space-responsive">
        {/* 페이지 헤더 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary-900 mb-2">
            프로젝트 목록
          </h1>
          <p className="text-primary-600">
            Jenkins에서 관리되는 모든 프로젝트와 작업을 확인하세요
          </p>
        </div>

        {/* 프로젝트 목록 */}
        {projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl text-primary-300 mb-4">📁</div>
            <h3 className="text-lg font-medium text-primary-900 mb-2">
              프로젝트가 없습니다
            </h3>
            <p className="text-primary-500">
              Jenkins에서 관리되는 프로젝트를 찾을 수 없습니다.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.name}
                className="bg-white rounded-lg border border-primary-200 p-6 hover:shadow-lg transition-shadow duration-200 cursor-pointer"
                onClick={() => navigate(`/projects/${project.name}`)}
              >
                {/* 프로젝트 헤더 */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-primary-900 mb-1">
                      {project.name}
                    </h3>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                          project.status
                        )}`}
                      >
                        {project.status || 'unknown'}
                      </span>
                      <span className="text-sm text-primary-500">
                        {project.totalJobs}개 작업
                      </span>
                    </div>
                  </div>
                  <svg
                    className="w-5 h-5 text-primary-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>

                {/* 최신 빌드 정보 */}
                {project.lastBuild ? (
                  <div className="space-y-2">
                    <div className="text-sm text-primary-600">
                      <span className="font-medium">최신 빌드:</span>{' '}
                      #{project.lastBuild.number} ({project.lastBuild.displayName})
                    </div>
                    <div className="text-sm text-primary-500">
                      <span className="font-medium">빌드 시간:</span>{' '}
                      {formatDate(project.lastBuildDate)}
                    </div>
                    <div className="text-sm text-primary-500">
                      <span className="font-medium">소요 시간:</span>{' '}
                      {formatDuration(project.lastBuild.duration)}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-primary-400">
                    빌드 기록이 없습니다
                  </div>
                )}

                {/* 작업 목록 미리보기 */}
                <div className="mt-4 pt-4 border-t border-primary-100">
                  <div className="text-sm font-medium text-primary-700 mb-2">
                    포함된 작업:
                  </div>
                  <div className="space-y-1">
                    {project.jobs.slice(0, 3).map((job) => (
                      <div key={job.name} className="text-sm text-primary-600">
                        • {job.name}
                      </div>
                    ))}
                    {project.jobs.length > 3 && (
                      <div className="text-sm text-primary-400">
                        +{project.jobs.length - 3}개 더
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 요약 정보 */}
        {projects.length > 0 && (
          <div className="mt-8 bg-white rounded-lg border border-primary-200 p-6">
            <h3 className="text-lg font-semibold text-primary-900 mb-4">
              요약 정보
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-900">
                  {projects.length}
                </div>
                <div className="text-sm text-primary-600">총 프로젝트</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-900">
                  {projects.reduce((sum, p) => sum + p.totalJobs, 0)}
                </div>
                <div className="text-sm text-primary-600">총 작업</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {projects.filter(p => p.status === 'SUCCESS').length}
                </div>
                <div className="text-sm text-primary-600">성공</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {projects.filter(p => p.status && p.status !== 'SUCCESS').length}
                </div>
                <div className="text-sm text-primary-600">실패/기타</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Projects;