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
    <div className="inline-flex w-full max-w-[300px] flex-col rounded-xl border border-brand-700/90 bg-brand-950/80 p-3 shadow-lg shadow-black/20">
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-brand-800/80 pb-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-stone-300">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-accent-400/90" aria-hidden />
          <span className="truncate font-medium">{rangeLabel}</span>
        </div>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            disabled={!start}
            className="shrink-0 rounded-lg bg-accent-500/90 px-2.5 py-1 text-[11px] font-semibold text-brand-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar
          </button>
        )}
      </div>

      <div className="mb-1.5 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-md p-1 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-xs font-medium text-stone-200">
          {MONTHS_SHORT[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-md p-1 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px text-center text-[10px] font-medium uppercase tracking-wide text-stone-600">
        {WEEKDAYS.map((w, i) => (
          <span key={`${w}-${i}`} className="py-0.5">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, idx) => {
          if (!day) {
            return <span key={`e-${idx}`} className="h-7" aria-hidden />
          }
          const ymd = toYmd(day)
          const disabled = ymd > todayYmd || (minYmd && ymd < minYmd)
          const isStart = isSameDay(day, startDate)
          const isEnd = isSameDay(day, endDate)
          const inRange = isInRange(day, startDate, endDate)
          const isToday = ymd === todayYmd
          const isEdge = isStart || isEnd

          return (
            <button
              key={ymd}
              type="button"
              disabled={disabled}
              onClick={() => pickDay(day)}
              className={`flex h-7 w-full items-center justify-center text-xs transition ${
                disabled
                  ? 'cursor-not-allowed text-stone-700'
                  : isEdge
                    ? 'rounded-md bg-accent-500 font-semibold text-brand-950 shadow-sm'
                    : inRange
                      ? 'bg-accent-500/15 text-accent-200/90'
                      : isToday
                        ? 'rounded-md text-accent-400 ring-1 ring-inset ring-accent-500/35 hover:bg-white/5'
                        : 'rounded-md text-stone-300 hover:bg-white/8 hover:text-stone-100'
              }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-stone-600">Dois cliques: início, depois fim.</p>
    </div>
  )
}
