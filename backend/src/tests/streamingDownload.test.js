/**
 * 백엔드 스트리밍 다운로드 검증 테스트
 * Task 5.2.4: 대용량 파일 스트리밍 다운로드 성능 및 메모리 효율성 검증
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// 테스트용 Express 앱 생성
const express = require('express');
const app = express();
const fileRoutes = require('../routes/files');

// JWT 미들웨어 설정
app.use('/api/files', fileRoutes);

describe('대용량 파일 스트리밍 다운로드 검증', () => {
  let authToken;
  const testFilePath = '/nas/release_version/test_large_files/large_test_file_600MB.tar.gz';
  
  beforeAll(() => {
    // 테스트용 JWT 토큰 생성
    authToken = jwt.sign(
      { 
        userId: 'test-user',
        username: 'test-user',
        email: 'test@example.com'
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  describe('스트리밍 다운로드 기능 검증', () => {
    it('should start streaming download immediately without buffering entire file', async () => {
      const startTime = Date.now();
      let firstByteReceived = false;
      let firstByteTime = null;
      let totalBytesReceived = 0;
      let responseStarted = false;

      const response = await request(app)
        .get('/api/files/download')
        .query({
          path: testFilePath,
          token: authToken
        })
        .expect(200)
        .buffer(false) // 스트리밍을 위해 버퍼링 비활성화
        .parse((res, callback) => {
          let chunks = [];
          
          res.on('data', (chunk) => {
            if (!firstByteReceived) {
              firstByteReceived = true;
              firstByteTime = Date.now() - startTime;
              responseStarted = true;
            }
            
            totalBytesReceived += chunk.length;
            chunks.push(chunk);
          });
          
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
          
          res.on('error', callback);
        });

      // 스트리밍 검증 기준
      expect(firstByteReceived).toBe(true);
      expect(firstByteTime).toBeLessThan(5000); // 5초 이내 첫 바이트 수신
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(totalBytesReceived).toBeGreaterThan(0);

      console.log(`✅ 스트리밍 검증 결과:`);
      console.log(`  ⚡ 첫 바이트 시간: ${firstByteTime}ms`);
      console.log(`  📊 총 수신 바이트: ${Math.round(totalBytesReceived / 1024 / 1024)}MB`);
      console.log(`  🎯 통과 기준: < 5000ms 첫 바이트 시간`);
    }, 30000); // 30초 타임아웃

    it('should handle streaming download via redirect strategy', async () => {
      const response = await request(app)
        .get('/api/files/download')
        .query({
          path: testFilePath,
          token: authToken
        })
        .expect((res) => {
          // 리다이렉트 또는 스트리밍 응답 확인
          const isRedirect = res.status >= 300 && res.status < 400;
          const isStreaming = res.status === 200 && res.headers['content-type'] === 'application/octet-stream';
          
          expect(isRedirect || isStreaming).toBe(true);
          
          if (isStreaming) {
            expect(res.headers['content-disposition']).toContain('attachment');
            expect(res.headers['cache-control']).toBe('no-cache');
          }
        });
    });

    it('should handle authentication via query parameter token', async () => {
      const response = await request(app)
        .get('/api/files/download')
        .query({
          path: '/nas/release_version/release/product/mr3.0.0/250310/26/V3.0.0_250310_0843.tar.gz',
          token: authToken
        })
        .expect((res) => {
          // 인증 성공 시 다운로드 시작 또는 리다이렉트
          expect([200, 302]).toContain(res.status);
        });
    });

    it('should reject requests without valid authentication', async () => {
      await request(app)
        .get('/api/files/download')
        .query({
          path: testFilePath
        })
        .expect(401);
    });

    it('should handle non-existent file gracefully', async () => {
      await request(app)
        .get('/api/files/download')
        .query({
          path: '/nas/release_version/non_existent_file.tar.gz',
          token: authToken
        })
        .expect(404);
    });
  });

  describe('메모리 효율성 검증', () => {
    it('should not consume excessive memory during large file streaming', async () => {
      const initialMemory = process.memoryUsage();
      let maxMemoryIncrease = 0;
      
      // 메모리 모니터링 시작
      const memoryInterval = setInterval(() => {
        const currentMemory = process.memoryUsage();
        const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;
        maxMemoryIncrease = Math.max(maxMemoryIncrease, memoryIncrease);
      }, 100);

      try {
        const response = await request(app)
          .get('/api/files/download')
          .query({
            path: testFilePath,
            token: authToken
          })
          .expect((res) => {
            expect([200, 302]).toContain(res.status);
          });

        clearInterval(memoryInterval);

        // 메모리 증가량이 100MB 이하여야 함 (스트리밍 효과 확인)
        const maxMemoryIncreaseMB = Math.round(maxMemoryIncrease / 1024 / 1024);
        expect(maxMemoryIncreaseMB).toBeLessThan(100);

        console.log(`🧠 메모리 효율성 검증:`);
        console.log(`  📈 최대 메모리 증가: ${maxMemoryIncreaseMB}MB`);
        console.log(`  🎯 통과 기준: < 100MB 증가`);
        console.log(`  ✅ 스트리밍 효과: ${maxMemoryIncreaseMB < 50 ? '우수' : '보통'}`);

      } finally {
        clearInterval(memoryInterval);
      }
    }, 30000);
  });

  describe('다운로드 전략 폴백 테스트', () => {
    it('should attempt multiple strategies for download', async () => {
      // 작은 파일로 전략 테스트
      const smallFilePath = '/nas/release_version/release/product/mr3.0.0/250310/26/V3.0.0_250310_0843.tar.gz';
      
      const response = await request(app)
        .get('/api/files/download')
        .query({
          path: smallFilePath,
          token: authToken
        })
        .expect((res) => {
          // 성공적인 다운로드 시작 확인
          expect([200, 302]).toContain(res.status);
          
          if (res.status === 200) {
            expect(res.headers['content-type']).toBe('application/octet-stream');
          }
        });
    });
  });
});

/**
 * 스트리밍 다운로드 성능 벤치마크
 */
describe('스트리밍 다운로드 성능 벤치마크', () => {
  let authToken;

  beforeAll(() => {
    authToken = jwt.sign(
      { userId: 'benchmark-user', username: 'benchmark', email: 'benchmark@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  it('should complete streaming download performance benchmark', async () => {
    const testCases = [
      {
        name: '소형 파일 (< 1MB)',
        path: '/nas/release_version/release/product/mr3.0.0/250310/26/V3.0.0_250310_0843.tar.gz'
      },
      {
        name: '대형 파일 (600MB)',
        path: '/nas/release_version/test_large_files/large_test_file_600MB.tar.gz'
      }
    ];

    const results = [];

    for (const testCase of testCases) {
      const startTime = Date.now();
      let firstByteTime = null;
      let completed = false;

      try {
        const response = await request(app)
          .get('/api/files/download')
          .query({
            path: testCase.path,
            token: authToken
          })
          .timeout(10000) // 10초 타임아웃
          .buffer(false)
          .parse((res, callback) => {
            res.on('data', (chunk) => {
              if (!firstByteTime) {
                firstByteTime = Date.now() - startTime;
              }
            });
            
            res.on('end', () => {
              completed = true;
              callback(null, 'completed');
            });
            
            res.on('error', callback);
            
            // 스트리밍 시작 확인 후 조기 종료 (벤치마크용)
            setTimeout(() => {
              res.destroy();
              callback(null, 'benchmark-complete');
            }, 2000);
          });

        results.push({
          name: testCase.name,
          firstByteTime: firstByteTime || 'N/A',
          completed: response.status === 200,
          status: response.status
        });

      } catch (error) {
        results.push({
          name: testCase.name,
          firstByteTime: 'Error',
          completed: false,
          error: error.message
        });
      }
    }

    // 벤치마크 결과 출력
    console.log('\n📊 스트리밍 다운로드 성능 벤치마크 결과:');
    console.log('='.repeat(60));
    
    results.forEach(result => {
      console.log(`📁 ${result.name}:`);
      console.log(`  ⚡ 첫 바이트 시간: ${result.firstByteTime}ms`);
      console.log(`  ✅ 완료 상태: ${result.completed ? 'Success' : 'Failed'}`);
      console.log(`  📊 HTTP 상태: ${result.status || 'N/A'}`);
      if (result.error) {
        console.log(`  ❌ 에러: ${result.error}`);
      }
      console.log('');
    });

    // 최소 하나의 테스트는 성공해야 함
    const successfulTests = results.filter(r => r.completed || r.status === 200);
    expect(successfulTests.length).toBeGreaterThan(0);

  }, 30000);
});