import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket, useSystemNotifications } from '../hooks/useWebSocket';
import Header from './Header';
import ProjectStatusCard from './ProjectStatusCard';
import DeploymentChart from './DeploymentChart';
import DeploymentTimeline from './DeploymentTimeline';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isConnected, connectionState } = useWebSocket();

  // 시스템 알림 활성화
  useSystemNotifications();

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
      const response = await fetch('/api/dashboard', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        // 요약 통계 설정
        setStats({
          totalProjects: data.data.projectStats.length,
          totalDeployments: data.data.summary.totalDeployments,
          successRate: data.data.summary.successRate,
          failureRate: Math.round((100 - data.data.summary.successRate) * 10) / 10,
        });

        // 프로젝트 목록을 대시보드 형식으로 변환
        const projectsData = data.data.projectStats.map((project, index) => {
          // 상태 결정 로직
          let status = 'healthy';
          if (project.successRate < 70) {
            status = 'error';
          } else if (project.successRate < 85) {
            status = 'warning';
          }

          // 최근 배포에서 해당 프로젝트의 빌드 상태 추출
          const projectDeployments = data.data.recentDeployments
            .filter(d => d.projectName === project.name)
            .slice(0, 5);
          
          const recentBuilds = projectDeployments.map(d => d.status);
          
          // 환경 설정 (기본값: Production)
          const environment = projectDeployments.length > 0 ? 
            projectDeployments[0].environment || 'Production' : 'Production';

          // 마지막 배포 시간 계산
          let lastDeployment = '배포 없음';
          if (projectDeployments.length > 0) {
            const lastDeploy = new Date(projectDeployments[0].deployedAt);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastDeploy) / (1000 * 60));
            
            if (diffMinutes < 60) {
              lastDeployment = `${diffMinutes}분 전`;
            } else if (diffMinutes < 1440) {
              lastDeployment = `${Math.floor(diffMinutes / 60)}시간 전`;
            } else {
              lastDeployment = `${Math.floor(diffMinutes / 1440)}일 전`;
            }
          }

          return {
            id: index + 1,
            name: project.name,
            environment: environment,
            status: status,
            deployments: project.deployments,
            successRate: project.successRate,
            trend: 0, // 트렌드 데이터는 별도 계산 필요
            lastDeployment: lastDeployment,
            recentBuilds: recentBuilds.length > 0 ? recentBuilds : ['unknown']
          };
        });

        setProjects(projectsData);
      } else {
        throw new Error(data.error?.message || '데이터 조회 실패');
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
      toast.error('대시보드 데이터를 불러오는데 실패했습니다.');
      setIsLoading(false);
    }
  };

  const StatCard = ({ title, value, suffix = '', trend, icon }) => (
    <div className="card-minimal p-6 hover:scale-[1.02] transition-transform duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-primary-500 mb-2">{title}</p>
          <div className="flex items-baseline space-x-1">
            <p className="text-3xl font-bold text-primary-900 tracking-tight">
              {value}
            </p>
            {suffix && (
              <span className="text-lg font-medium text-primary-500">{suffix}</span>
            )}
          </div>
          {trend !== undefined && (
            <div className="flex items-center mt-3">
              <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                trend > 0
                  ? 'bg-success-100 text-success-700'
                  : trend < 0
                    ? 'bg-error-100 text-error-700'
                    : 'bg-primary-100 text-primary-700'
              }`}>
                {trend > 0 ? '↗' : trend < 0 ? '↘' : '→'}
                <span className="ml-1">
                  {trend > 0 ? '+' : ''}{trend}%
                </span>
              </div>
              <span className="text-xs text-primary-400 ml-2">vs last month</span>
            </div>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
              {icon}
            </div>
          </div>
        )}
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

      <main className="container-max section-padding space-responsive">
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
        <div className="grid-stats mb-8">
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
        <div className="grid-timeline mb-8">
          {/* 배포 타임라인 */}
          <DeploymentTimeline />

          {/* 프로젝트 상태 카드 */}
          <ProjectStatusCard
            projects={projects}
            isLoading={isLoading}
          />

          {/* 배포 차트 - 큰 화면에서만 표시 */}
          <div className="show-xl">
            <DeploymentChart />
          </div>
        </div>

        {/* 빠른 액션 */}
        <div className="card-minimal p-6">
          <h3 className="text-lg font-semibold text-primary-900 mb-6">빠른 액션</h3>
          <div className="grid-stats gap-responsive">
            <button
              onClick={() => navigate('/deployments')}
              className="btn-secondary p-6 h-auto flex-col space-y-3 hover:scale-[1.02] transition-all duration-200 group"
            >
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <span className="text-sm font-medium">배포 검색</span>
            </button>
            <button className="btn-secondary p-6 h-auto flex-col space-y-3 hover:scale-[1.02] transition-all duration-200 group">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-sm font-medium">통계 보기</span>
            </button>
            <button className="btn-secondary p-6 h-auto flex-col space-y-3 hover:scale-[1.02] transition-all duration-200 group">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-sm font-medium">파일 다운로드</span>
            </button>
            <button className="btn-secondary p-6 h-auto flex-col space-y-3 hover:scale-[1.02] transition-all duration-200 group">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-sm font-medium">설정</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;