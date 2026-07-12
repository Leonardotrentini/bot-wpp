import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'

const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' },
  labelStyle: { color: '#fafaf9' },
}

export function ChartWidget({ chartType, payload, title }) {
  const { series = [], dataKey = 'msgs', xKey = 'day', multiSeries } = payload || {}

  if (!series.length) {
    return <p className="text-sm text-stone-500 py-8 text-center">Sem dados no período.</p>
  }

  const height = chartType === 'bar_horizontal' ? Math.max(200, series.length * 32) : 260

  if (chartType === 'bar_horizontal') {
    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={series} margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} horizontal={false} />
            <XAxis type="number" stroke="#a8a29e" fontSize={12} />
            <YAxis type="category" dataKey={xKey} width={100} stroke="#a8a29e" fontSize={11} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey={dataKey} fill="#eab308" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (multiSeries?.length) {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
            <XAxis dataKey={xKey} stroke="#a8a29e" fontSize={11} />
            <YAxis stroke="#a8a29e" fontSize={12} allowDecimals={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend />
            {multiSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chartType === 'bar') {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
            <XAxis dataKey={xKey} stroke="#a8a29e" fontSize={11} />
            <YAxis stroke="#a8a29e" fontSize={12} allowDecimals={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey={dataKey} fill="#eab308" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series}>
          <defs>
            <linearGradient id={`area-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#eab308" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
          <XAxis dataKey={xKey} stroke="#a8a29e" fontSize={11} />
          <YAxis stroke="#a8a29e" fontSize={12} allowDecimals={false} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke="#eab308"
            fill={`url(#area-${title})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
