import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { Logo } from '@/components/Logo'
import { diasEntre, type Painel, type PlanoSemana } from '../semana/tipos'
import { HORIZONTES, diaMes, logoDoDono, marcosDe, type Meta, type Plano } from './tipos'

export const dynamic = 'force-dynamic'

const AREA_APP: Record<string, string> = { saude: 'claudia', financas: 'airton', aprender: 'sabia', casa: 'casa' }
const LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Planos · Semanas: esta semana dia a dia, o que vem nas próximas, a meta fora do ritmo e os atalhos. */
export default async function Semanas() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const [{ data: pd }, { data: sd }, { data: pl, error }, { data: dec }] = await Promise.all([
    raw.rpc('hub_semana_painel'), raw.rpc('hub_semana'), raw.rpc('hub_planos'), raw.rpc('hub_decisoes'),
  ])
  const painel = (pd ?? null) as Painel | null
  const plano = (sd ?? null) as PlanoSemana | null
  const planos = (Array.isArray(pl) ? pl : []) as Plano[]
  const decisoes = Array.isArray(dec) ? dec.length : 0
  const hoje = spDate()
  const desde = painel?.desde ?? hoje
  const fim = painel?.fim ?? somaDias(desde, 6)
  const dias = diasEntre(desde, fim)
  const doPlano = plano && plano.semana === painel?.semana ? plano : null
  const itens = (doPlano?.itens ?? []).filter((i) => i.incluido)
  const fixos = painel?.fixos ?? []

  const marcos = marcosDe(planos).filter((m) => m.data > fim)
  const proximas = [1, 2, 3].map((k) => {
    const ini = somaDias(desde, 7 * k), ate = somaDias(ini, 6)
    return { ini, marco: marcos.find((m) => m.data >= ini && m.data <= ate) ?? null }
  })
  let fora: { m: Meta; plano: string } | null = null
  for (const p of planos) for (const h of HORIZONTES) for (const m of p.metas?.[h[0]] ?? [])
    if (!fora && m.ritmo === 'atrasada' && m.status === 'ativa') fora = { m, plano: p.titulo }

  return (
    <>
      <section className="card" aria-label="Esta semana">
        <div className="row between">
          <span className="small muted">{diaMes(desde)} a {diaMes(fim)}</span>
          <span className="small" style={{ color: doPlano?.status === 'confirmado' ? 'var(--accent)' : 'var(--dim)' }}>
            {doPlano ? (doPlano.status === 'confirmado' ? 'Confirmado' : 'Rascunho') : 'Sem plano'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 12 }}>
          {dias.map((d) => {
            const doDia = itens.filter((i) => i.data === d)
            const compromissos = fixos.filter((f) => f.data === d && f.fonte !== 'expediente').length
            const ehHoje = d === hoje
            return (
              <Link key={d} href="/semana" aria-label={`${d}: ${doDia.length} do plano, ${compromissos} compromissos`}
                style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: '8px 0', borderRadius: 14, color: 'inherit', background: ehHoje ? 'var(--surface-2)' : undefined }}>
                <span className="small" style={{ color: 'var(--dim)', fontSize: 11 }}>{LETRA[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
                <span style={{ fontWeight: ehHoje ? 600 : 400, color: ehHoje ? 'var(--accent)' : undefined }}>{Number(d.slice(8, 10))}</span>
                <span style={{ display: 'flex', gap: 3, minHeight: 6 }}>
                  {doDia.slice(0, 3).map((i) => <i key={i.id} data-app={AREA_APP[i.area] ?? 'hq'} style={{ width: 6, height: 6, borderRadius: 3, background: i.status === 'feito' ? 'var(--dim)' : 'var(--accent)' }} />)}
                  {compromissos > 0 && <i style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--muted)' }} />}
                </span>
              </Link>
            )
          })}
        </div>
        <Link className="small" href="/semana" style={{ display: 'inline-block', marginTop: 10 }}>{doPlano?.status === 'confirmado' ? 'Ajustar a semana' : 'Planejar a semana'}</Link>
      </section>

      <section className="card" aria-label="Próximas semanas">
        <div className="small muted">Próximas semanas</div>
        <div className="list small" style={{ marginTop: 4 }}>
          {proximas.map(({ ini, marco }) => (
            <div key={ini} className="row between">
              <span className="row" style={{ gap: 8, color: marco ? undefined : 'var(--dim)' }}>{marco ? <>{marco.titulo}<Logo app={logoDoDono(marco.dono)} tamanho={16} /></> : 'Nada marcado'}</span>
              <span className="muted">{diaMes(marco?.data ?? ini)}</span>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar os planos agora.</p></div>}
      {fora && (() => {
        const pct = fora.m.progresso == null ? null : Math.round(Math.min(1, Math.max(0, Number(fora.m.progresso))) * 100)
        return (
          <Link href="/planos/metas" className="card" aria-label="Meta fora do ritmo" style={{ color: 'inherit' }}>
            <div className="row between small">
              <span style={{ color: 'var(--alert)' }}>Fora do ritmo</span>
              {fora.m.prazo && <span className="muted">até {diaMes(fora.m.prazo)}</span>}
            </div>
            <div className="row" style={{ gap: 8, margin: '8px 0 10px' }}>{fora.m.titulo} <span className="muted">· {fora.plano}</span><Logo app={logoDoDono(fora.m.dono)} tamanho={16} /></div>
            <div className="barra" aria-hidden="true"><i style={{ width: `${pct ?? 0}%`, background: 'var(--alert)' }} /></div>
            {pct != null && <div className="small muted" style={{ marginTop: 6 }}>{pct}%</div>}
          </Link>
        )
      })()}

      <div className="grid2">
        <Link className="btn ghost" href="/planos/metas#decisoes" style={{ textAlign: 'center' }}>{decisoes ? `${decisoes} ${decisoes === 1 ? 'decisão' : 'decisões'}` : 'Decisões'}</Link>
        <Link className="btn" href="/planos/metas#novo" style={{ textAlign: 'center' }}>Novo plano</Link>
      </div>
    </>
  )
}
