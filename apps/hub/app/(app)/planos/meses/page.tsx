import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { Logo } from '@/components/Logo'
import { MESES_LONGOS, logoDoDono, marcosDe, type Plano } from '../tipos'

export const dynamic = 'force-dynamic'

/** Planos · Meses: os marcos (prazos das metas e datas-alvo dos planos) deste mês e dos próximos dois. */
export default async function Meses() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const { data, error } = await raw.rpc('hub_planos')
  const hoje = spDate()
  const marcos = marcosDe((Array.isArray(data) ? data : []) as Plano[]).filter((m) => m.data >= hoje)
  const meses = [0, 1, 2].map((k) => {
    const d = new Date(`${hoje.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k)
    return d.toISOString().slice(0, 7)
  })

  if (error) return <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar os planos agora.</p></div>
  return (
    <>
      {meses.map((ym) => {
        const doMes = marcos.filter((m) => m.data.startsWith(ym))
        const nome = MESES_LONGOS[Number(ym.slice(5, 7)) - 1]
        return doMes.length ? (
          <section key={ym} className="card" aria-label={nome}>
            <div className="row between"><span style={{ fontWeight: 500 }}>{nome}</span><span className="small muted">{doMes.length} {doMes.length === 1 ? 'marco' : 'marcos'}</span></div>
            <div className="list small" style={{ marginTop: 4 }}>
              {doMes.map((m, i) => (
                <div key={i} className="row" style={{ gap: 12 }}>
                  <span className="num muted" style={{ width: 22, flex: 'none' }}>{Number(m.data.slice(8, 10))}</span>
                  <span style={{ flex: 1, color: m.atrasada ? 'var(--alert)' : undefined }}>{m.titulo}{m.titulo !== m.plano && <span className="muted"> · {m.plano}</span>}</span>
                  <Logo app={logoDoDono(m.dono)} tamanho={18} />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section key={ym} className="card row between" aria-label={nome}>
            <span style={{ fontWeight: 500 }}>{nome}</span><span className="small" style={{ color: 'var(--dim)' }}>Nada marcado ainda</span>
          </section>
        )
      })}
      <p className="small" style={{ color: 'var(--dim)', margin: 0 }}>Os eventos da agenda entram aqui quando a agenda do Google estiver ligada.</p>
    </>
  )
}
