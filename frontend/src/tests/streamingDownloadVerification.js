/**
 * 대용량 파일 스트리밍 다운로드 검증 스크립트
 * Task 5.2.4: 500MB+ 파일의 즉시 다운로드 및 메모리 효율성 검증
 */

import downloadService from '../services/downloadService.js';

/**
 * 스트리밍 다운로드 성능 검증
 */
class StreamingDownloadVerifier {
  constructor() {
    this.testResults = [];
    this.memoryUsage = [];
    this.timingData = [];
  }

  /**
   * 메모리 사용량 모니터링 시작
   */
  startMemoryMonitoring() {
    const startMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
    
    // 개발 환경에서만 메모리 모니터링 활성화
    if (import.meta.env.MODE === 'development' && import.meta.env.VITE_ENABLE_MEMORY_MONITORING === 'true') {
      this.memoryInterval = setInterval(() => {
        if (performance.memory) {
          this.memoryUsage.push({
            timestamp: Date.now(),
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSizeMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          });
        }
      }, 1000); // 1초마다 메모리 사용량 기록
    }

    return startMemory;
  }

  /**
   * 메모리 사용량 모니터링 중지
   */
  stopMemoryMonitoring() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
  }

  /**
   * 대용량 파일 스트리밍 다운로드 테스트
   */
  async testLargeFileStreaming() {
    console.log('🚀 대용량 파일 스트리밍 다운로드 검증 시작');
    
    const testCases = [
      {
        name: '600MB 테스트 파일',
        filePath: '/nas/release_version/test_large_files/large_test_file_600MB.tar.gz',
        fileName: 'large_test_file_600MB.tar.gz',
        expectedSize: 600 * 1024 * 1024, // 600MB
      },
      {
        name: '3.0.0 메인 파일',
        filePath: '/nas/release_version/release/product/mr3.0.0/250310/26/V3.0.0_250310_0843.tar.gz',
        fileName: 'V3.0.0_250310_0843.tar.gz',
        expectedSize: 100 * 1024 * 1024, // 추정 100MB
      },
    ];

    for (const testCase of testCases) {
      await this.runSingleTest(testCase);
    }

    return this.generateReport();
  }

  /**
   * 개별 테스트 실행
   */
  async runSingleTest(testCase) {
    console.log(`\n📁 테스트: ${testCase.name}`);
    console.log(`📍 경로: ${testCase.filePath}`);

    const startMemory = this.startMemoryMonitoring();
    const startTime = Date.now();

    let progressEvents = [];
    let downloadStarted = false;
    let downloadCompleted = false;
    let errorOccurred = false;
    let timeToFirstByte = null;

    try {
      // 다운로드 서비스 테스트
      const result = await downloadService.downloadFile(
        testCase.filePath,
        testCase.fileName,
        {
          onProgress: (progress) => {
            progressEvents.push({
              ...progress,
              timestamp: Date.now(),
              memoryUsed: performance.memory ? 
                Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : 'N/A'
            });

            if (progress.type === 'start') {
              downloadStarted = true;
            }
            
            if (progress.type === 'redirect' && !timeToFirstByte) {
              timeToFirstByte = Date.now() - startTime;
              console.log(`⚡ 첫 바이트 시간: ${timeToFirstByte}ms`);
            }

            console.log(`📊 진행상황: ${progress.type} - ${progress.message}`);
          },
        }
      );

      downloadCompleted = result.success;
      
    } catch (error) {
      errorOccurred = true;
      console.error(`❌ 다운로드 에러:`, error.message);
    }

    this.stopMemoryMonitoring();
    const totalTime = Date.now() - startTime;

    // 결과 분석
    const maxMemoryUsage = Math.max(...this.memoryUsage.map(m => m.usedJSHeapSizeMB), 0);
    const memoryIncrease = maxMemoryUsage - Math.round(startMemory / 1024 / 1024);
    
    const testResult = {
      testName: testCase.name,
      filePath: testCase.filePath,
      fileName: testCase.fileName,
      downloadStarted,
      downloadCompleted,
      errorOccurred,
      totalTime,
      timeToFirstByte,
      maxMemoryUsageMB: maxMemoryUsage,
      memoryIncreaseMB: memoryIncrease,
      progressEventCount: progressEvents.length,
      strategy: 'streaming-redirect',
      passed: downloadStarted && !errorOccurred && timeToFirstByte < 5000 && memoryIncrease < 50,
    };

    this.testResults.push(testResult);
    
    // 결과 출력
    console.log(`\n📊 테스트 결과: ${testCase.name}`);
    console.log(`✅ 다운로드 시작: ${downloadStarted ? 'Yes' : 'No'}`);
    console.log(`🏁 다운로드 완료: ${downloadCompleted ? 'Yes' : 'No'}`);
    console.log(`⚡ 첫 바이트 시간: ${timeToFirstByte || 'N/A'}ms`);
    console.log(`🧠 최대 메모리 사용: ${maxMemoryUsage}MB`);
    console.log(`📈 메모리 증가량: ${memoryIncrease}MB`);
    console.log(`🎯 테스트 통과: ${testResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    
    // 메모리 사용량 상세 로그 (처음 5개, 마지막 5개)
    if (this.memoryUsage.length > 0) {
      console.log(`\n💾 메모리 사용량 샘플:`);
      const samples = [
        ...this.memoryUsage.slice(0, 3),
        ...this.memoryUsage.slice(-3)
      ];
      samples.forEach((sample, index) => {
        console.log(`  ${index < 3 ? '시작' : '종료'}+${Math.round((sample.timestamp - startTime) / 1000)}s: ${sample.usedJSHeapSizeMB}MB`);
      });
    }

    // 초기화
    this.memoryUsage = [];
  }

  /**
   * 종합 검증 리포트 생성
   */
  generateReport() {
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(t => t.passed).length;
    const avgTimeToFirstByte = this.testResults
      .filter(t => t.timeToFirstByte)
      .reduce((sum, t) => sum + t.timeToFirstByte, 0) / 
      this.testResults.filter(t => t.timeToFirstByte).length;

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        successRate: `${Math.round((passedTests / totalTests) * 100)}%`,
        avgTimeToFirstByte: Math.round(avgTimeToFirstByte) || 'N/A',
      },
      criteria: {
        timeToFirstByte: '< 5초 (스트리밍 즉시 시작)',
        memoryIncrease: '< 50MB (메모리 버퍼링 없음)',
        downloadStart: '성공적인 다운로드 시작',
        noErrors: '에러 없이 완료',
      },
      detailedResults: this.testResults,
      conclusion: passedTests === totalTests ? 
        '✅ 모든 테스트 통과: 대용량 파일 스트리밍 다운로드가 정상적으로 작동합니다.' :
        '⚠️ 일부 테스트 실패: 스트리밍 다운로드에 개선이 필요합니다.',
    };

    console.log('\n' + '='.repeat(80));
    console.log('📋 대용량 파일 스트리밍 다운로드 검증 리포트');
    console.log('='.repeat(80));
    console.log(`📅 테스트 시간: ${report.timestamp}`);
    console.log(`📊 테스트 결과: ${report.summary.passedTests}/${report.summary.totalTests} 통과 (${report.summary.successRate})`);
    console.log(`⚡ 평균 첫 바이트 시간: ${report.summary.avgTimeToFirstByte}ms`);
    console.log(`🎯 결론: ${report.conclusion}`);
    
    console.log('\n📏 통과 기준:');
    Object.entries(report.criteria).forEach(([key, value]) => {
      console.log(`  • ${key}: ${value}`);
    });

    console.log('\n📊 상세 결과:');
    this.testResults.forEach(result => {
      console.log(`  📁 ${result.testName}: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`     ⚡ 첫 바이트: ${result.timeToFirstByte || 'N/A'}ms, 메모리 증가: ${result.memoryIncreaseMB}MB`);
    });

    return report;
  }

  /**
   * 스트리밍 다운로드 기능 검증
   */
  async verifyStreamingCapabilities() {
    console.log('🔍 스트리밍 다운로드 기능 검증');
    
    // 전략 선택 테스트
    const strategy = downloadService.selectDownloadStrategy('/test/path', {
      fileSize: 600 * 1024 * 1024 // 600MB
    });
    
    console.log(`📋 선택된 전략: ${strategy}`);
    console.log(`✅ 기대값: redirect (스트리밍 지원)`);
    
    if (strategy !== 'redirect') {
      console.warn('⚠️ 경고: 대용량 파일에 대해 redirect 전략이 선택되지 않았습니다.');
      return false;
    }
    
    return true;
  }
}

// 브라우저 환경에서 실행할 수 있도록 전역 함수로 노출
if (typeof window !== 'undefined') {
  window.StreamingDownloadVerifier = StreamingDownloadVerifier;
  
  // 즉시 실행 함수
  window.runStreamingVerification = async function() {
    const verifier = new StreamingDownloadVerifier();
    
    console.log('🔧 기능 검증 실행');
    const capabilitiesOk = await verifier.verifyStreamingCapabilities();
    
    if (capabilitiesOk) {
      console.log('🚀 대용량 파일 테스트 실행');
      return await verifier.testLargeFileStreaming();
    } else {
      console.error('❌ 기능 검증 실패');
      return null;
    }
  };
}

export default StreamingDownloadVerifier;