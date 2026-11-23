import { airton } from '@/lib/airton'
import { MetasBloco, type MetasStatus } from '../Metas'

export const dynamic = 'force-dynamic'

export default async function Metas() {
  const { air, uid } = await airton()
  const gl = await air.rpc('goals_status', { p_user: uid })
  return <MetasBloco dados={gl.error ? null : ((gl.data ?? null) as MetasStatus | null)} erro={!!gl.error} />
}
