module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  settings: {
    react: {
      version: '18.2'
    }
  },
  plugins: ['react', 'react-refresh'],
  rules: {
    // React 관련
    'react/jsx-no-target-blank': 'off',
    'react/prop-types': 'warn',
    'react/jsx-uses-react': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-key': 'error',
    'react/jsx-no-duplicate-props': 'error',
    'react/jsx-no-undef': 'error',
    'react/no-unknown-property': 'error',

    // React Hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Refresh (개발 모드)
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],

    // 일반적인 규칙
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-trailing-spaces': 'error',
    'eol-last': 'error',
    'comma-dangle': ['error', 'always-multiline'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],

    // ES6+ 관련
    'prefer-const': 'error',
    'no-var': 'error',
    'prefer-template': 'error',
    'prefer-destructuring': ['error', { object: true, array: false }],

    // 함수 관련
    'no-unused-expressions': 'error',
    'consistent-return': 'error',

    // 객체/배열 관련
    'no-prototype-builtins': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.jsx', '**/*.test.js', '**/__tests__/**/*'],
      env: {
        jest: true,
        'vitest-globals/env': true,
      },
      extends: [
        'plugin:testing-library/react',
      ],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};