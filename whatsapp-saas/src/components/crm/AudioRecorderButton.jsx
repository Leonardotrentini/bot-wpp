import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, X } from 'lucide-react'
import { blobToAudioAttachment, formatRecordSeconds, pickAudioMimeType } from '../../lib/audioRecorder.js'

export function AudioRecorderButton({ disabled, onRecorded, onError, onRecordingChange }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [processing, setProcessing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => {
    onRecordingChange?.(recording)
  }, [recording, onRecordingChange])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function cleanupStream() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
  }

  async function startRecording() {
    const mimeType = pickAudioMimeType()
    if (!mimeType) {
      onError?.('Seu navegador não suporta gravação de áudio.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Microfone indisponível neste navegador.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        setProcessing(true)
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const attachment = await blobToAudioAttachment(blob)
          onRecorded?.(attachment)
        } catch (err) {
          onError?.(err?.message || 'Falha ao processar áudio.')
        } finally {
          setProcessing(false)
          cleanupStream()
          setRecording(false)
          setSeconds(0)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start(250)
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      cleanupStream()
      onError?.('Permita o acesso ao microfone para gravar áudio.')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function cancelRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
    cleanupStream()
    setRecording(false)
    setSeconds(0)
  }

  if (processing) {
    return (
      <button type="button" disabled className="rounded-xl p-2.5 text-stone-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </button>
    )
  }

  if (recording) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={cancelRecording}
          className="rounded-xl p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          title="Cancelar gravação"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="hidden min-w-[3rem] text-xs tabular-nums text-red-300 sm:inline">{formatRecordSeconds(seconds)}</span>
        <button
          type="button"
          onClick={stopRecording}
          className="rounded-xl bg-red-500/20 p-2.5 text-red-300 transition hover:bg-red-500/30"
          title="Finalizar gravação"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={startRecording}
      className="rounded-xl p-2.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100 disabled:opacity-40"
      title="Gravar áudio"
    >
      <Mic className="h-5 w-5" />
    </button>
  )
}
