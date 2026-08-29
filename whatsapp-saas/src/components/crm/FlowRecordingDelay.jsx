import { Mic } from 'lucide-react'
import { Input } from '../common/Input.jsx'
import { buildRecordingDelayPatch, getRecordingDelayUi, MAX_RECORDING_DELAY_SECONDS } from '../../lib/flowRecordingDelay.js'

export function FlowRecordingDelay({ action, onChange }) {
  const seconds = getRecordingDelayUi(action)

  return (
    <div className="mt-3 rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-400">
        <Mic className="h-3.5 w-3.5 text-sky-400" />
        Simular “gravando áudio…” antes de enviar
      </div>
      <div className="max-w-[160px]">
        <Input
          label="Segundos"
          type="number"
          min={0}
          max={MAX_RECORDING_DELAY_SECONDS}
          value={seconds}
          onChange={(e) => {
            const n = Math.max(0, Math.min(MAX_RECORDING_DELAY_SECONDS, Number(e.target.value) || 0))
            onChange(buildRecordingDelayPatch(n))
          }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-stone-500">
        {seconds > 0
          ? `O contato verá “gravando áudio…” por ~${seconds}s (renovado a cada 2–3s). Valor fixo — não estendemos pela duração do áudio.`
          : 'Deixe 0 para calcular automaticamente pela duração do áudio (3–20s).'}
      </p>
    </div>
  )
}
