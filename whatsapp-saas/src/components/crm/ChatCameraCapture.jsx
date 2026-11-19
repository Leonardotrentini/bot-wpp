import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Loader2, SwitchCamera, Video, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { rememberCamPermission } from '../../lib/mediaPermissions.js'

function pickVideoRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return null
  // Backend CRM exige MP4 — só gravamos se o browser gerar MP4.
  const candidates = ['video/mp4', 'video/mp4;codecs=avc1', 'video/mp4;codecs=h264']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || null
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  })
}

/**
 * Câmera full-screen (mobile). Foto via canvas (JPEG).
 * Vídeo só com MediaRecorder MP4; senão usa input nativo capture.
 */
export function ChatCameraCapture({ open, onClose, onCapture, onError }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const fileVideoRef = useRef(null)

  const [mode, setMode] = useState('photo') // photo | video
  const [facing, setFacing] = useState('environment')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [preview, setPreview] = useState(null) // { url, file, type }
  const [mp4Ok, setMp4Ok] = useState(() => Boolean(pickVideoRecorderMime()))

  const cleanupPreview = useCallback(() => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }, [preview])

  const closeAll = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    } catch {
      /* ignore */
    }
    recorderRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    cleanupPreview()
    setReady(false)
    setRecording(false)
    setStarting(false)
    setSeconds(0)
    onClose?.()
  }, [cleanupPreview, onClose])

  const startCamera = useCallback(
    async (nextFacing = facing) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.('Câmera indisponível neste navegador.')
        return
      }
      setStarting(true)
      setReady(false)
      stopStream(streamRef.current)
      streamRef.current = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: mode === 'video',
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        streamRef.current = stream
        rememberCamPermission()
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setReady(true)
      } catch {
        onError?.('Permita o acesso à câmera para tirar foto ou gravar vídeo.')
      } finally {
        setStarting(false)
      }
    },
    [facing, mode, onError],
  )

  useEffect(() => {
    if (!open) return undefined
    setMp4Ok(Boolean(pickVideoRecorderMime()))
    setMode('photo')
    setFacing('environment')
    startCamera('environment')
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      } catch {
        /* ignore */
      }
      stopStream(streamRef.current)
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abrir uma vez por `open`
  }, [open])

  useEffect(() => {
    if (!open || preview) return
    startCamera(facing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  if (!open) return null

  async function flipCamera() {
    const next = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    await startCamera(next)
  }

  function takePhoto() {
    const video = videoRef.current
    if (!video || !ready) return
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onError?.('Não foi possível capturar a foto.')
          return
        }
        const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        stopStream(streamRef.current)
        streamRef.current = null
        setReady(false)
        setPreview({ url, file, type: 'image' })
      },
      'image/jpeg',
      0.92,
    )
  }

  function startVideoRecording() {
    const mime = pickVideoRecorderMime()
    if (!mime || !streamRef.current) {
      fileVideoRef.current?.click()
      return
    }
    chunksRef.current = []
    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType: mime })
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/mp4' })
        if (blob.size < 500) {
          onError?.('Vídeo muito curto. Tente de novo.')
          setRecording(false)
          return
        }
        const file = new File([blob], `video-${Date.now()}.mp4`, { type: 'video/mp4' })
        const url = URL.createObjectURL(blob)
        stopStream(streamRef.current)
        streamRef.current = null
        setReady(false)
        setPreview({ url, file, type: 'video' })
        setRecording(false)
      }
      recorderRef.current = recorder
      recorder.start(250)
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      onError?.('Não foi possível gravar vídeo neste aparelho.')
      fileVideoRef.current?.click()
    }
  }

  function stopVideoRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.requestData?.()
      } catch {
        /* ignore */
      }
      recorder.stop()
    }
  }

  function confirmSend() {
    if (!preview?.file) return
    onCapture?.(preview.file)
    if (preview.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
    closeAll()
  }

  function retake() {
    cleanupPreview()
    startCamera(facing)
  }

  const mm = String(Math.floor(seconds / 60)).padStart(1, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-black lg:hidden" role="dialog" aria-modal="true">
      <input
        ref={fileVideoRef}
        type="file"
        accept="video/mp4,video/*,.mp4"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) {
            onCapture?.(file)
            closeAll()
          }
        }}
      />

      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={closeAll}
          className="rounded-full bg-black/40 p-2.5 text-white"
          aria-label="Fechar câmera"
        >
          <X className="h-5 w-5" />
        </button>
        {!preview && (
          <div className="inline-flex rounded-full bg-black/45 p-1">
            <button
              type="button"
              onClick={() => setMode('photo')}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                mode === 'photo' ? 'bg-accent-500 text-brand-950' : 'text-stone-200'
              }`}
            >
              Foto
            </button>
            <button
              type="button"
              onClick={() => {
                if (!mp4Ok) {
                  fileVideoRef.current?.click()
                  return
                }
                setMode('video')
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                mode === 'video' ? 'bg-accent-500 text-brand-950' : 'text-stone-200'
              }`}
            >
              Vídeo
            </button>
          </div>
        )}
        {!preview ? (
          <button
            type="button"
            onClick={flipCamera}
            className="rounded-full bg-black/40 p-2.5 text-white"
            aria-label="Inverter câmera"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        ) : (
          <span className="w-10" />
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-black">
        {preview ? (
          preview.type === 'video' ? (
            <video src={preview.url} controls playsInline className="h-full w-full object-contain" />
          ) : (
            <img src={preview.url} alt="Prévia" className="h-full w-full object-contain" />
          )
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
            {(starting || !ready) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-8 w-8 animate-spin text-accent-300" />
              </div>
            )}
            {recording && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white">
                REC {mm}:{ss}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-6 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {preview ? (
          <>
            <Button type="button" variant="secondary" onClick={retake}>
              Refazer
            </Button>
            <Button type="button" onClick={confirmSend}>
              Enviar
            </Button>
          </>
        ) : mode === 'photo' ? (
          <button
            type="button"
            disabled={!ready || starting}
            onClick={takePhoto}
            className="flex h-18 w-18 items-center justify-center rounded-full border-4 border-white/80 bg-white/20 p-1 disabled:opacity-40"
            aria-label="Tirar foto"
            style={{ height: 72, width: 72 }}
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-brand-950">
              <Camera className="h-7 w-7" />
            </span>
          </button>
        ) : recording ? (
          <button
            type="button"
            onClick={stopVideoRecording}
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-red-400 bg-red-500/30"
            aria-label="Parar vídeo"
          >
            <span className="h-7 w-7 rounded-md bg-red-500" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready || starting}
            onClick={startVideoRecording}
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-white/15 text-white disabled:opacity-40"
            aria-label="Gravar vídeo"
          >
            <Video className="h-7 w-7" />
          </button>
        )}
      </div>
      {!mp4Ok && mode === 'photo' && (
        <p className="px-4 pb-3 text-center text-[11px] text-stone-400">
          Neste aparelho, vídeo pela câmera abre o gravador nativo (MP4).
        </p>
      )}
    </div>
  )
}
