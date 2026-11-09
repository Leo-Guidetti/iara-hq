import { currentUser } from '@/lib/supabase/server'
import { SignOut } from '@/components/SignOut'
import { ThemeToggle } from '@/components/ThemeToggle'
import { FUNCTIONS_URL } from '@/lib/env'
import { ProfileForm, Tokens } from './client'

export const dynamic = 'force-dynamic'
const FEATURE: Record<string, string> = { 'food-parse': 'Registro de comida', diet: 'Dieta', 'photo-review': 'Análise de fotos', coach: 'Plano de treino', 'coach-session': 'Conversa da sessão', 'coach-review': 'Revisão semanal', checkin: 'Check-in' }

export default async function PerfilPage() {
  const me = (await currentUser())!
  const [{ data: p }, { data: tokens }, { data: cost }] = await Promise.all([
    me.sb.from('profiles').select('display_name, sex, birth_date, height_cm, goal').eq('id', me.user.id).single(),
    me.sb.from('ingest_tokens').select('id, label, created_at, last_used_at, revoked_at').order('created_at', { ascending: false }),
    me.sb.rpc('claudia_ai_cost', { p_months: 3 }),
  ])
  const months = [...new Set((cost ?? []).map((c) => c.mes))]
  return (
    <div className="stack">
      <h1>Perfil</h1>
      <section className="card stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Aparência</h2>
        <ThemeToggle />
      </section>
      <p className="small muted">{me.user.email}</p>
      <ProfileForm p={p!} />
      <Tokens tokens={tokens ?? []} endpoint={`${FUNCTIONS_URL}/claudia-ingest`} />
      <section className="card">
        <h2>Custo de IA</h2>
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
      <SignOut />
      <p className="disclaimer">A ClaudIA organiza o processo com base em referências acadêmicas. Não é aconselhamento médico.</p>
    </div>
  )
}
