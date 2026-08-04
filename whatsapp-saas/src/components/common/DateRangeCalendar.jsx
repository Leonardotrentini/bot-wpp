import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function parseYmd(ymd) {
  if (!ymd) return null
  const d = new Date(`${ymd}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function toYmd(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function isSameDay(a, b) {
  return a && b && toYmd(a) === toYmd(b)
}

function isInRange(day, start, end) {
  if (!start || !end) return false
  const t = day.getTime()
  const lo = Math.min(start.getTime(), end.getTime())
  const hi = Math.max(start.getTime(), end.getTime())
  return t >= lo && t <= hi
}

function buildMonthGrid(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1, 12, 0, 0, 0)
  const startPad = first.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewYear, viewMonth, d, 12, 0, 0, 0))
  }
  return cells
}

function formatShort(ymd) {
  const d = parseYmd(ymd)
  if (!d) return null
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function DateRangeCalendar({ start = '', end = '', onChange, onApply, maxDate, minDate }) {
  const today = useMemo(() => {
    const t = maxDate ? parseYmd(maxDate) : new Date()
    return t || new Date()
  }, [maxDate])
  const todayYmd = toYmd(today)
  const minYmd = minDate || null

  const initialView = parseYmd(end) || parseYmd(start) || today
  const [viewYear, setViewYear] = useState(initialView.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialView.getMonth())

  const startDate = parseYmd(start)
  const endDate = parseYmd(end)
  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  const rangeLabel = useMemo(() => {
    if (start && end) return `${formatShort(start)} – ${formatShort(end)}`
    if (start) return `${formatShort(start)} → escolha o fim`
    return 'Escolha o início'
  }, [start, end])

  function shiftMonth(delta) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) {
      m = 11
      y -= 1
    }
    if (m > 11) {
      m = 0
      y += 1
    }
    setViewMonth(m)
    setViewYear(y)
  }

  function pickDay(day) {
    const ymd = toYmd(day)
    if (ymd > todayYmd) return
    if (minYmd && ymd < minYmd) return

    if (!startDate || (startDate && endDate)) {
      onChange?.({ start: ymd, end: '' })
      return
    }
    if (day.getTime() < startDate.getTime()) {
      onChange?.({ start: ymd, end: toYmd(startDate) })
      return
    }
    onChange?.({ start: toYmd(startDate), end: ymd })
  }

  return (
    <div
      role="dialog"
      aria-label="Selecionar período"
      className="relative w-[280px] overflow-hidden rounded-2xl border border-brand-600/80 bg-[#0b1511] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.75)] ring-1 ring-white/10"
    >
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-brand-700/80 bg-brand-900 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-stone-100">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-accent-400" aria-hidden />
          <span className="truncate font-medium tracking-tight">{rangeLabel}</span>
        </div>
        {onApply ? (
          <button
            type="button"
            onClick={onApply}
            disabled={!start}
            className="shrink-0 rounded-lg bg-accent-500 px-2.5 py-1 text-[11px] font-semibold text-brand-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Aplicar
          </button>
        ) : null}
      </div>

      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg p-1.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold tabular-nums text-stone-50">
          {MONTHS_SHORT[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg p-1.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-0.5 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500">
        {WEEKDAYS.map((w, i) => (
          <span key={`${w}-${i}`} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (!day) {
            return <span key={`e-${idx}`} className="h-8" aria-hidden />
          }
          const ymd = toYmd(day)
          const disabled = ymd > todayYmd || (minYmd && ymd < minYmd)
          const isStart = isSameDay(day, startDate)
          const isEnd = isSameDay(day, endDate)
          const inRange = isInRange(day, startDate, endDate)
          const isToday = ymd === todayYmd
          const isEdge = isStart || isEnd
          const rangeOnly = inRange && !isEdge

          return (
            <button
              key={ymd}
              type="button"
              disabled={disabled}
              onClick={() => pickDay(day)}
              className={`flex h-8 w-full items-center justify-center text-[13px] tabular-nums transition ${
                disabled
                  ? 'cursor-not-allowed text-stone-700'
                  : isEdge
                    ? 'rounded-lg bg-accent-500 font-semibold text-brand-950 shadow-sm shadow-accent-500/30'
                    : rangeOnly
                      ? 'rounded-md bg-accent-500/25 text-accent-100'
                      : isToday
                        ? 'rounded-lg font-medium text-accent-300 ring-1 ring-inset ring-accent-500/50 hover:bg-white/5'
                        : 'rounded-lg text-stone-200 hover:bg-white/8 hover:text-white'
              }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <p className="mt-2.5 border-t border-brand-800 pt-2 text-center text-[10px] text-stone-500">
        Clique no início e depois no fim
      </p>
    </div>
  )
}
