import { currentUser } from '@/lib/supabase/server'
import { addDays, spDate } from '@/lib/dates'

/**
 * Nota de adesão da semana em andamento, calculada ao vivo (sem IA), com a mesma fórmula do
 * check-in da ClaudIA (supabase/functions/claudia-checkin): pesagens 20, proteína 25, treinos 35,
 * registro 10, corpo 10. Parcial: cada parte compara com os dias que já passaram, não com a semana inteira,
 * e o treino de hoje ainda não feito não conta contra.
 */
export type Adesao = {
  nota: number; dias: number; semana: { de: string; ate: string }
  pesagens: { feitos: number; de: number }
  treinos: { feitos: number; de: number }
  alimentacao: { feitos: number; de: number }
  proteina: { feitos: number; de: number } | null
  corpo: boolean
}

export async function adesaoParcial(): Promise<Adesao> {
  const me = (await currentUser())!
  const hoje = spDate()
  const ws = addDays(hoje, -((new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7))
  const we = addDays(ws, 6)
  const dias = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${ws}T12:00:00Z`)) / 864e5) + 1
  const [{ data: pesos }, { data: comida }, { data: dieta }, { data: medidas }, { data: fotos }, { data: sessoes }] = await Promise.all([
    me.sb.from('weight_entries').select('local_date').gte('local_date', ws).lte('local_date', hoje),
    me.sb.from('food_logs').select('local_date, kcal, protein_g').gte('local_date', ws).lte('local_date', hoje),
    me.sb.from('diet_recommendations').select('protein_g_target').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('measurements').select('local_date').gte('local_date', addDays(ws, -7)).lte('local_date', hoje),
    me.sb.from('progress_photos').select('local_date').gte('local_date', addDays(ws, -7)).lte('local_date', hoje),
    me.sb.from('plan_sessions').select('local_date, status').gte('local_date', ws).lte('local_date', we),
  ])
  const diasPesagem = new Set((pesos ?? []).map((w) => w.local_date)).size
  const porDia = new Map<string, { kcal: number; p: number }>()
  for (const f of comida ?? []) { const d = porDia.get(f.local_date) ?? { kcal: 0, p: 0 }; d.kcal += f.kcal ?? 0; d.p += Number(f.protein_g ?? 0); porDia.set(f.local_date, d) }
  const diasComida = [...porDia.values()].filter((d) => d.kcal >= 600)
  const alvoP = dieta?.protein_g_target ?? null
  const bateuP = alvoP ? diasComida.filter((d) => d.p >= alvoP * 0.9).length : 0
  const contam = (sessoes ?? []).filter((s) => s.local_date < hoje || s.status === 'done')
  const feitos = contam.filter((s) => s.status === 'done').length
  const corpo = (medidas?.length ?? 0) + (fotos?.length ?? 0) > 0

  const partes = [
    Math.round(20 * Math.min(1, diasPesagem / dias)),
    alvoP && diasComida.length ? Math.round(25 * (bateuP / Math.max(diasComida.length, Math.min(4, dias)))) : 0,
    // Sem treino planejado na semana = 0, como no check-in; planejado mas nenhum vencido ainda = em dia.
    !sessoes?.length ? 0 : contam.length ? Math.round(35 * Math.min(1, feitos / contam.length)) : 35,
    Math.round(10 * Math.min(1, diasComida.length / dias)),
    corpo ? 10 : 0,
  ]
  return {
    nota: partes.reduce((a, b) => a + b, 0), dias, semana: { de: ws, ate: we },
    pesagens: { feitos: diasPesagem, de: dias },
    treinos: { feitos, de: contam.length },
    alimentacao: { feitos: diasComida.length, de: dias },
    proteina: alvoP ? { feitos: bateuP, de: diasComida.length } : null,
    corpo,
  }
}
