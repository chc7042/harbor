import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket, useSystemNotifications } from '../hooks/useWebSocket';
import Header from './Header';
import SearchFilter from './SearchFilter';
import DeploymentTable from './DeploymentTable';
import DeploymentDetailModal from './DeploymentDetailModal';
import Pagination from './Pagination';
import { useDeploymentUpdates } from '../hooks/useWebSocket';
import api from '../services/api';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isConnected, connectionState } = useWebSocket();

  // 시스템 알림 활성화
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
    dateRange: 'all',
    startDate: '',
    endDate: ''
  });

  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [totalPages, setTotalPages] = useState(1);

  // 정렬 상태
  const [sortConfig, setSortConfig] = useState({
    field: 'created_at',
    direction: 'desc'
  });

  // 모달 상태
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchDeployments();
  }, [currentPage, itemsPerPage, searchTerm, filters, sortConfig]);

  // WebSocket으로 실시간 배포 업데이트 수신
  useDeploymentUpdates((updatedDeployment) => {
    setDeployments(prev => 
      prev.map(deployment => 
        deployment.id === updatedDeployment.id ? updatedDeployment : deployment
      )
    );
  });

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data || []);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      toast.error('프로젝트 목록을 불러오는데 실패했습니다.');
    }
  };

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

      if (filters.dateRange !== 'all') {
        if (filters.dateRange === 'custom') {
          if (filters.startDate) params.append('startDate', filters.startDate);
          if (filters.endDate) params.append('endDate', filters.endDate);
        } else {
          params.append('dateRange', filters.dateRange);
        }
      }

      // Jenkins 최근 배포 데이터 가져오기
      params.append('hours', '720'); // 30일 범위로 설정
      
      const response = await api.get(`/deployments/recent?${params}`);
      if (response.data.success) {
        const deploymentData = response.data.data || [];
        
        // 프론트엔드 형식에 맞게 데이터 변환
        const transformedData = deploymentData.map(deployment => ({
          id: deployment.id,
          project_name: deployment.projectName,
          build_number: deployment.buildNumber,
          status: deployment.status,
          environment: deployment.environment || 'development',
          deployed_by: deployment.deployedBy || 'Jenkins',
          branch: deployment.branch || 'main',
          created_at: deployment.deployedAt,
          duration: deployment.duration,
          description: deployment.commitMessage || `Build ${deployment.buildNumber} deployment`,
          jenkins_url: deployment.jenkinsUrl,
          artifacts: deployment.artifacts || []
        }));

        setDeployments(transformedData);
        setTotalItems(transformedData.length);
        setTotalPages(Math.ceil(transformedData.length / itemsPerPage));
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
        {!loading && deployments.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handleItemsPerPageChange}
          />
        )}

        {/* 배포 상세 모달 */}
        <DeploymentDetailModal
          deployment={selectedDeployment}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      </main>
    </div>
  );
};

export default Dashboard;