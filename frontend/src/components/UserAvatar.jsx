import { useState, useEffect } from 'react';
import { getGravatarUrl, getUserInitials, generateUserColor } from '../utils/avatarUtils';

const UserAvatar = ({ user, size = 32, className = "" }) => {
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [useGravatar, setUseGravatar] = useState(false);

  useEffect(() => {
    if (!user?.email) {
      setIsLoading(false);
      return;
    }

    // Gravatar 이미지 존재 확인 (캐시 우회를 위해 타임스탬프 추가)
    const baseGravatarUrl = getGravatarUrl(user.email, size);
    const gravatarUrl = `${baseGravatarUrl}&_=${Date.now()}`;

    // 이미지 로드 테스트
    const img = new Image();
    img.onload = () => {
      setAvatarUrl(baseGravatarUrl); // 실제 표시에는 캐시 파라미터 없는 URL 사용
      setUseGravatar(true);
      setIsLoading(false);
    };
    img.onerror = () => {
      setUseGravatar(false);
      setIsLoading(false);
    };

    // 타임아웃 설정 (3초 후 fallback 사용)
    const timeout = setTimeout(() => {
      if (isLoading) {
        setUseGravatar(false);
        setIsLoading(false);
      }
    }, 3000);

    img.src = gravatarUrl;

    return () => clearTimeout(timeout);
  }, [user?.email, size, isLoading]);

  if (isLoading) {
    return (
      <div
        className={`rounded-full bg-gray-200 animate-pulse flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <div className="w-4 h-4 bg-gray-300 rounded-full"></div>
      </div>
    );
  }

  if (useGravatar && avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${user?.name || user?.username} avatar`}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
        onError={() => {
          setUseGravatar(false);
          setAvatarUrl(null);
        }}
      />
    );
  }

  // Fallback: 이니셜 아바타
  const initials = getUserInitials(user);
  const backgroundColor = generateUserColor(user?.username);
  const fontSize = size > 40 ? '16px' : size > 24 ? '14px' : '12px';

  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-medium ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor,
        fontSize
      }}
    >
      {initials}
    </div>
  );
};

export default UserAvatar;