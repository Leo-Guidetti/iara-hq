'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'
import { appDoAgent } from '@/components/SeuDia'

export type Opcao = { id: string; rotulo: string; efeito?: unknown }
export type Posicao = { agent: string; posicao: 'favor' | 'contra' | 'neutro'; confianca: number; argumento: string; condicao: string | null }
export type Sintese = { concordancia?: string; divergencia?: string; recomendacao?: string; fala?: string; opcao_recomendada?: string | null }
export type Decisao = {
  id: number; plano_id: number | null; plano: string | null; pergunta: string; gatilho: string | null
  status: 'aberta' | 'painel'; created_at: string; opcoes: Opcao[]; sintese: Sintese | null; posicoes: Posicao[]
}

const DONO: Record<string, string> = { iara: 'IARA', claudia: 'ClaudIA', airton: 'AIrton', sabia: 'SabIA' }
const POS = { favor: 'A favor', contra: 'Contra', neutro: 'Neutro' } as const

function Cartao({ d }: { d: Decisao }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [conf, setConf] = useState<Opcao | null>(null)
  const [feito, setFeito] = useState<string | null>(null)

  async function ouvir() {
    setBusy(true); setErro(null)
    try {
      await callFunction('iara-plano', { acao: 'painel', decisao_id: d.id })
      router.refresh()
    } catch (e) { setErro((e as Error).message || 'Não consegui reunir os agentes agora.') }
    setBusy(false)
  }
  async function decidir(o: Opcao) {
    setBusy(true); setErro(null)
    const { data, error } = await (supabaseBrowser() as unknown as { rpc: (n: string, a: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }> })
      .rpc('hub_decidir', { p_id: d.id, p_escolha: o.id })
    setBusy(false)
    if (error) {
      const m = error.message
      setErro(m.includes('inválida') ? 'Essa opção não é válida.' : m.includes('expirada') ? 'Esta decisão expirou.' : m.includes('não encontrada') ? 'Decisão não encontrada.' : 'Não consegui registrar a decisão. Tente de novo.')
      setConf(null); return
    }
    const r = data as { rotulo?: string; ja_decidida?: boolean } | null
    setFeito(`Decidido: ${r?.rotulo ?? o.rotulo}`); setConf(null)
    router.refresh()
  }

  const rec = d.sintese?.opcao_recomendada ?? null
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <span className="tag">Decisão{d.plano ? ` · ${d.plano}` : ''}</span>
        <span className="tag alert">{d.status === 'aberta' ? 'Aberta' : 'Aguardando você'}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{d.pergunta}</h2>
      {d.gatilho && <p className="small muted" style={{ margin: 0 }}>{d.gatilho}</p>}

      {feito ? <p className="small" style={{ margin: 0 }}>{feito}</p> : d.status === 'aberta' ? (
        <>
          <button className="btn ai" style={{ justifySelf: 'start' }} disabled={busy} onClick={ouvir}>{busy ? 'Os agentes estão discutindo…' : 'Ouvir os agentes'}</button>
          {busy && <p className="small muted" style={{ margin: 0 }}>Isso leva alguns segundos.</p>}
        </>
      ) : (
        <>
          {d.posicoes.map((p) => (
            <div key={p.agent} data-app={appDoAgent(p.agent)} className="stack" style={{ gap: 4, borderLeft: '3px solid var(--accent)', paddingLeft: 10 }}>
              <div className="row between">
                <strong className="small" style={{ color: 'var(--accent)' }}>{DONO[p.agent] ?? p.agent}</strong>
                <span className="small">{POS[p.posicao] ?? p.posicao} · confiança {p.confianca}/10</span>
              </div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={p.confianca} aria-label={`Confiança de ${DONO[p.agent] ?? p.agent}`}
                style={{ height: 4, borderRadius: 2, background: 'color-mix(in srgb, var(--muted) 25%, transparent)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(10, Math.max(0, p.confianca)) * 10}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <p className="small" style={{ margin: 0 }}>{p.argumento}</p>
              {p.condicao && <p className="small muted" style={{ margin: 0 }}>Se: {p.condicao}</p>}
            </div>
          ))}
          {d.sintese && (
            <div className="card ai stack" style={{ gap: 6 }}>
              <span className="tag ai">Síntese · IARA</span>
              {d.sintese.concordancia && <p className="small" style={{ margin: 0 }}><strong>Concordam:</strong> {d.sintese.concordancia}</p>}
              {d.sintese.divergencia && <p className="small" style={{ margin: 0 }}><strong>Divergem:</strong> {d.sintese.divergencia}</p>}
              {d.sintese.recomendacao && <p className="small" style={{ margin: 0 }}><strong>Recomendação:</strong> {d.sintese.recomendacao}</p>}
            </div>
          )}
          {conf ? (
            <div className="stack" style={{ gap: 6 }}>
              <p style={{ margin: 0 }}><strong>Escolher: {conf.rotulo}?</strong></p>
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => decidir(conf)}>{busy ? 'Registrando…' : 'Sim'}</button>
                <button className="btn ghost" disabled={busy} onClick={() => setConf(null)}>Voltar</button>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">A decisão é sua. Escolha uma opção:</span>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {d.opcoes.map((o) => (
                  <button key={o.id} className={`btn ${o.id === rec ? 'ai' : 'ghost'}`} disabled={busy} onClick={() => setConf(o)}>
                    {o.rotulo}{o.id === rec ? ' · recomendada' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {erro && <p className="error">{erro}</p>}
    </section>
  )
}

export function Decisoes({ itens }: { itens: Decisao[] }) {
  if (!itens.length) return null
  return <div id="decisoes" className="stack">{itens.map((d) => <Cartao key={d.id} d={d} />)}</div>
}
