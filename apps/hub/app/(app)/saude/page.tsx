import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Fila, type Item } from '../casa/Fila'
import { addDays, fmtKg, spDate } from '@/lib/dates'
import { adesaoParcial } from '@/lib/adesao'
import { Anel } from '@/components/Anel'

export const dynamic = 'force-dynamic'
const SPORT: Record<string, string> = { strength: 'Força', run: 'Corrida', walk: 'Caminhada', swim: 'Natação', ride_indoor: 'Bike indoor', ride_outdoor: 'Bike', mobility: 'Mobilidade', yoga: 'Yoga', hiit: 'HIIT', hike: 'Trilha', row: 'Remo', other: 'Outro' }

export default async function Inicio() {
  const me = (await currentUser())!
  const today = spDate()
  const [adesao, { data: trend }, { data: food }, { data: diet }, { data: todaySessions }, { data: daily }, { data: checkin }, alertasRes] = await Promise.all([
    adesaoParcial().catch(() => null),
    me.sb.from('weight_with_trend').select('local_date, trend_7d').gte('local_date', addDays(today, -8)).order('local_date'),
    me.sb.from('food_logs').select('kcal, protein_g').eq('local_date', today),
    me.sb.from('diet_recommendations').select('kcal_target, protein_g_target').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('plan_sessions').select('id, title, sport, duration_min, status').eq('local_date', today).order('id'),
    me.sb.from('daily_activity').select('steps, sleep_min, resting_hr').eq('local_date', today).maybeSingle(),
    me.sb.from('weekly_checkins').select('week_start, score, payload').order('week_start', { ascending: false }).limit(1).maybeSingle(),
    (me.sb as unknown as SupabaseClient).rpc('hub_alertas'),
  ])
  const alertas = alertasRes.data as { itens?: Partial<Item>[] } | null
  const alertaItens = (alertas?.itens ?? []).map((i) => ({ origem: 'claudia', tipo: 'alerta', detalhe: null, minutos: null, acao: {}, ...i }) as Item)
  const last = trend?.at(-1), first = trend?.[0]
  const delta = last?.trend_7d != null && first?.trend_7d != null && last !== first ? Number(last.trend_7d) - Number(first.trend_7d) : null
  const kcal = (food ?? []).reduce((a, f) => a + (f.kcal ?? 0), 0)
  const prot = (food ?? []).reduce((a, f) => a + Number(f.protein_g ?? 0), 0)
  const alvoP = Number(diet?.protein_g_target ?? 0)
  const cp = checkin?.payload as { headline?: string; focus_of_week?: string } | null

  return (
    <>
      {adesao && (
        <section className="card row" aria-label="Adesão da semana" style={{ gap: 18 }}>
          <Anel valor={adesao.nota} max={100} tamanho={84} rotulo={`Adesão ${adesao.nota} de 100`} />
          <div className="small" style={{ lineHeight: 1.6 }}>
            <div className="muted">Adesão da semana{adesao.dias < 7 ? ' · parcial' : ''}</div>
            <div>Pesagens {adesao.pesagens.feitos}/{adesao.pesagens.de}</div>
            <div>Treinos {adesao.treinos.feitos}/{adesao.treinos.de}</div>
            <div>Alimentação {adesao.alimentacao.feitos}/{adesao.alimentacao.de} dias</div>
          </div>
        </section>
      )}

      <section className="grid2" aria-label="Hoje">
        <Link href="/saude/dieta" className="card" style={{ color: 'inherit' }}>
          <div className="small muted">Proteína</div>
          <div className="num" style={{ fontSize: '1.5rem', fontWeight: 300, margin: '4px 0 10px' }}>{Math.round(prot)}<span className="small muted"> / {alvoP || '—'} g</span></div>
          <div className="barra" aria-hidden="true"><i style={{ width: `${alvoP ? Math.min(100, (prot / alvoP) * 100) : 0}%` }} /></div>
          <div className="small" style={{ color: 'var(--dim)', marginTop: 6 }}>{kcal} / {diet?.kcal_target ?? '—'} kcal</div>
        </Link>
        <Link href="/saude/peso" className="card" style={{ color: 'inherit' }}>
          <div className="small muted">Peso · 7 dias</div>
          <div className="num" style={{ fontSize: '1.5rem', fontWeight: 300, margin: '4px 0 10px' }}>{fmtKg(last?.trend_7d)}</div>
          <div className="small" style={{ color: delta == null ? 'var(--dim)' : delta > 0 ? 'var(--alert)' : 'var(--accent)' }}>{delta == null ? 'sem tendência' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1).replace('.', ',')} kg na semana`}</div>
        </Link>
      </section>

      <section className="card" aria-label="Treino de hoje">
        <div className="small muted">Treino de hoje</div>
        <div className="list" style={{ marginTop: 4 }}>
          {(todaySessions ?? []).map((s) => (
            <Link key={s.id} href={`/saude/treino/${s.id}`} className="row between" style={{ color: 'inherit' }}>
              <span>{s.title}<span className="small muted"> · {SPORT[s.sport] ?? s.sport}{s.duration_min ? ` · ${s.duration_min} min` : ''}</span></span>
              <span className="small" style={{ color: s.status === 'done' ? 'var(--accent)' : 'var(--dim)' }}>{s.status === 'done' ? 'feito' : s.status === 'skipped' ? 'pulado' : 'planejado'}</span>
            </Link>
          ))}
          {!todaySessions?.length && <p className="small muted" style={{ margin: 0 }}>Dia de descanso.</p>}
        </div>
        {daily && (
          <div className="row small" style={{ gap: 16, color: 'var(--dim)', marginTop: 10 }}>
            {daily.steps != null && <span>{daily.steps.toLocaleString('pt-BR')} passos</span>}
            {daily.sleep_min != null && <span>Sono {Math.floor(daily.sleep_min / 60)}h{String(daily.sleep_min % 60).padStart(2, '0')}</span>}
            {daily.resting_hr != null && <span>FC {daily.resting_hr}</span>}
          </div>
        )}
      </section>

      {alertasRes.error ? <p className="small muted">Não consegui carregar os alertas agora.</p> : alertaItens.length > 0 && <Fila itens={alertaItens} />}

      {cp && (
        <Link href="/saude/treino" className="card ai" style={{ color: 'inherit' }}>
          <span className="small" style={{ color: 'var(--ai)' }}>Check-in da semana passada · {checkin!.score}/100</span>
          <p style={{ margin: '6px 0 0' }}>{cp.headline}</p>
          {cp.focus_of_week && <p className="small muted" style={{ margin: '4px 0 0' }}>Foco: {cp.focus_of_week}</p>}
        </Link>
      )}
      <p className="disclaimer">A ClaudIA organiza o processo com base em referências acadêmicas. Não é aconselhamento médico.</p>
    </>
  )
}
