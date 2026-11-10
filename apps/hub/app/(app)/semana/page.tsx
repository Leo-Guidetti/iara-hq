import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Md } from '@/lib/md'
import { Plano, Gerar } from './Plano'
import { Entrada } from './Entrada'
import { ddmm, diasEntre, type Painel, type PlanoSemana } from './tipos'

export const dynamic = 'force-dynamic'

// Planejamento da semana (pedido do Leo, 10/11): parte dele — expediente, compromissos, lugares e agenda —
// e a IARA devolve uma sugestão inicial e uma crítica para encaixar o resto. Ele ajusta e confirma.
export default async function SemanaPage() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const [{ data: pd, error: pe }, { data: sd, error: se }] = await Promise.all([raw.rpc('hub_semana_painel'), raw.rpc('hub_semana')])
  const painel = (pd ?? null) as Painel | null
  const plano = (sd ?? null) as PlanoSemana | null
  const dias = painel ? diasEntre(painel.desde, painel.fim) : []
  // Domingo o painel já olha a semana que vem; um plano da semana atual não serve mais.
  const planoDaSemana = plano && painel && plano.semana === painel.semana ? plano : null

  return (
    <div className="stack">
      <div>
        <h1>Sua semana</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {painel ? `${ddmm(painel.desde)} a ${ddmm(painel.fim)} · ` : ''}você marca o que é seu; a IARA sugere o resto e critica o encaixe.
        </p>
      </div>
      {(pe || se) && <div className="card alert"><p className="small">Não consegui carregar tudo agora.</p></div>}

      <div className="semana-cols">
        <div className="stack">
          {painel && <Entrada painel={painel} />}
          {(!planoDaSemana || planoDaSemana.status === 'rascunho') && (
            <section className="card stack" style={{ gap: 8 }}>
              <p className="small" style={{ margin: 0 }}>
                {planoDaSemana ? 'Mudou algum compromisso? Peça uma sugestão nova.' : 'Com seus compromissos marcados, peça a sugestão da IARA. No domingo às 18:00 ela já deixa uma pronta (aviso às 19:30).'}
              </p>
              <Gerar rotulo={planoDaSemana ? '✦ Sugerir e criticar de novo' : '✦ Sugerir e criticar a semana'} ghost={!!planoDaSemana} />
            </section>
          )}
        </div>

        {planoDaSemana && painel && (
          <div className="stack">
            {planoDaSemana.critica && (
              <section className="card alert stack" style={{ gap: 6 }}>
                <span className="tag alert">Crítica da IARA</span>
                <Md texto={planoDaSemana.critica} />
              </section>
            )}
            <section className="card ai">
              <div className="row between">
                <span className="tag ai">Sugestão da IARA</span>
                <span className={`tag ${planoDaSemana.status === 'confirmado' ? 'progress' : ''}`}>{planoDaSemana.status === 'confirmado' ? '✓ confirmado' : 'rascunho'}</span>
              </div>
              {planoDaSemana.resumo && <Md texto={planoDaSemana.resumo} />}
            </section>
            <Plano plano={planoDaSemana} fixos={painel.fixos} dias={dias} />
          </div>
        )}
      </div>
      <Link className="go" href="/hoje">← Voltar para Hoje</Link>
    </div>
  )
}
