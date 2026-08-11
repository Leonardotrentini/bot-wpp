/**
 * Prepara áudio para nota de voz do WhatsApp (PTT).
 * Chrome grava webm; WhatsApp só toca de forma confiável ogg/opus mono 48kHz.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const WHATSAPP_PTT_MIME = "audio/ogg; codecs=opus"

function resolveFfmpegPath() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const ffmpegStatic = require("ffmpeg-static")
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic
  } catch {
    /* pacote ausente */
  }
  return process.env.FFMPEG_PATH || "ffmpeg"
}

function stripDataUrl(value) {
  const s = String(value || "")
  const idx = s.toLowerCase().indexOf("base64,")
  if (s.trimStart().toLowerCase().startsWith("data:") && idx !== -1) {
    return s.slice(idx + "base64,".length).replace(/\s/g, "")
  }
  return s.replace(/\s/g, "")
}

function looksLikeOggOpus(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  if (buffer.subarray(0, 4).toString("ascii") !== "OggS") return false
  // Cabeçalho OpusHead costuma aparecer cedo no container Ogg.
  return buffer.includes(Buffer.from("OpusHead"))
}

function mimeNeedsConversion(mimetype) {
  const m = String(mimetype || "").toLowerCase()
  if (!m) return true
  if (m.includes("webm")) return true
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return true
  if (m.includes("mpeg") || m.includes("mp3")) return true
  if (m.includes("wav") || m.includes("x-wav")) return true
  if (m.includes("ogg") || m.includes("opus")) return false
  return true
}

function runFfmpeg(args) {
  const bin = resolveFfmpegPath()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (err) => {
      const e = new Error(`ffmpeg indisponível: ${err.message}`)
      e.code = "FFMPEG_MISSING"
      reject(e)
    })
    child.on("close", (code) => {
      if (code === 0) return resolve()
      const e = new Error(`Falha ao converter áudio para WhatsApp (ffmpeg exit ${code}).`)
      e.code = "FFMPEG_FAILED"
      e.details = stderr.slice(-800)
      reject(e)
    })
  })
}

async function convertBufferToWhatsAppOgg(inputBuffer) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpIn = path.join(os.tmpdir(), `vesto-audio-in-${id}`)
  const tmpOut = path.join(os.tmpdir(), `vesto-audio-out-${id}.ogg`)
  await fs.promises.writeFile(tmpIn, inputBuffer)
  try {
    await runFfmpeg([
      "-y",
      "-i",
      tmpIn,
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "48k",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-application",
      "voip",
      "-f",
      "ogg",
      tmpOut,
    ])
    const out = await fs.promises.readFile(tmpOut)
    if (!looksLikeOggOpus(out)) {
      const err = new Error("Conversão gerou arquivo inválido (esperado Ogg/Opus).")
      err.code = "AUDIO_CONVERT_INVALID"
      throw err
    }
    return out
  } finally {
    await Promise.all([
      fs.promises.unlink(tmpIn).catch(() => {}),
      fs.promises.unlink(tmpOut).catch(() => {}),
    ])
  }
}

/**
 * @param {{ audio: string, mimetype?: string|null }} input
 * @returns {Promise<{ base64: string, dataUrl: string, mimetype: string, converted: boolean, originalMimetype: string|null }>}
 */
async function prepareWhatsAppPttAudio({ audio, mimetype } = {}) {
  const originalMimetype = mimetype ? String(mimetype) : null
  const rawB64 = stripDataUrl(audio)
  if (!rawB64) {
    const err = new Error("Áudio vazio.")
    err.code = "AUDIO_EMPTY"
    throw err
  }

  let buffer = Buffer.from(rawB64, "base64")
  if (!buffer.length) {
    const err = new Error("Áudio inválido (base64 vazio).")
    err.code = "AUDIO_EMPTY"
    throw err
  }

  let converted = false
  const alreadyOk = looksLikeOggOpus(buffer) && !mimeNeedsConversion(originalMimetype)
  if (!alreadyOk) {
    buffer = await convertBufferToWhatsAppOgg(buffer)
    converted = true
  }

  const base64 = buffer.toString("base64")
  // Data-URL sem parâmetros no MIME — evita quebra em parsers `data:[^;]+;base64`.
  return {
    base64,
    dataUrl: `data:audio/ogg;base64,${base64}`,
    mimetype: WHATSAPP_PTT_MIME,
    converted,
    originalMimetype,
  }
}

/** Garante que a Evolution não devolveu webm “aceito” mas inutilizável no WhatsApp. */
function assertWhatsAppAudioAccepted(resp) {
  const am = resp?.message?.audioMessage || resp?.message?.pttMessage || null
  if (!am || typeof am !== "object") return resp

  const mime = String(am.mimetype || "").toLowerCase()
  if (mime.includes("webm")) {
    const err = new Error(
      "A Evolution aceitou o áudio, mas manteve formato webm — o WhatsApp não toca. Tente novamente.",
    )
    err.code = "AUDIO_NOT_WHATSAPP_COMPATIBLE"
    err.details = { mimetype: am.mimetype, ptt: am.ptt, seconds: am.seconds }
    throw err
  }
  return resp
}

module.exports = {
  WHATSAPP_PTT_MIME,
  prepareWhatsAppPttAudio,
  assertWhatsAppAudioAccepted,
  looksLikeOggOpus,
  mimeNeedsConversion,
  stripDataUrl,
}
