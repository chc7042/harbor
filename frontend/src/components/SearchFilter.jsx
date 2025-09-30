import React, { useState, useRef, useEffect } from 'react';
import { Search, Filter, Calendar, ChevronDown, X, Clock } from 'lucide-react';

const SearchFilter = ({
  searchTerm = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  projects = [],
  className = ''
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const filterRef = useRef(null);
  const datePickerRef = useRef(null);

  // 클릭 외부 감지
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsFilterOpen(false);
      }
      if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
        setIsDatePickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const statusOptions = [
    { value: 'all', label: '전체 상태', color: 'text-gray-600' },
    { value: 'success', label: '성공', color: 'text-green-600' },
    { value: 'failed', label: '실패', color: 'text-red-600' },
    { value: 'in_progress', label: '진행중', color: 'text-blue-600' },
    { value: 'pending', label: '대기중', color: 'text-yellow-600' }
  ];

  const environmentOptions = [
    { value: 'all', label: '전체 환경' },
    { value: 'production', label: 'Production' },
    { value: 'staging', label: 'Staging' },
    { value: 'development', label: 'Development' }
  ];

  const quickDateRanges = [
    { value: 'today', label: '오늘' },
    { value: 'yesterday', label: '어제' },
    { value: 'last7days', label: '지난 7일' },
    { value: 'last30days', label: '지난 30일' },
    { value: 'unlimited', label: '제한 없음' },
    { value: 'custom', label: '사용자 정의' }
  ];

  const handleFilterUpdate = (key, value) => {
    onFilterChange({
      ...filters,
      [key]: value
    });
  };

  const clearAllFilters = () => {
    onFilterChange({
      status: 'all',
      environment: 'all',
      project: 'all',
      dateRange: 'all',
      startDate: '',
      endDate: ''
    });
    onSearchChange('');
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.status && filters.status !== 'all') count++;
    if (filters.environment && filters.environment !== 'all') count++;
    if (filters.project && filters.project !== 'all') count++;
    if (filters.dateRange && filters.dateRange !== 'all') count++;
    if (searchTerm) count++;
    return count;
  };

  const activeFilterCount = getActiveFilterCount();

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 검색바 및 필터 버튼 */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* 검색 입력 */}
        <div className="flex-1 relative">
          <div className="search-bar">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="프로젝트명, 빌드 번호, 배포자로 검색..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="search-input pl-10"
            />
            {searchTerm && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-primary-400 hover:text-primary-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 필터 버튼 */}
        <div className="flex items-center space-x-2">
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`btn-secondary flex items-center space-x-2 relative ${
                activeFilterCount > 0 ? 'bg-primary-100 border-primary-400' : ''
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">필터</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
              {activeFilterCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* 필터 드롭다운 */}
            {isFilterOpen && (
              <div className="dropdown-menu w-80 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-primary-900">필터</h3>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="text-xs text-primary-600 hover:text-primary-800"
                    >
                      전체 초기화
                    </button>
                  )}
                </div>

                {/* 상태 필터 */}
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-2">상태</label>
                  <select
                    value={filters.status || 'all'}
                    onChange={(e) => handleFilterUpdate('status', e.target.value)}
                    className="input-primary w-full"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 환경 필터 */}
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-2">환경</label>
                  <select
                    value={filters.environment || 'all'}
                    onChange={(e) => handleFilterUpdate('environment', e.target.value)}
                    className="input-primary w-full"
                  >
                    {environmentOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 프로젝트 필터 */}
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-2">프로젝트</label>
                  <select
                    value={filters.project || 'all'}
                    onChange={(e) => handleFilterUpdate('project', e.target.value)}
                    className="input-primary w-full"
                  >
                    <option value="all">전체 프로젝트</option>
                    {projects.map((project) => (
                      <option key={project.id || project.name} value={project.name}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 날짜 범위 필터 */}
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-2">날짜 범위</label>
                  <select
                    value={filters.dateRange || 'all'}
                    onChange={(e) => handleFilterUpdate('dateRange', e.target.value)}
                    className="input-primary w-full mb-2"
                  >
                    <option value="all">전체 기간</option>
                    {quickDateRanges.map((range) => (
                      <option key={range.value} value={range.value}>
                        {range.label}
                      </option>
                    ))}
                  </select>

                  {/* 사용자 정의 날짜 범위 */}
                  {filters.dateRange === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-primary-600 mb-1">시작일</label>
                        <input
                          type="date"
                          value={filters.startDate || ''}
                          onChange={(e) => handleFilterUpdate('startDate', e.target.value)}
                          className="input-primary text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-primary-600 mb-1">종료일</label>
                        <input
                          type="date"
                          value={filters.endDate || ''}
                          onChange={(e) => handleFilterUpdate('endDate', e.target.value)}
                          className="input-primary text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 날짜 범위 빠른 선택 */}
          <div className="relative" ref={datePickerRef}>
            <button
              onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
              className="btn-secondary flex items-center space-x-2"
            >
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">날짜</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isDatePickerOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDatePickerOpen && (
              <div className="dropdown-menu w-48 p-2">
                {quickDateRanges.slice(0, -1).map((range) => (
                  <button
                    key={range.value}
                    onClick={() => {
                      handleFilterUpdate('dateRange', range.value);
                      setIsDatePickerOpen(false);
                    }}
                    className={`dropdown-item ${
                      filters.dateRange === range.value ? 'bg-primary-100 text-primary-900' : ''
                    }`}
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    {range.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 활성 필터 표시 */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-primary-600">활성 필터:</span>

          {searchTerm && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              검색: "{searchTerm}"
              <button
                onClick={() => onSearchChange('')}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filters.status && filters.status !== 'all' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              상태: {statusOptions.find(s => s.value === filters.status)?.label}
              <button
                onClick={() => handleFilterUpdate('status', 'all')}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filters.environment && filters.environment !== 'all' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              환경: {environmentOptions.find(e => e.value === filters.environment)?.label}
              <button
                onClick={() => handleFilterUpdate('environment', 'all')}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filters.project && filters.project !== 'all' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              프로젝트: {filters.project}
              <button
                onClick={() => handleFilterUpdate('project', 'all')}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filters.dateRange && filters.dateRange !== 'all' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
              날짜: {quickDateRanges.find(d => d.value === filters.dateRange)?.label || '사용자 정의'}
              <button
                onClick={() => handleFilterUpdate('dateRange', 'all')}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            onClick={clearAllFilters}
            className="text-xs text-primary-600 hover:text-primary-800 underline"
          >
            전체 초기화
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchFilter;