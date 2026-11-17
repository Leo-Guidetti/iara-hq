import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { appDoAgent } from '@/components/SeuDia'
import { ddmm } from '../semana/tipos'
import { NovoPlano, AcoesRascunho } from './Novo'
import { Decisoes, type Decisao } from './Decisoes'
import { Propostas, type Proposta } from './Propostas'

export const dynamic = 'force-dynamic'

type Ritmo = 'no_ritmo' | 'atrasada' | 'adiantada' | 'sem_dados'
type Meta = {
  id: number; titulo: string; dono: string; progresso: number | null; ritmo: Ritmo
  prazo: string | null; status: string; horizonte: string
}
type Plano = {
  id: number; titulo: string; tipo: string; status: string; porque: string | null
  alvo: { valor?: unknown; data?: string } | null
  metas: { longo?: Meta[]; medio?: Meta[]; curto?: Meta[] }
}
type ItemSemana = { data: string; hora: string | null; titulo: string; meta_id?: number | null }

const HORIZONTES = [['longo', 'Longo prazo'], ['medio', 'Médio prazo'], ['curto', 'Curto prazo']] as const
const DONO: Record<string, string> = { iara: 'IARA', claudia: 'ClaudIA', airton: 'AIrton', sabia: 'SabIA' }
const RITMO: Record<Ritmo, string> = { no_ritmo: 'No ritmo', atrasada: 'Atrasada', adiantada: 'Adiantada', sem_dados: 'Sem dados' }

export default async function PlanosPage() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const [{ data, error }, { data: sem }, { data: dec }, { data: prop }] = await Promise.all([raw.rpc('hub_planos'), raw.rpc('hub_semana'), raw.rpc('hub_decisoes'), raw.rpc('hub_propostas')])
  const propostas = (Array.isArray(prop) ? prop : []) as Proposta[]
  const decisoes = (Array.isArray(dec) ? dec : []) as Decisao[]
  const planos = (Array.isArray(data) ? data : []) as Plano[]
  const hoje = spDate()
  const itens = ((sem as { itens?: ItemSemana[] } | null)?.itens ?? []).filter((i) => i.meta_id != null && i.data >= hoje)

  return (
    <div className="stack">
      <div>
        <h1>Planos</h1>
        <p className="muted small" style={{ margin: 0 }}>Do objetivo de longo prazo até o que fazer esta semana.</p>
      </div>
      <Decisoes itens={decisoes} />
      <Propostas itens={propostas} />
      <NovoPlano />
      {error ? (
        <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar os planos agora.</p></div>
      ) : !planos.length ? (
        <section className="card stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Nenhum plano ainda</h2>
          <p className="small muted" style={{ margin: 0 }}>Planos nascem de uma frase à IARA: diga o que você quer conquistar e ela monta os horizontes e as metas.</p>
        </section>
      ) : planos.map((p) => {
        const ids = new Set(HORIZONTES.flatMap(([h]) => (p.metas?.[h] ?? []).map((m) => m.id)))
        const prox = itens.find((i) => ids.has(Number(i.meta_id)))
        return (
          <section key={p.id} className="card stack" style={{ gap: 10 }}>
            <div className="row between">
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{p.titulo}</h2>
              <span className={`tag ${p.status === 'rascunho' ? 'ai' : 'progress'}`}>{p.status === 'rascunho' ? 'Rascunho' : p.status}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {p.tipo}
              {p.alvo?.valor != null && ` · alvo ${String(p.alvo.valor)}`}
              {p.alvo?.data && ` · até ${ddmm(p.alvo.data)}`}
            </p>
            {p.porque && <p className="small" style={{ margin: 0 }}>Porque: {p.porque}</p>}
            {HORIZONTES.map(([h, nome]) => {
              const metas = (p.metas?.[h] ?? []).filter((m) => m.status !== 'cancelada')
              return (
                <div key={h} className="stack" style={{ gap: 8 }}>
                  <span className="tag">{nome}</span>
                  {metas.length ? metas.map((m) => <MetaLinha key={m.id} m={m} />) : <p className="small muted" style={{ margin: 0 }}>Sem metas.</p>}
                </div>
              )
            })}
            {p.status === 'rascunho' && <AcoesRascunho planoId={p.id} />}
            {prox && <p className="small" style={{ margin: 0 }}>Próximo passo: {prox.titulo} · {ddmm(prox.data)}{prox.hora ? ` ${prox.hora}` : ''}</p>}
          </section>
        )
      })}
    </div>
  )
}

function MetaLinha({ m }: { m: Meta }) {
  const pct = m.progresso == null ? null : Math.round(Math.min(1, Math.max(0, Number(m.progresso))) * 100)
  const atrasada = m.ritmo === 'atrasada'
  return (
    <div data-app={appDoAgent(m.dono)} className="stack" style={{ gap: 4, borderLeft: '3px solid var(--accent)', paddingLeft: 10 }}>
      <div className="row between">
        <strong className="small">{m.titulo}</strong>
        <span className="small" style={{ color: atrasada ? 'var(--alert)' : 'var(--accent)' }}>{DONO[m.dono] ?? m.dono}</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label={`Progresso de ${m.titulo}`}
        style={{ height: 6, borderRadius: 3, background: 'color-mix(in srgb, var(--muted) 25%, transparent)', overflow: 'hidden' }}>
        <div style={{ width: `${pct ?? 0}%`, height: '100%', background: atrasada ? 'var(--alert)' : 'var(--accent)' }} />
      </div>
      <span className="small muted" style={atrasada ? { color: 'var(--alert)' } : undefined}>
        {pct != null ? `${pct}% · ` : ''}{RITMO[m.ritmo] ?? m.ritmo}{m.prazo ? ` · prazo ${ddmm(m.prazo)}` : ''}
      </span>
    </div>
  )
}
