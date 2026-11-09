import { currentUser } from '@/lib/supabase/server'
import { addDays, fmtDay, fmtKg, spDate } from '@/lib/dates'
import { WeightChart, type Point } from './WeightChart'
import { WeightForm } from './WeightForm'
import { DeleteButton } from './DeleteButton'

export const dynamic = 'force-dynamic'

const SOURCE: Record<string, string> = { manual: 'manual', shortcut: 'atalho', apple_health: 'Saúde' }

export default async function PesoPage() {
  const me = (await currentUser())!
  const since = addDays(spDate(), -90)
  const [{ data: trend }, { data: entries }] = await Promise.all([
    me.sb.from('weight_with_trend').select('local_date, weight_kg, trend_7d, n_7d').gte('local_date', since).order('local_date'),
    me.sb.from('weight_entries').select('id, measured_at, local_date, weight_kg, fasted, source, note').order('measured_at', { ascending: false }).limit(20),
  ])

  const points: Point[] = (trend ?? []).map((r) => ({ date: r.local_date!, weight: r.weight_kg, trend: r.trend_7d }))
  const last = trend?.at(-1)
  const weekAgo = trend?.filter((r) => r.local_date! <= addDays(last?.local_date ?? spDate(), -7)).at(-1)
  const rate = last?.trend_7d != null && weekAgo?.trend_7d != null ? Number(last.trend_7d) - Number(weekAgo.trend_7d) : null
  const pct = rate != null && weekAgo?.trend_7d ? (rate / Number(weekAgo.trend_7d)) * 100 : null

  return (
    <div className="stack">
      <div>
        <h1>Peso</h1>
        <p className="muted small">A média de 7 dias filtra água e sal; é ela que mostra a tendência.</p>
      </div>

      <section className="grid2">
        <div className="card">
          <span className="tag progress">Média 7 dias</span>
          <div className="kpi num">{fmtKg(last?.trend_7d)}</div>
          <span className="small muted">{last ? `${last.n_7d} pesagens · ${fmtDay(last.local_date!)}` : 'sem dados'}</span>
        </div>
        <div className={`card ${pct != null && pct < -1 ? 'alert' : ''}`}>
          <span className={`tag ${pct != null && pct < -1 ? 'alert' : 'progress'}`}>Ritmo semanal</span>
          <div className={`kpi num ${rate != null ? (rate > 0 ? 'up' : 'down') : ''}`}>
            {rate == null ? '—' : `${rate > 0 ? '+' : ''}${rate.toFixed(2).replace('.', ',')}`}
          </div>
          <span className="small muted">
            {pct == null ? 'precisa de 2 semanas' : pct < -1 ? `${pct.toFixed(1)}%/sem: rápido, risco de perder massa magra` : `${pct.toFixed(1).replace('.', ',')}% do peso por semana`}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Últimos 90 dias</h2>
        <WeightChart data={points} />
      </section>

      <WeightForm />

      <section className="card">
        <h2>Registros</h2>
        <div className="list">
          {(entries ?? []).map((e) => (
            <div key={e.id} className="row between">
              <div>
                <div className="num">{fmtKg(e.weight_kg)}</div>
                <div className="small muted">
                  {fmtDay(e.local_date)} · {new Date(e.measured_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                  {' · '}{SOURCE[e.source] ?? e.source}{e.fasted ? ' · jejum' : ''}{e.note ? ` · ${e.note}` : ''}
                </div>
              </div>
              <DeleteButton id={e.id} />
            </div>
          ))}
          {!entries?.length && <p className="muted">Nenhuma pesagem ainda.</p>}
        </div>
      </section>
    </div>
  )
}
