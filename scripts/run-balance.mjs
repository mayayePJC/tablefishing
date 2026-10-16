/** 运行难度曲线分析：node scripts/run-balance.mjs [次数] */
import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/balance.ts'],
  bundle: true,
  outfile: 'out-test/balance.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  logLevel: 'error'
})
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, ['out-test/balance.cjs', ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
