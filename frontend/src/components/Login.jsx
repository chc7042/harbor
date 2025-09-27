import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const Login = () => {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 이미 로그인된 경우 대시보드로 리다이렉트
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.username.trim() || !formData.password.trim()) {
      toast.error('사용자명과 비밀번호를 입력해주세요.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await login(formData.username.trim(), formData.password);

      if (result.success) {
        toast.success('로그인되었습니다.');
        // AuthContext에서 자동으로 리다이렉트 처리
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error('로그인 중 오류가 발생했습니다.');
      console.error('Login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary-50">
        <div className="text-center">
          <div className="spinner mx-auto mb-4"></div>
          <p className="text-primary-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-primary-900 mb-2">
            Jenkins NAS 배포 이력
          </h2>
          <p className="text-primary-600">
            로그인하여 배포 이력을 확인하세요
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-card p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="username" className="sr-only">
                사용자명
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="input-primary"
                placeholder="사용자명"
                value={formData.username}
                onChange={handleInputChange}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="password" className="sr-only">
                비밀번호
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="input-primary"
                placeholder="비밀번호"
                value={formData.password}
                onChange={handleInputChange}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <button
                type="submit"
                className="btn-primary w-full flex justify-center items-center"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner mr-2"></span>
                    로그인 중...
                  </>
                ) : (
                  '로그인'
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="text-center text-sm text-primary-500">
          <p>LDAP 계정으로 로그인하세요</p>
        </div>
      </div>
    </div>
  );
};

export default Login;