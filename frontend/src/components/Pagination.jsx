import React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

const Pagination = ({
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  itemsPerPage = 20,
  onPageChange,
  onItemsPerPageChange,
  className = ''
}) => {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const getVisiblePages = () => {
    const delta = 2; // 현재 페이지 주변에 보여줄 페이지 수
    const range = [];
    const rangeWithDots = [];

    // 시작과 끝 범위 계산
    let start = Math.max(1, currentPage - delta);
    let end = Math.min(totalPages, currentPage + delta);

    // 페이지 번호 배열 생성
    for (let i = start; i <= end; i++) {
      range.push(i);
    }

    // 첫 페이지와의 간격이 있으면 점 추가
    if (start > 2) {
      rangeWithDots.push(1, '...');
    } else if (start === 2) {
      rangeWithDots.push(1);
    }

    // 메인 범위 추가
    rangeWithDots.push(...range);

    // 마지막 페이지와의 간격이 있으면 점 추가
    if (end < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else if (end === totalPages - 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange(page);
    }
  };

  const itemsPerPageOptions = [10, 20, 50, 100];

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0 ${className}`}>
      {/* 페이지 정보 및 항목 수 선택 */}
      <div className="flex items-center space-x-4 text-sm text-gray-600">
        <div>
          <span className="font-medium text-primary-900">{startItem}-{endItem}</span>
          <span className="mx-1">of</span>
          <span className="font-medium text-primary-900">{totalItems}</span>
          <span className="ml-1">항목</span>
        </div>

        <div className="flex items-center space-x-2">
          <label htmlFor="itemsPerPage" className="text-sm">
            페이지당:
          </label>
          <select
            id="itemsPerPage"
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange?.(Number(e.target.value))}
            className="input-primary text-sm w-auto min-w-0"
          >
            {itemsPerPageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 페이지네이션 컨트롤 */}
      <div className="flex items-center space-x-1">
        {/* 이전 페이지 버튼 */}
        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`p-2 rounded-lg transition-colors ${
            currentPage === 1
              ? 'text-gray-400 cursor-not-allowed'
              : 'text-gray-600 hover:text-primary-900 hover:bg-primary-50'
          }`}
          aria-label="이전 페이지"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* 페이지 번호들 */}
        <div className="flex items-center space-x-1">
          {getVisiblePages().map((page, index) => {
            if (page === '...') {
              return (
                <span key={`dots-${index}`} className="px-3 py-2 text-gray-400">
                  <MoreHorizontal className="w-4 h-4" />
                </span>
              );
            }

            const isCurrentPage = page === currentPage;

            return (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isCurrentPage
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-primary-900 hover:bg-primary-50'
                }`}
                aria-label={`페이지 ${page}`}
                aria-current={isCurrentPage ? 'page' : undefined}
              >
                {page}
              </button>
            );
          })}
        </div>

        {/* 다음 페이지 버튼 */}
        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`p-2 rounded-lg transition-colors ${
            currentPage === totalPages
              ? 'text-gray-400 cursor-not-allowed'
              : 'text-gray-600 hover:text-primary-900 hover:bg-primary-50'
          }`}
          aria-label="다음 페이지"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 빠른 페이지 이동 (모바일에서 숨김) */}
      <div className="hidden sm:flex items-center space-x-2 text-sm">
        <label htmlFor="gotoPage" className="text-gray-600">
          페이지 이동:
        </label>
        <input
          id="gotoPage"
          type="number"
          min="1"
          max={totalPages}
          placeholder={currentPage.toString()}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              const page = parseInt(e.target.value);
              if (page >= 1 && page <= totalPages) {
                handlePageChange(page);
                e.target.value = '';
              }
            }
          }}
          className="input-primary w-16 text-center text-sm"
        />
        <span className="text-gray-400">/ {totalPages}</span>
      </div>
    </div>
  );
};

export default Pagination;