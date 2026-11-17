'use client'
import { useEffect, useState } from 'react'
import { falar, pararVoz, temVoz } from '@/components/Ouvir'

/** Botão Ouvir/Parar com a voz do navegador; some se não houver voz. */
export function Falar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false)
  const [lendo, setLendo] = useState(false)
  useEffect(() => { setOk(temVoz()); return () => pararVoz() }, [])
  if (!ok) return null
  return <button type="button" className="chip" aria-pressed={lendo} onClick={() => { if (lendo) { pararVoz(); setLendo(false) } else { setLendo(true); falar(texto, () => setLendo(false)) } }}>{lendo ? 'Parar' : 'Ouvir'}</button>
}
