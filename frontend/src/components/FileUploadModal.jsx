import React, { useState } from 'react';
import { X } from 'lucide-react';
import FileUploader from './FileUploader';

const FileUploadModal = ({ isOpen, onClose, onUploadComplete }) => {
  const [currentPath, setCurrentPath] = useState('/nas/release_version/');

  const handleUploadComplete = (data) => {
    console.log('Upload completed:', data);
    if (onUploadComplete) {
      onUploadComplete(data);
    }
    // 성공 알림 후 모달 닫기
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  const handleUploadError = (error) => {
    console.error('Upload error:', error);
    // 에러는 FileUploader 컴포넌트에서 처리됨
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            파일 업로드
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* 컨텐츠 */}
        <div className="p-6">
          {/* 경로 입력 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              업로드 경로
            </label>
            <input
              type="text"
              value={currentPath}
              onChange={(e) => setCurrentPath(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="/nas/release_version/"
            />
            <p className="text-xs text-gray-500 mt-1">
              파일이 업로드될 NAS 경로를 입력하세요
            </p>
          </div>

          {/* 파일 업로더 */}
          <FileUploader
            currentPath={currentPath}
            onUploadComplete={handleUploadComplete}
            onUploadError={handleUploadError}
          />
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-lg">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileUploadModal;