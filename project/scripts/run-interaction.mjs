import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Game 及其依赖使用参数属性和无扩展名导入，需编译后运行，不能仅 strip types。
const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../out-test/interaction.cjs', import.meta.url))
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/interaction-test.ts'],
  bundle: true,
  outfile: output,
  platform: 'node',
  format: 'cjs',
  external: ['@napi-rs/canvas'],
  logLevel: 'warning'
})
const result = spawnSync(process.execPath, [output], { stdio: 'inherit', cwd: root })
if (result.error) throw result.error
process.exit(result.status ?? 1)
