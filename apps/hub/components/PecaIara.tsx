'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { callFunction } from '@/lib/functions'
import { supabaseBrowser } from '@/lib/supabase/client'
import { minutosAte, useAgora } from '@/lib/useAgora'
import { useDitado } from '@/lib/useDitado'
import { lerTela } from '@/lib/tela'
import { destravarVoz, falar, pararVoz, temVoz } from './Ouvir'

type Pendente = { tipo: 'pergunta' | 'confirmacao'; pergunta?: string; opcoes?: string[]; acao_id?: number; expira_em?: string } | null
type Desfazer = { acao_id: number; ate: string } | null
type Resp = {
  fala?: string
  tela?: { executou?: boolean } | null
  pendente?: Pendente
  desfazer?: Desfazer
  intencao?: string | null
  slots?: unknown
}
type Turno = { texto: string; fala: string; erro?: boolean }
type Estado = 'parado' | 'ouvindo' | 'pensando' | 'falando'

const ROTULO: Record<Estado, { texto: string; acao: string }> = {
  parado: { texto: 'Toque no orbe e fale', acao: 'Falar com a IARA' },
  ouvindo: { texto: 'Ouvindo…', acao: 'Parar de ouvir' },
  pensando: { texto: 'Pensando…', acao: 'Pensando' },
  falando: { texto: 'Toque para interromper', acao: 'Interromper' },
}

const MSG: Record<number, string> = {
  400: 'Não entendi o pedido. Reescreva em outras palavras.',
  401: 'Sessão expirada: entre de novo.',
  403: 'Sem permissão para isso.',
  405: 'Pedido não aceito.',
}

/** Falar com a IARA: canal único de comando em linguagem natural (UX-23). Voz primeiro, pelo orbe (protótipo de 23/11); texto em "Digitar". */
export function PecaIara({ texto: comecarNoTexto = false }: { texto?: boolean } = {}) {
  const router = useRouter()
  const ditado = useDitado()
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [historico, setHistorico] = useState<Turno[]>([])
  const [falando, setFalando] = useState(false)
  const [digitar, setDigitar] = useState(comecarNoTexto)
  useEffect(() => () => pararVoz(), [])
  const [pendente, setPendente] = useState<Pendente>(null)
  const [desfazer, setDesfazer] = useState<Desfazer>(null)
  const [retorno, setRetorno] = useState<{ fala: string; erro: boolean } | null>(null)
  const agora = useAgora(!!(desfazer || pendente?.expira_em))
  const podeDesfazer = !!desfazer && Date.parse(desfazer.ate) > agora

  async function desfazerAcao() {
    if (!desfazer || busy) return
    setBusy(true)
    const { data, error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_acao_desfazer', { p_id: desfazer.acao_id })
    const r = (data ?? {}) as { ok?: boolean; fala?: string }
    setBusy(false)
    if (error) { setRetorno({ fala: 'Não consegui desfazer agora. Tente de novo.', erro: true }); return }
    setRetorno({ fala: r.fala || (r.ok ? 'Desfeito.' : 'Não deu para desfazer.'), erro: r.ok === false })
    if (r.ok) { setDesfazer(null); atualizar() }
  }

  /** Atualiza a tela depois de uma ação: as telas leem os dados no servidor, então o refresh basta (sem recarregar). */
  const atualizar = () => router.refresh()

  async function enviar(t: string, porVoz = false) {
    const msg = t.trim()
    if (!msg || busy) return
    pararVoz()
    setBusy(true)
    setPendente(null)
    setRetorno(null)
    let turno: Turno
    try {
      // UX-23: a rota e os itens marcados na tela vão junto, para "essa meta" / "o segundo" acharem o id certo.
      const r = await callFunction<Resp>('iara-comando', { texto: msg, canal: 'hub', contexto_tela: lerTela() })
      turno = { texto: msg, fala: r.fala || 'Pronto.', erro: r.tela?.executou === false }
      setPendente(r.pendente ?? null)
      setDesfazer(r.desfazer ?? null)
      setTexto('')
      if (r.tela?.executou === true) atualizar()
      if (porVoz && temVoz()) { setFalando(true); falar(turno.fala, () => setFalando(false)) }
    } catch (e) {
      const m = (e as Error).message || ''
      const cod = Number(/^Erro (\d{3})$/.exec(m)?.[1])
      turno = { texto: msg, fala: MSG[cod] ?? (m || 'Não consegui agora. Tente de novo.'), erro: true }
    }
    setHistorico((h) => [...h, turno].slice(-1))
    setBusy(false)
  }

  const atual = historico[historico.length - 1]
  const opcoes = pendente?.tipo === 'confirmacao' ? ['Sim', 'Não'] : (pendente?.opcoes ?? []).slice(0, 3)
  const estado: Estado = ditado.ouvindo ? 'ouvindo' : busy ? 'pensando' : falando ? 'falando' : 'parado'
  const mostrarTexto = digitar || !ditado.suportado

  function tocarOrbe() {
    if (ditado.ouvindo) { ditado.parar(); return }
    if (falando) { pararVoz(); setFalando(false); return }
    if (busy || !ditado.suportado) return
    pararVoz(); destravarVoz(); ditado.iniciar((t) => enviar(t, true))
  }

  return (
    <section className="stack peca" style={{ gap: 14 }} aria-label="Falar com a IARA">
      <button type="button" className={`orbe ${estado}`} onClick={tocarOrbe} disabled={!ditado.suportado || (busy && !ditado.ouvindo)}
        aria-label={ROTULO[estado].acao} aria-pressed={ditado.ouvindo}>
        <span className="onda" /><span className="onda o2" /><span className="onda o3" />
        <span className="anel-giro" />
        <span className="nucleo" />
      </button>
      <p className="small muted" style={{ margin: 0, textAlign: 'center' }} aria-live="polite">
        {ditado.ouvindo && ditado.parcial ? ditado.parcial : ditado.suportado ? ROTULO[estado].texto : 'Escreva seu pedido.'}
      </p>
      {ditado.erro && <p className="error small" style={{ margin: 0, textAlign: 'center' }} aria-live="polite">{ditado.erro}</p>}

      {!busy && atual && (
        <div className="stack" style={{ gap: 8 }} aria-live="polite">
          <p className="small muted" style={{ margin: 0 }}>“{atual.texto}”</p>
          <p className={atual.erro ? 'error' : 'fala'} style={{ margin: 0 }}>{atual.fala}</p>
          {pendente?.pergunta && <p className="small" style={{ margin: 0 }}>{pendente.pergunta}</p>}
          {pendente?.tipo === 'confirmacao' && (
            <p className="small muted" style={{ margin: 0 }}>{pendente.expira_em ? `Vale por ${minutosAte(pendente.expira_em, agora)} min.` : 'Vale por 10 min.'}</p>
          )}
          {opcoes.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {opcoes.map((o) => (
                <button key={o} className="btn ghost" onClick={() => enviar(o === 'Sim' ? 'sim' : o === 'Não' && pendente?.tipo === 'confirmacao' ? 'não' : o)}>{o}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {!busy && podeDesfazer && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn ghost" onClick={desfazerAcao}>Desfazer</button>
          <span className="small muted">vale por {minutosAte(desfazer!.ate, agora)} min</span>
        </div>
      )}
      {!busy && retorno && <p className={retorno.erro ? 'error small' : 'small'} style={{ margin: 0 }} aria-live="polite">{retorno.fala}</p>}

      {mostrarTexto ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); enviar(texto) }}>
          <input aria-label="Peça à IARA" placeholder="Peça à IARA…" value={texto} disabled={busy || ditado.ouvindo} autoFocus={digitar}
            onChange={(e) => setTexto(e.target.value)} />
          <button className="btn ai" disabled={busy || ditado.ouvindo || !texto.trim()}>{busy ? '…' : 'Enviar'}</button>
        </form>
      ) : (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="chip" onClick={() => { ditado.parar(); setDigitar(true) }}>Digitar</button>
        </div>
      )}
    </section>
  )
}
