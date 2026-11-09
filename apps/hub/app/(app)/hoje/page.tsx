import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { dailyAlerts } from '@/lib/alerts'
import { spDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// Apps que ainda vivem fora do hub: o bloco leva para a experiência atual de cada um.
const AIRTON_URL = 'https://airton-gray.vercel.app'
const CASA_URL = 'https://iara-rho.vercel.app'

type Linha = { texto: string; destaque?: boolean }
type IaraResumo = {
  briefing: { tipo: string; data: string; texto: string | null; lido: boolean } | null
  itens_pendentes: number
  itens: { origem: string; titulo: string; minutos: number | null }[]
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
  const [sessoes, alertas, pend, mes, iara] = await Promise.all([
    seguro(me.sb.from('plan_sessions').select('title, status, duration_min').eq('local_date', today).order('id')),
    dailyAlerts(me.sb).then((r) => r.alerts).catch(() => 'erro' as const),
    seguro(raw.schema('airton').rpc('review_counts', { p_user: me.user.id })),
    seguro(raw.schema('airton').rpc('month_plan', { p_user: me.user.id })),
    seguro(raw.rpc('hub_resumo_iara')),
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

  // IARA House: briefing do dia e a fila de itens (trilha da SabIA etc.).
  const casa: Linha[] = []
  const r = iara && iara !== 'erro' ? (iara as IaraResumo) : null
  if (r?.briefing) {
    const quando = r.briefing.tipo === 'noite' ? 'da noite' : 'da manhã'
    casa.push({ texto: `Briefing ${quando}${r.briefing.lido ? '' : ' (não lido)'}${r.briefing.texto ? `: ${r.briefing.texto.split('\n')[0].slice(0, 140)}` : ''}`, destaque: !r.briefing.lido })
  }
  for (const i of r?.itens ?? []) casa.push({ texto: `${i.titulo}${i.minutos && !i.titulo.includes('min') ? ` · ${i.minutos} min` : ''}` })

  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())

  return (
    <div className="stack">
      <div>
        <span className="tag progress">IARA HQ</span>
        <h1>Hoje</h1>
        <p className="muted small" style={{ margin: 0 }}>{data}</p>
      </div>

      <Bloco app="claudia" nome="ClaudIA" papel="Saúde" href="/saude" rotulo="Abrir a ClaudIA"
        linhas={claudia} falhou={sessoes === 'erro' && alertas === 'erro'} vazio="Tudo em dia na saúde." />
      <Bloco app="airton" nome="AIrton" papel="Finanças" href={AIRTON_URL} externo rotulo="Abrir o AIrton"
        linhas={airton} falhou={pend === 'erro' && mes === 'erro'} vazio="Nada pendente nas finanças." />
      <Bloco app="casa" nome="IARA House" papel="Casa e rotina" href={CASA_URL} externo rotulo="Abrir a IARA House"
        linhas={casa} falhou={iara === 'erro'} vazio="Nenhuma pendência da IARA hoje." />
    </div>
  )
}

function Bloco({ app, nome, papel, href, externo, rotulo, linhas, falhou, vazio }: {
  app: 'claudia' | 'airton' | 'casa'; nome: string; papel: string; href: string; externo?: boolean; rotulo: string
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
        : linhas.length ? <ul className="small">{linhas.map((l, i) => <li key={i} style={l.destaque ? { fontWeight: 600 } : undefined}>{l.texto}</li>)}</ul>
        : <p className="small muted" style={{ margin: 0 }}>{vazio}</p>}
      {externo
        ? <a className="go" href={href} target="_blank" rel="noreferrer">{rotulo} ↗</a>
        : <Link className="go" href={href}>{rotulo} →</Link>}
    </section>
  )
}
