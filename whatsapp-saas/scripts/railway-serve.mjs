/**
 * Arranque em produção (Railway): injeta window.__VESTO_ENV__ no index.html
 * a partir de variáveis de ambiente em runtime, para o axios usar a API certa
 * sem depender só do build com VITE_*.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distIndex = join(root, 'dist', 'index.html')
const port = process.env.PORT || '8080'

const apiBase = (process.env.BACKEND_API_BASE || process.env.VITE_API_URL || '').trim()
const rawUse = (process.env.BACKEND_USE_REAL_API ?? process.env.VITE_USE_REAL_API ?? 'true').toString().toLowerCase()
const useRealApi = rawUse === 'true' || rawUse === '1' || rawUse === 'yes'

if (apiBase.startsWith('http')) {
  let html = readFileSync(distIndex, 'utf8')
  if (!html.includes('__VESTO_ENV__')) {
    const payload = JSON.stringify({ apiBase, useRealApi })
    const inject = `<script>window.__VESTO_ENV__=${payload}</script>`
    const marker = '<script type="module"'
    const idx = html.indexOf(marker)
    if (idx !== -1) {
      html = `${html.slice(0, idx)}${inject}\n${html.slice(idx)}`
      writeFileSync(distIndex, html)
    }
  }
}

const child = spawn('serve', ['-s', 'dist', '-l', `tcp://0.0.0.0:${port}`], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => process.exit(code ?? 0))
