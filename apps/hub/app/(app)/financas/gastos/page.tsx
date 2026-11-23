import { airton, airtonLink, brl, nomeMes, type Plano } from '@/lib/airton'

export const dynamic = 'force-dynamic'

type Mes = { month: string; spend: number; status?: string }
type Ano = { months?: Mes[] }
type Tx = { id: string; date: string; description: string | null; merchant: string | null; spend: number | null; category_name: string | null }

const Seta = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
)

/** Gastos: gasto por mês (6 meses), o mês por categoria contra o teto e os últimos lançamentos. */
export default async function Gastos() {
  const { air, uid } = await airton()
  const mp = await air.rpc('month_plan', { p_user: uid })
  const p = (mp.data ?? {}) as Plano
  const hoje = p.today ?? new Date().toISOString().slice(0, 10)
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7))
  const [ys, ysAnt, tx] = await Promise.all([
    air.rpc('year_series', { p_year: ano, p_user: uid }),
    mes < 6 ? air.rpc('year_series', { p_year: ano - 1, p_user: uid }) : Promise.resolve({ data: null, error: null }),
    air.from('v_tx').select('id, date, description, merchant, spend, category_name').gt('spend', 0).order('date', { ascending: false }).limit(8),
  ])
  const atual = hoje.slice(0, 7)
  const meses = [...(((ysAnt.data ?? {}) as Ano).months ?? []), ...(((ys.data ?? {}) as Ano).months ?? [])]
    .filter((m) => m.month <= atual)
    .slice(-6)
  const fechados = meses.filter((m) => m.month < atual)
  const media = fechados.length ? fechados.reduce((s, m) => s + Number(m.spend), 0) / fechados.length : null
  const previsto = Number(p.projectedSpend ?? 0)
  const difPct = media && previsto ? Math.round(((previsto - media) / media) * 100) : null
  const topo = Math.max(1, ...meses.map((m) => Number(m.spend)), media ?? 0)

  const cats = (p.categories ?? [])
    .map((c) => ({ ...c, teto: Number(c.budget ?? c.expected ?? 0) }))
    .filter((c) => Number(c.spent) > 0)
    .sort((a, b) => Number(b.spent) - Number(a.spent))
    .slice(0, 6)
  const gastos = (tx.data ?? []) as Tx[]
  const ontem = new Date(`${hoje}T12:00:00Z`); ontem.setUTCDate(ontem.getUTCDate() - 1)
  const quando = (d: string) => d === hoje ? 'hoje' : d === ontem.toISOString().slice(0, 10) ? 'ontem' : `${Number(d.slice(8, 10))} ${nomeMes(d)}`

  return (
    <>
      <section aria-label="Gasto por mês" className="card">
        <div className="row between">
          <span className="small muted">Gasto por mês · {meses.length} meses</span>
          <a className="small row" style={{ gap: 4 }} href={airtonLink('/ano')} target="_blank" rel="noreferrer" aria-label="Abrir o ano no AIrton completo">detalhe <Seta /></a>
        </div>
        {ys.error ? <p className="small muted">Não consegui ler o histórico agora.</p> : (
          <>
            <div className="row between small" style={{ marginTop: 6 }}>
              <span>{media != null ? `média ${brl(media)}` : ''}</span>
              {difPct != null && atual && <span style={{ color: difPct > 0 ? 'var(--alert)' : 'var(--progress)' }}>{nomeMes(atual)} deve fechar {difPct > 0 ? '+' : '−'}{Math.abs(difPct)}% vs. média</span>}
            </div>
            <div style={{ position: 'relative', height: 112, marginTop: 14 }}>
              {media != null && <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: `${(media / topo) * 100}%`, borderTop: '1px dashed var(--dim)' }} />}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${meses.length || 1}, 1fr)`, gap: 10, alignItems: 'end', height: '100%' }}>
                {meses.map((m) => (
                  <div key={m.month} title={`${nomeMes(m.month, true)}: ${brl(Number(m.spend))}`} style={{ justifySelf: 'center', width: '100%', maxWidth: 34, height: `${Math.max(2, (Number(m.spend) / topo) * 100)}%`, borderRadius: 8, background: m.month === atual ? 'var(--progress)' : 'var(--surface-3)' }} />
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${meses.length || 1}, 1fr)`, gap: 10, marginTop: 6 }}>
              {meses.map((m) => <span key={m.month} className="muted" style={{ fontSize: 12, textAlign: 'center' }}>{nomeMes(m.month)}</span>)}
            </div>
            <div className="small" style={{ color: 'var(--dim)', marginTop: 8, fontSize: 12 }}>tracejado = média{atual ? ` · ${nomeMes(atual)} ainda parcial` : ''}</div>
          </>
        )}
      </section>

      {!!cats.length && (
        <section aria-label="Gasto por categoria" className="card">
          <div className="row between small muted"><span>{p.month ? `${nomeMes(p.month, true).replace(/^./, (c) => c.toUpperCase())} por categoria` : 'Por categoria'}</span><span>vs. teto</span></div>
          <div className="stack" style={{ gap: 12, marginTop: 12 }}>
            {cats.map((c) => {
              const passou = c.teto > 0 && Number(c.spent) > c.teto
              return (
                <div key={c.id}>
                  <div className="row between small"><span>{c.name}</span><span className="num" style={{ color: passou ? 'var(--alert)' : 'var(--muted)' }}>{brl(Number(c.spent))}{passou ? ' · passou' : c.teto ? ` de ${brl(c.teto)}` : ''}</span></div>
                  <div className="barra" style={{ marginTop: 6 }} aria-hidden="true"><i style={{ width: `${c.teto ? Math.min(100, (Number(c.spent) / c.teto) * 100) : 100}%`, background: passou ? 'var(--alert)' : undefined }} /></div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section aria-label="Últimos lançamentos" className="card">
        {gastos.length ? (
          <div className="list small">
            {gastos.map((t) => (
              <div key={t.id} className="row" style={{ gap: 12 }}>
                <span className="muted" style={{ width: 48, flex: 'none' }}>{quando(t.date)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{t.merchant || t.description} <span className="muted">· {t.category_name ?? 'sem categoria'}</span></span>
                <span className="num">{brl(Number(t.spend))}</span>
              </div>
            ))}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Sem gastos recentes.</p>}
      </section>
      <a className="btn ghost" href={airtonLink('/lancamentos')} target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Ver todos os lançamentos</a>
    </>
  )
}
