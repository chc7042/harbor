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

    // Gravatar 이미지 존재 확인
    const gravatarUrl = getGravatarUrl(user.email, size);
    
    const img = new Image();
    img.onload = () => {
      setAvatarUrl(gravatarUrl);
      setUseGravatar(true);
      setIsLoading(false);
    };
    
    img.onerror = () => {
      setUseGravatar(false);
      setIsLoading(false);
    };
    
    img.src = gravatarUrl;
  }, [user?.email, size]);

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