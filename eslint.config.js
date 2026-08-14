import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'dist-worker/**', '.wrangler/**', 'coverage/**', 'node_modules/**', 'data/**'] },

  js.configs.recommended,

  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 由 tsc 負責，ESLint 不認得 TS 的環境型別宣告
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Express 以參數個數辨識錯誤處理中介層，未使用的參數仍必須保留
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // 必須置於最後：關閉所有與 Prettier 衝突的格式類規則
  prettierConfig
)
