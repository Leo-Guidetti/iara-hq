import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Md } from '@/lib/md'
import { Plano, Gerar, type PlanoSemana } from './Plano'

export const dynamic = 'force-dynamic'

// Planejamento da semana (Etapa 5): a IARA monta domingo 18:00; o Leo revisa às 20:00 e confirma.
const dia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })

export default async function SemanaPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_semana')
  const p = (data ?? null) as PlanoSemana | null
  const fim = p ? new Date(new Date(`${p.semana}T12:00:00Z`).getTime() + 6 * 864e5).toISOString().slice(0, 10) : null

  return (
    <div className="stack">
      <div>
        <h1>Sua semana</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {p ? `${dia(p.semana)} a ${dia(fim!)} · treinos, estudos, dieta, contas e casa num plano só.` : 'Treinos, estudos, dieta, contas e casa num plano só.'}
        </p>
      </div>
      {error && <div className="card alert"><p className="small">Não consegui carregar agora.</p></div>}
      {p ? (
        <>
          <section className="card ai">
            <div className="row between">
              <span className="tag ai">Plano da semana · IARA</span>
              <span className={`tag ${p.status === 'confirmado' ? 'progress' : ''}`}>{p.status === 'confirmado' ? '✓ confirmado' : 'rascunho'}</span>
            </div>
            {p.resumo && <Md texto={p.resumo} />}
          </section>
          <Plano plano={p} />
        </>
      ) : !error && (
        <section className="card stack">
          <p className="small" style={{ margin: 0 }}>
            O plano sai todo domingo às 18:00 (aviso às 19:30) para você revisar às 20:00. Quer montar o desta semana agora?
          </p>
          <Gerar rotulo="✦ Montar a semana agora" />
        </section>
      )}
      <Link className="go" href="/hoje">← Voltar para Hoje</Link>
    </div>
  )
}
