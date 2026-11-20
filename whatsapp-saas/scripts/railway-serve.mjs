/**
 * Arranque em produção (Railway):
 * 1) Injeta window.__VESTO_ENV__ no index.html (API em runtime)
 * 2) Serve estático com 404 real em /assets/* (evita "Failed to fetch dynamically imported module")
 * 3) SPA fallback só para rotas de app (não para assets)
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distDir = join(root, 'dist')
const distIndex = join(distDir, 'index.html')
const port = Number(process.env.PORT || 8080)

const apiBaseRaw = (process.env.BACKEND_API_BASE || process.env.VITE_API_URL || '').trim()
const apiBase = apiBaseRaw.replace(/\/+$/, '')
const rawUse = (process.env.BACKEND_USE_REAL_API ?? process.env.VITE_USE_REAL_API ?? 'true').toString().toLowerCase()
let useRealApi = rawUse === 'true' || rawUse === '1' || rawUse === 'yes'

function validApiBase(s) {
  return /^https?:\/\/.+/i.test(s)
}

if (useRealApi && !validApiBase(apiBase)) {
  const msg =
    '[fatal] Defina BACKEND_API_BASE (ou VITE_API_URL) no serviço do front, ex.: https://seu-backend.up.railway.app/api — sem isto o browser tenta localhost e o login dá Network Error.'
  if (process.env.NODE_ENV === 'production') {
    console.error(msg)
    process.exit(1)
  }
  console.warn(`${msg} (modo não-produção: a desativar API real.)`)
  useRealApi = false
}

let html = readFileSync(distIndex, 'utf8')
if (!html.includes('__VESTO_ENV__')) {
  const payload = JSON.stringify({ apiBase: apiBase || '', useRealApi })
  const inject = `<script>window.__VESTO_ENV__=${payload}</script>`
  const marker = '<script type="module"'
  const idx = html.indexOf(marker)
  if (idx !== -1) {
    html = `${html.slice(0, idx)}${inject}\n${html.slice(idx)}`
    writeFileSync(distIndex, html)
  }
}

// Recarrega 1x se chunk antigo falhar (deploy novo + cache do browser).
if (!html.includes('__VESTO_CHUNK_RELOAD__')) {
  const reloadScript = `<script>window.__VESTO_CHUNK_RELOAD__=1;(function(){function go(){try{var k='vesto:chunk-reload';if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');location.reload()}catch(e){location.reload()}}window.addEventListener('vite:preloadError',function(e){e.preventDefault();go()});window.addEventListener('unhandledrejection',function(e){var m=String(e&&e.reason&&(e.reason.message||e.reason)||'');if(/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(m))go()})}());</script>`
  const marker = '<script type="module"'
  const idx = html.indexOf(marker)
  if (idx !== -1) {
    html = `${html.slice(0, idx)}${reloadScript}\n${html.slice(idx)}`
    writeFileSync(distIndex, html)
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/')
  const cleaned = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = join(base, cleaned)
  if (!full.startsWith(base + sep) && full !== base) return null
  return full
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers)
  res.end(body)
}

function sendFile(req, res, filePath, { immutable = false } = {}) {
  const ext = extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const buf = readFileSync(filePath)
  const headers = {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, no-store, must-revalidate',
  }
  const accept = String(req.headers['accept-encoding'] || '')
  if (accept.includes('gzip') && buf.length > 1024 && /\.(js|css|html|svg|json|mjs|txt)$/i.test(ext)) {
    const gz = gzipSync(buf)
    headers['Content-Encoding'] = 'gzip'
    headers['Vary'] = 'Accept-Encoding'
    headers['Content-Length'] = gz.length
    return send(res, 200, gz, headers)
  }
  return send(res, 200, buf, headers)
}

const server = createServer((req, res) => {
  try {
    const urlPath = (req.url || '/').split('?')[0] || '/'
    const isAsset = urlPath.startsWith('/assets/')

    let filePath = safeJoin(distDir, urlPath === '/' ? '/index.html' : urlPath)
    if (!filePath) {
      return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' })
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return sendFile(req, res, filePath, { immutable: isAsset })
    }

    // Asset inexistente (hash antigo pós-deploy): 404 real, NÃO index.html
    if (isAsset) {
      return send(res, 404, 'Not Found', {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
    }

    // SPA fallback
    return sendFile(req, res, distIndex, { immutable: false })
  } catch (err) {
    console.error('[railway-serve]', err?.message || err)
    return send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`[railway-serve] listening on 0.0.0.0:${port}`)
})
