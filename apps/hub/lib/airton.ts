import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'

/** AIrton completo: o "modo detalhe" (código fora deste repo). Os atalhos abrem a tela certa dele. */
export const AIRTON_COMPLETO = 'https://airton-gray.vercel.app'
export const airtonLink = (rota: string) => `${AIRTON_COMPLETO}${rota}`

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** "2026-11" → "nov" (ou "novembro" com longo). */
export const nomeMes = (ym: string, longo = false) => (longo ? MESES_LONGOS : MESES)[Number(ym.slice(5, 7)) - 1] ?? ym

/** Cliente do schema airton com o login do Leo (RLS). */
export async function airton() {
  const me = (await currentUser())!
  return { air: (me.sb as unknown as SupabaseClient).schema('airton'), uid: me.user.id }
}

export type Plano = {
  month?: string; today?: string; available?: number; perDay?: number | null; daysLeft?: number; daysInMonth?: number
  spentTotal?: number; projectedSpend?: number
  income?: { expected?: number; received?: number }
  committed?: { total?: number }
  categories?: { id: string; name: string; spent: number; budget: number | null; expected?: number | null; nature?: string }[]
  upcoming?: { date: string; label: string; amount: number; kind: string }[]
}
