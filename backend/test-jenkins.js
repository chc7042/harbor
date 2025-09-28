// Jenkins 테스트 스크립트
const { getJenkinsService } = require('./src/services/jenkinsService');

async function testJenkinsIntegration() {
  console.log('=== Jenkins 통합 테스트 시작 ===');

  const jenkinsService = getJenkinsService();

  try {
    // 1. Jenkins 헬스체크
    console.log('\n1. Jenkins 헬스체크...');
    const health = await jenkinsService.healthCheck();
    console.log('Jenkins 헬스체크 결과:', health);

    if (health.status === 'healthy') {
      // 2. Jenkins 작업 목록 조회
      console.log('\n2. Jenkins 작업 목록 조회...');
      const jobs = await jenkinsService.getJobs();
      console.log(`Jenkins 작업 수: ${jobs.length}`);
      console.log('작업 목록:', jobs.map(job => job.name).slice(0, 5));

      if (jobs.length > 0) {
        // 3. 첫 번째 작업의 빌드 이력 조회
        const firstJob = jobs[0];
        console.log(`\n3. 작업 "${firstJob.name}" 빌드 이력 조회...`);

        try {
          const builds = await jenkinsService.getJobBuilds(firstJob.name, 5);
          console.log(`빌드 수: ${builds.length}`);

          if (builds.length > 0) {
            console.log('최근 빌드들:');
            builds.forEach(build => {
              console.log(`- 빌드 #${build.buildNumber}: ${build.status} (${new Date(build.timestamp).toLocaleString()})`);
            });
          }
        } catch (error) {
          console.error(`작업 "${firstJob.name}" 빌드 조회 실패:`, error.message);
        }
      }

      // 4. 최근 빌드 조회
      console.log('\n4. 최근 24시간 빌드 조회...');
      try {
        const recentBuilds = await jenkinsService.getRecentBuilds(24, 10);
        console.log(`최근 빌드 수: ${recentBuilds.length}`);

        if (recentBuilds.length > 0) {
          console.log('최근 빌드들:');
          recentBuilds.slice(0, 3).forEach(build => {
            console.log(`- ${build.projectName} #${build.buildNumber}: ${build.status}`);
          });
        }
      } catch (error) {
        console.error('최근 빌드 조회 실패:', error.message);
      }
    }

  } catch (error) {
    console.error('\nJenkins 통합 테스트 실패:', error.message);
    console.error('Stack:', error.stack);
  }

  console.log('\n=== Jenkins 통합 테스트 완료 ===');
}

// 테스트 실행
testJenkinsIntegration()
  .then(() => {
    console.log('\n✅ 테스트 완료');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ 테스트 실패:', error);
    process.exit(1);
  });