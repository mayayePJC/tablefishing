/**
 * Build after migration with: node project/scripts/build-launcher.mjs
 * The default release root is the parent of project, independent of process.cwd().
 * Before migration or for staging use explicit --workspace-root / --output paths.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = dirname(scriptDirectory)
let workspaceRoot = dirname(projectDirectory)
let outputPath = null
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const option = args[index]
  if (option === '--help') {
    console.log('Usage: node project/scripts/build-launcher.mjs [--workspace-root ABSOLUTE_PATH] [--output ABSOLUTE_PATH]')
    process.exit(0)
  }
  if (!['--workspace-root', '--output'].includes(option) || !args[index + 1]) {
    throw new Error(`Unknown option or missing path: ${option}`)
  }
  const value = args[++index]
  if (!isAbsolute(value)) throw new Error(`${option} requires an absolute path`)
  if (option === '--workspace-root') workspaceRoot = resolve(value)
  else outputPath = resolve(value)
}
outputPath ??= join(workspaceRoot, 'fishing-codex.exe')

if (process.platform !== 'win32') throw new Error('The Windows launcher must be built on Windows with .NET Framework csc.exe.')
const windowsRoot = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows'
const compiler = [
  join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
].find(existsSync)
if (!compiler) throw new Error('The Windows .NET Framework C# compiler was not found.')
const source = join(scriptDirectory, 'windows-launcher.cs')
const icon = join(projectDirectory, 'src-tauri', 'icons', 'icon.ico')
if (!existsSync(source) || !existsSync(icon)) throw new Error('Launcher source or project icon is missing.')
mkdirSync(dirname(outputPath), { recursive: true })

const result = spawnSync(compiler, [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/codepage:65001', '/utf8output',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  `/win32icon:${icon}`, `/out:${outputPath}`, source
], { encoding: 'utf8', windowsHide: true })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// A GUI PE subsystem is required: double-clicking the root launcher must never
// create the console window used by .cmd/.bat/node wrappers.
const image = readFileSync(outputPath)
const peOffset = image.readUInt32LE(0x3c)
if (image.toString('ascii', 0, 2) !== 'MZ' || image.readUInt32LE(peOffset) !== 0x00004550 ||
    image.readUInt16LE(peOffset + 24 + 68) !== 2) {
  throw new Error('The compiled launcher is not a Windows GUI executable.')
}
console.log(`Windows GUI launcher built: ${outputPath} (${image.length} bytes)`)
