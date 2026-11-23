import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Tabs } from '@/components/Tabs'
import { Logo } from '@/components/Logo'
import { ABAS_HOJE } from '@/lib/apps'
import { brl } from '@/lib/airton'
import { adesaoParcial } from '@/lib/adesao'
import { spDate } from '@/lib/dates'
import { ddmm, diasEntre, type Painel, type PlanoSemana } from './tipos'

export const dynamic = 'force-dynamic'

/** Hoje · Semana: só o resumo da semana até aqui. O planejamento mora em Planos (/planos/semana). */
export default async function SemanaPage() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const [{ data: pd }, { data: sd }, { data: wk }, adesao] = await Promise.all([
    raw.rpc('hub_semana_painel'), raw.rpc('hub_semana'), raw.schema('airton').rpc('week_summary', { p_user: me.user.id }),
    adesaoParcial().catch(() => null),
  ])
  const w = (wk ?? null) as { spent?: number; typical?: number } | null
  const painel = (pd ?? null) as Painel | null
  const plano = (sd ?? null) as PlanoSemana | null
  const doPlano = plano && painel && plano.semana === painel.semana ? plano : null
  const confirmado = doPlano?.status === 'confirmado'
  const itens = confirmado ? doPlano!.itens.filter((i) => i.incluido) : []
  const feitos = itens.filter((i) => i.status === 'feito').length
  const hoje = spDate()
  const dias = painel ? diasEntre(painel.desde, painel.fim) : []

  return (
    <div className="stack hoje">
      <Tabs items={ABAS_HOJE} />
      <div className="hello">
        <span className="small muted">{painel ? `${ddmm(painel.desde)} a ${ddmm(painel.fim)}` : 'Esta semana'}</span>
        <h1>Sua semana até aqui</h1>
      </div>

      {adesao && (
        <section className="card" aria-label="Adesão da semana" data-app="claudia">
          <div className="row between">
            <span className="row small muted" style={{ gap: 8 }}><Logo app="claudia" tamanho={18} />Adesão{adesao.dias < 7 ? ' · parcial' : ''}</span>
            <span className="num" style={{ fontSize: '1.5rem', fontWeight: 300 }}>{adesao.nota}<span className="small muted">/100</span></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 14px', alignItems: 'center', marginTop: 12 }}>
            {([['Pesagens', adesao.pesagens], ['Treinos', adesao.treinos], ['Alimentação', adesao.alimentacao]] as const).map(([nome, v]) => (
              <div key={nome} style={{ display: 'contents' }}>
                <span className="small muted">{nome}</span>
                <div className="barra" aria-label={`${nome} ${v.feitos} de ${v.de}`}><i style={{ width: `${v.de ? Math.min(100, (v.feitos / v.de) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" aria-label="Gasto da semana" data-app="airton">
        <div className="row between">
          <span className="row small muted" style={{ gap: 8 }}><Logo app="airton" tamanho={18} />Gasto</span>
          <span className="num" style={{ fontSize: '1.5rem', fontWeight: 300 }}>{w ? brl(Number(w.spent ?? 0)) : '—'}</span>
        </div>
        {w?.typical != null && <div className="small" style={{ color: 'var(--dim)', textAlign: 'right' }}>normal ~{brl(Number(w.typical) * 7)}</div>}
      </section>

      <section className="card" aria-label="Plano da semana">
        <div className="row between">
          <span className="row small muted" style={{ gap: 8 }}><Logo app="planos" tamanho={18} />Plano da semana</span>
          <span className="small">{confirmado ? `${feitos} de ${itens.length} feitos` : doPlano ? 'falta confirmar' : 'ainda sem plano'}</span>
        </div>
        {confirmado && dias.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dias.length}, 1fr)`, gap: 4, marginTop: 12 }} aria-hidden="true">
            {dias.map((d) => {
              const doDia = itens.filter((i) => i.data === d)
              const ok = doDia.length > 0 && doDia.every((i) => i.status === 'feito')
              return <i key={d} style={{ height: 6, borderRadius: 3, background: ok ? 'var(--accent)' : d < hoje && doDia.length ? 'var(--alert)' : 'var(--surface-3)' }} />
            })}
          </div>
        )}
        <Link className="small" href="/planos/semana" style={{ display: 'inline-block', marginTop: 12 }}>{confirmado ? 'Ver em Planos' : 'Planejar a semana'}</Link>
      </section>
    </div>
  )
}
