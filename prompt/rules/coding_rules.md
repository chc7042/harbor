# ADAM 시스템 코딩 규칙 및 가이드라인

## 목적

이 문서는 ADAM 시스템 개발 시 모든 개발자가 준수해야 하는 코딩 규칙과 가이드라인을 정의합니다. 이 규칙들을 통해 코드 일관성, 시스템 안정성, 보안성을 보장하고 팀 협업 효율성을 극대화합니다.

## 1. 코딩 표준 및 규칙

### 1.1 TypeScript 코딩 규칙

#### 필수 규칙 (MUST)

- **타입 안전성 준수**
  ```typescript
  // ✅ 올바른 예시
  interface RobotStatus {
    id: string;
    status: 'online' | 'offline' | 'error';
    lastHeartbeat: Date;
  }

  // ❌ 잘못된 예시 - any 타입 사용 금지 (특별한 경우 제외)
  const robotData: any = {};
  ```

- **명명 규칙 (Naming Convention)**
  ```typescript
  // 클래스: PascalCase
  class RobotControlService {}

  // 인터페이스: PascalCase with 'I' prefix (선택사항) 또는 PascalCase
  interface DeviceConfiguration {}
  interface IDeviceConfiguration {} // 허용

  // 함수/메서드: camelCase
  async function connectToDevice() {}

  // 변수: camelCase
  const deviceId = 'robot_001';

  // 상수: UPPER_SNAKE_CASE
  const MAX_RETRY_ATTEMPTS = 3;

  // 파일명: kebab-case
  robot-control.service.ts
  device-registry.repository.ts
  ```

- **함수 및 메서드 규칙**
  ```typescript
  // ✅ 비동기 함수는 반드시 async/await 사용
  async function fetchRobotStatus(robotId: string): Promise<RobotStatus> {
    try {
      const result = await this.robotRepository.findById(robotId);
      return result;
    } catch (error) {
      throw new Error(`Failed to fetch robot status: ${error.message}`);
    }
  }

  // ✅ 에러 처리 필수
  async function processData(data: unknown): Promise<ProcessedData> {
    if (!data) {
      throw new BadRequestException('Data is required');
    }
    // 처리 로직...
  }
  ```

#### 권장 규칙 (SHOULD)

- **함수 복잡도 제한**: 한 함수는 30줄 이내로 제한
- **매개변수 개수 제한**: 함수 매개변수는 5개 이하로 제한
- **깊은 중첩 방지**: if문 중첩은 3레벨 이하로 제한

### 1.2 NestJS 프레임워크 규칙

#### 필수 규칙

- **의존성 주입 패턴 사용**
  ```typescript
  // ✅ 올바른 DI 사용
  @Injectable()
  export class RobotService {
    constructor(
      @Inject(ROBOT_REPOSITORY) private readonly robotRepository: RobotRepository,
      private readonly logger: Logger,
    ) {}
  }
  ```

- **데코레이터 활용**
  ```typescript
  // ✅ 컨트롤러 데코레이터
  @Controller('api/robots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiTags('Robot Management')
  export class RobotController {

    @Post()
    @Roles(UserRole.ROBOE_MASTER)
    @ApiOperation({ summary: 'Create new robot' })
    @ApiResponse({ status: 201, type: RobotResponseDto })
    async createRobot(@Body() createRobotDto: CreateRobotDto) {
      return this.robotService.createRobot(createRobotDto);
    }
  }
  ```

- **DTO 사용 필수**
  ```typescript
  // ✅ 입력 DTO
  export class CreateRobotDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ description: 'Robot unique identifier' })
    robotId: string;

    @IsEnum(RobotType)
    @ApiProperty({ enum: RobotType })
    type: RobotType;

    @IsOptional()
    @IsObject()
    @ApiPropertyOptional({ description: 'Robot configuration' })
    config?: RobotConfig;
  }

  // ✅ 응답 DTO
  export class RobotResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    robotId: string;

    @ApiProperty({ enum: RobotStatus })
    status: RobotStatus;

    @ApiProperty()
    createdAt: Date;
  }
  ```

### 1.3 데이터베이스 관련 규칙

#### 필수 규칙

- **Repository Pattern 사용**
  ```typescript
  // ✅ 추상화된 리포지토리 인터페이스 구현
  export class RobotRepository implements DAOBase<Robot> {
    async create(data: Partial<Robot>): Promise<Robot> {
      // MongoDB 구현
    }

    async findById(id: string): Promise<Robot | null> {
      // 구현
    }
  }
  ```

- **트랜잭션 사용**
  ```typescript
  // ✅ 중요한 작업에 트랜잭션 적용
  async updateRobotWithJob(robotId: string, jobData: CreateJobDto): Promise<void> {
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        await this.robotRepository.updateStatus(robotId, 'busy', { session });
        await this.jobRepository.create(jobData, { session });
      });
    } finally {
      await session.endSession();
    }
  }
  ```

- **인덱싱 최적화**
  ```typescript
  // ✅ 스키마에 적절한 인덱스 정의
  @Schema({
    collection: 'robots',
    timestamps: true,
  })
  export class Robot {
    @Prop({ required: true, unique: true, index: true })
    robotId: string;

    @Prop({ required: true, index: true })
    status: string;

    @Prop({ index: true })
    lastHeartbeat: Date;
  }
  ```

## 2. 아키텍처 및 설계 규칙

### 2.1 레이어 구조 규칙

#### 필수 규칙

- **계층 간 의존성 규칙**
  ```
  Controller → Service → Repository → Database
  (상위 계층만 하위 계층에 의존)
  ```

- **순환 의존성 금지**
  ```typescript
  // ❌ 금지: Service 간 순환 의존
  // robot.service.ts에서 job.service.ts를 import하고
  // job.service.ts에서 robot.service.ts를 import하는 경우

  // ✅ 해결: 공통 Service나 Event 기반 통신 사용
  @Injectable()
  export class RobotService {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    async updateStatus(robotId: string, status: RobotStatus) {
      // 상태 업데이트
      this.eventEmitter.emit('robot.status.updated', { robotId, status });
    }
  }
  ```

- **단일 책임 원칙 (SRP)**
  ```typescript
  // ✅ 올바른 예시 - 각 서비스는 하나의 책임만
  @Injectable()
  export class RobotConnectionService {
    // 로봇 연결 관리만 담당
  }

  @Injectable()
  export class RobotStatusService {
    // 로봇 상태 관리만 담당
  }

  @Injectable()
  export class RobotCommandService {
    // 로봇 명령 처리만 담당
  }
  ```

### 2.2 모듈 구조 규칙

#### 필수 규칙

- **도메인별 모듈 분리**
  ```typescript
  // ✅ 각 도메인별로 독립적인 모듈
  @Module({
    imports: [
      MongooseModule.forFeature([
        { name: Robot.name, schema: RobotSchema }
      ]),
    ],
    controllers: [RobotController],
    providers: [
      RobotService,
      {
        provide: ROBOT_REPOSITORY,
        useClass: RobotRepository,
      },
    ],
    exports: [RobotService, ROBOT_REPOSITORY],
  })
  export class RobotModule {}
  ```

- **공통 모듈 재사용**
  ```typescript
  // ✅ 공통 기능은 별도 모듈로 분리
  @Global()
  @Module({
    providers: [LoggerService, ConfigService],
    exports: [LoggerService, ConfigService],
  })
  export class CommonModule {}
  ```

### 2.3 외부 통신 규칙

#### 필수 규칙

- **통합 커넥터 인터페이스 준수**
  ```typescript
  // ✅ 모든 외부 통신 커넥터는 공통 인터페이스 구현
  export class ModbusConnector implements IoDeviceConnectorBase {
    async open(): Promise<void> {
      // Modbus 특화 구현
    }

    async read(deviceId: string): Promise<any> {
      // Modbus 특화 구현
    }
  }

  export class OpcUaConnector implements IoDeviceConnectorBase {
    async open(): Promise<void> {
      // OPC UA 특화 구현
    }

    async read(deviceId: string): Promise<any> {
      // OPC UA 특화 구현
    }
  }
  ```

- **에러 처리 표준화**
  ```typescript
  // ✅ 통일된 에러 처리
  export class ConnectorError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly deviceId?: string,
    ) {
      super(message);
      this.name = 'ConnectorError';
    }
  }

  // 사용 예시
  if (!connection.isConnected) {
    throw new ConnectorError(
      'CONNECTION_FAILED',
      `Failed to connect to device ${deviceId}`,
      deviceId,
    );
  }
  ```

## 3. 보안 규칙

### 3.1 인증 및 권한 규칙

#### 필수 규칙

- **모든 API 엔드포인트에 인증 적용**
  ```typescript
  // ✅ JWT 가드 적용
  @Controller('api/robots')
  @UseGuards(JwtAuthGuard)
  export class RobotController {
    // 모든 메서드에 자동 적용
  }
  ```

- **역할 기반 접근 제어 (RBAC) 적용**
  ```typescript
  // ✅ 민감한 작업에 역할 제한
  @Post('emergency-stop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ROBOE_MASTER, UserRole.EMERGENCY_OPERATOR)
  async emergencyStop(@Param('id') robotId: string) {
    return this.robotService.emergencyStop(robotId);
  }
  ```

- **입력 데이터 검증 필수**
  ```typescript
  // ✅ 모든 입력 데이터 검증
  export class CreateDeviceDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-zA-Z0-9_-]+$/) // 특수문자 제한
    @Length(1, 50)
    deviceId: string;

    @IsIP()
    ipAddress: string;

    @IsPort()
    port: number;
  }
  ```

### 3.2 데이터 보안 규칙

#### 필수 규칙

- **민감 정보 암호화**
  ```typescript
  // ✅ 비밀번호, API 키 등 암호화 저장
  @Prop({
    required: true,
    transform: (value: string) => bcrypt.hashSync(value, 10),
  })
  password: string;

  @Prop({
    required: true,
    transform: (value: string) => this.encryptionService.encrypt(value),
  })
  apiKey: string;
  ```

- **로그에 민감 정보 제외**
  ```typescript
  // ✅ 로깅 시 민감 정보 마스킹
  this.logger.log(`User ${user.username} logged in from ${sanitizeIP(request.ip)}`);

  // ❌ 금지: 비밀번호, 토큰 등 로그 출력
  this.logger.log(`Login attempt: ${JSON.stringify(loginData)}`); // 위험
  ```

### 3.3 네트워크 보안 규칙

#### 필수 규칙

- **HTTPS/TLS 사용 강제**
  ```typescript
  // ✅ 프로덕션 환경에서 HTTPS 강제
  if (process.env.NODE_ENV === 'production' && !request.secure) {
    throw new ForbiddenException('HTTPS required');
  }
  ```

- **CORS 정책 엄격 적용**
  ```typescript
  // ✅ 운영환경에서 엄격한 CORS 설정
  const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://admin.roboe.com', 'https://dashboard.roboe.com']
      : true,
    credentials: true,
    optionsSuccessStatus: 200,
  };
  ```

## 4. 성능 및 확장성 규칙

### 4.1 성능 최적화 규칙

#### 필수 규칙

- **데이터베이스 쿼리 최적화**
  ```typescript
  // ✅ 적절한 인덱스 사용 및 쿼리 최적화
  async findRobotsByStatus(status: string): Promise<Robot[]> {
    return this.robotModel
      .find({ status })
      .select('robotId name status lastHeartbeat') // 필요한 필드만 선택
      .limit(100) // 결과 제한
      .sort({ lastHeartbeat: -1 }) // 인덱스 활용
      .exec();
  }
  ```

- **캐싱 전략 적용**
  ```typescript
  // ✅ 자주 조회되는 데이터 캐싱
  @Injectable()
  export class RobotService {
    @Cacheable('robot-status', 30) // 30초 캐싱
    async getRobotStatus(robotId: string): Promise<RobotStatus> {
      return this.robotRepository.findById(robotId);
    }
  }
  ```

- **페이지네이션 필수**
  ```typescript
  // ✅ 대량 데이터 조회 시 페이지네이션
  async findRobots(page: number = 1, limit: number = 20): Promise<PaginatedResult<Robot>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.robotModel.find().skip(skip).limit(limit).exec(),
      this.robotModel.countDocuments().exec(),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
  ```

### 4.2 리소스 관리 규칙

#### 필수 규칙

- **연결 풀 사용**
  ```typescript
  // ✅ 데이터베이스 연결 풀 설정
  const mongoConfig = {
    uri: process.env.DATABASE_URL,
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10, // 최대 연결 수
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };
  ```

- **메모리 누수 방지**
  ```typescript
  // ✅ 이벤트 리스너 정리
  @Injectable()
  export class RobotService implements OnModuleDestroy {
    private intervals: NodeJS.Timeout[] = [];

    onModuleDestroy() {
      // 정리 작업
      this.intervals.forEach(interval => clearInterval(interval));
      this.eventEmitter.removeAllListeners();
    }
  }
  ```

## 5. 테스트 규칙

### 5.1 테스트 작성 규칙

#### 필수 규칙

- **모든 Service 클래스 단위 테스트 작성**
  ```typescript
  // ✅ 단위 테스트 예시
  describe('RobotService', () => {
    let service: RobotService;
    let mockRepository: jest.Mocked<RobotRepository>;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          RobotService,
          {
            provide: ROBOT_REPOSITORY,
            useValue: createMockRepository(),
          },
        ],
      }).compile();

      service = module.get<RobotService>(RobotService);
      mockRepository = module.get(ROBOT_REPOSITORY);
    });

    it('should create robot successfully', async () => {
      // Arrange
      const createRobotDto: CreateRobotDto = {
        robotId: 'test-robot',
        type: RobotType.MOBILE,
      };

      mockRepository.create.mockResolvedValue(mockRobot);

      // Act
      const result = await service.createRobot(createRobotDto);

      // Assert
      expect(result).toBeDefined();
      expect(mockRepository.create).toHaveBeenCalledWith(createRobotDto);
    });
  });
  ```

- **통합 테스트 작성**
  ```typescript
  // ✅ E2E 테스트 예시
  describe('Robot Controller (e2e)', () => {
    let app: INestApplication;
    let authToken: string;

    beforeAll(async () => {
      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();

      // 테스트용 인증 토큰 획득
      authToken = await getTestAuthToken(app);
    });

    it('/api/robots (POST) should create robot', () => {
      return request(app.getHttpServer())
        .post('/api/robots')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          robotId: 'test-robot',
          type: 'mobile',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.robotId).toBe('test-robot');
        });
    });
  });
  ```

#### 권장 규칙

- **테스트 커버리지 90% 이상 유지**
- **테스트 데이터는 독립적으로 관리** (데이터베이스 격리)
- **모킹(Mocking)을 통한 외부 의존성 제거**

## 6. 문서화 규칙

### 6.1 코드 문서화

#### 필수 규칙

- **Swagger/OpenAPI 문서화**
  ```typescript
  // ✅ 모든 API 엔드포인트 문서화
  @Post()
  @ApiOperation({
    summary: 'Create new robot',
    description: 'Register a new robot in the system with initial configuration',
  })
  @ApiResponse({
    status: 201,
    description: 'Robot successfully created',
    type: RobotResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: 409,
    description: 'Robot with same ID already exists',
  })
  async createRobot(@Body() createRobotDto: CreateRobotDto) {
    return this.robotService.createRobot(createRobotDto);
  }
  ```

- **JSDoc 주석 작성**
  ```typescript
  // ✅ 복잡한 비즈니스 로직에 JSDoc 주석
  /**
   * Calculates optimal path for robot movement considering obstacles
   *
   * @param startPoint - Starting coordinate
   * @param endPoint - Destination coordinate
   * @param obstacles - Array of obstacle coordinates
   * @returns Promise resolving to optimal path coordinates
   *
   * @throws {PathNotFoundError} When no valid path exists
   * @throws {InvalidCoordinateError} When coordinates are out of bounds
   *
   * @example
   * ```typescript
   * const path = await calculateOptimalPath(
   *   { x: 0, y: 0 },
   *   { x: 10, y: 10 },
   *   [{ x: 5, y: 5 }]
   * );
   * ```
   */
  async calculateOptimalPath(
    startPoint: Coordinate,
    endPoint: Coordinate,
    obstacles: Coordinate[],
  ): Promise<Coordinate[]> {
    // 구현...
  }
  ```

### 6.2 README 및 설정 문서

#### 필수 규칙

- **각 모듈별 README.md 작성**
- **환경 변수 문서화**
- **API 사용 예제 제공**
- **배포 및 설치 가이드 작성**

## 7. 로깅 및 모니터링 규칙

### 7.1 로깅 규칙

#### 필수 규칙

- **구조화된 로깅**
  ```typescript
  // ✅ 구조화된 로그 메시지
  this.logger.log({
    message: 'Robot status updated',
    robotId: 'robot_001',
    previousStatus: 'idle',
    newStatus: 'busy',
    timestamp: new Date().toISOString(),
    userId: request.user.id,
  });

  // ✅ 에러 로깅
  this.logger.error({
    message: 'Failed to connect to device',
    deviceId: deviceId,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  ```

- **로그 레벨 적절히 사용**
  ```typescript
  // ERROR: 시스템 오류, 즉시 대응 필요
  this.logger.error('Database connection failed');

  // WARN: 잠재적 문제, 모니터링 필요
  this.logger.warn('Device response time exceeded threshold');

  // INFO: 일반 정보, 비즈니스 이벤트
  this.logger.info('Robot started new job');

  // DEBUG: 개발/디버깅 정보
  this.logger.debug('Processing modbus register data');
  ```

### 7.2 모니터링 규칙

#### 필수 규칙

- **헬스 체크 엔드포인트 구현**
  ```typescript
  // ✅ 시스템 상태 체크
  @Get('health')
  @ApiOperation({ summary: 'System health check' })
  async healthCheck(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.database.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap'),
      () => this.disk.checkStorage('storage'),
    ]);
  }
  ```

- **메트릭 수집**
  ```typescript
  // ✅ 비즈니스 메트릭 수집
  @Injectable()
  export class MetricsService {
    private readonly robotConnectionCounter = new Counter({
      name: 'robot_connections_total',
      help: 'Total number of robot connections',
      labelNames: ['status'],
    });

    recordRobotConnection(status: 'connected' | 'disconnected') {
      this.robotConnectionCounter.inc({ status });
    }
  }
  ```

## 8. 운영 및 배포 규칙

### 8.1 환경 관리 규칙

#### 필수 규칙

- **환경별 설정 분리**
  ```typescript
  // ✅ 환경별 설정 파일
  // config/development.ts
  export const developmentConfig = {
    database: {
      url: 'mongodb://localhost:27017/adam_dev',
    },
    logging: {
      level: 'debug',
    },
  };

  // config/production.ts
  export const productionConfig = {
    database: {
      url: process.env.DATABASE_URL,
    },
    logging: {
      level: 'info',
    },
  };
  ```

- **민감 정보 환경 변수 사용**
  ```bash
  # ✅ .env 파일 사용
  DATABASE_URL=mongodb://username:password@host:port/database
  JWT_SECRET_KEY=your-super-secret-key
  MQTT_PASSWORD=mqtt-broker-password

  # ❌ 코드에 하드코딩 금지
  const dbUrl = 'mongodb://admin:password123@localhost:27017/adam'; // 위험
  ```

### 8.2 배포 규칙

#### 필수 규칙

- **Docker 컨테이너 사용**
  ```dockerfile
  # ✅ 멀티 스테이지 빌드
  FROM node:18-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --only=production

  FROM node:18-alpine AS runtime
  WORKDIR /app
  COPY --from=builder /app/node_modules ./node_modules
  COPY . .

  EXPOSE 8006
  CMD ["npm", "run", "start:prod"]
  ```

- **헬스 체크 설정**
  ```yaml
  # ✅ docker-compose.yml 헬스 체크
  services:
    adam-backend:
      image: adam-backend:latest
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:8006/health"]
        interval: 30s
        timeout: 10s
        retries: 3
        start_period: 40s
  ```

## 9. 규칙 준수 검증

### 9.1 자동화된 검증

#### 필수 도구

- **ESLint**: 코딩 스타일 및 품질 검증
- **Prettier**: 코드 포맷팅
- **Jest**: 단위 테스트 및 커버리지
- **Husky**: Git 훅을 통한 사전 검증

```json
// package.json 스크립트
{
  "scripts": {
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write src/**/*.ts",
    "test": "jest",
    "test:cov": "jest --coverage",
    "pre-commit": "npm run lint && npm run test"
  }
}
```

### 9.2 코드 리뷰 체크리스트

#### 필수 체크 항목

- [ ] 코딩 표준 준수 (명명 규칙, 타입 안전성)
- [ ] 적절한 에러 처리
- [ ] 보안 규칙 준수 (입력 검증, 권한 체크)
- [ ] 테스트 코드 작성
- [ ] 문서화 (JSDoc, Swagger)
- [ ] 성능 고려사항 (캐싱, 페이지네이션)
- [ ] 로깅 적절성
- [ ] 트랜잭션 사용 (필요한 경우)

## 결론

이 규칙들은 ADAM 시스템의 품질, 보안, 유지보수성을 보장하기 위한 최소한의 기준입니다. 규칙이 명확하지 않거나 개선이 필요한 경우 팀 논의를 통해 업데이트해야 합니다.

### 규칙 위반 시 처리 방안

1. **코드 리뷰 단계**: 리뷰어가 규칙 위반 사항 지적 및 수정 요청
2. **CI/CD 단계**: 자동화된 도구를 통한 규칙 위반 감지 및 빌드 실패
3. **정기 감사**: 분기별 코드 품질 감사를 통한 규칙 준수 확인

이 규칙들을 통해 일관성 있고 안정적인 ADAM 시스템을 구축할 수 있습니다.