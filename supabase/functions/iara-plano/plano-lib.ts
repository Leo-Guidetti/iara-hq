// IARA · plano nasce de uma frase (UX-11): partes puras (sem banco, sem IA) para poder testar sem chave.
// Validação/normalização da saída do `smart`, decisão de rodada de perguntas, teto por execução e fala.

export const DONOS = ['iara', 'claudia', 'airton', 'sabia'] as const;
export const HORIZONTES = ['curto', 'medio', 'longo'] as const;
export const TIPOS = ['imovel', 'carro', 'carreira', 'habilidade', 'habito', 'outro'] as const;
export const TETO_RUN_USD = 0.10;
export const MAX_RODADAS = 3;

export type Dono = typeof DONOS[number];
export type Horizonte = typeof HORIZONTES[number];
export type Tipo = typeof TIPOS[number];
export type Meta = {
  horizonte: Horizonte; dono: Dono; titulo: string;
  medida: Record<string, unknown>; prazo: string | null; cadencia: string | null;
  demanda: { reais_mes?: number; minutos_semana?: number }; ref: string | null;
};
export type PrimeiroPasso = { titulo: string; dono: Dono; detalhe: string | null };
export type Extracao = {
  tipo: Tipo; titulo: string; envolve_dinheiro: boolean; valor: number | null; data: string | null; porque: string | null;
  pergunta: { texto: string; opcoes: string[] } | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const num = (v: unknown): number | null => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** Normaliza a extração do `fast`: tipo/data/valor válidos; data no passado conta como ausente. */
export function normalizarExtracao(x: any, hoje: string): Extracao {
  const tipo = (TIPOS as readonly string[]).includes(x?.tipo) ? (x.tipo as Tipo) : 'outro';
  const valor = num(x?.valor);
  const data = dataValida(x?.data) && x.data >= hoje ? x.data : null;
  const opcoes = Array.isArray(x?.pergunta?.opcoes) ? x.pergunta.opcoes.map((o: unknown) => texto(o, 60)).filter(Boolean).slice(0, 3) : [];
  const pt = texto(x?.pergunta?.texto, 200);
  return {
    tipo, titulo: texto(x?.titulo, 100) ?? 'Novo plano',
    envolve_dinheiro: x?.envolve_dinheiro === true || tipo === 'imovel' || tipo === 'carro',
    valor: valor !== null && valor > 0 ? valor : null, data, porque: texto(x?.porque, 300),
    pergunta: pt ? { texto: pt, opcoes } : null,
  };
}

/** D2: valor E prazo sempre que houver dinheiro; prazo para os demais. Sem IA. */
export function faltando(e: Extracao): ('valor' | 'prazo')[] {
  const f: ('valor' | 'prazo')[] = [];
  if (e.envolve_dinheiro && e.valor === null) f.push('valor');
  if (e.data === null) f.push('prazo');
  return f;
}

/** Decide se pergunta (até 3 rodadas, contando as respostas já recebidas) e qual pergunta. Sem IA para decidir. */
export function decidirRodada(e: Extracao, respostas: unknown[]): { pergunta: string; opcoes: string[]; rodada: number } | null {
  const f = faltando(e);
  const rodada = respostas.length + 1;
  if (!f.length || rodada > MAX_RODADAS) return null;
  const padrao = f.length === 2 ? 'Qual o valor total e até quando você quer isso?' : f[0] === 'valor' ? 'Qual o valor total que você tem em mente?' : 'Até quando você quer chegar lá?';
  // Pergunta do modelo só vale se a rodada tem 1 coisa faltando ou ela cita o que falta; senão, a padrão (valor nunca é adivinhado).
  const p = e.pergunta?.texto;
  const cita = p && ((f.includes('valor') && /valor|quanto|custa|reais|R\$/i.test(p)) || (f.includes('prazo') && /quando|prazo|data|ano|até/i.test(p)));
  return { pergunta: limparFala(cita ? p! : padrao), opcoes: cita ? e.pergunta!.opcoes : [], rodada };
}

/** Teto por execução: aborta ANTES de passar de US$ 0,10 (gasto até agora + pior caso da próxima chamada). */
export function garantirTeto(custoAtual: number, estimativa: number, teto = TETO_RUN_USD) {
  if (custoAtual + estimativa > teto) throw new Error(`Orçamento por plano excederia US$ ${teto.toFixed(2)} (atual ${custoAtual.toFixed(4)} + estimado ${estimativa.toFixed(4)}).`);
}
/** Pior caso do smart: entrada estimada por caracteres (~3,5/token) + max_tokens inteiro de saída (Sonnet 5.5: US$ 2/10 por MTok). */
export const estimarSmart = (chars: number, maxTokens: number) => (chars / 3.5) * 2 / 1e6 + maxTokens * 10 / 1e6;

const alvoDe = (m: Record<string, unknown>) => num(m.alvo);

/** Medida e ref no formato que os adapters do UX-09 entendem. Ref inválida vira null; tipo inválido é consertado. */
function normalizarMedidaRef(dono: Dono, medidaIn: any, refIn: unknown, ctx: { pesoAtual: number | null }): { medida: Record<string, unknown>; ref: string | null } {
  const tipos = ['valor', 'contagem', 'habito', 'marco'];
  let tipo = tipos.includes(medidaIn?.tipo) ? (medidaIn.tipo as string) : 'marco';
  const alvo = num(medidaIn?.alvo);
  const medida: Record<string, unknown> = { tipo };
  const unidade = texto(medidaIn?.unidade, 30);
  if (unidade) medida.unidade = unidade;
  if (alvo !== null && alvo > 0) medida.alvo = alvo;
  if (dataValida(medidaIn?.inicio)) medida.inicio = medidaIn.inicio;
  let ref = texto(refIn, 60);

  if (dono === 'iara') {
    // marco (concluída = 1) ou contagem manual (atual/alvo); sem alvo numérico, é marco.
    ref = null;
    if (tipo !== 'contagem' || !medida.alvo) tipo = 'marco';
    medida.tipo = tipo;
    if (tipo === 'contagem') medida.atual = 0;
    else { delete medida.alvo; delete medida.unidade; }
  } else if (dono === 'airton') {
    ref = null; // airton.goals:<id> só nasce na confirmação (id real); ref inventada não vale
    if (tipo === 'valor' && !medida.alvo) medida.tipo = 'habito'; // valor nunca é adivinhado
    if (tipo === 'marco' || tipo === 'contagem') medida.tipo = 'habito';
  } else if (dono === 'sabia') {
    const livroAno = ref === 'sabia.livros:ano' || (ref !== null && /^sabia\.livros:\d+$/.test(ref));
    ref = livroAno ? ref : null;
    if (ref === 'sabia.livros:ano') { medida.tipo = 'contagem'; medida.unidade ??= 'livros'; }
    else if (ref === null && (tipo === 'valor' || tipo === 'contagem') && !medida.alvo) medida.tipo = 'habito';
  } else if (dono === 'claudia') {
    if (ref === 'claudia.peso' && medida.alvo) {
      medida.tipo = 'valor'; medida.unidade = 'kg';
      if (ctx.pesoAtual !== null) medida.valor_inicial = num(medidaIn?.valor_inicial) ?? ctx.pesoAtual;
    } else if (ref === 'claudia.sessoes:semana' && medida.alvo) {
      medida.tipo = 'habito'; medida.unidade = 'sessões/semana';
    } else ref = null;
  }
  return { medida, ref };
}

const donoPorTexto = (v: unknown): Dono | null => {
  const s = String(v ?? '').toLowerCase().trim();
  if ((DONOS as readonly string[]).includes(s)) return s as Dono;
  if (s === 'leo') return 'iara';
  return null;
};

function horizontePorPrazo(prazo: string | null, hoje: string): Horizonte {
  if (!prazo) return 'medio';
  const d = diasEntre(hoje, prazo);
  return d <= 31 ? 'curto' : d <= 365 ? 'medio' : 'longo';
}

/** Valida e conserta a saída do `smart`: dono válido (D1: carreira e hobbies = iara), horizonte válido, ≥ 1 meta por
 *  horizonte (completa com marcos da IARA), medida/ref no formato dos adapters, no máx. 1 meta de valor do AIrton
 *  (vira airton.goals na confirmação). Nunca lança por conteúdo ruim: conserta e registra em `avisos`. */
export function normalizarMetas(saida: any, ctx: { tipo: Tipo; titulo: string; alvo: { valor: number | null; data: string | null }; hoje: string; pesoAtual?: number | null })
  : { metas: Meta[]; primeiro_passo: PrimeiroPasso; avisos: string[] } {
  const avisos: string[] = [];
  const pesoAtual = ctx.pesoAtual ?? null;
  const soIara = ctx.tipo === 'carreira' || ctx.tipo === 'habilidade'; // D1
  const metas: Meta[] = [];
  const vistos = new Set<string>();
  let valorAirton = 0;
  for (const m of Array.isArray(saida?.metas) ? saida.metas : []) {
    const titulo = texto(m?.titulo, 120);
    if (!titulo || vistos.has(titulo.toLowerCase())) continue;
    vistos.add(titulo.toLowerCase());
    let dono = donoPorTexto(m?.dono);
    if (!dono) { avisos.push(`dono inválido em "${titulo}" → iara`); dono = 'iara'; }
    if (soIara && dono !== 'iara') { avisos.push(`D1: "${titulo}" passou de ${dono} para iara`); dono = 'iara'; }
    const prazo = dataValida(m?.prazo) && m.prazo >= ctx.hoje ? m.prazo : null;
    let horizonte = (HORIZONTES as readonly string[]).includes(m?.horizonte) ? (m.horizonte as Horizonte) : null;
    if (!horizonte) { horizonte = horizontePorPrazo(prazo, ctx.hoje); avisos.push(`horizonte inválido em "${titulo}" → ${horizonte}`); }
    const { medida, ref } = normalizarMedidaRef(dono, m?.medida, m?.ref, { pesoAtual });
    if (dono === 'airton' && medida.tipo === 'valor') {
      if (++valorAirton > 1) { medida.tipo = 'habito'; avisos.push(`mais de uma meta de valor do AIrton: "${titulo}" virou hábito`); }
    }
    const demanda: Meta['demanda'] = {};
    const rm = num(m?.reais_mes), ms = num(m?.minutos_semana);
    if (dono === 'airton' && rm !== null && rm > 0) demanda.reais_mes = Math.round(rm);
    if (ms !== null && ms > 0) demanda.minutos_semana = Math.min(Math.round(ms), 3000);
    metas.push({ horizonte, dono, titulo, medida, prazo, cadencia: texto(m?.cadencia, 40), demanda, ref });
    if (metas.length >= 10) break;
  }

  // Primeiro passo da semana (dono válido; D1 vale também aqui).
  const pp = saida?.primeiro_passo;
  let ppDono = donoPorTexto(pp?.dono) ?? 'iara';
  if (soIara) ppDono = 'iara';
  const primeiro_passo: PrimeiroPasso = {
    titulo: texto(pp?.titulo, 120) ?? `Dar o primeiro passo em "${ctx.titulo}"`, dono: ppDono, detalhe: texto(pp?.detalhe, 300),
  };

  // ≥ 1 meta por horizonte: completa o que faltou com marcos da IARA.
  const completar = (h: Horizonte, titulo: string, prazo: string | null) => {
    if (metas.some((m) => m.horizonte === h)) return;
    avisos.push(`faltava meta de ${h}: marco da iara`);
    metas.push({ horizonte: h, dono: 'iara', titulo: titulo.slice(0, 120), medida: { tipo: 'marco' }, prazo, cadencia: null, demanda: {}, ref: null });
  };
  const fimLongo = ctx.alvo.data ?? addDias(ctx.hoje, 730);
  const longoDias = diasEntre(ctx.hoje, fimLongo);
  completar('curto', primeiro_passo.titulo, addDias(ctx.hoje, 7));
  completar('medio', `Marco do meio do caminho: ${ctx.titulo}`.slice(0, 120), addDias(ctx.hoje, Math.max(Math.min(Math.round(longoDias / 2), 365), 60)));
  completar('longo', `Concluir: ${ctx.titulo}`.slice(0, 120), fimLongo);
  const ordem = { curto: 0, medio: 1, longo: 2 };
  metas.sort((a, b) => ordem[a.horizonte] - ordem[b.horizonte]);
  return { metas, primeiro_passo, avisos };
}

/** Texto para fala: sem markdown, sem quebra de linha. */
export const limparFala = (s: string) => s.replace(/[*_#`>~\[\]]+/g, '').replace(/\s+/g, ' ').trim();

/** Fala do rascunho: até 2 frases, conclusão primeiro, no máximo 1 pergunta. */
export function falaRascunho(titulo: string, nMetas: number, viab: { cabe: boolean } | null): string {
  const t = limparFala(titulo).replace(/"/g, '');
  const v = viab ? (viab.cabe ? ', e pela sua poupança de hoje cabe' : ', mas pela sua poupança de hoje não cabe sem ajuste') : '';
  return `Montei o rascunho "${t}" com ${nMetas} metas do curto ao longo prazo${v}. Posso ativar?`;
}

/** Viabilidade sem IA: aporte mensal das metas do AIrton vs. folga da poupança (poupanca_base - aporte já comprometido). */
export function viabilidade(metas: Meta[], fin: { poupanca_base?: number | null; aporte_total_metas?: number | null } | null) {
  const reais = metas.filter((m) => m.dono === 'airton').reduce((s, m) => s + (m.demanda.reais_mes ?? 0), 0);
  const base = num(fin?.poupanca_base);
  if (!reais || base === null) return null;
  const folga = base - (num(fin?.aporte_total_metas) ?? 0);
  return { reais_mes_necessarios: reais, folga_mes: Math.round(folga), cabe: reais <= folga };
}
