import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'

await build({
  entryPoints: ['scripts/fish-boundary-test.ts'],
  bundle: true,
  outfile: 'out-test/fish-boundary.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  logLevel: 'error'
})

const result = spawnSync(process.execPath, ['out-test/fish-boundary.cjs'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
