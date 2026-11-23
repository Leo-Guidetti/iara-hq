import type { LogoKey } from '@/lib/apps'

// Tipos e rótulos compartilhados pelas subabas de Planos (RPC public.hub_planos).
export type Ritmo = 'no_ritmo' | 'atrasada' | 'adiantada' | 'sem_dados'
export type Meta = {
  id: number; titulo: string; dono: string; progresso: number | null; ritmo: Ritmo
  prazo: string | null; status: string; horizonte: string
}
export type Plano = {
  id: number; titulo: string; tipo: string; status: string; porque: string | null
  alvo: { valor?: unknown; data?: string } | null
  metas: { longo?: Meta[]; medio?: Meta[]; curto?: Meta[] }
}
export type ItemSemana = { data: string; hora: string | null; titulo: string; meta_id?: number | null }

export const HORIZONTES = [['longo', 'Longo prazo'], ['medio', 'Médio prazo'], ['curto', 'Curto prazo']] as const
export const DONO: Record<string, string> = { iara: 'IARA', claudia: 'ClaudIA', airton: 'AIrton', sabia: 'SabIA' }
export const RITMO: Record<Ritmo, string> = { no_ritmo: 'No ritmo', atrasada: 'Atrasada', adiantada: 'Adiantada', sem_dados: 'Sem dados' }


const LOGO_DONO: Record<string, LogoKey> = { iara: 'iara', claudia: 'claudia', airton: 'airton', sabia: 'sabia', casa: 'casa' }
export const logoDoDono = (d: string): LogoKey => LOGO_DONO[d] ?? 'iara'

/** Marcos com data: prazo de cada meta ativa e a data-alvo de cada plano. */
export type Marco = { data: string; titulo: string; dono: string; plano: string; atrasada: boolean }
export function marcosDe(planos: Plano[]): Marco[] {
  const out: Marco[] = []
  for (const p of planos) {
    if (p.status === 'cancelado' || p.status === 'arquivado') continue
    if (p.alvo?.data) out.push({ data: p.alvo.data.slice(0, 10), titulo: p.titulo, dono: 'iara', plano: p.titulo, atrasada: false })
    for (const h of HORIZONTES) for (const m of p.metas?.[h[0]] ?? [])
      if (m.prazo && m.status === 'ativa') out.push({ data: m.prazo.slice(0, 10), titulo: m.titulo, dono: m.dono, plano: p.titulo, atrasada: m.ritmo === 'atrasada' })
  }
  return out.sort((a, b) => a.data.localeCompare(b.data))
}
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const diaMes = (iso: string) => `${Number(iso.slice(8, 10))} ${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}`
