import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { dailyAlerts } from '@/lib/alerts'
import { spDate } from '@/lib/dates'

import { ICON } from '@/lib/icons'
import { Md } from '@/lib/md'

export const dynamic = 'force-dynamic'

type Linha = { texto: string; destaque?: boolean }
type CasaResumo = {
  briefings: { id: number; tipo: string; data: string; texto: string | null; lido: boolean }[]
  itens: { origem: string; titulo: string; minutos: number | null; status: string }[]
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

export default async function Hoje() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const today = spDate()
  const [sessoes, alertas, pend, mes, iara, sab] = await Promise.all([
    seguro(me.sb.from('plan_sessions').select('title, status, duration_min').eq('local_date', today).order('id')),
    dailyAlerts(me.sb).then((r) => r.alerts).catch(() => 'erro' as const),
    seguro(raw.schema('airton').rpc('review_counts', { p_user: me.user.id })),
    seguro(raw.schema('airton').rpc('month_plan', { p_user: me.user.id })),
    seguro(raw.rpc('hub_casa')),
    seguro(raw.rpc('hub_sabia')),
  ])

  // ClaudIA: treino do dia e alertas determinísticos (sem IA).
  const claudia: Linha[] = []
  if (Array.isArray(sessoes)) {
    for (const s of sessoes) claudia.push({ texto: `${s.status === 'done' ? '✓ ' : 'Treino: '}${s.title}${s.duration_min ? ` · ${s.duration_min} min` : ''}`, destaque: s.status !== 'done' })
  }
  if (Array.isArray(alertas)) {
    for (const a of [...alertas].sort((x, y) => (x.level === 'alert' ? -1 : 0) - (y.level === 'alert' ? -1 : 0)).slice(0, 3)) claudia.push({ texto: a.text, destaque: a.level === 'alert' })
  }

  // AIrton: lançamentos para revisar e quanto ainda cabe no mês.
  const airton: Linha[] = []
  if (pend && pend !== 'erro') {
    const p = pend as { pending?: number; unconfirmed?: number }
    if (Number(p.pending) > 0) airton.push({ texto: `${plural(Number(p.pending), 'lançamento precisa', 'lançamentos precisam')} de você`, destaque: true })
    else if (Number(p.unconfirmed) > 0) airton.push({ texto: `${plural(Number(p.unconfirmed), 'lançamento novo', 'lançamentos novos')} para conferir` })
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

  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date()))
  const saudacao = hora < 5 ? 'Boa madrugada' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  const nome = (me.user.user_metadata?.name as string | undefined)?.split(' ')[0] ?? 'Leo'

  const conta = (l: Linha[]) => l.filter((x) => x.destaque).length
  const planetas = [
    { app: 'claudia' as const, nome: 'ClaudIA', href: '/saude', icon: ICON.saude, n: conta(claudia), x: 50, y: 0 },
    { app: 'airton' as const, nome: 'AIrton', href: '/financas', icon: ICON.financas, n: conta(airton), x: 100, y: 50 },
    { app: 'sabia' as const, nome: 'SabIA', href: '/aprender', icon: ICON.aprender, n: conta(sabia), x: 50, y: 100 },
    { app: 'casa' as const, nome: 'IARA House', href: '/casa', icon: ICON.casa, n: conta(casa), x: 0, y: 50 },
  ]
  const total = planetas.reduce((s, p) => s + p.n, 0)

  return (
    <div className="stack">
      <div className="hello">
        <span className="tag progress">IARA HQ · {data}</span>
        <h1>{saudacao}, {nome}</h1>
        <p className="muted small" style={{ margin: 0 }}>{total ? `${plural(total, 'missão pede', 'missões pedem')} você hoje.` : 'Tudo em órbita: nada pendente agora.'}</p>
      </div>

      <section className="card ai">
        <span className="tag ai">Briefing do dia · IARA</span>
        {briefing?.texto ? (
          <>
            <Md texto={briefing.texto.split('\n').slice(0, 6).join('\n')} />
            {briefing.texto.split('\n').length > 6 && (
              <details className="brief"><summary>Ver o briefing inteiro</summary><Md texto={briefing.texto.split('\n').slice(6).join('\n')} /></details>
            )}
          </>
        ) : <p className="small muted" style={{ margin: '6px 0 0' }}>O briefing sai todo dia às 07:00.</p>}
      </section>

      <div className="orbit" aria-label="Seus apps">
        <div className="ring" />
        <div className="ring inner" />
        <div className="core"><div><b>{total}</b><small>{total === 1 ? 'pendência' : 'pendências'}</small></div></div>
        <div className="spin">
          {planetas.map((p) => (
            <div key={p.app} className="planet" data-app={p.app} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <Link href={p.href} aria-label={`${p.nome}: ${plural(p.n, 'pendência', 'pendências')}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={p.icon} /></svg>
                {p.n > 0 && <span className="badge">{p.n}</span>}
                <span className="name">{p.nome}</span>
              </Link>
            </div>
          ))}
        </div>
      </div>

      <Bloco app="claudia" nome="ClaudIA" papel="Saúde" href="/saude" rotulo="Abrir a ClaudIA"
        linhas={claudia} falhou={sessoes === 'erro' && alertas === 'erro'} vazio="Tudo em dia na saúde." />
      <Bloco app="airton" nome="AIrton" papel="Finanças" href="/financas" rotulo="Abrir o AIrton"
        linhas={airton} falhou={pend === 'erro' && mes === 'erro'} vazio="Nada pendente nas finanças." />
      <Bloco app="sabia" nome="SabIA" papel="Aprender" href="/aprender" rotulo="Abrir a SabIA"
        linhas={sabia} falhou={sab === 'erro'} vazio="A trilha de hoje ainda não saiu." />
      <Bloco app="casa" nome="IARA House" papel="Casa" href="/casa" rotulo="Abrir a IARA House"
        linhas={casa} falhou={iara === 'erro'} vazio="Nenhuma tarefa da casa hoje." />
    </div>
  )
}

function Bloco({ app, nome, papel, href, rotulo, linhas, falhou, vazio }: {
  app: 'claudia' | 'airton' | 'sabia' | 'casa'; nome: string; papel: string; href: string; rotulo: string
  linhas: Linha[]; falhou: boolean; vazio: string
}) {
  const pend = linhas.filter((l) => l.destaque).length
  return (
    <section className="card module" data-app={app}>
      <div className="row between">
        <span className="tag">{nome}</span>
        <span className="small muted">{papel}{pend ? ` · ${plural(pend, 'pendência', 'pendências')}` : ''}</span>
      </div>
      {falhou ? <p className="small muted" style={{ margin: 0 }}>Não consegui carregar agora.</p>
        : linhas.length ? <div className="stack small" style={{ gap: 6 }}>{linhas.map((l, i) => <div key={i} className={`missao${l.texto.startsWith('✓') ? ' feita' : ''}`} style={l.destaque ? { fontWeight: 600 } : undefined}>{l.texto.replace(/^✓ /, '')}</div>)}</div>
        : <p className="small muted" style={{ margin: 0 }}>{vazio}</p>}
      <Link className="go" href={href}>{rotulo} →</Link>
    </section>
  )
}
