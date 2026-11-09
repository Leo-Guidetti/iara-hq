import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// AIrton dentro do site único: leitura pelas funções do schema airton com o login do Leo (RLS).
// O app antigo segue no ar para o que ainda não veio para cá (Open Finance, chat, investimentos).
const AIRTON_COMPLETO = 'https://airton-gray.vercel.app'

type Plano = {
  available?: number; perDay?: number | null; daysLeft?: number
  income?: { expected?: number; received?: number }
  committed?: { total?: number }
  savings?: { pct?: number; goal?: number }
  upcoming?: { date: string; label: string; amount: number; kind: string }[]
}
type Semana = { spent?: number; typical?: number; byCategory?: { name: string; spent: number; typical: number }[] }
type Pend = { pending?: number; unconfirmed?: number; uncategorized?: number }
type Tx = { id: string; date: string; description: string | null; merchant: string | null; spend: number | null; category_name: string | null; nature: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export default async function Financas() {
  const me = (await currentUser())!
  const air = (me.sb as unknown as SupabaseClient).schema('airton')
  const [mp, wk, rc, tx] = await Promise.all([
    air.rpc('month_plan', { p_user: me.user.id }),
    air.rpc('week_summary', { p_user: me.user.id }),
    air.rpc('review_counts', { p_user: me.user.id }),
    air.from('v_tx').select('id, date, description, merchant, spend, category_name, nature').order('date', { ascending: false }).limit(8),
  ])
  const p = (mp.data ?? {}) as Plano
  const w = (wk.data ?? {}) as Semana
  const r = (rc.data ?? {}) as Pend
  const gastos = ((tx.data ?? []) as Tx[]).filter((t) => Number(t.spend) > 0)
  const livre = Number(p.available ?? 0)
  const semana = Number(w.spent ?? 0), normal = Number(w.typical ?? 0) * 7
  const revisar = Number(r.pending ?? 0) + Number(r.unconfirmed ?? 0)

  return (
    <div className="stack">
      <div>
        <span className="tag progress">AIrton · Finanças</span>
        <h1>{livre >= 0 ? `${brl(livre)} livres` : `Passou ${brl(-livre)}`}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {p.perDay != null ? `${brl(Number(p.perDay))} por dia` : ''}{p.daysLeft != null ? ` · ${p.daysLeft} dias até o fim do mês` : ''}
        </p>
      </div>

      {mp.error && <div className="card alert"><p className="small">Não consegui ler o plano do mês agora.</p></div>}

      <div className="kpis">
        <div className="card"><div className="small muted">Entradas previstas</div><div className="kpi num" style={{ fontSize: '1.4rem' }}>{brl(Number(p.income?.expected ?? 0))}</div></div>
        <div className="card"><div className="small muted">Comprometido</div><div className="kpi num" style={{ fontSize: '1.4rem' }}>{brl(Number(p.committed?.total ?? 0))}</div></div>
        <div className="card"><div className="small muted">Semana</div><div className="kpi num" style={{ fontSize: '1.4rem' }}>{brl(semana)}</div><div className="small muted">normal ~{brl(normal)}</div></div>
        <div className="card"><div className="small muted">Para revisar</div><div className="kpi num" style={{ fontSize: '1.4rem', color: revisar ? 'var(--alert)' : undefined }}>{revisar}</div><div className="small muted">lançamentos</div></div>
      </div>

      {!!p.upcoming?.length && (
        <section className="card">
          <h2>Próximos no mês</h2>
          <div className="list small">
            {p.upcoming.slice(0, 6).map((u, i) => (
              <div key={i} className="row between">
                <span><span className="muted num">{dm(u.date)}</span> · {u.label}</span>
                <strong className="num" style={{ color: u.amount > 0 ? 'var(--progress)' : undefined }}>{brl(Number(u.amount))}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Últimos gastos</h2>
        {gastos.length ? (
          <div className="list small">
            {gastos.map((t) => (
              <div key={t.id} className="row between">
                <span><span className="muted num">{dm(t.date)}</span> · {t.merchant || t.description}<br /><span className="muted">{t.category_name ?? 'sem categoria'}</span></span>
                <strong className="num">{brl(Number(t.spend))}</strong>
              </div>
            ))}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Sem gastos recentes.</p>}
      </section>

      <a className="btn ghost" href={AIRTON_COMPLETO} target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Open Finance, chat e investimentos no AIrton completo ↗</a>
    </div>
  )
}
