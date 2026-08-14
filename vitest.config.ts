import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // 只負責 listen，交由端對端驗證
        'src/index.ts',
        // 只負責在模組層級組裝 handler，交由 wrangler dev 端對端驗證
        'src/worker/index.ts',
        // 純型別宣告，編譯後沒有任何執行期程式碼
        'src/types/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
