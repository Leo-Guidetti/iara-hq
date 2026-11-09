'use client'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDay } from '@/lib/dates'

export type CompPoint = { date: string; fat: number | null; lean: number | null }

export function CompChart({ data }: { data: CompPoint[] }) {
  if (data.length < 2) return <p className="muted small">Com duas medições aparece a evolução de gordura x massa magra.</p>
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="fat" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 2', 'dataMax + 2']} />
          <YAxis yAxisId="lean" orientation="right" hide domain={['dataMin - 2', 'dataMax + 2']} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }} labelFormatter={(l) => fmtDay(String(l))}
            formatter={(v, n) => [`${Number(v).toFixed(1).replace('.', ',')} kg`, n === 'fat' ? 'Gordura' : 'Massa magra']} />
          <Legend formatter={(v) => (v === 'fat' ? 'Gordura' : 'Massa magra')} wrapperStyle={{ fontSize: 13 }} />
          <Line yAxisId="fat" dataKey="fat" stroke="var(--alert)" strokeWidth={2.5} dot />
          <Line yAxisId="lean" dataKey="lean" stroke="var(--progress)" strokeWidth={2.5} dot />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
