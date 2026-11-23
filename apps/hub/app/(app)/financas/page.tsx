import { airton, airtonLink, brl, nomeMes, type Plano } from '@/lib/airton'

export const dynamic = 'force-dynamic'

type Inv = { mes: string; patrimonio: number | null }

/** Resumo: só o gasto do mês (com o saldo projetado), o patrimônio resumido e os próximos lançamentos. */
export default async function Financas() {
  const { air, uid } = await airton()
  const [mp, inv] = await Promise.all([
    air.rpc('month_plan', { p_user: uid }),
    air.from('v_inv_month').select('mes, patrimonio').order('mes', { ascending: false }).limit(13),
  ])
  const p = (mp.data ?? {}) as Plano
  const gasto = Number(p.spentTotal ?? 0)
  const entradas = Number(p.income?.expected ?? 0)
  const pct = entradas > 0 ? Math.round((gasto / entradas) * 100) : null
  const saldo = Number(p.available ?? 0)
  const fim = p.month && p.daysInMonth ? `${String(p.daysInMonth).padStart(2, '0')}/${p.month.slice(5, 7)}` : 'fim do mês'

  const serie = ((inv.data ?? []) as Inv[]).filter((r) => r.patrimonio != null).reverse()
  const atual = serie.at(-1)?.patrimonio ?? null
  const base = serie.length > 1 ? serie[0].patrimonio : null
  const var12 = atual != null && base ? ((Number(atual) - Number(base)) / Number(base)) * 100 : null

  return (
    <>
      {mp.error ? (
        <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui ler o plano do mês agora.</p></div>
      ) : (
        <section aria-label="Mês" className="card">
          <p className="small muted" style={{ margin: 0 }}>Gasto em {p.month ? nomeMes(p.month, true) : 'este mês'}</p>
          <div className="kpi num" style={{ margin: '4px 0 12px' }}>{brl(gasto)}</div>
          {pct != null && <div className="barra" aria-hidden="true"><i style={{ width: `${Math.min(100, pct)}%`, background: pct > 100 ? 'var(--alert)' : undefined }} /></div>}
          <div className="row between small muted" style={{ marginTop: 8 }}>
            <span>{pct != null ? `${pct}% das entradas previstas` : ''}</span>
            <span>{p.daysLeft != null ? `${p.daysLeft} ${p.daysLeft === 1 ? 'dia restante' : 'dias restantes'}` : ''}</span>
          </div>
          <div className="row between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <span className="small muted">Saldo projetado em {fim}</span>
            <strong className="num" style={{ color: saldo < 0 ? 'var(--alert)' : undefined }}>{brl(saldo)}</strong>
          </div>
        </section>
      )}

      {atual != null && (
        <a className="card row between" href={airtonLink('/patrimonio')} target="_blank" rel="noreferrer" aria-label="Patrimônio, abrir o detalhe no AIrton completo" style={{ color: 'inherit' }}>
          <div>
            <div className="small muted">Patrimônio</div>
            <div className="num" style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '-.02em' }}>{brl(Number(atual))}</div>
            {var12 != null && <div className="small" style={{ color: var12 >= 0 ? 'var(--progress)' : 'var(--alert)' }}>{var12 >= 0 ? '+' : ''}{var12.toFixed(1).replace('.', ',')}% em 12 meses</div>}
          </div>
          <Linha valores={serie.map((r) => Number(r.patrimonio))} />
        </a>
      )}

      {!!p.upcoming?.length && (
        <section aria-label="Próximos" className="card">
          <div className="small muted">Próximos</div>
          <div className="list small" style={{ marginTop: 4 }}>
            {p.upcoming.slice(0, 5).map((u, i) => (
              <div key={i} className="row between">
                <span>{u.label} <span className="muted">· {Number(u.date.slice(8, 10))} {nomeMes(u.date)}</span></span>
                <span className="num" style={{ color: u.amount > 0 ? 'var(--progress)' : undefined }}>{u.amount > 0 ? '+' : '−'}{brl(Math.abs(Number(u.amount)))}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/** Mini linha do patrimônio (sem eixo: o detalhe mora no AIrton completo). */
function Linha({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null
  const w = 110, h = 44, min = Math.min(...valores), max = Math.max(...valores), amp = max - min || 1
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, h - 4 - ((v - min) / amp) * (h - 8)] as const)
  const [ux, uy] = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`-4 0 ${w + 8} ${h}`} aria-hidden="true">
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="var(--progress)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ux} cy={uy} r="3" fill="var(--progress)" />
    </svg>
  )
}
