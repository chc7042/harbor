import React, { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import FileUploader from './FileUploader';

const FileUploadModal = ({ isOpen, onClose, onUploadComplete }) => {
  const currentPath = '\\\\nas.roboetech.com\\release_version\\release\\upload';
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);

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

  const handleOpenSharedFolder = async () => {
    try {
      setIsOpeningFolder(true);

      // upload 폴더에 대한 공유 링크 가져오기
      const response = await fetch('/deployments/share/upload', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.shareUrl) {
          // 새 창에서 공유 폴더 열기
          window.open(data.shareUrl, '_blank');
        } else {
          throw new Error(data.error || '공유 폴더 링크 생성에 실패했습니다.');
        }
      } else {
        throw new Error('서버 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('공유 폴더 열기 실패:', error);
      alert(`공유 폴더 열기에 실패했습니다: ${error.message}`);
    } finally {
      setIsOpeningFolder(false);
    }
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
            <div className="flex space-x-2">
              <input
                type="text"
                value={currentPath}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600 cursor-not-allowed"
                placeholder="\\\\nas.roboetech.com\\release_version\\release\\upload"
              />
              <button
                onClick={handleOpenSharedFolder}
                disabled={isOpeningFolder}
                className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                title="공유 폴더 열기"
              >
                <FolderOpen size={16} />
                <span className="text-sm">
                  {isOpeningFolder ? '열기 중...' : '폴더 열기'}
                </span>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              '폴더 열기' 버튼으로 브라우저에서 업로드 폴더를 확인할 수 있습니다.
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