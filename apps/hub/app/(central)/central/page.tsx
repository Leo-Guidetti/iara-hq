import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { brl } from '@/lib/airton'
import { adesaoParcial } from '@/lib/adesao'
import { agoraSP, blocosDoDia } from '@/lib/dia'
import type { LogoKey } from '@/lib/apps'
import { Logo } from '@/components/Logo'
import { Sol } from '@/components/Sol'
import { Falar } from '@/components/Falar'
import { ModoTela } from '@/components/ModoTela'
import { Checklist, type ItemDia } from '../../(app)/hoje/Checklist'
import type { Painel, PlanoSemana } from '../../(app)/semana/tipos'

export const dynamic = 'force-dynamic'

/** Uma consulta que falha não derruba a tela: o cartão fica sem número. */
async function seguro<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try { const { data, error } = await p; return error ? null : data } catch { return null }
}

type Casa = { itens: { id: number; origem: string; titulo: string; data: string; minutos: number | null }[] } | null
type Sabia = { trilha: { minutos: number; hoje: boolean } | null; itens: { titulo: string; minutos: number; status: string }[] } | null
type Tarefa = { titulo: string; data: string; status: string }
type Cartao = { app: LogoKey; href: string; nome: string; titulo: string; valor?: string; detalhe?: string; barra?: number }

const fim = (hora: string, min: number | null | undefined) => {
  const [h, m] = hora.split(':').map(Number)
  const t = h * 60 + m + (min ?? 0)
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

// Hub da casa (iPad na parede, protótipo de 23/11): relógio com o sol, próximos da agenda, o orbe da IARA, o checklist
// do dia e um cartão por app. Tudo cabe numa tela, sem rolar no iPad em paisagem; cada cartão abre a área no modo Gestão.
export default async function Central() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const hoje = spDate()
  const [sessoes, mes, casa, sab, dia, semana, tarefas, painel, plano, adesao] = await Promise.all([
    seguro(me.sb.from('plan_sessions').select('id, title, status, duration_min').eq('local_date', hoje).order('id')),
    seguro(raw.schema('airton').rpc('month_plan', { p_user: me.user.id })),
    seguro(raw.rpc('hub_casa')),
    seguro(raw.rpc('hub_sabia')),
    seguro(raw.rpc('hub_dia')),
    seguro(raw.rpc('hub_semana_hoje')),
    seguro(raw.rpc('hub_casa_tarefas')),
    seguro(raw.rpc('hub_semana_painel')),
    seguro(raw.rpc('hub_semana')),
    adesaoParcial().catch(() => null),
  ])
  const m = (mes ?? null) as { available?: number; spentTotal?: number; upcoming?: { date: string; label: string; amount: number }[] } | null
  const sb = (sab ?? null) as Sabia
  const c = (casa ?? null) as Casa
  const agora = agoraSP()

  const blocos = blocosDoDia({ dia, semana, sessoes, mes: m, sabia: sb, hoje })
  const proximos = blocos.filter((b) => b.hora && fim(b.hora, b.minutos) > agora && !b.feito)
    .sort((a, b) => a.hora!.localeCompare(b.hora!)).slice(0, 4)
  const checklist: ItemDia[] = (c?.itens ?? []).filter((i) => i.data <= hoje)
    .map((i) => ({ id: i.id, origem: i.origem, titulo: i.titulo, minutos: i.minutos })).slice(0, 6)

  const p = (painel ?? null) as Painel | null
  const pl = (plano ?? null) as PlanoSemana | null
  const doPlano = pl && p && pl.semana === p.semana && pl.status === 'confirmado' ? pl.itens.filter((i) => i.incluido) : null
  const feitos = doPlano?.filter((i) => i.status === 'feito').length ?? 0
  const abertas = ((Array.isArray(tarefas) ? tarefas : []) as Tarefa[]).filter((t) => t.status !== 'feito')
  const faltam = sb?.trilha?.hoje ? sb.itens.filter((i) => i.status === 'pendente') : null

  const cartoes: Cartao[] = [
    { app: 'planos', href: '/planos', nome: 'Planos', titulo: 'Plano da semana',
      valor: doPlano ? `${feitos} de ${doPlano.length}` : undefined, detalhe: doPlano ? undefined : 'ainda sem plano',
      barra: doPlano?.length ? feitos / doPlano.length : undefined },
    { app: 'claudia', href: '/saude', nome: 'Saúde', titulo: `Adesão${adesao && adesao.dias < 7 ? ' · parcial' : ''}`,
      valor: adesao ? `${adesao.nota}` : '—', barra: adesao ? adesao.nota / 100 : undefined },
    { app: 'airton', href: '/financas', nome: 'Finanças', titulo: 'Saldo projetado',
      valor: m?.available != null ? brl(Number(m.available)) : '—', detalhe: m?.spentTotal != null ? `gasto ${brl(Number(m.spentTotal))}` : undefined },
    { app: 'sabia', href: '/aprender', nome: 'Conhecimento', titulo: 'Trilha do dia',
      valor: faltam ? (faltam.length ? `${faltam.reduce((n, i) => n + i.minutos, 0)} min` : '✓') : undefined,
      detalhe: faltam ? (faltam.length ? `${faltam.length} ${faltam.length === 1 ? 'item' : 'itens'}` : 'concluída') : 'sem trilha hoje' },
    { app: 'casa', href: '/casa', nome: 'Casa', titulo: abertas.length ? `${abertas.length} ${abertas.length === 1 ? 'tarefa aberta' : 'tarefas abertas'}` : 'Tudo em dia',
      detalhe: abertas[0] ? `${abertas[0].titulo}${abertas[0].data === hoje ? ' · hoje' : abertas[0].data < hoje ? ' · atrasada' : ''}` : undefined },
  ]

  return (
    <div className="central">
      <div className="central-topo"><ModoTela atual="casa" /></div>
      <Sol />
      <div className="central-meio">
        <section className="central-bloco" aria-label="Próximos na agenda">
          <span className="small muted">Próximos</span>
          {proximos.length ? (
            <ol className="central-agenda">
              {proximos.map((b, i) => (
                <li key={i}><span className="num">{b.hora}</span><span>{b.texto}</span>{b.app !== 'hq' && <Logo app={b.app as LogoKey} tamanho={20} />}</li>
              ))}
            </ol>
          ) : <p className="small muted" style={{ margin: '10px 0 0' }}>Nada mais com hora marcada hoje.</p>}
        </section>
        <div className="central-orbe"><Falar variante="orbe" /><span className="small muted">Toque para falar</span></div>
        <section className="central-bloco" aria-label="Checklist diário">
          <span className="small muted">Checklist diário</span>
          <Checklist itens={checklist} />
        </section>
      </div>
      <nav className="central-apps" aria-label="Apps">
        {cartoes.map((k) => (
          <Link key={k.app} href={k.href} data-app={k.app === 'planos' ? 'hq' : k.app} aria-label={`Abrir ${k.nome}`}>
            <Logo app={k.app} tamanho={28} />
            <span className="small muted">{k.titulo}</span>
            {k.valor && <strong className="num">{k.valor}</strong>}
            {k.barra != null && <span className="barra" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, k.barra)) * 100)}%` }} /></span>}
            {k.detalhe && <span className="small" style={{ color: 'var(--text-2)' }}>{k.detalhe}</span>}
          </Link>
        ))}
      </nav>
    </div>
  )
}
