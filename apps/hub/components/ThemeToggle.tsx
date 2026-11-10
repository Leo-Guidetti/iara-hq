'use client'
import { useEffect, useState } from 'react'

type Tema = 'auto' | 'light' | 'dark'
const OPCOES: [Tema, string][] = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]

/** Modo claro/escuro. "Automático" segue o sistema; a escolha fica neste aparelho. */
export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>('auto')
  useEffect(() => {
    try { setTema((localStorage.getItem('tema') as Tema | null) ?? 'auto') } catch { /* sem storage */ }
  }, [])
  function escolher(t: Tema) {
    setTema(t)
    const root = document.documentElement
    if (t === 'auto') delete root.dataset.theme
    else root.dataset.theme = t
    try { if (t === 'auto') localStorage.removeItem('tema'); else localStorage.setItem('tema', t) } catch { /* sem storage */ }
  }
  return (
    <div className="seg" role="group" aria-label="Aparência">
      {OPCOES.map(([v, l]) => <button key={v} type="button" aria-pressed={tema === v} onClick={() => escolher(v)}>{l}</button>)}
    </div>
  )
}

/** Botão rápido no topo: alterna claro/escuro a partir do que está na tela agora (a escolha fica neste aparelho). */
export function TemaRapido() {
  const [escuro, setEscuro] = useState<boolean | null>(null)
  useEffect(() => {
    const root = document.documentElement
    const sistema = window.matchMedia('(prefers-color-scheme: dark)')
    const ler = () => setEscuro(root.dataset.theme ? root.dataset.theme === 'dark' : sistema.matches)
    ler()
    sistema.addEventListener('change', ler)
    return () => sistema.removeEventListener('change', ler)
  }, [])
  function alternar() {
    const t: Tema = escuro ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('tema', t) } catch { /* sem storage */ }
    setEscuro(!escuro)
  }
  return (
    <button type="button" className="tema" onClick={alternar} aria-label={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'} title={escuro ? 'Modo claro' : 'Modo escuro'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {escuro
          ? <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 100-8 4 4 0 000 8z" />
          : <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />}
      </svg>
    </button>
  )
}
