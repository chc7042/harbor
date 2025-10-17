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
    dateRange: 'unlimited',
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

      // 날짜 범위에 따른 시간 제한 설정
      const dateRangeHours = {
        'today': '24',
        'yesterday': '48', 
        'last7days': '168',   // 7일
        'last30days': '720',  // 30일
        'unlimited': null,    // 제한 없음
        'all': null          // 제한 없음
      };

      const hours = dateRangeHours[filters.dateRange];
      if (hours) {
        params.append('hours', hours);
      }

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
          // 지연 로딩을 위한 아티팩트 관련 필드 추가
          version: deployment.version, // 아티팩트 로딩 시 필요
          artifacts: deployment.artifacts || [], // 초기 빈 배열
          hasArtifacts: deployment.hasArtifacts || false // 아티팩트 존재 여부
        }));

        // 배포 데이터 정렬 (배포시간 기준 최신순)
        const sortedDeployments = transformedData.sort((a, b) => {
          let aValue, bValue;

          switch (sortConfig.field) {
            case 'created_at':
              aValue = new Date(a.created_at);
              bValue = new Date(b.created_at);
              break;
            case 'project_name':
              aValue = a.project_name;
              bValue = b.project_name;
              break;
            case 'build_number':
              aValue = parseInt(a.build_number) || 0;
              bValue = parseInt(b.build_number) || 0;
              break;
            case 'status':
              aValue = a.status;
              bValue = b.status;
              break;
            default:
              aValue = new Date(a.created_at);
              bValue = new Date(b.created_at);
          }

          if (aValue < bValue) {
            return sortConfig.direction === 'asc' ? -1 : 1;
          }
          if (aValue > bValue) {
            return sortConfig.direction === 'asc' ? 1 : -1;
          }
          return 0;
        });

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


  const handleSearchChange = (newSearchTerm) => {
    setSearchTerm(newSearchTerm);
    setCurrentPage(1); // 검색 시 첫 페이지로 이동
  };

  const handleFilterChange = (newFilters) => {
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

  // 배포 정보 업데이트 처리 (아티팩트 지연 로딩용)
  const handleDeploymentUpdate = (updatedDeployment) => {
    setDeployments(prev =>
      prev.map(deployment =>
        deployment.id === updatedDeployment.id
          ? { ...deployment, artifacts: updatedDeployment.artifacts }
          : deployment
      )
    );
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
          onDeploymentUpdate={handleDeploymentUpdate}
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