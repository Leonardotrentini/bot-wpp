import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

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
  const a = Math.min(start.getTime(), end.getTime())
  const b = Math.max(start.getTime(), end.getTime())
  return t >= a && t <= b
}

function startOfMonth(year, month) {
  return new Date(year, month, 1, 12, 0, 0, 0)
}

function buildMonthGrid(viewYear, viewMonth) {
  const first = startOfMonth(viewYear, viewMonth)
  const startPad = first.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewYear, viewMonth, d, 12, 0, 0, 0))
  }
  return cells
}

function formatBr(ymd) {
  const d = parseYmd(ymd)
  if (!d) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function DateRangeCalendar({ start = '', end = '', onChange, maxDate }) {
  const today = useMemo(() => {
    const t = maxDate ? parseYmd(maxDate) : new Date()
    return t || new Date()
  }, [maxDate])
  const todayYmd = toYmd(today)

  const initialView = parseYmd(end) || parseYmd(start) || today
  const [viewYear, setViewYear] = useState(initialView.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialView.getMonth())

  const startDate = parseYmd(start)
  const endDate = parseYmd(end)
  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

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

  function setPreset(days) {
    const endD = today
    const startD = new Date(today)
    startD.setDate(startD.getDate() - (days - 1))
    onChange?.({ start: toYmd(startD), end: toYmd(endD) })
    setViewYear(endD.getFullYear())
    setViewMonth(endD.getMonth())
  }

  return (
    <div className="rounded-2xl border border-brand-700 bg-brand-950/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-stone-300">
          <Calendar className="h-4 w-4 text-accent-400" />
          <span>
            {start ? formatBr(start) : 'Início'} — {end ? formatBr(end) : 'Fim'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '7 dias', days: 7 },
            { label: '30 dias', days: 30 },
            { label: '90 dias', days: 90 },
          ].map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPreset(p.days)}
              className="rounded-lg border border-brand-700 px-2.5 py-1 text-xs text-stone-400 transition hover:border-accent-500/40 hover:text-accent-300"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold text-stone-100 font-heading">
          {MONTHS[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-stone-500 mb-1">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (!day) return <span key={`empty-${idx}`} />
          const ymd = toYmd(day)
          const disabled = ymd > todayYmd
          const isStart = isSameDay(day, startDate)
          const isEnd = isSameDay(day, endDate)
          const inRange = isInRange(day, startDate, endDate)
          const isToday = ymd === todayYmd

          return (
            <button
              key={ymd}
              type="button"
              disabled={disabled}
              onClick={() => pickDay(day)}
              className={`relative flex h-9 w-full items-center justify-center rounded-lg text-sm transition ${
                disabled
                  ? 'cursor-not-allowed text-stone-700'
                  : isStart || isEnd
                    ? 'bg-accent-500 font-semibold text-brand-950'
                    : inRange
                      ? 'bg-accent-500/20 text-accent-200'
                      : isToday
                        ? 'border border-accent-500/40 text-accent-300 hover:bg-white/5'
                        : 'text-stone-200 hover:bg-white/10'
              }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-stone-500">
        Clique no dia inicial e depois no dia final. Para trocar, clique de novo no novo início.
      </p>
    </div>
  )
}
