'use client'
import { useEffect, useState } from 'react'

/** Relógio que atualiza a cada `ms` enquanto `ativo` (para prazos de confirmar/desfazer). */
export function useAgora(ativo: boolean, ms = 15_000) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ativo) return
    setAgora(Date.now())
    const t = setInterval(() => setAgora(Date.now()), ms)
    return () => clearInterval(t)
  }, [ativo, ms])
  return agora
}

export const minutosAte = (iso: string, agora: number) => Math.max(1, Math.ceil((Date.parse(iso) - agora) / 60_000))
