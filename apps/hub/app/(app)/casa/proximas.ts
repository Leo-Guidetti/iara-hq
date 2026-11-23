// Fora do 'use client': a página (servidor) filtra antes de mandar para o componente.
export type Tarefa = { id: number; tipo: string; titulo: string; detalhe: string | null; data: string; hora: string | null; minutos: number | null; status: string; rec: number | null }

/** Recorrente aparece uma vez só: a próxima ocorrência em aberto (ou a de hoje, se já foi feita). */
export function proximas(itens: Tarefa[], hoje: string): Tarefa[] {
  const vistas = new Set<number>()
  return itens.filter((t) => {
    if (t.rec == null) return true
    if (t.status === 'feito') return t.data === hoje
    if (vistas.has(t.rec)) return false
    vistas.add(t.rec)
    return true
  })
}
