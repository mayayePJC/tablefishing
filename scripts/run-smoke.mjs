/** 用 esbuild 打包冒烟测试并以 node 运行 */
import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/smoke.ts'],
  bundle: true,
  outfile: 'out-test/smoke.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  logLevel: 'info'
})
console.log('--- running smoke test ---')
await import('node:child_process').then(({ spawnSync }) => {
  const r = spawnSync(process.execPath, ['out-test/smoke.cjs'], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
})
