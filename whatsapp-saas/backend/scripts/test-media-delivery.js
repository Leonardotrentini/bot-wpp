/**
 * Prova de entrega real: texto + áudio (webm→ogg PTT) + vídeo H.264 + imagem.
 * Não envia para o próprio número (eco some no WhatsApp).
 * Exige ACK do WhatsApp (sai de PENDING) e download do CDN.
 *
 *   node scripts/test-media-delivery.js
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const { PrismaClient } = require("@prisma/client")
const {
  sendText,
  sendMedia,
  sendWhatsAppAudio,
  fetchChatMessages,
  getBase64FromMediaMessage,
  extractMediaBase64Payload,
} = require("../src/lib/evolution")
const { prepareWhatsAppPttAudio } = require("../src/lib/whatsappAudio")

const LEONARDO = "554599049134"
const ACK_OK = new Set(["SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED", "2", "3", "4", "5"])

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ""
    child.stderr.on("data", (c) => {
      stderr += String(c)
    })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-400) || `exit ${code}`))))
  })
}

function ffmpegBin() {
  try {
    return require("ffmpeg-static")
  } catch {
    return "ffmpeg"
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function digits(v) {
  return String(v || "").replace(/\D/g, "")
}

function slimMedia(msg) {
  if (!msg || typeof msg !== "object") return null
  const inner = msg.message || msg
  for (const k of ["audioMessage", "videoMessage", "imageMessage", "documentMessage", "conversation", "extendedTextMessage"]) {
    if (!inner[k]) continue
    if (k === "conversation") return { kind: "text", text: inner[k] }
    if (k === "extendedTextMessage") return { kind: "text", text: inner[k].text }
    const m = { ...inner[k] }
    delete m.jpegThumbnail
    delete m.mediaKey
    delete m.fileSha256
    delete m.fileEncSha256
    delete m.streamingSidecar
    return {
      kind: k,
      mimetype: m.mimetype,
      ptt: m.ptt,
      seconds: m.seconds,
      width: m.width,
      height: m.height,
      fileLength: m.fileLength,
      directPath: Boolean(m.directPath),
      url: Boolean(m.url),
    }
  }
  return { kind: "unknown", keys: Object.keys(inner) }
}

function statusOk(status) {
  const s = String(status || "").toUpperCase()
  if (!s || s === "PENDING" || s === "ERROR" || s === "0") return false
  if (ACK_OK.has(s)) return true
  if (s.includes("ACK") || s.includes("READ") || s.includes("PLAY")) return true
  const n = Number(status)
  return Number.isFinite(n) && n >= 2
}

async function makeWebm() {
  const out = path.join(os.tmpdir(), `vesto-deliv-${Date.now()}.webm`)
  await run(ffmpegBin(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=1",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-f",
    "webm",
    out,
  ])
  const buf = await fs.promises.readFile(out)
  await fs.promises.unlink(out).catch(() => {})
  return buf
}

async function makeMp4() {
  const out = path.join(os.tmpdir(), `vesto-deliv-${Date.now()}.mp4`)
  await run(ffmpegBin(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=320x240:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    "1",
    out,
  ])
  const buf = await fs.promises.readFile(out)
  await fs.promises.unlink(out).catch(() => {})
  return buf
}

async function makeJpeg() {
  const out = path.join(os.tmpdir(), `vesto-deliv-${Date.now()}.jpg`)
  await run(ffmpegBin(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64:d=1",
    "-frames:v",
    "1",
    "-q:v",
    "5",
    out,
  ])
  const buf = await fs.promises.readFile(out)
  await fs.promises.unlink(out).catch(() => {})
  return buf
}

async function findRecord(instanceName, jids, messageId) {
  for (const jid of jids) {
    try {
      const { records } = await fetchChatMessages(instanceName, jid, { page: 1, pageSize: 20 })
      const hit = (records || []).find((r) => r?.key?.id === messageId)
      if (hit) return hit
    } catch {
      /* tenta próximo jid */
    }
  }
  return null
}

async function waitAck(instanceName, jids, messageId, { timeoutMs = 25000, intervalMs = 2500 } = {}) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    last = await findRecord(instanceName, jids, messageId)
    const st = last?.status ?? last?.message?.status
    if (last && statusOk(st)) return { record: last, status: st }
    await sleep(intervalMs)
  }
  return { record: last, status: last?.status ?? last?.message?.status ?? "TIMEOUT" }
}

async function downloadOk(instanceName, record) {
  if (!record) return { ok: false, reason: "sem record" }
  try {
    const resp = await getBase64FromMediaMessage(instanceName, record)
    const extracted = extractMediaBase64Payload(resp)
    const b64 = extracted?.base64 || resp?.base64 || resp?.data || ""
    const bytes = Buffer.from(String(b64).replace(/^data:[^,]+,/, ""), "base64")
    if (bytes.length < 100) return { ok: false, reason: `cdn curto (${bytes.length}b)` }
    return { ok: true, bytes: bytes.length, mime: extracted?.mimetype || resp?.mimetype }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

function pickDestination(conn) {
  const owner = digits(conn.phone)
  if (owner && owner !== LEONARDO) return { number: LEONARDO, reason: "número do Leonardo (não é eco)" }
  if (owner === LEONARDO) return { number: "554796747378", reason: "Luis/Baseset (instância é do Leonardo)" }
  return { number: LEONARDO, reason: "fallback Leonardo" }
}

async function main() {
  const prisma = new PrismaClient()
  const failures = []
  const results = []

  try {
    const conn = await prisma.whatsAppConnection.findFirst({
      where: { connected: true, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
    })
    if (!conn?.instanceName) throw new Error("Nenhuma instância WhatsApp OPEN em produção")
    const user = await prisma.user.findUnique({
      where: { id: conn.userId },
      select: { name: true, email: true },
    })
    const dest = pickDestination(conn)
    const number = dest.number
    const jids = [`${number}@s.whatsapp.net`, `${number}@lid`, number]
    const stamp = new Date().toISOString().slice(11, 19)

    console.log(`\n=== Teste de entrega real WhatsApp ===`)
    console.log(`instância: ${conn.instanceName}`)
    console.log(`conta:     ${user?.name || conn.userId} (${conn.phone || "?"})`)
    console.log(`destino:   ${number}  ← ${dest.reason}`)
    console.log(`hora:      ${stamp} UTC\n`)

    if (digits(conn.phone) === number) {
      throw new Error("Recusou eco: destino = próprio número da instância")
    }

    async function sendStep(kind, fn) {
      try {
        await fn()
      } catch (err) {
        const msg = err?.message || String(err)
        console.log(`   ERRO: ${msg}`)
        failures.push(`${kind}: envio falhou (${msg.slice(0, 180)})`)
        results.push({ kind, id: null, error: msg })
      }
    }

    await sendStep("text", async () => {
      console.log("1) Texto de controle…")
      const textBody = `teste vesto ${stamp} — ignore`
      const textResp = await sendText(conn.instanceName, number, textBody)
      const textId = textResp?.key?.id
      console.log(`   id=${textId || "?"} status_ini=${textResp?.status || "?"}`)
      if (!textId) failures.push("texto: sem messageId")
      results.push({ kind: "text", id: textId, initial: textResp?.status })
    })

    await sendStep("audio", async () => {
      console.log("2) Áudio webm → ogg PTT…")
      const webm = await makeWebm()
      const prepared = await prepareWhatsAppPttAudio({ audio: webm.toString("base64"), mimetype: "audio/webm" })
      const audioResp = await sendWhatsAppAudio(conn.instanceName, number, {
        audio: prepared.base64,
        mimetype: prepared.mimetype,
      })
      const audioId = audioResp?.key?.id
      const am = audioResp?.message?.audioMessage || {}
      console.log(`   id=${audioId || "?"} mime=${am.mimetype || "-"} ptt=${am.ptt} sec=${am.seconds} status_ini=${audioResp?.status}`)
      if (!audioId) failures.push("audio: sem messageId")
      if (am.ptt !== true) failures.push("audio: Evolution não marcou ptt=true")
      if (String(am.mimetype || "").toLowerCase().includes("webm")) failures.push("audio: ainda webm")
      results.push({ kind: "audio", id: audioId, initial: audioResp?.status, ptt: am.ptt, mime: am.mimetype })
    })

    await sendStep("video", async () => {
      console.log("3) Vídeo H.264…")
      const mp4 = await makeMp4()
      const videoResp = await sendMedia(conn.instanceName, number, {
        mediatype: "video",
        media: mp4.toString("base64"),
        mimetype: "video/mp4",
        fileName: "teste.mp4",
        caption: `teste vesto video ${stamp}`,
      })
      const videoId = videoResp?.key?.id
      const vm = videoResp?.message?.videoMessage || {}
      console.log(
        `   id=${videoId || "?"} mime=${vm.mimetype || "-"} path=${Boolean(vm.directPath)} status_ini=${videoResp?.status}`,
      )
      if (!videoId) failures.push("video: sem messageId")
      if (!vm.directPath && !vm.url) failures.push("video: sem CDN (directPath/url)")
      results.push({ kind: "video", id: videoId, initial: videoResp?.status, mime: vm.mimetype, path: Boolean(vm.directPath) })
    })

    await sendStep("image", async () => {
      console.log("4) Imagem de controle…")
      const jpeg = await makeJpeg()
      const imgResp = await sendMedia(conn.instanceName, number, {
        mediatype: "image",
        media: jpeg.toString("base64"),
        mimetype: "image/jpeg",
        fileName: "teste.jpg",
        caption: `teste vesto img ${stamp}`,
      })
      const imgId = imgResp?.key?.id
      const im = imgResp?.message?.imageMessage || {}
      console.log(`   id=${imgId || "?"} mime=${im.mimetype || "-"} path=${Boolean(im.directPath)} status_ini=${imgResp?.status}`)
      if (!imgId) failures.push("image: sem messageId")
      results.push({ kind: "image", id: imgId, initial: imgResp?.status })
    })

    console.log("\n5) Esperando ACK do WhatsApp (até 25s)…")
    for (const item of results) {
      if (!item.id) continue
      const ack = await waitAck(conn.instanceName, jids, item.id)
      item.ack = ack.status
      item.record = ack.record
      const media = slimMedia(ack.record)
      item.found = Boolean(ack.record)
      item.media = media
      const ok = item.found && statusOk(ack.status)
      console.log(
        `   ${item.kind.padEnd(6)} found=${item.found} ack=${ack.status || "?"} ${ok ? "OK" : "FALHOU"} ${media ? JSON.stringify(media) : ""}`,
      )
      if (!item.found) failures.push(`${item.kind}: mensagem não apareceu no findMessages`)
      else if (!statusOk(ack.status)) failures.push(`${item.kind}: ACK preso em ${ack.status} (WhatsApp não confirmou)`)
    }

    console.log("\n6) Download da mídia no CDN do WhatsApp…")
    for (const item of results) {
      if (item.kind === "text") continue
      const dl = await downloadOk(conn.instanceName, item.record)
      item.cdn = dl
      console.log(`   ${item.kind.padEnd(6)} ${dl.ok ? `OK ${dl.bytes} bytes` : `FALHOU ${dl.reason}`}`)
      if (!dl.ok) failures.push(`${item.kind}: CDN ${dl.reason}`)
    }

    console.log("\n7) CRM (webhook salvou a mensagem?)…")
    await sleep(2000)
    for (const item of results) {
      if (!item.id) continue
      const row = await prisma.crmMessage.findFirst({
        where: { messageId: item.id },
        select: { id: true, type: true, status: true, mediaMime: true, fromMe: true },
      })
      item.crm = row
      console.log(`   ${item.kind.padEnd(6)} ${row ? `salvo type=${row.type} status=${row.status}` : "ainda não no CRM (webhook pode atrasar)"}`)
    }

    console.log("\n======== RESULTADO ========")
    if (failures.length) {
      console.log("FALHOU:")
      for (const f of failures) console.log(`  - ${f}`)
      process.exitCode = 1
    } else {
      console.log("PASSOU — texto, áudio PTT, vídeo e imagem saíram de PENDING e o CDN do WhatsApp devolveu a mídia.")
      console.log(`Confira no celular ${number} as 4 mensagens "teste vesto ${stamp}".`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("\n✗ FALHOU:", err?.message || err)
  if (err?.details) console.error(JSON.stringify(err.details).slice(0, 800))
  process.exitCode = 1
})
