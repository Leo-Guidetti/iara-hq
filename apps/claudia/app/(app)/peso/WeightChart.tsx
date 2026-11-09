'use client'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDay } from '@/lib/dates'

export type Point = { date: string; weight: number | null; trend: number | null }

export function WeightChart({ data }: { data: Point[] }) {
  if (data.length < 2) return <p className="muted small">Registre pelo menos dois dias para ver o gráfico.</p>
  const vals = data.flatMap((p) => [p.weight, p.trend]).filter((v): v is number => v != null)
  const min = Math.floor(Math.min(...vals) - 1)
  const max = Math.ceil(Math.max(...vals) + 1)
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#2E3B4C" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: '#8B98A8', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[min, max]} tick={{ fill: '#8B98A8', fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: '#1C2530', border: '1px solid #2E3B4C', borderRadius: 12 }}
            labelFormatter={(l) => fmtDay(String(l))}
            formatter={(v, name) => [`${Number(v).toFixed(1).replace('.', ',')} kg`, name === 'trend' ? 'Média 7 dias' : 'Peso']}
          />
          <Scatter dataKey="weight" fill="#8B98A8" />
          <Line dataKey="trend" stroke="#4FD1A5" strokeWidth={2.5} dot={false} type="monotone" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
