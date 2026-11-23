import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'

import { Logo } from '@/components/Logo'
import { Md } from '@/lib/md'
import { SeuDia } from '@/components/SeuDia'
import { agoraSP, blocosDoDia } from '@/lib/dia'
import { Notificacoes } from '@/components/Notificacoes'
import { Perguntas, type Aviso } from '@/components/Perguntas'
import { Ouvir } from '@/components/Ouvir'
import { Tabs } from '@/components/Tabs'
import { ABAS_HOJE, type LogoKey } from '@/lib/apps'
import { ExpedienteCard } from '../semana/Entrada'
import type { Painel } from '../semana/tipos'
import { Checklist, type ItemDia } from './Checklist'

export const dynamic = 'force-dynamic'

type Linha = { texto: string; destaque?: boolean; href?: string }
type CasaResumo = {
  briefings: { id: number; tipo: string; data: string; texto: string | null; fala?: string | null; lido: boolean }[]
  itens: { id: number; origem: string; titulo: string; data: string; minutos: number | null; status: string }[]
} | null
type SabiaResumo = {
  trilha: { tipo: string; minutos: number; hoje: boolean } | null
  itens: { titulo: string; minutos: number; status: string }[]
} | null

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Uma consulta que falha não derruba a tela: o bloco mostra que não carregou. */
async function seguro<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null | 'erro'> {
  try {
    const { data, error } = await p
    return error ? 'erro' : data
  } catch {
    return 'erro'
  }
}

export default async function Hoje({ searchParams }: { searchParams: Promise<{ pergunta?: string }> }) {
  const { pergunta } = await searchParams
  const foco = /^\d+$/.test(pergunta ?? '') ? Number(pergunta) : null
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const today = spDate()
  const [sessoes, alertas, pend, mes, iara, sab, dia, semana, planosRaw, decRaw, avisosRaw, painelRaw] = await Promise.all([
    seguro(me.sb.from('plan_sessions').select('id, title, status, duration_min').eq('local_date', today).order('id')),
    seguro(raw.rpc('hub_alertas')),
    seguro(raw.schema('airton').rpc('review_counts', { p_user: me.user.id })),
    seguro(raw.schema('airton').rpc('month_plan', { p_user: me.user.id })),
    seguro(raw.rpc('hub_casa')),
    seguro(raw.rpc('hub_sabia')),
    seguro(raw.rpc('hub_dia')),
    seguro(raw.rpc('hub_semana_hoje')),
    seguro(raw.rpc('hub_planos')),
    seguro(raw.rpc('hub_decisoes')),
    seguro(raw.rpc('hub_avisos')),
    seguro(raw.rpc('hub_semana_painel')),
  ])
  const painel = painelRaw && painelRaw !== 'erro' ? (painelRaw as Painel) : null
  const avisos = avisosRaw && avisosRaw !== 'erro' ? ((avisosRaw as { itens?: Aviso[] }).itens ?? []) : []
  const decAbertas = Array.isArray(decRaw) ? decRaw.length : 0
  // Planos: só as metas fora do ritmo (atrasadas) aparecem; no ritmo, nada.
  const atrasadas: Linha[] = []
  if (Array.isArray(planosRaw)) {
    for (const p of planosRaw as { titulo: string; metas?: Record<string, { titulo: string; ritmo: string; status: string }[]> }[])
      for (const h of ['curto', 'medio', 'longo']) for (const m of p.metas?.[h] ?? [])
        if (m.ritmo === 'atrasada' && m.status === 'ativa') atrasadas.push({ texto: `${m.titulo} · ${p.titulo}`, destaque: true, href: '/planos/metas' })
  }

  // ClaudIA: treino do dia e alertas determinísticos (sem IA).
  const claudia: Linha[] = []
  if (Array.isArray(sessoes)) {
    for (const s of sessoes) claudia.push({ texto: `${s.status === 'done' ? '✓ ' : 'Treino: '}${s.title}${s.duration_min ? ` · ${s.duration_min} min` : ''}`, destaque: s.status !== 'done' })
  }
  // Alertas da ClaudIA vêm de public.hub_alertas() (publicados pelo cron diário); o badge usa o total.
  const al = alertas && alertas !== 'erro' ? (alertas as { total?: number }) : null
  const alertasTotal = Number(al?.total) || 0

  // AIrton: lançamentos para revisar e quanto ainda cabe no mês.
  const airton: Linha[] = []
  if (pend && pend !== 'erro') {
    const p = pend as { pending?: number; unconfirmed?: number }
    if (Number(p.pending) > 0) airton.push({ texto: `${plural(Number(p.pending), 'lançamento precisa', 'lançamentos precisam')} de você`, destaque: true, href: '/financas/revisar' })
    else if (Number(p.unconfirmed) > 0) airton.push({ texto: `${plural(Number(p.unconfirmed), 'lançamento novo', 'lançamentos novos')} para conferir`, href: '/financas/revisar' })
  }
  if (mes && mes !== 'erro') {
    const m = mes as { available?: number; perDay?: number | null }
    const livre = Number(m.available)
    if (Number.isFinite(livre)) airton.push(livre >= 0
      ? { texto: `Livre no mês: ${brl(livre)}${m.perDay != null ? ` · ${brl(Number(m.perDay))}/dia` : ''}` }
      : { texto: `Passou do livre do mês em ${brl(-livre)}`, destaque: true })
  }

  // Briefing único do dia (IARA, todas as áreas) e IARA House só com o que é da casa.
  const c = iara && iara !== 'erro' ? (iara as CasaResumo) : null
  // Checklist diário: a fila de hoje de todos os agentes (o que é de amanhã fica para amanhã).
  const checklist: ItemDia[] = (c?.itens ?? []).filter((i) => i.data <= today).map((i) => ({ id: i.id, origem: i.origem, titulo: i.titulo, minutos: i.minutos }))
  const briefing = c?.briefings.find((b) => b.tipo === 'manha') ?? c?.briefings[0] ?? null
  const casa: Linha[] = (c?.itens ?? []).filter((i) => i.origem === 'iara').map((i) => ({ texto: i.titulo, destaque: true }))

  // SabIA: a trilha do dia.
  const sabia: Linha[] = []
  const sb = sab && sab !== 'erro' ? (sab as SabiaResumo) : null
  if (sb?.trilha?.hoje) {
    const faltam = sb.itens.filter((i) => i.status === 'pendente')
    sabia.push(faltam.length
      ? { texto: `Trilha do dia: ${plural(faltam.length, 'item', 'itens')} · ${faltam.reduce((n, i) => n + i.minutos, 0)} min`, destaque: true }
      : { texto: '✓ Trilha do dia concluída' })
    for (const i of faltam.slice(0, 2)) sabia.push({ texto: `${i.titulo} · ${i.minutos} min` })
  }

  // Seu dia: rotina com horário + plano da semana + treino e contas de hoje (sem hora marcada).
  const blocos = blocosDoDia({ dia, semana, sessoes, mes: mes && mes !== 'erro' ? (mes as never) : null, sabia: sb, hoje: today })
  const agoraHHMM = agoraSP()

  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date()))
  const saudacao = hora < 5 ? 'Boa madrugada' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  const nome = (me.user.user_metadata?.name as string | undefined)?.split(' ')[0] ?? 'Leo'

  const conta = (l: Linha[]) => l.filter((x) => x.destaque).length

  const apps: { app: LogoKey; href: string; nome: string; n: number }[] = [
    { app: 'claudia', href: '/saude', nome: 'Saúde', n: conta(claudia) + alertasTotal },
    { app: 'airton', href: '/financas', nome: 'Finanças', n: conta(airton) },
    { app: 'sabia', href: '/aprender', nome: 'Conhecimento', n: conta(sabia) },
    { app: 'casa', href: '/casa', nome: 'Casa', n: conta(casa) },
  ]

  return (
    <div className="stack hoje">
      <Tabs items={ABAS_HOJE} />
      <div className="hello">
        <span className="small muted" style={{ textTransform: 'capitalize' }}>{data}</span>
        <h1>{saudacao}, {nome}</h1>
      </div>

      {foco != null && <Perguntas avisos={avisos} foco={foco} falhou={avisosRaw === 'erro'} />}
      {foco == null && <Perguntas avisos={avisos} foco={null} falhou={false} />}
      <Notificacoes compacto />
      {decAbertas > 0 && (
        <Link href="/planos/metas#decisoes" className="card row between" style={{ color: 'inherit' }}>
          <span className="small">{plural(decAbertas, 'decisão espera', 'decisões esperam')} você</span>
          <span className="small" style={{ color: 'var(--accent)' }}>Ver</span>
        </Link>
      )}

      {/* Desktop largo: duas colunas (agenda e checklist | expediente, briefing e apps). No celular, uma só. */}
      <div className="hoje-cols">
        <div className="hoje-col">
          <section className="card" aria-label="Agenda de hoje">
            <div className="row between">
              <span className="small muted">Agenda</span>
              <span className="small" style={{ color: 'var(--dim)' }}>agenda + plano</span>
            </div>
            {blocos.length ? <SeuDia blocos={blocos} agora={agoraHHMM} /> : <p className="small muted" style={{ margin: '8px 0 0' }}>Nada agendado hoje.</p>}
          </section>

          <section className="card" aria-label="Checklist diário">
            <div className="row between" style={{ marginBottom: 4 }}>
              <span className="small muted">Checklist diário</span>
              {atrasadas.length > 0 && <Link className="small" href="/planos" style={{ color: 'var(--alert)' }}>{plural(atrasadas.length, 'meta fora do ritmo', 'metas fora do ritmo')}</Link>}
            </div>
            {iara === 'erro' ? <p className="small muted" style={{ margin: 0 }}>Não consegui carregar agora.</p> : <Checklist itens={checklist} adicionar={today} />}
          </section>

        </div>
        <div className="hoje-col">
          {painel && <ExpedienteCard expediente={painel.expediente} lugares={painel.lugares} titulo="Expediente padrão" />}

          <section className="card" aria-label="Briefing do dia">
            <div className="row between">
              <span className="small" style={{ color: 'var(--ai)' }}>Briefing do dia</span>
              {briefing?.texto && <Ouvir id={briefing.id} fala={briefing.fala} texto={briefing.texto} />}
            </div>
            {briefing?.texto ? (
              <>
                <Md texto={briefing.texto.split('\n').slice(0, 3).join('\n')} />
                {briefing.texto.split('\n').length > 3 && (
                  <details className="brief"><summary>Ver o briefing inteiro</summary><Md texto={briefing.texto.split('\n').slice(3).join('\n')} /></details>
                )}
              </>
            ) : <p className="small muted" style={{ margin: '6px 0 0' }}>O briefing sai todo dia às 07:00.</p>}
          </section>

          <nav className="apps-linha" aria-label="Seus apps">
            {apps.map((a) => (
              <Link key={a.app} href={a.href} data-app={a.app} aria-label={`${a.nome}${a.n ? `, ${plural(a.n, 'pendência', 'pendências')}` : ''}`}>
                <Logo app={a.app} tamanho={30} />
                {a.n > 0 && <b>{a.n}</b>}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
