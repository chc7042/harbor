# Jenkins NAS 배포 이력 관리 - API 명세서

## 개요

Jenkins NAS 배포 이력 관리 시스템의 REST API 명세서입니다. 모든 API는 JSON 형식으로 데이터를 주고받으며, JWT 토큰 기반 인증을 사용합니다.

**Base URL**: `http://localhost:3001/api` (개발) / `https://your-domain.com/api` (프로덕션)

## 인증 (Authentication)

### JWT 토큰 기반 인증
- 모든 보호된 엔드포인트는 `Authorization: Bearer <token>` 헤더 필요
- 토큰 만료 시간: 1시간
- Refresh 토큰을 통한 자동 갱신 지원

### 인증 관련 엔드포인트

#### POST /auth/login
사용자 로그인 (LDAP 인증)

**요청**
```json
{
  "username": "john.doe",
  "password": "user_password"
}
```

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "john.doe",
      "name": "John Doe",
      "email": "john.doe@company.com",
      "department": "Engineering"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 3600
    }
  }
}
```

**응답 (401 Unauthorized)**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "사용자명 또는 비밀번호가 올바르지 않습니다."
  }
}
```

#### POST /auth/refresh
Access 토큰 갱신

**요청**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

#### POST /auth/logout
사용자 로그아웃

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 (200 OK)**
```json
{
  "success": true,
  "message": "로그아웃 되었습니다."
}
```

#### GET /auth/me
현재 사용자 정보 조회

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "john.doe",
      "name": "John Doe",
      "email": "john.doe@company.com",
      "department": "Engineering",
      "lastLogin": "2025-01-15T10:30:00Z"
    }
  }
}
```

## 배포 이력 관리 (Deployments)

### GET /deployments
배포 이력 목록 조회 (페이지네이션, 필터링, 정렬 지원)

**쿼리 파라미터**
- `page` (integer, optional): 페이지 번호 (기본값: 1)
- `limit` (integer, optional): 페이지당 항목 수 (기본값: 20, 최대: 100)
- `search` (string, optional): 프로젝트명 검색
- `status` (string, optional): 배포 상태 필터 (success, failed, in_progress)
- `project` (string, optional): 특정 프로젝트 필터
- `dateFrom` (string, optional): 시작 날짜 (ISO 8601 형식)
- `dateTo` (string, optional): 종료 날짜 (ISO 8601 형식)
- `sortBy` (string, optional): 정렬 기준 (createdAt, projectName, buildNumber)
- `sortOrder` (string, optional): 정렬 순서 (asc, desc, 기본값: desc)

**요청 예시**
```
GET /api/deployments?page=1&limit=10&status=success&sortBy=createdAt&sortOrder=desc
```

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "deployments": [
      {
        "id": "deployment_001",
        "projectName": "web-frontend",
        "buildNumber": 245,
        "status": "success",
        "deployedAt": "2025-01-15T10:30:00Z",
        "jenkins": {
          "jobUrl": "https://jenkins.company.com/job/web-frontend/245/",
          "gitCommit": "abc123def456",
          "gitBranch": "main"
        },
        "artifacts": [
          {
            "filename": "web-frontend-v1.2.0.war",
            "path": "/mnt/nas/web-frontend/245/web-frontend-v1.2.0.war",
            "size": 25678934,
            "checksum": "sha256:abc123..."
          }
        ],
        "metadata": {
          "duration": 120,
          "triggeredBy": "john.doe"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 15,
      "totalItems": 289,
      "itemsPerPage": 20,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### GET /deployments/:id
특정 배포 상세 정보 조회

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "deployment": {
      "id": "deployment_001",
      "projectName": "web-frontend",
      "buildNumber": 245,
      "status": "success",
      "deployedAt": "2025-01-15T10:30:00Z",
      "jenkins": {
        "jobName": "web-frontend",
        "jobUrl": "https://jenkins.company.com/job/web-frontend/245/",
        "buildUrl": "https://jenkins.company.com/job/web-frontend/245/console",
        "gitCommit": "abc123def456",
        "gitBranch": "main",
        "gitCommitMessage": "Fix user authentication bug"
      },
      "artifacts": [
        {
          "filename": "web-frontend-v1.2.0.war",
          "path": "/mnt/nas/web-frontend/245/web-frontend-v1.2.0.war",
          "size": 25678934,
          "checksum": "sha256:abc123...",
          "downloadUrl": "/api/deployments/deployment_001/artifacts/0/download"
        }
      ],
      "metadata": {
        "duration": 120,
        "triggeredBy": "john.doe",
        "parameters": {
          "environment": "production",
          "version": "1.2.0"
        }
      },
      "logs": {
        "buildLog": "Build log content...",
        "deployLog": "Deployment log content..."
      }
    }
  }
}
```

### POST /deployments
새 배포 정보 생성 (Jenkins Webhook용)

**요청 헤더**
```
X-Jenkins-Signature: sha256=<signature>
Content-Type: application/json
```

**요청**
```json
{
  "project": "web-frontend",
  "buildNumber": 246,
  "status": "success",
  "timestamp": "2025-01-15T11:00:00Z",
  "jenkins": {
    "jobName": "web-frontend",
    "jobUrl": "https://jenkins.company.com/job/web-frontend/246/",
    "gitCommit": "def456ghi789",
    "gitBranch": "main",
    "gitCommitMessage": "Add new dashboard feature"
  },
  "artifacts": [
    {
      "filename": "web-frontend-v1.2.1.war",
      "path": "/nas/artifacts/web-frontend/246/web-frontend-v1.2.1.war",
      "size": 25879456,
      "checksum": "sha256:def456..."
    }
  ],
  "metadata": {
    "duration": 135,
    "triggeredBy": "jane.smith",
    "parameters": {
      "environment": "production",
      "version": "1.2.1"
    }
  }
}
```

**응답 (201 Created)**
```json
{
  "success": true,
  "data": {
    "deployment": {
      "id": "deployment_002",
      "projectName": "web-frontend",
      "buildNumber": 246,
      "status": "success",
      "createdAt": "2025-01-15T11:00:00Z"
    }
  }
}
```

### GET /deployments/:id/artifacts/:index/download
아티팩트 파일 다운로드

**응답 (200 OK)**
- Content-Type: application/octet-stream
- Content-Disposition: attachment; filename="web-frontend-v1.2.0.war"
- 파일 바이너리 데이터

**응답 (404 Not Found)**
```json
{
  "success": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "요청한 파일을 찾을 수 없습니다."
  }
}
```

## 대시보드 통계 (Dashboard)

### GET /dashboard/stats
대시보드 통계 정보 조회

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalProjects": 25,
      "totalDeployments": 1247,
      "successRate": 92.5,
      "failureRate": 7.5,
      "lastUpdated": "2025-01-15T11:30:00Z"
    },
    "recentActivity": {
      "last24Hours": {
        "deployments": 15,
        "successes": 13,
        "failures": 2
      },
      "last7Days": {
        "deployments": 98,
        "successes": 91,
        "failures": 7
      }
    },
    "topProjects": [
      {
        "projectName": "web-frontend",
        "deploymentCount": 156,
        "successRate": 94.2,
        "lastDeployment": "2025-01-15T11:00:00Z"
      },
      {
        "projectName": "api-backend",
        "deploymentCount": 134,
        "successRate": 89.6,
        "lastDeployment": "2025-01-15T09:30:00Z"
      }
    ]
  }
}
```

### GET /dashboard/timeline
배포 타임라인 조회 (최근 24시간)

**쿼리 파라미터**
- `hours` (integer, optional): 조회할 시간 범위 (기본값: 24, 최대: 168)

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "timeline": [
      {
        "timestamp": "2025-01-15T11:00:00Z",
        "deployments": [
          {
            "id": "deployment_002",
            "projectName": "web-frontend",
            "buildNumber": 246,
            "status": "success"
          }
        ]
      },
      {
        "timestamp": "2025-01-15T10:30:00Z",
        "deployments": [
          {
            "id": "deployment_001",
            "projectName": "web-frontend",
            "buildNumber": 245,
            "status": "success"
          }
        ]
      }
    ]
  }
}
```

### GET /dashboard/charts/success-rate
성공률 차트 데이터 조회

**쿼리 파라미터**
- `period` (string, optional): 기간 (daily, weekly, monthly, 기본값: daily)
- `days` (integer, optional): 조회할 일수 (기본값: 30, 최대: 365)

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "chart": {
      "labels": ["2025-01-10", "2025-01-11", "2025-01-12", "2025-01-13", "2025-01-14", "2025-01-15"],
      "datasets": [
        {
          "label": "성공률 (%)",
          "data": [95.2, 87.5, 100.0, 92.3, 88.9, 93.8],
          "backgroundColor": "#10B981"
        },
        {
          "label": "실패율 (%)",
          "data": [4.8, 12.5, 0.0, 7.7, 11.1, 6.2],
          "backgroundColor": "#EF4444"
        }
      ]
    }
  }
}
```

## 프로젝트 관리 (Projects)

### GET /projects
프로젝트 목록 조회

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "name": "web-frontend",
        "displayName": "Web Frontend",
        "description": "React-based web application",
        "totalDeployments": 156,
        "successRate": 94.2,
        "lastDeployment": {
          "buildNumber": 246,
          "status": "success",
          "deployedAt": "2025-01-15T11:00:00Z"
        },
        "isActive": true
      },
      {
        "name": "api-backend",
        "displayName": "API Backend",
        "description": "Node.js REST API server",
        "totalDeployments": 134,
        "successRate": 89.6,
        "lastDeployment": {
          "buildNumber": 89,
          "status": "success",
          "deployedAt": "2025-01-15T09:30:00Z"
        },
        "isActive": true
      }
    ]
  }
}
```

### GET /projects/:name
특정 프로젝트 상세 정보 조회

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "project": {
      "name": "web-frontend",
      "displayName": "Web Frontend",
      "description": "React-based web application",
      "statistics": {
        "totalDeployments": 156,
        "successRate": 94.2,
        "avgBuildTime": 125,
        "lastWeekDeployments": 8
      },
      "lastDeployment": {
        "id": "deployment_002",
        "buildNumber": 246,
        "status": "success",
        "deployedAt": "2025-01-15T11:00:00Z",
        "gitCommit": "def456ghi789"
      },
      "recentDeployments": [
        {
          "id": "deployment_002",
          "buildNumber": 246,
          "status": "success",
          "deployedAt": "2025-01-15T11:00:00Z"
        }
      ]
    }
  }
}
```

## WebSocket 실시간 통신

### 연결 설정
```javascript
const ws = new WebSocket('ws://localhost:3001');

// 인증 (연결 직후 실행)
ws.send(JSON.stringify({
  type: 'auth',
  token: 'Bearer <access_token>'
}));
```

### 메시지 타입

#### 새 배포 알림
```json
{
  "type": "deployment.created",
  "data": {
    "deployment": {
      "id": "deployment_003",
      "projectName": "api-backend",
      "buildNumber": 90,
      "status": "in_progress",
      "deployedAt": "2025-01-15T12:00:00Z"
    }
  }
}
```

#### 배포 상태 업데이트
```json
{
  "type": "deployment.updated",
  "data": {
    "deployment": {
      "id": "deployment_003",
      "status": "success",
      "completedAt": "2025-01-15T12:02:30Z"
    }
  }
}
```

## 헬스체크 및 시스템 정보

### GET /health
서버 헬스체크

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-15T12:00:00Z",
    "uptime": 86400,
    "version": "1.0.0",
    "services": {
      "database": "healthy",
      "nas": "healthy",
      "ldap": "healthy"
    }
  }
}
```

### GET /metrics
시스템 메트릭 정보 (모니터링용)

**응답 (200 OK)**
```json
{
  "success": true,
  "data": {
    "system": {
      "memory": {
        "used": 245760000,
        "total": 2147483648,
        "percentage": 11.4
      },
      "cpu": {
        "usage": 15.7
      }
    },
    "application": {
      "activeConnections": 23,
      "requestsPerMinute": 145,
      "averageResponseTime": 85
    },
    "database": {
      "connections": 5,
      "queries": 1247,
      "avgQueryTime": 12
    }
  }
}
```

## 에러 코드 및 응답 형식

### 에러 응답 형식
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "에러 메시지",
    "details": "상세 정보 (선택적)"
  }
}
```

### 공통 에러 코드
- `INVALID_REQUEST`: 잘못된 요청 (400)
- `UNAUTHORIZED`: 인증 실패 (401)
- `FORBIDDEN`: 권한 없음 (403)
- `NOT_FOUND`: 리소스를 찾을 수 없음 (404)
- `VALIDATION_ERROR`: 입력 값 검증 실패 (422)
- `INTERNAL_ERROR`: 서버 내부 오류 (500)
- `SERVICE_UNAVAILABLE`: 서비스 이용 불가 (503)

### 인증 관련 에러 코드
- `INVALID_CREDENTIALS`: 로그인 정보 오류
- `TOKEN_EXPIRED`: 토큰 만료
- `TOKEN_INVALID`: 유효하지 않은 토큰
- `LDAP_CONNECTION_ERROR`: LDAP 서버 연결 실패

### 배포 관련 에러 코드
- `DEPLOYMENT_NOT_FOUND`: 배포 정보를 찾을 수 없음
- `INVALID_WEBHOOK`: 유효하지 않은 Webhook 요청
- `FILE_NOT_FOUND`: 파일을 찾을 수 없음
- `NAS_ACCESS_ERROR`: NAS 접근 오류

이 API 명세서는 Jenkins NAS 배포 이력 관리 시스템의 모든 엔드포인트와 데이터 형식을 정의합니다. 실제 구현 시 이 명세를 기준으로 개발하시기 바랍니다.