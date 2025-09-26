module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'plugin:security/recommended',
    'prettier',
  ],
  plugins: ['node', 'security'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // 보안 관련
    'security/detect-object-injection': 'error',
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-eval-with-expression': 'error',

    // Node.js 관련
    'node/no-unpublished-require': 'off',
    'node/no-missing-require': 'error',
    'node/no-extraneous-require': 'error',
    'node/prefer-global/process': 'error',
    'node/prefer-global/buffer': 'error',

    // 일반적인 규칙
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-trailing-spaces': 'error',
    'eol-last': 'error',
    'comma-dangle': ['error', 'always-multiline'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],

    // 비동기 처리
    'prefer-promise-reject-errors': 'error',
    'no-async-promise-executor': 'error',

    // 함수 관련
    'no-unused-expressions': 'error',
    'consistent-return': 'error',
    'no-return-await': 'error',

    // 객체/배열 관련
    'no-prototype-builtins': 'error',
    'prefer-destructuring': ['error', { object: true, array: false }],

    // 에러 처리
    'handle-callback-err': 'error',
    'no-throw-literal': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.js', '**/__tests__/**/*.js'],
      env: {
        jest: true,
      },
      rules: {
        'no-console': 'off',
        'node/no-unpublished-require': 'off',
      },
    },
    {
      files: ['scripts/**/*.js'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};