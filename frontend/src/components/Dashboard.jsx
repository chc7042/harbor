import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Header from './Header';
import ProjectStatusCard from './ProjectStatusCard';
import DeploymentChart from './DeploymentChart';
import DeploymentTimeline from './DeploymentTimeline';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalDeployments: 0,
    successRate: 0,
    failureRate: 0,
  });
  const [projects, setProjects] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      // TODO: API 호출로 실제 데이터 가져오기
      // const response = await api.get('/dashboard/stats');
      // setStats(response.data.data.overview);

      // 임시 더미 데이터
      setTimeout(() => {
        setStats({
          totalProjects: 6,
          totalDeployments: 247,
          successRate: 94.3,
          failureRate: 5.7,
        });

        setProjects([
          {
            id: 1,
            name: 'web-frontend',
            environment: 'Production',
            status: 'healthy',
            deployments: 156,
            successRate: 94.2,
            trend: 2.3,
            lastDeployment: '2분 전',
            recentBuilds: ['success', 'success', 'success', 'success', 'failed']
          },
          {
            id: 2,
            name: 'api-backend',
            environment: 'Production',
            status: 'healthy',
            deployments: 134,
            successRate: 89.6,
            trend: -1.2,
            lastDeployment: '15분 전',
            recentBuilds: ['success', 'success', 'failed', 'success', 'success']
          },
          {
            id: 3,
            name: 'mobile-app',
            environment: 'Staging',
            status: 'warning',
            deployments: 89,
            successRate: 87.3,
            trend: -3.1,
            lastDeployment: '1시간 전',
            recentBuilds: ['failed', 'success', 'failed', 'success', 'success']
          },
          {
            id: 4,
            name: 'data-pipeline',
            environment: 'Production',
            status: 'healthy',
            deployments: 67,
            successRate: 96.1,
            trend: 1.8,
            lastDeployment: '3시간 전',
            recentBuilds: ['success', 'success', 'success', 'success', 'success']
          },
          {
            id: 5,
            name: 'microservice-auth',
            environment: 'Production',
            status: 'error',
            deployments: 45,
            successRate: 72.4,
            trend: -8.7,
            lastDeployment: '6시간 전',
            recentBuilds: ['failed', 'failed', 'success', 'failed', 'failed']
          },
          {
            id: 6,
            name: 'analytics-service',
            environment: 'Development',
            status: 'healthy',
            deployments: 32,
            successRate: 91.8,
            trend: 4.2,
            lastDeployment: '1일 전',
            recentBuilds: ['success', 'success', 'success', 'failed', 'success']
          }
        ]);

        setIsLoading(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
      toast.error('대시보드 데이터를 불러오는데 실패했습니다.');
      setIsLoading(false);
    }
  };

  const StatCard = ({ title, value, suffix = '', trend, icon }) => (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-primary-600">{title}</p>
            <p className="text-2xl font-bold text-primary-900">
              {value}
              {suffix && <span className="text-lg text-primary-600">{suffix}</span>}
            </p>
            {trend && (
              <p className={`text-xs ${trend > 0 ? 'text-success-600' : 'text-error-600'}`}>
                {trend > 0 ? '+' : ''}{trend}% from last month
              </p>
            )}
          </div>
          {icon && (
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
                {icon}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary-50">
        <Header />
        <main className="container-max section-padding">
          <div className="text-center">
            <div className="spinner mx-auto mb-4"></div>
            <p className="text-primary-600">데이터를 불러오는 중...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary-50">
      <Header />

      <main className="container-max section-padding">
        {/* 환영 메시지 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary-900 mb-2">
            안녕하세요, {user?.name || user?.username}님
          </h1>
          <p className="text-primary-600">
            Jenkins NAS 배포 현황을 확인하세요
          </p>
        </div>

        {/* 통계 카드 */}
        <div className="grid-cards mb-8">
          <StatCard
            title="전체 프로젝트"
            value={stats.totalProjects}
            icon={
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
          />
          <StatCard
            title="총 배포 수"
            value={stats.totalDeployments}
            trend={12}
            icon={
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            }
          />
          <StatCard
            title="성공률"
            value={stats.successRate}
            suffix="%"
            trend={2.1}
            icon={
              <svg className="w-4 h-4 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="실패율"
            value={stats.failureRate}
            suffix="%"
            trend={-0.8}
            icon={
              <svg className="w-4 h-4 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        {/* 최근 배포 활동 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 배포 타임라인 */}
          <DeploymentTimeline />

          {/* 프로젝트 상태 카드 */}
          <ProjectStatusCard
            projects={projects}
            isLoading={isLoading}
          />
        </div>

        {/* 빠른 액션 */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-primary-900">빠른 액션</h3>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <button className="btn-secondary p-4 h-auto flex-col space-y-2">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>배포 검색</span>
              </button>
              <button className="btn-secondary p-4 h-auto flex-col space-y-2">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>통계 보기</span>
              </button>
              <button className="btn-secondary p-4 h-auto flex-col space-y-2">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>파일 다운로드</span>
              </button>
              <button className="btn-secondary p-4 h-auto flex-col space-y-2">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>설정</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;