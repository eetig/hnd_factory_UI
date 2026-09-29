import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

/**
 * ESLint 扁平配置（ESLint 9）。
 *
 * 只启用「正确性」规则，不启用任何格式类规则 —— 格式交给 Prettier（npm run format），
 * 两者职责分开，避免同一件事被两个工具各自要求一遍、互相打架。
 *
 * 用 flat/essential 而不是 flat/recommended：recommended 里带大量排版规则，
 * 直接开会在既有代码上刷出上千条与业务无关的告警，反而让人忽略真问题。
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.log'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 未使用变量视为错误：SFC 重构后最容易留下的就是「搬走了实现、忘了删 import」
      'no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 组件文件里对 Props 的默认值校验较宽松，避免为历史代码补一堆 props 默认值
    files: ['**/*.vue'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/require-prop-types': 'off',
      // Login / ImageParse 这类视图名与路由一一对应，保持单词名
      'vue/multi-word-component-names': 'off',
      // 模板文案里用全角空格（U+3000）做图例分隔是有意为之（如压力容器的符号说明），
      // 不是笔误，因此模板里不检查「irregular whitespace」
      'no-irregular-whitespace': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]
