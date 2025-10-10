import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket, useSystemNotifications } from '../hooks/useWebSocket';
import websocketService from '../services/websocketService';
import Header from './Header';
import SearchFilter from './SearchFilter';
import DeploymentTable from './DeploymentTable';
import DeploymentDetailModal from './DeploymentDetailModal';
import Pagination from './Pagination';
import ProjectHierarchy from './ProjectHierarchy';
import FileUploadModal from './FileUploadModal';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Upload } from 'lucide-react';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isConnected, connectionState } = useWebSocket();

  // 시스템 알림 활성화 (useWebSocket을 공유하여 중복 연결 방지)
  useSystemNotifications();

  const [deployments, setDeployments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalItems, setTotalItems] = useState(0);

  // 검색 및 필터 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: 'all',
    environment: 'all',
    project: 'all',
    dateRange: 'last30days', // 기본값을 30일로 변경
    startDate: '',
    endDate: ''
  });

  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [totalPages, setTotalPages] = useState(1);

  // 정렬 상태
  const [sortConfig, setSortConfig] = useState({
    field: 'created_at',
    direction: 'desc'
  });

  // 모달 상태
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // 뷰 모드 상태 (deployments: 배포이력, projects: 프로젝트 계층)
  const [viewMode, setViewMode] = useState('projects');

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchDeployments();
  }, [currentPage, itemsPerPage, searchTerm, filters, sortConfig]);

  // WebSocket으로 실시간 배포 업데이트 수신
  useEffect(() => {
    if (!isConnected) return;

    const handleDeploymentUpdate = (updatedDeployment) => {
      if (updatedDeployment && updatedDeployment.id) {
        setDeployments(prev => 
          prev.map(deployment => 
            deployment && deployment.id === updatedDeployment.id ? updatedDeployment : deployment
          )
        );
      }
    };

    // WebSocket 서비스에서 직접 이벤트 리스닝
    websocketService.on('deployment_update', handleDeploymentUpdate);

    return () => {
      websocketService.off('deployment_update', handleDeploymentUpdate);
    };
  }, [isConnected]);

  const fetchProjects = useCallback(async () => {
    try {
      const response = await api.get('/projects');
      
      // API 응답 구조에 맞게 데이터 추출
      const projectData = response.data?.data || response.data || [];
      
      // 프로젝트를 버전 번호 기준으로 내림차순 정렬 (3.0.0, 2.0.0, 1.2.0 순서)
      const sortedProjects = projectData.sort((a, b) => {
        // 더 유연한 버전 번호 추출 (1.2, 1.2.0 모두 지원)
        const versionA = a.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        const versionB = b.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        
        if (versionA && versionB) {
          const parseVersion = (match) => {
            return [
              parseInt(match[1], 10) || 0, // 메이저
              parseInt(match[2], 10) || 0, // 마이너  
              parseInt(match[3], 10) || 0  // 패치
            ];
          };
          
          const vA = parseVersion(versionA);
          const vB = parseVersion(versionB);
          
          // 메이저, 마이너, 패치 버전을 차례로 비교 (내림차순)
          for (let i = 0; i < 3; i++) {
            if (vA[i] !== vB[i]) {
              return vB[i] - vA[i]; // 내림차순
            }
          }
          return 0; // 동일한 버전
        }
        
        // 버전이 없는 경우 이름으로 정렬
        return b.name.localeCompare(a.name);
      });
      
      setProjects(sortedProjects);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      toast.error('프로젝트 목록을 불러오는데 실패했습니다.');
      setProjects([]); // 에러 시 빈 배열로 설정
    }
  }, []);

  const fetchDeployments = async () => {
    try {
      setLoading(true);

      // API 요청 파라미터 구성
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        sort: sortConfig.field,
        order: sortConfig.direction
      });

      if (searchTerm) {
        params.append('search', searchTerm);
      }

      if (filters.status !== 'all') {
        params.append('status', filters.status);
      }

      if (filters.environment !== 'all') {
        params.append('environment', filters.environment);
      }

      if (filters.project !== 'all') {
        params.append('project', filters.project);
      }

      // 날짜 범위에 따른 시간 제한 설정
      let hoursLimit = '720'; // 기본값 30일 (30 * 24 = 720시간)
      
      if (filters.dateRange !== 'all') {
        if (filters.dateRange === 'custom') {
          if (filters.startDate) params.append('startDate', filters.startDate);
          if (filters.endDate) params.append('endDate', filters.endDate);
          // custom의 경우 시간 제한 없음
          hoursLimit = null;
        } else if (filters.dateRange === 'unlimited') {
          // 제한 없음의 경우 시간 제한 설정 안함
          hoursLimit = null;
        } else {
          // 기타 빠른 날짜 범위 설정
          params.append('dateRange', filters.dateRange);
          switch (filters.dateRange) {
            case 'today':
              hoursLimit = '24';
              break;
            case 'yesterday':
              hoursLimit = '48';
              break;
            case 'last7days':
              hoursLimit = '168'; // 7 * 24
              break;
            case 'last30days':
              hoursLimit = '720'; // 30 * 24
              break;
            default:
              hoursLimit = '720';
          }
        }
      }

      // 시간 제한이 있는 경우에만 추가
      if (hoursLimit) {
        params.append('hours', hoursLimit);
      }
      
      const apiUrl = `/deployments/recent?${params}`;
      const response = await api.get(apiUrl);
      
      // response.data가 있고 success가 true이거나, data 배열이 직접 있는 경우 처리
      const deploymentData = response.data?.data || response.data || [];
      
      if (Array.isArray(deploymentData)) {
        // 프론트엔드 형식에 맞게 데이터 변환
        const transformedData = deploymentData.map(deployment => ({
          id: deployment.id,
          project_name: deployment.projectName || deployment.project_name,
          build_number: deployment.buildNumber || deployment.build_number,
          status: deployment.status,
          environment: deployment.environment || 'development',
          deployed_by: deployment.deployedBy || deployment.deployed_by || 'Jenkins',
          branch: deployment.branch || 'main',
          created_at: deployment.deployedAt || deployment.created_at,
          duration: deployment.duration,
          description: deployment.commitMessage || deployment.description || `Build ${deployment.buildNumber || deployment.build_number} deployment`,
          jenkins_url: deployment.jenkinsUrl || deployment.jenkins_url,
          artifacts: deployment.artifacts || [],
          subJobs: deployment.subJobs || []
        }));

        setDeployments(transformedData);
        
        // API 응답에서 페이지네이션 정보 추출
        const pagination = response.data?.pagination;
        if (pagination) {
          setTotalItems(pagination.totalItems || transformedData.length);
          setTotalPages(pagination.totalPages || Math.ceil(transformedData.length / itemsPerPage));
        } else {
          setTotalItems(transformedData.length);
          setTotalPages(Math.ceil(transformedData.length / itemsPerPage));
        }
      } else {
        setDeployments([]);
        setTotalItems(0);
        setTotalPages(1);
      }

    } catch (error) {
      console.error('Failed to fetch deployments:', error);
      toast.error('배포 이력을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (newSearchTerm) => {
    setSearchTerm(newSearchTerm);
    setCurrentPage(1);
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const handleSort = (newSortConfig) => {
    setSortConfig(newSortConfig);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handleItemsPerPageChange = (newItemsPerPage) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  const handleRowClick = (deployment) => {
    setSelectedDeployment(deployment);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedDeployment(null);
  };

  const handleJobClick = useCallback((job) => {
    // 작업 클릭 시 해당 작업의 상세 정보 표시
    if (job.url) {
      window.open(job.url, '_blank');
    }
  }, []);

  const handleUploadComplete = useCallback((data) => {
    toast.success(`파일 업로드 완료: ${data.filename}`);
    // 프로젝트 목록 새로고침 (업로드된 파일이 반영될 수 있도록)
    fetchProjects();
  }, [fetchProjects]);

  if (loading) {
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
        {/* 페이지 헤더 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary-900 mb-2">
            안녕하세요, {user?.name || user?.username}님
          </h1>
          <p className="text-primary-600">
            Jenkins NAS 배포 현황을 확인하세요
          </p>
        </div>

        {/* 뷰 모드 탭 */}
        <div className="mb-6 bg-white p-4 rounded border">
          <div className="border-b border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <Upload size={16} />
                파일 업로드
              </button>
            </div>
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setViewMode('projects')}
                className={`py-2 px-4 border-b-2 font-medium text-sm cursor-pointer ${
                  viewMode === 'projects'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                프로젝트 계층 구조
              </button>
              <button
                onClick={() => setViewMode('deployments')}
                className={`py-2 px-4 border-b-2 font-medium text-sm cursor-pointer ${
                  viewMode === 'deployments'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                배포 이력
              </button>
            </nav>
          </div>
        </div>

        {/* 프로젝트 계층 뷰 */}
        {viewMode === 'projects' && (
          <ProjectHierarchy
            projects={projects}
            deployments={deployments}
            onJobClick={handleJobClick}
            className="mb-6"
          />
        )}

        {/* 배포 이력 뷰 */}
        {viewMode === 'deployments' && (
          <>
            {/* 검색 및 필터 */}
            <SearchFilter
              searchTerm={searchTerm}
              onSearchChange={handleSearchChange}
              filters={filters}
              onFilterChange={handleFilterChange}
              projects={projects}
              className="mb-6"
            />

            {/* 배포 테이블 */}
            <DeploymentTable
              deployments={deployments}
              loading={loading}
              sortConfig={sortConfig}
              onSort={handleSort}
              onRowClick={handleRowClick}
              className="mb-6"
            />

            {/* 페이지네이션 */}
            {!loading && totalItems > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                itemsPerPage={itemsPerPage}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handleItemsPerPageChange}
              />
            )}
          </>
        )}

        {/* 배포 상세 모달 - 배포 이력 뷰에서만 표시 */}
        {viewMode === 'deployments' && isModalOpen && selectedDeployment && (
          <DeploymentDetailModal
            key={`${selectedDeployment.project_name}-${selectedDeployment.build_number}`}
            deployment={selectedDeployment}
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            source="dashboard"
          />
        )}

        {/* 파일 업로드 모달 */}
        <FileUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onUploadComplete={handleUploadComplete}
        />
      </main>
    </div>
  );
};

export default Dashboard;