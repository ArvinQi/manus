module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // 基本规则
    'no-console': 'warn',
    'no-unused-vars': 'off', // 使用 TypeScript 的检查代替
    '@typescript-eslint/no-unused-vars': 'off', // 暂时关闭未使用变量警告
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off', // 暂时关闭 any 类型警告
    
    // 代码风格
    'indent': ['error', 2],
    'quotes': ['error', 'single', { 'avoidEscape': true }],
    'semi': ['error', 'always'],
    
    // 允许空函数
    '@typescript-eslint/no-empty-function': 'off',
  },
};