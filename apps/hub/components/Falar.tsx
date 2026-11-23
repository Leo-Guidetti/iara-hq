'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { PecaIara } from './PecaIara'

// Botão "Falar com a IARA" no topo (protótipo aprovado, 23/11): substitui o card "Peça à IARA" no alto das telas.
// Abre uma folha com o mesmo canal de texto e voz. O orbe de voz entra depois nesta mesma folha.
export function Falar() {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const path = usePathname()
  useEffect(() => { setAberto(false) }, [path])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])
  return (
    <>
      <button type="button" className="falar-btn" aria-label="Falar com a IARA" title="Falar com a IARA" onClick={() => setAberto(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <dialog ref={ref} className="folha" aria-label="Falar com a IARA" onClose={() => setAberto(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setAberto(false) }}>
        <div className="folha-corpo">
          <div className="row between" style={{ marginBottom: 12 }}>
            <strong style={{ color: 'var(--hq)' }}>IARA</strong>
            <button type="button" className="chip" onClick={() => setAberto(false)}>Fechar</button>
          </div>
          {aberto && <PecaIara />}
        </div>
      </dialog>
    </>
  )
}
