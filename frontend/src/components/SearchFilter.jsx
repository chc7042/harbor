import React from 'react';
import { Search, X } from 'lucide-react';

const SearchFilter = ({
  searchTerm = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  projects = [],
  className = ''
}) => {

  const statusOptions = [
    { value: 'all', label: '전체 상태' },
    { value: 'success', label: '성공' },
    { value: 'failed', label: '실패' },
    { value: 'in_progress', label: '진행중' },
    { value: 'pending', label: '대기중' }
  ];

  const dateRangeOptions = [
    { value: 'all', label: '전체 기간' },
    { value: 'today', label: '오늘' },
    { value: 'yesterday', label: '어제' },
    { value: 'last7days', label: '지난 7일' },
    { value: 'last30days', label: '지난 30일' },
    { value: 'unlimited', label: '제한 없음' }
  ];

  const handleFilterChange = (key, value) => {
    onFilterChange({
      ...filters,
      [key]: value
    });
  };

  return (
    <div className={`bg-white p-4 rounded-lg shadow-sm border border-gray-200 ${className}`}>
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
        
        {/* 검색 입력 */}
        <div className="flex-1 relative min-w-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="프로젝트명, 빌드 번호로 검색..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 상태 필터 */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">상태:</label>
          <select
            value={filters.status || 'all'}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-w-[120px]"
          >
            {statusOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* 기간 필터 */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">기간:</label>
          <select
            value={filters.dateRange || 'all'}
            onChange={(e) => handleFilterChange('dateRange', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-w-[120px]"
          >
            {dateRangeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* 프로젝트 필터 */}
        {projects.length > 0 && (
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">프로젝트:</label>
            <select
              value={filters.project || 'all'}
              onChange={(e) => handleFilterChange('project', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-w-[140px]"
            >
              <option value="all">전체 프로젝트</option>
              {projects.map(project => (
                <option key={project.id || project.name} value={project.name}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 필터 초기화 버튼 */}
        {(searchTerm || filters.status !== 'all' || filters.dateRange !== 'unlimited' || filters.project !== 'all') && (
          <button
            onClick={() => {
              onSearchChange('');
              onFilterChange({
                status: 'all',
                dateRange: 'unlimited',
                project: 'all',
                environment: 'all',
                startDate: '',
                endDate: ''
              });
            }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
          >
            초기화
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchFilter;