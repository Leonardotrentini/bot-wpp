import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.PORT || '4173'
const child = spawn(
  'npx',
  ['serve', '-s', 'dist', '--listen', `tcp://0.0.0.0:${port}`],
  { stdio: 'inherit', cwd: root, shell: true, env: process.env },
)

child.on('exit', (code) => process.exit(code ?? 0))
