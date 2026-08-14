import { createApp } from './app.js'
import { PORT, RULES_PATH } from './config.node.js'
import { loadRules } from './services/rules.loader.js'
import type { CompiledProvider } from './types/clearurls.js'

let providers: CompiledProvider[]

try {
  providers = loadRules()
} catch (error) {
  console.error(`載入規則集失敗（${RULES_PATH}）`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

console.log(`已載入 ${providers.length} 個 ClearURLs provider`)

createApp(providers).listen(PORT, () => {
  console.log(`clear-url-api 已啟動：http://localhost:${PORT}`)
})
