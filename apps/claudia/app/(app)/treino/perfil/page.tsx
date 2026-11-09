import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { TrainingProfileForm } from './Form'

export const dynamic = 'force-dynamic'

export default async function TrainingProfilePage() {
  const me = (await currentUser())!
  const { data } = await me.sb.from('training_profiles').select('*').eq('user_id', me.user.id).maybeSingle()
  return (
    <div className="stack">
      <Link href="/treino" className="small muted">‹ Treino</Link>
      <h1>Perfil de treino</h1>
      <TrainingProfileForm tp={data} />
    </div>
  )
}
