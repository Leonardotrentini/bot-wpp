/**
 * Prepara áudio para nota de voz do WhatsApp (PTT).
 * Chrome grava webm; WhatsApp só toca de forma confiável ogg/opus mono 48kHz.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const WHATSAPP_PTT_MIME = "audio/ogg; codecs=opus"
const WHATSAPP_VIDEO_MIME = "video/mp4"
const WHATSAPP_IMAGE_MIME = "image/jpeg"
const VIDEO_TRANSCODE_MAX_BYTES = Number(process.env.WHATSAPP_VIDEO_TRANSCODE_MAX_BYTES || 40 * 1024 * 1024)

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
      const e = new Error(`Falha ao converter mídia para WhatsApp (ffmpeg exit ${code}).`)
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
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
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

async function convertBufferToWhatsAppMp4(inputBuffer) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpIn = path.join(os.tmpdir(), `vesto-video-in-${id}`)
  const tmpOut = path.join(os.tmpdir(), `vesto-video-out-${id}.mp4`)
  await fs.promises.writeFile(tmpIn, inputBuffer)
  const common = [
    "-y",
    "-i",
    tmpIn,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
  ]
  try {
    try {
      await runFfmpeg([...common, "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "44100", tmpOut])
    } catch {
      await runFfmpeg([...common, "-an", tmpOut])
    }
    const out = await fs.promises.readFile(tmpOut)
    if (!out.length) {
      const err = new Error("Conversão de vídeo gerou arquivo vazio.")
      err.code = "VIDEO_CONVERT_INVALID"
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
 * WhatsApp só toca H.264 + AAC em MP4. Celular manda HEVC/H.265 e a Evolution
 * sobe o arquivo, mas o destinatário não vê o vídeo.
 */
async function prepareWhatsAppVideo({ media, mimetype, fileName } = {}) {
  const originalMimetype = mimetype ? String(mimetype) : null
  const rawB64 = stripDataUrl(media)
  if (!rawB64) {
    const err = new Error("Vídeo vazio.")
    err.code = "VIDEO_EMPTY"
    throw err
  }
  let buffer = Buffer.from(rawB64, "base64")
  if (!buffer.length) {
    const err = new Error("Vídeo inválido (base64 vazio).")
    err.code = "VIDEO_EMPTY"
    throw err
  }

  let converted = false
  if (buffer.length <= VIDEO_TRANSCODE_MAX_BYTES) {
    try {
      buffer = await convertBufferToWhatsAppMp4(buffer)
      converted = true
    } catch (err) {
      console.warn("[whatsapp-video] transcode falhou, enviando original:", err?.message || err)
    }
  }

  const base64 = buffer.toString("base64")
  const name = String(fileName || "video.mp4").replace(/\.[^.]+$/, "") + ".mp4"
  return {
    base64,
    mimetype: WHATSAPP_VIDEO_MIME,
    fileName: name,
    converted,
    originalMimetype,
  }
}

/**
 * Normaliza JPEG/JFIF para mime/nome aceitos pelo WhatsApp.
 */
function prepareWhatsAppImage({ media, mimetype, fileName } = {}) {
  const rawB64 = stripDataUrl(media)
  if (!rawB64) {
    const err = new Error("Imagem vazia.")
    err.code = "IMAGE_EMPTY"
    throw err
  }
  const mime = String(mimetype || "").toLowerCase()
  const name = String(fileName || "")
  const isJpeg =
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    mime.includes("jfif") ||
    mime.includes("pjpeg") ||
    /\.(jpe?g|jfif)$/i.test(name)
  const outMime = isJpeg ? WHATSAPP_IMAGE_MIME : mimetype || WHATSAPP_IMAGE_MIME
  const base = name.replace(/\.[^.]+$/, "") || "image"
  const outName = isJpeg || !/\.[a-z0-9]+$/i.test(name) ? `${base}.jpg` : name
  return { base64: rawB64, mimetype: outMime, fileName: outName }
}

/** Estima duração do áudio (segundos) via ffmpeg — usado para simular “gravando…”. */
async function probeMediaDurationSeconds({ media, mimetype } = {}) {
  const rawB64 = stripDataUrl(media)
  if (!rawB64) return null
  let buffer
  try {
    buffer = Buffer.from(rawB64, "base64")
  } catch {
    return null
  }
  if (!buffer.length) return null

  const ext = String(mimetype || "").includes("ogg")
    ? ".ogg"
    : String(mimetype || "").includes("webm")
      ? ".webm"
      : String(mimetype || "").includes("mpeg")
        ? ".mp3"
        : ".bin"
  const tmpIn = path.join(os.tmpdir(), `vesto-probe-${Date.now()}${ext}`)
  await fs.promises.writeFile(tmpIn, buffer)
  const bin = resolveFfmpegPath()

  try {
    return await new Promise((resolve) => {
      const child = spawn(bin, ["-i", tmpIn, "-f", "null", "-"], { windowsHide: true })
      let stderr = ""
      child.stderr.on("data", (c) => {
        stderr += String(c)
      })
      child.on("error", () => resolve(null))
      child.on("close", () => {
        const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (!m) return resolve(null)
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        resolve(Number.isFinite(sec) && sec > 0 ? sec : null)
      })
    })
  } finally {
    await fs.promises.unlink(tmpIn).catch(() => {})
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
  WHATSAPP_VIDEO_MIME,
  WHATSAPP_IMAGE_MIME,
  prepareWhatsAppPttAudio,
  prepareWhatsAppVideo,
  prepareWhatsAppImage,
  assertWhatsAppAudioAccepted,
  probeMediaDurationSeconds,
  looksLikeOggOpus,
  mimeNeedsConversion,
  stripDataUrl,
}
