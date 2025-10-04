# Tasks for Harbor 파일 다운로드 시스템 전면 재설계

## Relevant Files

- `backend/src/routes/files.js` - 메인 다운로드 API 엔드포인트, 리다이렉트 패턴 구현
- `backend/src/middleware/auth.js` - JWT 인증 미들웨어, 쿼리 파라미터 토큰 지원 및 강화된 로깅/디버깅 기능
- `backend/src/services/synologyApiService.js` - NAS 직접 URL 생성 및 제공 서비스
- `backend/src/services/nasService.js` - NAS 서비스 최적화 및 폴백 체인 개선
- `frontend/src/components/DeploymentTable.jsx` - 통합 다운로드 버튼 구현
- `frontend/src/components/ProjectDetailModal.jsx` - 모달 다운로드 통합
- `frontend/src/services/api.js` - 통합 다운로드 API 호출 함수
- `frontend/src/services/downloadService.js` - 새로운 통합 다운로드 서비스
- `docker-compose.prod.yml` - 배포 설정 최적화
- `backend/package.json` - 종속성 및 빌드 스크립트 확인
- `frontend/package.json` - 프론트엔드 빌드 설정 확인

### Notes

- 코드 변경사항이 확실히 반영되도록 컨테이너 완전 재빌드 필요
- JWT 토큰 쿼리 파라미터 지원으로 브라우저 직접 다운로드 인증 해결
- 리다이렉트 패턴으로 즉시 다운로드 시작 구현
- 다단계 폴백 체인으로 안정성 확보

## Tasks

- [x] 1.0 배포 프로세스 문제 해결 및 코드 반영 보장
  - [x] 1.1 현재 컨테이너 상태 및 로그 분석
  - [x] 1.2 Docker 이미지 완전 재빌드 (캐시 무효화)
  - [x] 1.3 컨테이너 재시작 및 코드 반영 확인
  - [x] 1.4 디버그 로그를 통한 변경사항 검증 (문제 발견: 이전 코드 실행됨)
- [x] 1.5 발견된 코드 반영 문제 해결
  - [x] 1.5.1 현재 로컬 파일과 컨테이너 내부 파일 비교
  - [x] 1.5.2 실제 코드 변경사항을 컨테이너에 강제 반영
  - [x] 1.5.3 코드 반영 후 컨테이너 재시작
  - [x] 1.5.4 변경사항 적용 확인 (성공: 쿼리 파라미터 토큰 인식됨)
- [x] 2.0 백엔드 인증 시스템 개선
  - [x] 2.1 JWT 쿼리 파라미터 지원 미들웨어 수정
  - [x] 2.2 인증 미들웨어 로깅 및 디버깅 강화
  - [x] 2.3 토큰 검증 로직 테스트 및 검증
- [x] 3.0 백엔드 다운로드 API 통합 및 리다이렉트 구현
  - [x] 3.1 파일 다운로드 라우터 리다이렉트 패턴 구현
  - [x] 3.2 NAS 직접 URL 생성 로직 개선
  - [x] 3.3 다단계 폴백 체인 구현 (Synology → Share Link → NAS Service)
  - [x] 3.4 에러 처리 및 로깅 강화
- [ ] 4.0 프론트엔드 다운로드 시스템 통합
  - [ ] 4.1 통합 다운로드 서비스 구현
  - [ ] 4.2 DeploymentTable 다운로드 버튼 JWT 토큰 포함 수정
  - [ ] 4.3 ProjectDetailModal 다운로드 통합
  - [ ] 4.4 에러 처리 및 사용자 피드백 개선
- [ ] 5.0 시스템 테스트 및 검증
  - [ ] 5.1 2.0.0 버전 파일 다운로드 테스트
  - [ ] 5.2 대용량 파일 (500MB+) 다운로드 테스트
  - [ ] 5.3 동시 다운로드 테스트
  - [ ] 5.4 인증 실패 시나리오 테스트
- [ ] 6.0 성능 최적화 및 모니터링
  - [ ] 6.1 다운로드 성능 메트릭 수집
  - [ ] 6.2 로그 모니터링 및 알림 설정
  - [ ] 6.3 사용자 경험 개선사항 적용