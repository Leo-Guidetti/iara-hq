import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { fmtKg } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function Inicio() {
  const me = (await currentUser())!
  const [{ data: profile }, { data: last }] = await Promise.all([
    me.sb.from('profiles').select('display_name').eq('id', me.user.id).single(),
    me.sb.from('weight_with_trend').select('trend_7d, local_date').order('local_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  return (
    <div className="stack">
      <div>
        <span className="tag progress">ClaudIA</span>
        <h1>Olá{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
      </div>
      <Link href="/peso" className="card">
        <span className="tag progress">Peso · média 7 dias</span>
        <div className="kpi num">{fmtKg(last?.trend_7d)}</div>
      </Link>
      <p className="muted small">O resumo completo do dia entra na etapa 5.</p>
    </div>
  )
}
