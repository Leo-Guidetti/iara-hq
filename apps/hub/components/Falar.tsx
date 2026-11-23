'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { PecaIara } from './PecaIara'

// Botão "Falar com a IARA" no topo (protótipo aprovado, 23/11): substitui o card "Peça à IARA" no alto das telas.
// Abre uma folha com o orbe de voz (toque e fale) e, se preferir, o campo de texto.
export function Falar({ variante = 'botao', comando = false }: { variante?: 'botao' | 'orbe'; comando?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const path = usePathname()
  useEffect(() => { setAberto(false) }, [path])
  // Desktop: ⌘K / Ctrl+K abre a conversa já no campo de texto.
  useEffect(() => {
    if (!comando) return
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setTexto(true); setAberto(true) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [comando])
  const abrir = (porTexto: boolean) => { setTexto(porTexto); setAberto(true) }
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])
  return (
    <>
      {variante === 'orbe' ? (
        // Hub da casa: o orbe em espera no centro da tela; um toque abre a conversa.
        <button type="button" className="orbe parado orbe-espera" aria-label="Falar com a IARA" onClick={() => abrir(false)}>
          <span className="onda" /><span className="onda o2" /><span className="onda o3" /><span className="anel-giro" /><span className="nucleo" />
        </button>
      ) : (
        <>
        {comando && (
          <button type="button" className="comando" onClick={() => abrir(true)} aria-label="Peça à IARA (⌘K)">
            <span>Peça à IARA…</span><kbd>⌘K</kbd>
          </button>
        )}
        <button type="button" className="falar-btn" aria-label="Falar com a IARA" title="Falar com a IARA" onClick={() => abrir(false)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        </>
      )}
      <dialog ref={ref} className="folha" aria-label="Falar com a IARA" onClose={() => setAberto(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setAberto(false) }}>
        <div className="folha-corpo">
          <div className="row between" style={{ marginBottom: 4 }}>
            <span className="row small" style={{ gap: 8, color: 'var(--hq)' }}><span className="nav-marca" aria-hidden="true" />IARA</span>
            <button type="button" className="falar-btn" aria-label="Fechar" onClick={() => setAberto(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {aberto && <PecaIara texto={texto} />}
        </div>
      </dialog>
    </>
  )
}
