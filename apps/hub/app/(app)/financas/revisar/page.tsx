import { airton, airtonLink } from '@/lib/airton'
import { Revisao, type RevisaoDados } from '../Revisao'

export const dynamic = 'force-dynamic'

export default async function Revisar() {
  const { air, uid } = await airton()
  const rv = await air.rpc('review_list', { p_limit: 30, p_user: uid })
  return <Revisao dados={rv.error ? null : ((rv.data ?? null) as RevisaoDados | null)} erro={!!rv.error} appAntigo={airtonLink('/?revisar=1')} />
}
