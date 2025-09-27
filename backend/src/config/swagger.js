const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

/**
 * Swagger/OpenAPI 설정
 */
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Jenkins NAS 배포 이력 관리 API',
      version: '1.0.0',
      description: 'Jenkins NAS 배포 이력을 관리하는 웹 애플리케이션의 RESTful API 문서',
      contact: {
        name: 'Development Team',
        email: 'dev@roboetech.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3002',
        description: '개발 서버',
      },
      {
        url: 'https://api.harbor.roboetech.com',
        description: '프로덕션 서버',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT 토큰을 Bearer 스키마로 전송',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'refreshToken',
          description: 'Refresh 토큰 쿠키',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  example: 'INVALID_REQUEST',
                },
                message: {
                  type: 'string',
                  example: '요청이 유효하지 않습니다.',
                },
                details: {
                  type: 'string',
                  example: '상세 오류 정보',
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  example: '2025-09-26T13:30:00.000Z',
                },
              },
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: '사용자 ID',
              example: 1,
            },
            username: {
              type: 'string',
              description: 'LDAP 사용자명',
              example: 'nicolas.choi',
            },
            email: {
              type: 'string',
              format: 'email',
              description: '이메일 주소',
              example: 'nicolas.choi@roboetech.com',
            },
            full_name: {
              type: 'string',
              description: '전체 이름',
              example: '최현창',
            },
            department: {
              type: 'string',
              description: '부서',
              example: 'Engineering',
            },
            is_active: {
              type: 'boolean',
              description: '활성 상태',
              example: true,
            },
            last_login: {
              type: 'string',
              format: 'date-time',
              description: '마지막 로그인 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: '생성 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: '수정 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
          },
        },
        Deployment: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: '배포 ID',
              example: 1,
            },
            project_name: {
              type: 'string',
              description: '프로젝트명',
              example: 'harbor-frontend',
            },
            branch: {
              type: 'string',
              description: '브랜치명',
              example: 'main',
            },
            commit_hash: {
              type: 'string',
              description: '커밋 해시',
              example: 'abc123def456',
            },
            build_number: {
              type: 'integer',
              description: '빌드 번호',
              example: 42,
            },
            status: {
              type: 'string',
              enum: ['success', 'failure', 'pending', 'cancelled'],
              description: '배포 상태',
              example: 'success',
            },
            started_at: {
              type: 'string',
              format: 'date-time',
              description: '배포 시작 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
            completed_at: {
              type: 'string',
              format: 'date-time',
              description: '배포 완료 시간',
              example: '2025-09-26T13:35:00.000Z',
            },
            duration: {
              type: 'integer',
              description: '배포 소요 시간 (초)',
              example: 300,
            },
            file_path: {
              type: 'string',
              description: 'NAS 파일 경로',
              example: '/nas/deployments/harbor-frontend/build-42.tar.gz',
            },
            file_size: {
              type: 'integer',
              description: '파일 크기 (바이트)',
              example: 1024000,
            },
            file_checksum: {
              type: 'string',
              description: '파일 체크섬',
              example: 'sha256:abc123def456...',
            },
            jenkins_url: {
              type: 'string',
              format: 'uri',
              description: 'Jenkins 빌드 URL',
              example: 'https://jenkins.roboetech.com/job/harbor-frontend/42/',
            },
            triggered_by: {
              type: 'string',
              description: '배포 트리거 사용자',
              example: 'nicolas.choi',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: '생성 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: '수정 시간',
              example: '2025-09-26T13:30:00.000Z',
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              description: 'LDAP 사용자명',
              example: 'nicolas.choi',
            },
            password: {
              type: 'string',
              description: '비밀번호',
              example: 'password123',
            },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              properties: {
                user: {
                  $ref: '#/components/schemas/User',
                },
                accessToken: {
                  type: 'string',
                  description: 'JWT 액세스 토큰',
                  example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                },
                expiresIn: {
                  type: 'integer',
                  description: '토큰 만료 시간 (초)',
                  example: 900,
                },
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'LDAP 인증 관련 API',
      },
      {
        name: 'Deployments',
        description: '배포 이력 관리 API',
      },
      {
        name: 'Users',
        description: '사용자 관리 API',
      },
      {
        name: 'Health',
        description: '시스템 상태 확인 API',
      },
    ],
  },
  apis: [
    './src/routes/*.js',
    './src/models/*.js',
    './src/app.js',
  ],
};

// Swagger JSDoc 설정
const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Swagger UI 커스터마이징 옵션
const swaggerUIOptions = {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #1f2937; }
    .swagger-ui .scheme-container { background: #f9fafb; }
    .swagger-ui .btn.authorize {
      background-color: #3b82f6;
      border-color: #3b82f6;
    }
    .swagger-ui .btn.authorize:hover {
      background-color: #2563eb;
      border-color: #2563eb;
    }
  `,
  customSiteTitle: 'Harbor API Documentation',
  customfavIcon: '/assets/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestSnippetsEnabled: true,
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
  },
};

module.exports = {
  swaggerSpec,
  swaggerUIOptions,
  setupSwagger: (app) => {
    // Swagger JSON 엔드포인트
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    // Swagger UI 엔드포인트
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUIOptions));

    console.log('📚 API Documentation available at: /api-docs');
    console.log('📄 OpenAPI JSON spec available at: /api-docs.json');
  },
};