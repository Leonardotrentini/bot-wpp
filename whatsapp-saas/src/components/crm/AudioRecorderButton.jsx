import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, X } from 'lucide-react'
import {
  blobToAudioAttachment,
  formatRecordSeconds,
  openRecordingStream,
  pickAudioMimeType,
  warmUpAudioRecording,
} from '../../lib/audioRecorder.js'
import { AudioWaveform } from './AudioWaveform.jsx'

function RecordingBar({ children, className = '' }) {
  return (
    <div
      className={`flex min-h-[42px] min-w-0 flex-1 items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-2 ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * @param {'click'|'hold'} [mode='click'] — desktop: click start/stop; mobile WA: hold to record.
 * @param {boolean} [autoSendOnStop=false] — se true, onRecorded e o pai pode enviar na hora (hold).
 */
export function AudioRecorderButton({
  disabled,
  onRecorded,
  onError,
  onRecordingChange,
  mode = 'click',
  autoSendOnStop = false,
}) {
  const holdMode = mode === 'hold'
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [slideHint, setSlideHint] = useState(false)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const mimeRef = useRef(null)
  const secondsRef = useRef(0)
  const cancelledRef = useRef(false)
  const startingUiTimerRef = useRef(null)
  const holdPointerIdRef = useRef(null)
  const holdStartXRef = useRef(0)
  const holdActiveRef = useRef(false)

  useEffect(() => {
    secondsRef.current = seconds
  }, [seconds])

  useEffect(() => {
    warmUpAudioRecording().catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      if (startingUiTimerRef.current) clearTimeout(startingUiTimerRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function clearStartingUiTimer() {
    if (startingUiTimerRef.current) {
      clearTimeout(startingUiTimerRef.current)
      startingUiTimerRef.current = null
    }
  }

  function beginStartingUi() {
    clearStartingUiTimer()
    startingUiTimerRef.current = setTimeout(() => setStarting(true), 280)
  }

  function setComposerRecording(active) {
    onRecordingChange?.(active)
  }

  function cleanupStream() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    mimeRef.current = null
  }

  function exitRecordingMode() {
    setRecording(false)
    setStarting(false)
    setSeconds(0)
    setSlideHint(false)
    setComposerRecording(false)
    holdActiveRef.current = false
    holdPointerIdRef.current = null
  }

  async function startRecording() {
    if (starting || recording || processing) return
    const mimeType = pickAudioMimeType()
    if (!mimeType) {
      onError?.('Seu navegador não suporta gravação de áudio.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Microfone indisponível neste navegador.')
      return
    }

    setStarting(false)
    setComposerRecording(true)
    beginStartingUi()

    try {
      await warmUpAudioRecording()
      const stream = await openRecordingStream()
      clearStartingUiTimer()
      setStarting(false)
      streamRef.current = stream
      mimeRef.current = mimeType

      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        if (cancelledRef.current) {
          cancelledRef.current = false
          setProcessing(false)
          cleanupStream()
          exitRecordingMode()
          return
        }
        setProcessing(true)
        try {
          const mime = mimeRef.current || mimeType
          const baseMime = String(mime).split(';')[0].trim() || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: baseMime })
          const elapsed = secondsRef.current
          if (elapsed < 1 && blob.size < 400) {
            throw new Error(
              holdMode ? 'Segure o microfone para gravar.' : 'Grave pelo menos 1 segundo e clique em parar.',
            )
          }
          if (blob.size < 100) {
            throw new Error('Não captamos áudio. Verifique o microfone e tente de novo.')
          }
          const attachment = await blobToAudioAttachment(blob, { durationSeconds: Math.max(elapsed, 1) })
          onRecorded?.(attachment, { autoSend: autoSendOnStop || holdMode })
        } catch (err) {
          onError?.(err?.message || 'Falha ao processar áudio.')
        } finally {
          setProcessing(false)
          cleanupStream()
          exitRecordingMode()
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(200)
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      clearStartingUiTimer()
      cleanupStream()
      exitRecordingMode()
      onError?.('Permita o acesso ao microfone para gravar áudio.')
    }
  }

  function handleMicPointerEnter() {
    warmUpAudioRecording().catch(() => {})
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    if (recorder.state === 'recording') {
      try {
        recorder.requestData()
      } catch {
        /* ignore */
      }
    }
    recorder.stop()
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function cancelRecording() {
    cancelledRef.current = true
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        /* ignore */
      }
    } else {
      cleanupStream()
      exitRecordingMode()
      cancelledRef.current = false
    }
  }

  function finishHoldGesture(clientX) {
    if (!holdActiveRef.current) return
    const dx = clientX - holdStartXRef.current
    holdActiveRef.current = false
    holdPointerIdRef.current = null
    if (dx < -56) {
      cancelRecording()
      return
    }
    // Pode ainda estar em "starting" — para quando o recorder existir.
    const tryStop = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        stopRecording()
        return true
      }
      return false
    }
    if (!tryStop()) {
      // Microfone ainda abrindo: aguarda e para (ou cancela se falhar).
      const startedAt = Date.now()
      const wait = setInterval(() => {
        if (tryStop() || Date.now() - startedAt > 4000) {
          clearInterval(wait)
          if (!mediaRecorderRef.current) {
            cleanupStream()
            exitRecordingMode()
          }
        }
      }, 50)
    }
  }

  useEffect(() => {
    if (!holdMode) return undefined
    const onMove = (e) => {
      if (!holdActiveRef.current || e.pointerId !== holdPointerIdRef.current) return
      const dx = e.clientX - holdStartXRef.current
      setSlideHint(dx < -56)
    }
    const onUp = (e) => {
      if (!holdActiveRef.current) return
      if (holdPointerIdRef.current != null && e.pointerId !== holdPointerIdRef.current) return
      finishHoldGesture(e.clientX)
    }
    const onCancel = () => {
      if (!holdActiveRef.current) return
      holdActiveRef.current = false
      holdPointerIdRef.current = null
      cancelRecording()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners estáveis via refs
  }, [holdMode])

  function onHoldPointerDown(e) {
    if (disabled || processing) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    holdActiveRef.current = true
    holdPointerIdRef.current = e.pointerId
    holdStartXRef.current = e.clientX
    setSlideHint(false)
    void startRecording()
  }

  if (processing) {
    return (
      <RecordingBar className="border-brand-700 bg-brand-900/40">
        <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
        <span className="text-xs text-stone-400">Processando áudio…</span>
      </RecordingBar>
    )
  }

  if (starting) {
    return (
      <RecordingBar>
        {!holdMode && (
          <button
            type="button"
            onClick={() => {
              cleanupStream()
              exitRecordingMode()
            }}
            className="shrink-0 rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
            title="Cancelar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-1 items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-red-300/80" />
          <span className="text-xs text-stone-400">
            {holdMode ? 'Segure para gravar…' : 'Preparando microfone…'}
          </span>
        </div>
        <span className="shrink-0 min-w-[2.75rem] text-xs tabular-nums text-red-300/60">0:00</span>
        <div className="shrink-0 rounded-xl bg-red-500/15 p-2.5 text-red-300/50">
          <Mic className="h-4 w-4" />
        </div>
      </RecordingBar>
    )
  }

  if (recording) {
    if (holdMode) {
      return (
        <RecordingBar className={slideHint ? 'border-red-400/50 bg-red-500/15' : ''}>
          <span className={`shrink-0 text-[10px] ${slideHint ? 'text-red-300' : 'text-stone-500'}`}>
            {slideHint ? 'Solte p/ cancelar' : '← Deslize p/ cancelar'}
          </span>
          <AudioWaveform stream={streamRef.current} active={recording} />
          <span className="shrink-0 min-w-[2.75rem] text-xs tabular-nums text-red-300">
            {formatRecordSeconds(seconds)}
          </span>
          <div className="shrink-0 rounded-xl bg-red-500/35 p-2.5 text-red-100 ring-2 ring-red-400/40">
            <Mic className="h-4 w-4" />
          </div>
        </RecordingBar>
      )
    }
    return (
      <RecordingBar>
        <button
          type="button"
          onClick={cancelRecording}
          className="shrink-0 rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          title="Cancelar gravação"
        >
          <X className="h-4 w-4" />
        </button>
        <AudioWaveform stream={streamRef.current} active={recording} />
        <span className="hidden shrink-0 text-[10px] text-stone-500 sm:inline">Clique em parar</span>
        <span className="shrink-0 min-w-[2.75rem] text-xs tabular-nums text-red-300">{formatRecordSeconds(seconds)}</span>
        <button
          type="button"
          onClick={stopRecording}
          className="shrink-0 rounded-xl bg-red-500/25 p-2.5 text-red-200 transition hover:bg-red-500/35"
          title="Parar gravação"
        >
          <Mic className="h-4 w-4" />
        </button>
      </RecordingBar>
    )
  }

  if (holdMode) {
    return (
      <button
        type="button"
        disabled={disabled}
        onPointerEnter={handleMicPointerEnter}
        onPointerDown={onHoldPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        className="mb-0.5 flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-full border border-accent-500/35 bg-transparent text-accent-300 transition active:bg-accent-500/20 disabled:opacity-40"
        title="Segure para gravar áudio"
        aria-label="Segure para gravar áudio"
      >
        <Mic className="h-5 w-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={startRecording}
      onPointerEnter={handleMicPointerEnter}
      className="shrink-0 rounded-xl p-2.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100 disabled:opacity-40"
      title="Clique para gravar áudio"
    >
      <Mic className="h-5 w-5" />
    </button>
  )
}
