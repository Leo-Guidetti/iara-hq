import { currentUser } from '@/lib/supabase/server'
import { SignOut } from '@/components/SignOut'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Notificacoes } from '@/components/Notificacoes'
import { FUNCTIONS_URL } from '@/lib/env'
import { Limites, type AvisosCfg } from '@/components/Limites'
import { ProfileForm, Tokens, SiriToken } from './client'
import { Mais } from '@/components/Mais'
import { Logo } from '@/components/Logo'
import Link from 'next/link'
import { airtonLink } from '@/lib/airton'

export const dynamic = 'force-dynamic'
const FEATURE: Record<string, string> = { 'food-parse': 'Registro de comida', diet: 'Dieta', 'photo-review': 'Análise de fotos', coach: 'Plano de treino', 'coach-session': 'Conversa da sessão', 'coach-review': 'Revisão semanal', checkin: 'Check-in' }

export default async function PerfilPage() {
  const me = (await currentUser())!
  const [{ data: p }, { data: tokens }, { data: cost }, { data: avisos }, { data: strava }] = await Promise.all([
    me.sb.from('profiles').select('display_name, sex, birth_date, height_cm, goal').eq('id', me.user.id).single(),
    me.sb.from('ingest_tokens').select('id, label, created_at, last_used_at, revoked_at, escopos').order('created_at', { ascending: false }),
    me.sb.rpc('claudia_ai_cost', { p_months: 3 }),
    me.sb.rpc('hub_avisos'),
    me.sb.rpc('strava_status'),
  ])
  const st = strava as { connected?: boolean } | null
  const nome = (p?.display_name as string | null) ?? (me.user.user_metadata?.name as string | undefined) ?? 'Leo'
  const months = [...new Set((cost ?? []).map((c) => c.mes))]
  return (
    <div className="stack">
      <section className="row" style={{ gap: 14 }}>
        <span className="avatar-grande" aria-hidden="true"><span>{nome.slice(0, 1).toUpperCase()}</span></span>
        <span><span style={{ display: 'block', fontSize: '1.2rem', fontWeight: 500 }}>{nome}</span><span className="small" style={{ color: 'var(--dim)' }}>{me.user.email}</span></span>
      </section>
      <section className="card row between">
        <span className="small">Aparência</span>
        <ThemeToggle />
      </section>
      <Notificacoes />
      <section className="card" aria-label="Conexões">
        <div className="list small">
          <Link href="/saude/treino" className="row between" style={{ color: 'inherit' }}><span className="row" style={{ gap: 10 }}><Logo app="claudia" tamanho={20} />Strava</span><span style={{ color: st?.connected ? 'var(--claudia)' : 'var(--dim)' }}>{st?.connected ? 'Conectado' : 'Conectar'}</span></Link>
          <a href={airtonLink('/ajustes#open-finance')} target="_blank" rel="noreferrer" className="row between" style={{ color: 'inherit' }}><span className="row" style={{ gap: 10 }}><Logo app="airton" tamanho={20} />Banco (Open Finance)</span><span style={{ color: 'var(--dim)' }}>no AIrton</span></a>
          <Link href="/planos/semana" className="row between" style={{ color: 'inherit' }}><span className="row" style={{ gap: 10 }}><Logo app="planos" tamanho={20} />Agenda Google</span><span style={{ color: 'var(--dim)' }}>em Planos</span></Link>
        </div>
      </section>
      <Mais rotulo="Avisos e limites">
      <Limites cfg={avisos as AvisosCfg | null} />
      </Mais>
      <Mais rotulo="Dados pessoais">
      <ProfileForm p={p!} />
      </Mais>
      <Mais rotulo="Atalhos do iPhone e Siri">
      <Tokens tokens={(tokens ?? []).filter((t) => !t.escopos.includes('iara'))} endpoint={`${FUNCTIONS_URL}/claudia-ingest`} />
      <SiriToken tokens={(tokens ?? []).filter((t) => t.escopos.includes('iara'))} url={`${FUNCTIONS_URL}/iara-comando?formato=texto`} />
      </Mais>
      <Mais rotulo="Custo de IA">
      <section className="card">
        {months.map((m) => {
          const rows = (cost ?? []).filter((c) => c.mes === m)
          const total = rows.reduce((a, r) => a + Number(r.custo_usd), 0)
          return (
            <div key={m} style={{ marginBottom: 10 }}>
              <div className="row between"><strong>{new Date(`${m}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><span className="num">US$ {total.toFixed(2)}</span></div>
              <div className="list small">{rows.map((r) => <div key={r.feature + r.model} className="row between"><span>{FEATURE[r.feature] ?? r.feature} <span className="muted">· {r.chamadas}×</span></span><span className="num muted">US$ {Number(r.custo_usd).toFixed(3)}</span></div>)}</div>
            </div>
          )
        })}
        {!months.length && <p className="muted small">Nenhuma chamada de IA registrada ainda.</p>}
      </section>
      </Mais>
      <SignOut />
      <p className="disclaimer">A ClaudIA organiza o processo com base em referências acadêmicas. Não é aconselhamento médico.</p>
    </div>
  )
}
