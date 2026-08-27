import { Clock } from 'lucide-react'
import { Input } from '../common/Input.jsx'
import { Select } from '../common/Select.jsx'
import { buildActionDelayPatch, getActionDelayUi, maxDelayForUnit } from '../../lib/flowActionDelay.js'

export function FlowActionDelay({ action, onChange, isFirst = false }) {
  const delay = getActionDelayUi(action)
  const max = maxDelayForUnit(delay.unit)

  return (
    <div className="rounded-lg border border-brand-800/80 bg-brand-950/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-400">
        <Clock className="h-3.5 w-3.5 text-accent-400" />
        {isFirst ? 'Aguardar antes de começar' : 'Aguardar antes desta ação'}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[100px] flex-1">
          <Input
            label="Tempo"
            type="number"
            min={0}
            max={max}
            value={delay.value}
            onChange={(e) => {
              const n = Math.max(0, Number(e.target.value) || 0)
              onChange(buildActionDelayPatch(n, delay.unit))
            }}
          />
        </div>
        <div className="w-32">
          <p className="mb-1.5 text-sm font-medium text-stone-300">Unidade</p>
          <Select
            value={delay.unit}
            onChange={(e) => {
              const unit =
                e.target.value === 'seconds' || e.target.value === 'hours' ? e.target.value : 'minutes'
              onChange(buildActionDelayPatch(delay.value, unit))
            }}
          >
            <option value="seconds">Segundos</option>
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
          </Select>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">
        {delay.value > 0
          ? isFirst
            ? 'O fluxo espera esse tempo após o gatilho antes da primeira ação.'
            : 'O fluxo espera esse tempo após a ação anterior antes de executar esta.'
          : isFirst
            ? 'Deixe 0 para executar assim que o gatilho disparar.'
            : 'Deixe 0 para executar logo após a ação anterior.'}
      </p>
    </div>
  )
}
