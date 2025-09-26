module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',   // 빌드 시스템 또는 외부 종속성에 영향을 주는 변경사항
        'ci',      // CI 구성 파일 및 스크립트 변경
        'docs',    // 문서만 변경
        'feat',    // 새로운 기능 추가
        'fix',     // 버그 수정
        'perf',    // 성능 개선
        'refactor', // 버그 수정이나 기능 추가가 아닌 코드 변경
        'revert',  // 이전 커밋 되돌리기
        'style',   // 코드 의미에 영향을 주지 않는 변경 (공백, 포맷팅, 세미콜론 등)
        'test',    // 누락된 테스트 추가 또는 기존 테스트 수정
        'chore',   // 기타 작업
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [1, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'footer-leading-blank': [1, 'always'],
    'footer-max-line-length': [2, 'always', 100],
  },
};