import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { addDays, spDate } from '@/lib/dates'

export type Alert = { level: 'alert' | 'info'; text: string; href: string }

/** Alertas determinísticos do dia: nada aqui chama IA. */
export async function dailyAlerts(sb: SupabaseClient<Database>): Promise<{ alerts: Alert[]; ctx: Record<string, unknown> }> {
  const today = spDate()
  const [{ data: trend }, { data: lastW }, { data: comp }, { data: photo }, { data: diet }, { data: food }, { data: meds }, { data: plan }, { data: checkin }] = await Promise.all([
    sb.from('weight_with_trend').select('local_date, trend_7d').gte('local_date', addDays(today, -21)).order('local_date'),
    sb.from('weight_entries').select('local_date').order('measured_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('body_comp_estimates').select('local_date, lean_mass_kg, fat_mass_kg').order('local_date'),
    sb.from('progress_photos').select('local_date').order('local_date', { ascending: false }).limit(1).maybeSingle(),
    sb.from('diet_recommendations').select('kcal_target, protein_g_target').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('food_logs').select('local_date, kcal, protein_g').gte('local_date', addDays(today, -7)).lt('local_date', today),
    sb.from('medication_logs').select('local_date, side_effects').gte('local_date', addDays(today, -10)).order('administered_at', { ascending: false }),
    sb.from('workout_plans').select('materialized_through').eq('is_active', true).limit(1).maybeSingle(),
    sb.from('weekly_checkins').select('week_start').order('week_start', { ascending: false }).limit(1).maybeSingle(),
  ])
  const alerts: Alert[] = []
  const t = trend ?? []
  const now = t.at(-1)?.trend_7d, wk = t.filter((x) => x.local_date! <= addDays(t.at(-1)?.local_date ?? today, -7)).at(-1)?.trend_7d
  const two = t.filter((x) => x.local_date! <= addDays(t.at(-1)?.local_date ?? today, -14)).at(-1)?.trend_7d
  if (now != null && wk != null) {
    const pct = ((Number(now) - Number(wk)) / Number(wk)) * 100
    const pct2 = two != null ? ((Number(wk) - Number(two)) / Number(two)) * 100 : null
    if (pct < -1 && pct2 != null && pct2 < -1) alerts.push({ level: 'alert', text: `Perda acima de 1% por semana há duas semanas (${pct.toFixed(1)}%): risco maior de perder massa magra. Vale falar com seu médico.`, href: '/saude/peso' })
    else if (pct < -1) alerts.push({ level: 'alert', text: `Ritmo de ${pct.toFixed(1)}% nesta semana: acima de 1%. Garanta proteína e treino de força.`, href: '/saude/peso' })
  }
  if (!lastW || lastW.local_date < addDays(today, -3)) alerts.push({ level: 'info', text: 'Sem pesagem há 3+ dias: a média de 7 dias fica menos confiável.', href: '/saude/peso' })
  const c = comp ?? []
  if (c.length >= 2) {
    const a = c[0], b = c.at(-1)!
    const dL = Number(b.lean_mass_kg) - Number(a.lean_mass_kg), dF = Number(b.fat_mass_kg) - Number(a.fat_mass_kg)
    if (dL + dF < 0 && dL / (dL + dF) > 0.25) alerts.push({ level: 'alert', text: `Cerca de ${Math.round((dL / (dL + dF)) * 100)}% do que saiu desde ${a.local_date} parece massa magra.`, href: '/saude/corpo' })
  }
  if (!c.length || c.at(-1)!.local_date! < addDays(today, -14)) alerts.push({ level: 'info', text: 'Medidas de fita com mais de 14 dias: meça cintura e pescoço.', href: '/saude/corpo' })
  if (!photo || photo.local_date < addDays(today, -28)) alerts.push({ level: 'info', text: 'Fotos de progresso com mais de 4 semanas.', href: '/saude/corpo' })
  if (diet?.protein_g_target) {
    const per = new Map<string, number>()
    for (const f of food ?? []) per.set(f.local_date, (per.get(f.local_date) ?? 0) + Number(f.protein_g ?? 0))
    const vals = [...per.values()]
    if (vals.length >= 3) {
      const avg = vals.reduce((x, y) => x + y, 0) / vals.length
      if (avg < diet.protein_g_target * 0.9) alerts.push({ level: 'alert', text: `Proteína média de ${Math.round(avg)} g nos últimos 7 dias, abaixo da meta de ${diet.protein_g_target} g.`, href: '/saude/dieta' })
    }
  }
  const fx = (meds ?? []).flatMap((m) => m.side_effects ?? [])
  if (fx.length) alerts.push({ level: 'alert', text: `Efeitos colaterais registrados: ${[...new Set(fx)].join(', ')}. Se persistirem, fale com quem prescreveu.`, href: '/saude/dieta' })
  if (plan && (!plan.materialized_through || plan.materialized_through < addDays(today, 3))) alerts.push({ level: 'info', text: 'O plano de treino acaba em menos de 3 dias: estenda ou gere um novo.', href: '/saude/treino' })
  const lastWeek = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - 7)
  if (!checkin || checkin.week_start < lastWeek) alerts.push({ level: 'info', text: 'Check-in da última semana ainda não feito.', href: '/saude/treino' })
  return { alerts, ctx: { trend: now, diet } }
}
