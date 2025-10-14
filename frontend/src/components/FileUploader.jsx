import React, { useState, useRef } from 'react';
import { uploadFile, uploadFileStream } from '../services/api';

const FileUploader = ({ currentPath, onUploadComplete, onUploadError }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // 파일 크기 제한 (2GB)
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
  const STREAM_THRESHOLD = 100 * 1024 * 1024; // 100MB 이상은 스트리밍

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validateFile = (file) => {
    // 파일 크기 체크
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`파일 크기가 너무 큽니다. (${formatFileSize(file.size)} / 최대 ${formatFileSize(MAX_FILE_SIZE)})`);
    }

    // 파일 타입 체크
    const allowedTypes = [
      'application/gzip',
      'application/x-gzip',
      'application/zip',
      'application/x-zip-compressed',
      'application/json',
      'application/octet-stream',
      'text/plain'
    ];

    const allowedExtensions = ['.tar.gz', '.zip', '.json', '.txt'];
    const hasValidExtension = allowedExtensions.some(ext =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!allowedTypes.includes(file.type) && !hasValidExtension) {
      throw new Error('지원하지 않는 파일 형식입니다. (.tar.gz, .zip, .json, .txt 파일만 허용)');
    }

    return true;
  };

  const handleUpload = async (file) => {
    try {
      console.log('📤 FileUploader: Starting upload process', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        currentPath
      });

      validateFile(file);
      setIsUploading(true);
      setProgress(0);
      setUploadStatus('업로드 준비 중...');

      const uploadPath = currentPath || '\\\\nas.roboetech.com\\release_version\\release\\upload';

      console.log('📤 FileUploader: Upload path set to:', uploadPath);

      // 파일 크기에 따라 업로드 방식 선택 (일시적으로 스트리밍 비활성화)
      const useStreaming = false; // file.size > STREAM_THRESHOLD;
      const uploadFunction = useStreaming ? uploadFileStream : uploadFile;

      console.log('📤 FileUploader: Using upload function:', useStreaming ? 'uploadFileStream' : 'uploadFile');
      console.log('📤 FileUploader: Calling upload function...');

      const result = await uploadFunction(file, uploadPath, (progressInfo) => {
        console.log('📤 FileUploader: Progress update:', progressInfo);
        setProgress(progressInfo.progress || 0);
        setUploadStatus(progressInfo.message || '');
      });

      console.log('📤 FileUploader: Upload function returned:', result);

      if (result.success) {
        console.log('📤 FileUploader: Upload successful!');
        setUploadStatus('업로드가 완료되었습니다!');
        onUploadComplete && onUploadComplete(result.data);

        // 성공 후 초기화
        setTimeout(() => {
          setIsUploading(false);
          setProgress(0);
          setUploadStatus('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }, 2000);
      } else {
        console.error('📤 FileUploader: Upload failed with result:', result);
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('📤 FileUploader: Upload error caught:', error);
      console.error('📤 FileUploader: Error stack:', error.stack);
      console.error('📤 FileUploader: Error details:', {
        message: error.message,
        name: error.name,
        code: error.code,
        response: error.response
      });

      setUploadStatus(error.message || '업로드에 실패했습니다.');
      onUploadError && onUploadError(error.message);

      setTimeout(() => {
        setIsUploading(false);
        setProgress(0);
        setUploadStatus('');
      }, 3000);
    }
  };

  const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleUpload(files[0]);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleUpload(files[0]);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setDragActive(false);
  };

  const openFileDialog = () => {
    if (!isUploading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 드래그 앤 드롭 영역 */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
          }
          ${isUploading ? 'pointer-events-none opacity-60' : ''}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={openFileDialog}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept=".tar.gz,.zip,.json,.txt"
          disabled={isUploading}
        />

        {!isUploading ? (
          <>
            <div className="text-4xl mb-2">📤</div>
            <p className="text-lg font-medium text-gray-700 mb-2">
              파일을 드래그하거나 클릭하여 업로드
            </p>
            <p className="text-sm text-gray-500">
              .tar.gz, .zip, .json, .txt 파일 (최대 {formatFileSize(MAX_FILE_SIZE)})
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {formatFileSize(STREAM_THRESHOLD)} 이상의 파일은 스트리밍 업로드됩니다
            </p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-2">⏳</div>
            <p className="text-lg font-medium text-gray-700 mb-2">
              업로드 중...
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600">{progress}%</p>
            <p className="text-xs text-gray-500 mt-1">{uploadStatus}</p>
          </>
        )}
      </div>

      {/* 업로드 상태 표시 */}
      {uploadStatus && !isUploading && (
        <div className={`
          mt-4 p-3 rounded-md text-sm
          ${uploadStatus.includes('완료') || uploadStatus.includes('성공')
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
          }
        `}>
          {uploadStatus}
        </div>
      )}

      {/* 현재 경로 표시 */}
      {currentPath && (
        <div className="mt-3 text-xs text-gray-500">
          업로드 경로: {currentPath}
        </div>
      )}
    </div>
  );
};

export default FileUploader;