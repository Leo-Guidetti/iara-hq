import { appDoAgent, type Bloco } from '@/components/SeuDia'

// Linha do tempo de hoje (determinística, sem IA), usada pela Hoje e pelo Hub da casa do iPad.
type Sessao = { id: number; title: string; status: string; duration_min: number | null }
type Rotina = { hora: string; minutos: number | null; atividade: string; agent: string }
type ItemPlano = { hora: string | null; area: string; titulo: string; minutos: number | null; ref: string | null; feito: boolean }
type Trilha = { trilha: { minutos: number; hoje: boolean } | null; itens: { status: string }[] } | null
type Mes = { upcoming?: { date: string; label: string; amount: number }[] } | null

const AREA_APP: Record<string, string> = { saude: 'claudia', financas: 'airton', aprender: 'sabia', casa: 'casa' }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })

/** Rotina com horário + itens do plano da semana + treinos + contas de hoje. Cada entrada pode faltar (consulta que falhou). */
export function blocosDoDia({ dia, semana, sessoes, mes, sabia, hoje }: {
  dia: unknown; semana: unknown; sessoes: unknown; mes: Mes; sabia: Trilha; hoje: string
}): Bloco[] {
  const blocos: Bloco[] = []
  const trilhaFeita = !!sabia?.trilha?.hoje && !!sabia.itens.length && sabia.itens.every((i) => i.status !== 'pendente')
  if (Array.isArray(dia)) {
    for (const r of dia as Rotina[]) {
      const ehTrilha = r.agent === 'sabia' && /trilha|imers/i.test(r.atividade)
      blocos.push({ hora: r.hora, minutos: ehTrilha && sabia?.trilha?.hoje ? sabia.trilha.minutos : r.minutos, texto: r.atividade, app: appDoAgent(r.agent), feito: ehTrilha && trilhaFeita })
    }
  }
  // Plano da semana confirmado: os itens de hoje entram com o horário combinado no domingo.
  // Treino com ref usa o horário do plano no lugar do bloco sem hora; contas já vêm do AIrton logo abaixo.
  const planoHoje = Array.isArray(semana) ? (semana as ItemPlano[]) : []
  const treinoNoPlano = new Map(planoHoje.filter((i) => i.ref?.startsWith('treino:')).map((i) => [Number(i.ref!.slice(7)), i]))
  for (const i of planoHoje) {
    if (i.ref?.startsWith('treino:') || i.ref?.startsWith('conta:')) continue
    blocos.push({ hora: i.hora, minutos: i.minutos, texto: i.titulo, app: AREA_APP[i.area] ?? 'hq', feito: i.feito })
  }
  if (Array.isArray(sessoes)) for (const s of sessoes as Sessao[]) {
    const p = treinoNoPlano.get(Number(s.id))
    blocos.push({ hora: p?.hora ?? null, minutos: s.duration_min, texto: `Treino: ${s.title}`, app: 'claudia', feito: s.status === 'done' })
  }
  for (const u of (mes?.upcoming ?? []).filter((u) => u.date === hoje)) {
    blocos.push({ hora: null, texto: `${Number(u.amount) < 0 ? 'Conta' : 'Entrada'}: ${u.label} · ${brl(Math.abs(Number(u.amount)))}`, app: 'airton' })
  }
  return blocos
}

/** Hora atual em São Paulo, "HH:MM". */
export const agoraSP = () => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date())
