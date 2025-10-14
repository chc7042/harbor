# PRD: NAS 경로 자동 탐지 및 DB 저장 시스템

## Introduction/Overview

현재 Jenkins 배포 시스템에서 NAS 경로를 찾지 못할 때 하드코딩된 날짜 매핑을 사용하고 있어 유지보수성과 확장성에 문제가 있습니다. 이 기능은 Jenkins 빌드 정보와 실제 NAS 디렉토리 스캔을 통해 동적으로 배포 경로를 찾고, 검증된 경로를 DB에 저장하여 성능과 안정성을 향상시키는 것을 목표로 합니다.

## Goals

1. 하드코딩된 날짜 매핑을 제거하여 시스템의 유연성 향상
2. Jenkins 빌드 날짜 기반 NAS 경로 자동 생성 구현
3. 실제 NAS 디렉토리 스캔을 통한 정확한 경로 탐지
4. 검증된 경로의 DB 저장으로 성능 최적화
5. 30초 이내 응답 시간 보장
6. 견고한 에러 처리 및 재시도 메커니즘 구현

## User Stories

**US1: 시스템 관리자로서**
- Jenkins 로그에 NAS 경로가 명시되지 않은 배포에 대해서도 자동으로 올바른 NAS 경로를 찾을 수 있어야 함
- 새로운 버전이 배포되어도 코드 수정 없이 자동으로 경로를 탐지할 수 있어야 함

**US2: 개발자로서**
- 배포 상세 정보를 조회할 때 빠른 응답 시간을 제공받아야 함
- 한번 찾은 경로는 즉시 반환되어야 함

**US3: 최종 사용자로서**
- 배포 정보를 조회할 때 "NAS 확인 필요" 메시지가 최소화되어야 함
- 시스템이 자동으로 올바른 파일 경로를 찾아 표시해야 함

## Functional Requirements

### F1: Jenkins 빌드 정보 기반 경로 생성
1. Jenkins API를 통해 빌드 timestamp 정보를 조회해야 함
2. 빌드 날짜를 YYMMDD 형식으로 변환하여 NAS 경로 구성해야 함
3. 빌드 날짜 전후 1일씩 범위를 확장하여 경로 후보 생성해야 함

### F2: NAS 디렉토리 실제 스캔
4. NAS 서비스를 통해 생성된 경로 후보들의 실제 존재 여부 확인해야 함
5. 존재하는 디렉토리에서 배포 파일 목록을 조회해야 함
6. V*.tar.gz, mr*.enc.tar.gz, be*.enc.tar.gz, fe*.enc.tar.gz 패턴의 파일 탐지해야 함

### F3: DB 저장 및 조회
7. 검증된 NAS 경로를 deployment_paths 테이블에 저장해야 함
8. project_name, version, build_number를 키로 하는 고유 제약 조건 적용해야 함
9. 경로 조회 시 DB를 우선 검색하여 캐시된 결과 반환해야 함

### F4: 폴백 체인 구현
10. 다음 순서로 경로 탐지를 시도해야 함:
    - DB 조회
    - Jenkins 로그 직접 추출
    - Jenkins 빌드 날짜 기반 + NAS 검증
    - NAS 디렉토리 스캔
11. 모든 방법이 실패하면 null 반환해야 함

### F5: 성능 최적화
12. 전체 경로 탐지 프로세스가 30초 이내 완료되어야 함
13. DB 조회는 1초 이내 응답해야 함
14. NAS 스캔 시 병렬 처리로 성능 향상해야 함

### F6: 에러 처리 및 재시도
15. NAS 연결 실패 시 최대 3회 재시도해야 함
16. Jenkins API 오류 시 지수 백오프 방식으로 재시도해야 함
17. 모든 에러는 적절한 로그 레벨로 기록해야 함

## Non-Goals (Out of Scope)

- 기존 하드코딩된 폴백 로직 완전 제거 (단계적 제거)
- NAS 서버 자체의 성능 최적화
- Jenkins 서버 설정 변경
- 프론트엔드 UI/UX 개선
- 실시간 알림 시스템

## Design Considerations

### Database Schema
```sql
CREATE TABLE deployment_paths (
  id SERIAL PRIMARY KEY,
  project_name VARCHAR(100) NOT NULL,
  version VARCHAR(20) NOT NULL,
  build_number INTEGER NOT NULL,
  build_date DATE NOT NULL,
  nas_path TEXT NOT NULL,
  download_file VARCHAR(255),
  all_files JSONB,
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_name, version, build_number)
);

CREATE INDEX idx_deployment_paths_lookup
ON deployment_paths(project_name, version, build_number);
```

### API Response Format
```javascript
{
  nasPath: "\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26",
  downloadFile: "V3.0.0_250310_0843.tar.gz",
  allFiles: [
    "V3.0.0_250310_0843.tar.gz",
    "mr3.0.0_250310_1739_26.enc.tar.gz",
    "be3.0.0_250310_0842_83.enc.tar.gz",
    "fe3.0.0_250310_0843_49.enc.tar.gz"
  ],
  deploymentPath: "\\\\nas.roboetech.com\\release_version\\release\\product\\mr3.0.0\\250310\\26",
  source: "database" | "jenkins_log" | "build_date" | "nas_scan"
}
```

## Technical Considerations

- **Dependencies**: 기존 NAS 서비스, Jenkins API 클라이언트, PostgreSQL 데이터베이스
- **Migration**: 기존 deployment 테이블과의 연관관계 고려
- **Backwards Compatibility**: 기존 API 응답 형식 유지
- **Concurrency**: 동시 요청 시 중복 스캔 방지를 위한 락 메커니즘 필요
- **Memory Usage**: 대량 파일 목록 처리 시 메모리 사용량 모니터링

## Success Metrics

1. **정확도**: NAS 경로 탐지 성공률 95% 이상
2. **성능**: 평균 응답 시간 5초 이하, 최대 30초
3. **캐시 효율성**: DB 히트율 80% 이상
4. **에러 감소**: "NAS 확인 필요" 메시지 70% 감소
5. **유지보수성**: 새 버전 배포 시 코드 변경 불필요

## Open Questions

1. 기존 하드코딩된 데이터를 DB로 마이그레이션할 방법?
2. NAS 서버 부하 증가에 대한 모니터링 방안?
3. 잘못된 경로가 DB에 저장된 경우 수정/삭제 메커니즘?
4. 배포 파일 패턴이 변경될 경우 대응 방안?
5. 시스템 확장 시 다른 NAS 서버 지원 방법?