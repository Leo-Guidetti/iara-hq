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
