// IARA · revisão mensal dos planos (UX-14): partes puras (sem banco, sem IA) para testar sem chave.
// A IARA só PROPÕE (core.plano_propostas); quem aplica é o Leo (public.hub_proposta_decidir).

export const TETO_REVISAO_USD = 0.08;
export const MAX_PROPOSTAS = 5;
export const CAMPOS = ['prazo', 'demanda', 'medida', 'status'] as const;
export const STATUS_PROPOSTOS = ['pausada', 'concluida', 'cancelada'] as const;
export type Campo = typeof CAMPOS[number];
export type MetaRev = { id: number; plano_id: number; prazo?: string | null; status?: string; demanda?: Record<string, unknown>; medida?: Record<string, unknown> };
export type Proposta = { meta_id: number; plano_id: number; campo: Campo; valor: unknown; motivo: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number | null => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

/** 1º domingo do mês (dia <= 7 e domingo), em data de São Paulo. */
export const ehPrimeiroDomingo = (data: string, dow: number) => dow === 0 && Number(data.slice(8, 10)) <= 7;
/** Revisão trimestral (jan, abr, jul, out) inclui as metas de horizonte longo. */
export const incluiLongo = (data: string) => [1, 4, 7, 10].includes(Number(data.slice(5, 7)));

/** Valida a saída do modelo: meta do usuário (id enviado), campo válido, valor no formato do campo e diferente do atual,
 *  motivo obrigatório, sem repetir (meta, campo), no máximo 5. Nunca lança por conteúdo ruim. */
export function normalizarPropostas(saida: any, metas: MetaRev[], hoje: string): Proposta[] {
  const porId = new Map(metas.map((m) => [Number(m.id), m]));
  const vistos = new Set<string>();
  const out: Proposta[] = [];
  for (const p of Array.isArray(saida?.propostas) ? saida.propostas : []) {
    const m = porId.get(Number(p?.meta_id));
    const campo = p?.campo as Campo;
    if (!m || !(CAMPOS as readonly string[]).includes(campo)) continue;
    const motivo = typeof p?.motivo === 'string' ? p.motivo.trim().slice(0, 300) : '';
    if (!motivo) continue;
    const v = p?.valor ?? {};
    let valor: unknown = null;
    if (campo === 'prazo') {
      const d = typeof v === 'string' ? v : v.prazo;
      if (typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && d >= hoje && d !== m.prazo) valor = d;
    } else if (campo === 'status') {
      const s = typeof v === 'string' ? v : v.status;
      if ((STATUS_PROPOSTOS as readonly string[]).includes(s) && s !== m.status) valor = s;
    } else if (campo === 'demanda') {
      const o: Record<string, number> = {};
      const r = num(v.reais_mes), t = num(v.minutos_semana);
      if (r !== null && r >= 0) o.reais_mes = Math.round(r * 100) / 100;
      if (t !== null && t >= 0) o.minutos_semana = Math.round(t);
      if (Object.keys(o).length && Object.entries(o).some(([k, x]) => num(m.demanda?.[k]) !== x)) valor = o;
    } else {
      const a = num(v.alvo);
      if (a !== null && a > 0 && num(m.medida?.alvo) !== a) valor = { alvo: a };
    }
    const chave = `${m.id}|${campo}`;
    if (valor === null || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ meta_id: Number(m.id), plano_id: Number(m.plano_id), campo, valor, motivo });
    if (out.length >= MAX_PROPOSTAS) break;
  }
  return out;
}
