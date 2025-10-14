import React, { createContext, useContext, useReducer, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

const initialState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  token: null,
};

const authReducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
        token: action.payload.token,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        token: null,
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    case 'AUTH_ERROR':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        token: null,
      };
    default:
      return state;
  }
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    checkAuthStatus();
  }, []);


  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('token');

      if (!token) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      // 토큰이 있으면 사용자 정보 확인
      const response = await api.get('/auth/me');

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user: response.data.user,
          token,
        },
      });
    } catch (error) {
      // 토큰이 유효하지 않으면 로컬 스토리지 정리
      localStorage.removeItem('token');
      dispatch({ type: 'AUTH_ERROR' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const login = async (username, password) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });

      const response = await api.post('/auth/login', {
        username,
        password,
      });

      const { user, token } = response.data;

      // 토큰을 로컬 스토리지에 저장
      localStorage.setItem('token', token);

      // API 기본 헤더 설정
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: { user, token },
      });

      return { success: true };
    } catch (error) {
      dispatch({ type: 'AUTH_ERROR' });

      // 에러 코드별 메시지 매핑
      const errorCode = error.response?.data?.error?.code;
      const serverMessage = error.response?.data?.error?.message;
      
      let errorMessage = '로그인 중 오류가 발생했습니다.';
      
      switch (errorCode) {
        case 'USER_NOT_FOUND':
          errorMessage = '사용자를 찾을 수 없습니다.';
          break;
        case 'INVALID_CREDENTIALS':
          errorMessage = '사용자명 또는 비밀번호가 올바르지 않습니다.';
          break;
        case 'ACCESS_DENIED':
          errorMessage = '이 애플리케이션에 접근할 권한이 없습니다.';
          break;
        case 'LDAP_ERROR':
          errorMessage = 'LDAP 서버 연결에 실패했습니다. 관리자에게 문의하세요.';
          break;
        case 'DATABASE_ERROR':
          errorMessage = '데이터베이스 연결에 실패했습니다. 관리자에게 문의하세요.';
          break;
        case 'DATABASE_AUTH_ERROR':
          errorMessage = '데이터베이스 인증에 실패했습니다. 관리자에게 문의하세요.';
          break;
        case 'VALIDATION_ERROR':
          errorMessage = serverMessage || '입력 정보를 확인해주세요.';
          break;
        default:
          // 서버에서 제공한 메시지가 있으면 사용, 없으면 기본 메시지
          errorMessage = serverMessage || '로그인 중 오류가 발생했습니다.';
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  };

  const logout = async () => {
    try {
      // 서버에 로그아웃 요청
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // 로컬 상태 및 스토리지 정리
      localStorage.removeItem('token');
      delete api.defaults.headers.common['Authorization'];

      dispatch({ type: 'LOGOUT' });
    }
  };


  const value = {
    ...state,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};