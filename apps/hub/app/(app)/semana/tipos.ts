// Tipos do planejamento da semana (RPCs public.hub_semana e public.hub_semana_painel).
export type Fixo = {
  data: string; inicio: string | null; fim: string | null; titulo: string
  tipo: 'trabalho' | 'pessoal' | 'saude' | 'outro' | 'agenda'; fonte: string; id: number | null
  local?: string | null; ocupado?: boolean
}
export type Lugar = { nome: string; endereco: string | null; min_casa: number | null }
export type Expediente = { dias: number[]; inicio: string; fim: string; titulo?: string; local?: string | null } | null
export type Painel = {
  semana: string; desde: string; fim: string; expediente: Expediente; lugares: Lugar[]; fixos: Fixo[]
  agenda: { eventos: number; ultima_sync: string | null }; feed_token: string | null
}
export type ItemSemana = {
  id: number; data: string; hora: string | null; area: 'saude' | 'financas' | 'aprender' | 'casa'
  titulo: string; detalhe: string | null; minutos: number | null; valor: number | null; incluido: boolean; status: string | null
}
export type PlanoSemana = {
  id: number; semana: string; status: 'rascunho' | 'confirmado'; resumo: string | null; critica: string | null; itens: ItemSemana[]
}

export const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
export const nomeDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
export const ddmm = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
export function diasEntre(de: string, ate: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${de}T12:00:00Z`); t <= Date.parse(`${ate}T12:00:00Z`); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
