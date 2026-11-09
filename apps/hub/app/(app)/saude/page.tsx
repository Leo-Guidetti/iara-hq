import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { dailyAlerts } from '@/lib/alerts'
import { addDays, fmtDay, fmtKg, spDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'
const SPORT: Record<string, string> = { strength: 'Força', run: 'Corrida', walk: 'Caminhada', swim: 'Natação', ride_indoor: 'Bike indoor', ride_outdoor: 'Bike', mobility: 'Mobilidade', yoga: 'Yoga', hiit: 'HIIT', hike: 'Trilha', row: 'Remo', other: 'Outro' }

export default async function Inicio() {
  const me = (await currentUser())!
  const today = spDate()
  const ws = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))
  const [{ data: profile }, { data: trend }, { data: comp }, { data: food }, { data: diet }, { data: todaySessions }, { data: week }, { data: daily }, { data: checkin }, { alerts }] = await Promise.all([
    me.sb.from('profiles').select('display_name').eq('id', me.user.id).single(),
    me.sb.from('weight_with_trend').select('local_date, trend_7d').gte('local_date', addDays(today, -8)).order('local_date'),
    me.sb.from('body_comp_estimates').select('local_date, bf_mean, lean_mass_kg').order('local_date', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('food_logs').select('kcal, protein_g').eq('local_date', today),
    me.sb.from('diet_recommendations').select('kcal_target, protein_g_target').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('plan_sessions').select('id, title, sport, duration_min, status').eq('local_date', today).order('id'),
    me.sb.from('plan_sessions').select('status').gte('local_date', ws).lte('local_date', addDays(ws, 6)),
    me.sb.from('daily_activity').select('steps, sleep_min, resting_hr').eq('local_date', today).maybeSingle(),
    me.sb.from('weekly_checkins').select('week_start, score, payload').order('week_start', { ascending: false }).limit(1).maybeSingle(),
    dailyAlerts(me.sb),
  ])
  const last = trend?.at(-1), first = trend?.[0]
  const delta = last?.trend_7d != null && first?.trend_7d != null && last !== first ? Number(last.trend_7d) - Number(first.trend_7d) : null
  const kcal = (food ?? []).reduce((a, f) => a + (f.kcal ?? 0), 0)
  const prot = (food ?? []).reduce((a, f) => a + Number(f.protein_g ?? 0), 0)
  const done = (week ?? []).filter((s) => s.status === 'done').length
  const cp = checkin?.payload as { headline?: string; focus_of_week?: string } | null

  return (
    <div className="stack">
      <div>
        <span className="tag progress">Saúde · {new Date(`${today}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
        <h1>Olá{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
      </div>

      {alerts.map((a) => (
        <Link key={a.text} href={a.href} className={`card ${a.level === 'alert' ? 'alert' : ''}`}>
          <span className={`tag ${a.level === 'alert' ? 'alert' : ''}`} style={a.level === 'info' ? { color: 'var(--muted)' } : undefined}>{a.level === 'alert' ? 'Atenção' : 'Lembrete'}</span>
          <p style={{ margin: '4px 0 0' }}>{a.text}</p>
        </Link>
      ))}

      <section className="grid2">
        <Link href="/saude/peso" className="card">
          <span className="tag progress">Peso · 7 dias</span>
          <div className="kpi num">{fmtKg(last?.trend_7d)}</div>
          <span className={`small ${delta == null ? 'muted' : delta > 0 ? 'up' : 'down'}`}>{delta == null ? 'sem tendência' : `${delta > 0 ? '+' : ''}${delta.toFixed(2).replace('.', ',')} kg na semana`}</span>
        </Link>
        <Link href="/saude/corpo" className="card">
          <span className="tag progress">Gordura · fita</span>
          <div className="kpi num">{comp?.bf_mean != null ? `${String(comp.bf_mean).replace('.', ',')}%` : '—'}</div>
          <span className="small muted">{comp ? `magra ${fmtKg(comp.lean_mass_kg)} · ${fmtDay(comp.local_date!)}` : 'sem medidas'}</span>
        </Link>
        <Link href="/saude/dieta" className="card">
          <span className="tag progress">Proteína hoje</span>
          <div className="kpi num">{Math.round(prot)}<span className="small muted"> / {diet?.protein_g_target ?? '—'} g</span></div>
          <span className="small muted">{kcal} / {diet?.kcal_target ?? '—'} kcal</span>
        </Link>
        <Link href="/saude/treino" className="card">
          <span className="tag progress">Treinos na semana</span>
          <div className="kpi num">{done}<span className="small muted"> / {week?.length ?? 0}</span></div>
          <span className="small muted">{daily?.steps != null ? `${daily.steps.toLocaleString('pt-BR')} passos hoje` : 'sem dados do Watch hoje'}</span>
        </Link>
      </section>

      <section className="card">
        <h2>Hoje</h2>
        <div className="list">
          {(todaySessions ?? []).map((s) => (
            <Link key={s.id} href={`/saude/treino/${s.id}`} className="row between">
              <span><strong>{s.title}</strong><br /><span className="small muted">{SPORT[s.sport] ?? s.sport}{s.duration_min ? ` · ${s.duration_min} min` : ''}</span></span>
              <span className={s.status === 'done' ? 'tag progress' : 'small muted'}>{s.status === 'done' ? '✓ feito' : s.status === 'skipped' ? 'pulado' : 'planejado'}</span>
            </Link>
          ))}
          {!todaySessions?.length && <p className="muted">Dia de descanso.</p>}
        </div>
        {daily?.sleep_min != null && <p className="small muted">Sono {Math.floor(daily.sleep_min / 60)}h{String(daily.sleep_min % 60).padStart(2, '0')}{daily.resting_hr ? ` · FC repouso ${daily.resting_hr}` : ''}</p>}
      </section>

      {cp && (
        <Link href="/saude/treino" className="card ai">
          <span className="tag ai">✦ Check-in · {checkin!.score}/100</span>
          <p style={{ margin: '6px 0 0' }}>{cp.headline}</p>
          {cp.focus_of_week && <p className="small muted" style={{ margin: '4px 0 0' }}>Foco: {cp.focus_of_week}</p>}
        </Link>
      )}
      <p className="disclaimer">A ClaudIA organiza o processo com base em referências acadêmicas. Não é aconselhamento médico.</p>
    </div>
  )
}
