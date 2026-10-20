import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../out-test/local-music.cjs', import.meta.url))
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/local-music-test.ts'],
  bundle: true,
  outfile: output,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const result = spawnSync(process.execPath, [output], { stdio: 'inherit', cwd: root })
if (result.error) throw result.error
process.exit(result.status ?? 1)
