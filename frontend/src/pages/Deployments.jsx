import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SearchFilter from '../components/SearchFilter';
import DeploymentTable from '../components/DeploymentTable';
import DeploymentDetailModal from '../components/DeploymentDetailModal';
import Pagination from '../components/Pagination';
// useDeploymentUpdates 제거 - 폴링으로 대체
import api from '../services/api';
import toast from 'react-hot-toast';

const Deployments = () => {
  const navigate = useNavigate();
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
    console.log('useEffect triggered - filters changed:', filters);
    fetchDeployments();
  }, [searchTerm, filters, currentPage, itemsPerPage, sortConfig]);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      if (response.data.success) {
        setProjects(response.data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      // 에러 발생 시 빈 배열로 설정
      setProjects([]);
    }
  };

  const fetchDeployments = async () => {
    try {
      console.log('fetchDeployments started, filters:', filters);
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

      if (filters.dateRange !== 'all' && filters.dateRange !== 'unlimited') {
        if (filters.dateRange === 'custom') {
          if (filters.startDate) params.append('startDate', filters.startDate);
          if (filters.endDate) params.append('endDate', filters.endDate);
        } else {
          params.append('dateRange', filters.dateRange);
        }
      }

      // Jenkins 최근 배포 데이터 가져오기 - unlimited가 아닌 경우에만 시간 제한 적용
      if (filters.dateRange !== 'unlimited') {
        params.append('hours', '720'); // 30일 범위로 설정
        console.log('Adding hours limit: 720');
      } else {
        console.log('No hours limit (unlimited)');
      }
      
      console.log('Final API URL:', `/deployments/recent?${params}`);
      const response = await api.get(`/deployments/recent?${params}`);
      console.log('API response received:', response.data);
      if (response.data.success) {
        const deploymentData = response.data.data || [];
        console.log('API data length:', deploymentData.length);
        
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
          jenkins_url: deployment.jenkinsUrl
        }));

        // 프론트엔드에서 필터링 적용
        const filteredDeployments = filterMockData(transformedData);
        const sortedDeployments = sortMockData(filteredDeployments);

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedData = sortedDeployments.slice(startIndex, endIndex);

        setDeployments(paginatedData);
        setTotalItems(sortedDeployments.length);
        setTotalPages(Math.ceil(sortedDeployments.length / itemsPerPage));
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

  const generateMockDeployments = () => {
    const statuses = ['success', 'failed', 'in_progress', 'pending'];
    const environments = ['production', 'staging', 'development'];
    const projectNames = ['harbor-frontend', 'harbor-backend', 'mobile-app', 'api-gateway', 'data-pipeline', 'microservice-auth'];
    const users = ['john.doe', 'jane.smith', 'nicolas.choi', 'mike.wilson', 'sarah.kim', 'alex.chen'];
    const branches = ['main', 'develop', 'feature/auth', 'feature/ui', 'hotfix/login', 'release/v2.1'];

    return Array.from({ length: 150 }, (_, i) => ({
      id: i + 1,
      project_name: projectNames[Math.floor(Math.random() * projectNames.length)],
      build_number: Math.floor(Math.random() * 500) + 1,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      environment: environments[Math.floor(Math.random() * environments.length)],
      deployed_by: users[Math.floor(Math.random() * users.length)],
      branch: branches[Math.floor(Math.random() * branches.length)],
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      duration: Math.floor(Math.random() * 1200) + 30,
      description: `Build ${Math.floor(Math.random() * 500) + 1} deployment`
    }));
  };

  const filterMockData = (data) => {
    return data.filter(deployment => {
      // 검색어 필터링
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matches =
          deployment.project_name.toLowerCase().includes(searchLower) ||
          deployment.build_number.toString().includes(searchLower) ||
          deployment.deployed_by.toLowerCase().includes(searchLower);
        if (!matches) return false;
      }

      // 상태 필터링
      if (filters.status !== 'all' && deployment.status !== filters.status) {
        return false;
      }

      // 환경 필터링
      if (filters.environment !== 'all' && deployment.environment !== filters.environment) {
        return false;
      }

      // 프로젝트 필터링
      if (filters.project !== 'all' && deployment.project_name !== filters.project) {
        return false;
      }

      // 날짜 필터링 ('all'과 'unlimited'는 필터링하지 않음)
      if (filters.dateRange !== 'all' && filters.dateRange !== 'unlimited') {
        const deploymentDate = new Date(deployment.created_at);
        const now = new Date();

        switch (filters.dateRange) {
          case 'today':
            if (deploymentDate.toDateString() !== now.toDateString()) return false;
            break;
          case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (deploymentDate.toDateString() !== yesterday.toDateString()) return false;
            break;
          case 'last7days':
            const week = new Date(now);
            week.setDate(week.getDate() - 7);
            if (deploymentDate < week) return false;
            break;
          case 'last30days':
            const month = new Date(now);
            month.setDate(month.getDate() - 30);
            if (deploymentDate < month) return false;
            break;
          case 'custom':
            if (filters.startDate && deploymentDate < new Date(filters.startDate)) return false;
            if (filters.endDate && deploymentDate > new Date(filters.endDate)) return false;
            break;
        }
      }

      return true;
    });
  };

  const sortMockData = (data) => {
    return [...data].sort((a, b) => {
      let aValue = a[sortConfig.field];
      let bValue = b[sortConfig.field];

      // 날짜 필드 처리
      if (sortConfig.field === 'created_at') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      }

      // 숫자 필드 처리
      if (sortConfig.field === 'build_number' || sortConfig.field === 'duration') {
        aValue = Number(aValue);
        bValue = Number(bValue);
      }

      // 문자열 필드 처리
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };

  const handleSearchChange = (newSearchTerm) => {
    setSearchTerm(newSearchTerm);
    setCurrentPage(1); // 검색 시 첫 페이지로 이동
  };

  const handleFilterChange = (newFilters) => {
    console.log('handleFilterChange called:', newFilters);
    setFilters(newFilters);
    setCurrentPage(1); // 필터 변경 시 첫 페이지로 이동
  };

  const handleSort = (newSortConfig) => {
    setSortConfig(newSortConfig);
    setCurrentPage(1); // 정렬 변경 시 첫 페이지로 이동
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handleItemsPerPageChange = (newItemsPerPage) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1); // 페이지 크기 변경 시 첫 페이지로 이동
  };

  const handleRowClick = (deployment) => {
    setSelectedDeployment(deployment);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedDeployment(null);
  };

  return (
    <div className="min-h-screen bg-primary-50">
      <Header />

      <main className="container-max section-padding space-responsive">
        {/* 페이지 헤더 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary-900 mb-2">
            배포 이력
          </h1>
          <p className="text-primary-600">
            모든 배포 기록을 검색하고 관리하세요
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
          source="deployments"
        />
      </main>
    </div>
  );
};

export default Deployments;