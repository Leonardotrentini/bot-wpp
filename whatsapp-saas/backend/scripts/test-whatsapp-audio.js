/**
 * Teste: conversão webm → ogg/opus + (opcional) envio real via Evolution.
 *
 * Só conversão:  node scripts/test-whatsapp-audio.js
 * Live (envia 1s de áudio):  node scripts/test-whatsapp-audio.js --live
 */
require("dotenv").config()
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const {
  prepareWhatsAppPttAudio,
  prepareWhatsAppVideo,
  assertWhatsAppAudioAccepted,
  looksLikeOggOpus,
  WHATSAPP_PTT_MIME,
} = require("../src/lib/whatsappAudio")

const live = process.argv.includes("--live")

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

async function makeSampleWebm() {
  let ffmpeg
  try {
    ffmpeg = require("ffmpeg-static")
  } catch {
    ffmpeg = "ffmpeg"
  }
  const out = path.join(os.tmpdir(), `vesto-sample-${Date.now()}.webm`)
  await run(ffmpeg, [
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

async function convertChecks() {
  console.log("\n1) Conversão de webm sintético…")
  const webm = await makeSampleWebm()
  console.log(`   webm gerado: ${webm.length} bytes`)
  const prepared = await prepareWhatsAppPttAudio({
    audio: webm.toString("base64"),
    mimetype: "audio/webm",
  })
  const outBuf = Buffer.from(prepared.base64, "base64")
  if (!prepared.converted) throw new Error("Esperava converted=true para webm")
  if (prepared.mimetype !== WHATSAPP_PTT_MIME) throw new Error(`mime inesperado: ${prepared.mimetype}`)
  if (!looksLikeOggOpus(outBuf)) throw new Error("Saída não é Ogg/Opus")
  console.log(`   ok → ogg/opus ${outBuf.length} bytes | mime=${prepared.mimetype}`)

  console.log("\n2) Guardrail rejeita webm na resposta Evolution…")
  let rejected = false
  try {
    assertWhatsAppAudioAccepted({
      key: { id: "x", fromMe: true },
      message: { audioMessage: { mimetype: "audio/webm", ptt: false } },
    })
  } catch (err) {
    rejected = err.code === "AUDIO_NOT_WHATSAPP_COMPATIBLE"
  }
  if (!rejected) throw new Error("Guardrail não rejeitou webm")
  console.log("   ok — webm é rejeitado")

  console.log("\n3) ogg/opus já pronto não reconverte…")
  const again = await prepareWhatsAppPttAudio({
    audio: prepared.base64,
    mimetype: WHATSAPP_PTT_MIME,
  })
  if (again.converted) throw new Error("Não deveria reconverter ogg/opus")
  console.log("   ok — skipped")

  console.log("\n3b) Conversão de vídeo sintético → H.264 MP4…")
  const tmpVid = path.join(os.tmpdir(), `vesto-sample-${Date.now()}.mp4`)
  let ffmpegBin
  try {
    ffmpegBin = require("ffmpeg-static")
  } catch {
    ffmpegBin = "ffmpeg"
  }
  await run(ffmpegBin, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    "1",
    tmpVid,
  ])
  const vidBuf = await fs.promises.readFile(tmpVid)
  await fs.promises.unlink(tmpVid).catch(() => {})
  const video = await prepareWhatsAppVideo({
    media: vidBuf.toString("base64"),
    mimetype: "video/mp4",
    fileName: "teste.mov",
  })
  if (video.mimetype !== "video/mp4") throw new Error(`mime vídeo inesperado: ${video.mimetype}`)
  if (!video.fileName.endsWith(".mp4")) throw new Error(`fileName inválido: ${video.fileName}`)
  if (!video.converted) throw new Error("Esperava converted=true para vídeo")
  console.log(`   ok → mp4 ${Buffer.from(video.base64, "base64").length} bytes | ${video.fileName}`)

  return prepared
}

async function liveSend(prepared) {
  const { PrismaClient } = require("@prisma/client")
  const { sendWhatsAppAudio } = require("../src/lib/evolution")
  const prisma = new PrismaClient()

  try {
    // Preferir instância do Luis (Baseset) — está open e já usou áudio em testes.
    const conn = await prisma.whatsAppConnection.findFirst({
      where: { connected: true, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
    })
    if (!conn?.instanceName) throw new Error("Nenhuma instância WhatsApp conectada em produção")

    const user = await prisma.user.findUnique({ where: { id: conn.userId }, select: { name: true, email: true } })
    // Envia para o próprio número da instância (eco) — evita spam em lead.
    const ownerDigits = String(conn.phone || "").replace(/\D/g, "")
    let number = ownerDigits
    if (!number) {
      // fallback: número do Leonardo (já recebeu testes da Baseset)
      number = "554599049134"
    }

    console.log(`\n4) Envio live via Evolution`)
    console.log(`   instância: ${conn.instanceName} (${user?.name || conn.userId})`)
    console.log(`   destino: ${number}`)

    const resp = await sendWhatsAppAudio(conn.instanceName, number, {
      audio: prepared.dataUrl,
      mimetype: prepared.mimetype,
    })

    const am = resp?.message?.audioMessage || {}
    const id = resp?.key?.id
    console.log(`   messageId: ${id || "?"}`)
    console.log(`   evoMime: ${am.mimetype || "-"}`)
    console.log(`   ptt: ${am.ptt}`)
    if (am.ptt !== true) {
      console.warn("   aviso: Evolution não marcou ptt=true (pode não aparecer como nota de voz)")
    }
    console.log(`   seconds: ${am.seconds}`)
    console.log(`   converted: ${resp?._vestoAudio?.converted}`)

    if (!id) throw new Error("Evolution não devolveu messageId")
    if (String(am.mimetype || "").toLowerCase().includes("webm")) {
      throw new Error("Evolution ainda devolveu webm após conversão")
    }
    console.log("   OK — áudio aceito em formato compatível")

    console.log("\n5) Envio live de vídeo H.264…")
    const { sendMedia } = require("../src/lib/evolution")
    const tmpVid = path.join(os.tmpdir(), `vesto-live-${Date.now()}.mp4`)
    let ffmpegBin
    try {
      ffmpegBin = require("ffmpeg-static")
    } catch {
      ffmpegBin = "ffmpeg"
    }
    await run(ffmpegBin, [
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
      tmpVid,
    ])
    const vidBuf = await fs.promises.readFile(tmpVid)
    await fs.promises.unlink(tmpVid).catch(() => {})
    const vresp = await sendMedia(conn.instanceName, number, {
      mediatype: "video",
      media: vidBuf.toString("base64"),
      mimetype: "video/mp4",
      fileName: "teste.mp4",
      caption: "teste vesto",
    })
    const vm = vresp?.message?.videoMessage || {}
    console.log(`   messageId: ${vresp?.key?.id || "?"}`)
    console.log(`   evoMime: ${vm.mimetype || "-"}`)
    console.log(`   seconds: ${vm.seconds}`)
    console.log(`   w: ${vm.width} h: ${vm.height}`)
    if (!vresp?.key?.id) throw new Error("Vídeo: Evolution não devolveu messageId")
    console.log("   OK — vídeo aceito")

    return { ok: true, id, mimetype: am.mimetype, ptt: am.ptt }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const prepared = await convertChecks()
  if (live) {
    // Carregar credenciais Evolution de produção se o .env local não tiver
    if (!process.env.EVOLUTION_BASE_URL || !process.env.EVOLUTION_API_KEY) {
      throw new Error("Defina EVOLUTION_BASE_URL e EVOLUTION_API_KEY para --live")
    }
    if (!process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL?.includes("railway")) {
      console.warn("Aviso: DATABASE pode não ser produção")
    }
    await liveSend(prepared)
  } else {
    console.log("\n(sem --live) conversão local OK. Para teste real: node scripts/test-whatsapp-audio.js --live")
  }
  console.log("\n✓ teste de áudio WhatsApp passou\n")
}

main().catch((err) => {
  console.error("\n✗ FALHOU:", err?.message || err)
  if (err?.details) console.error(err.details)
  process.exitCode = 1
})
