// SabIA · plano de prática semanal (UX-17). Lógica pura (sem banco, sem rede): testável com `deno test`.
// Domingo, depois do recap: para cada habilidade ativa sem plano na semana, 1 chamada `fast` (Haiku, effort low, structured outputs).

export type Habilidade = {
  id: number; nome: string; tipo: string; nivel: string | null; objetivo: string | null; curriculo: unknown;
  alvo: number | null; minutos_ultima_semana: number; dias_ultima_semana: number; notas: string[];
};
export type Sessao = { dia: string; minutos: number; foco: string; como: string };
export type Plano = { resumo: string; sessoes: Sessao[]; dica: string };

export const DIAS_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
export const MAX_HABILIDADES = 4; // o SQL (hobby_pendentes) também limita a 4
export const MAX_TOKENS_HOBBY = 700;

const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const TXT = { type: 'string' };
export const HOBBY_SCHEMA = obj({
  resumo: TXT,
  sessoes: { type: 'array', items: obj({ dia: { type: 'string', enum: DIAS_SEMANA }, minutos: { type: 'integer' }, foco: TXT, como: TXT }) },
  dica: TXT,
});

export const HOBBY_SYSTEM = `Você é a SabIA, treinadora de prática do Leo. Monte o plano de prática da próxima semana para UMA habilidade: poucas sessões curtas e realistas, progressão simples, foco claro em cada sessão.
- A soma dos minutos das sessões deve ficar perto da meta semanal (se não houver meta, 2 a 4 sessões de 15 a 30 min).
- Considere o que ele praticou na semana que passou: se ficou abaixo da meta, simplifique; se bateu, avance um passo.
- Sessões em dias diferentes. "como" é uma instrução prática em 1 frase. Nada de listas longas, nada de inventar material que ele não citou.`;

export function montarPromptHobby(h: Habilidade, data: string): string {
  const alvo = h.alvo ? `${h.alvo} min por semana` : 'sem meta semanal definida';
  return `Hoje é domingo, ${data}. Habilidade: ${h.nome} (${h.tipo}).
Nível: ${h.nivel ?? 'não informado'}. Objetivo: ${h.objetivo ?? 'não informado'}.${h.curriculo ? `\nCurrículo: ${JSON.stringify(h.curriculo).slice(0, 600)}` : ''}
Meta: ${alvo}. Semana que passou: ${h.minutos_ultima_semana} min em ${h.dias_ultima_semana} dia(s).${h.notas.length ? `\nNotas recentes: ${h.notas.join(' | ')}` : ''}
Responda no formato JSON pedido, de 2 a 5 sessões.`;
}

/** Saída do modelo (qualquer lixo) -> plano seguro (sessões válidas, minutos 5..120) + o payload de hobby_plano_gravar. */
export function normalizarPlano(bruto: unknown): { resumo: string; minutos: number; corpo: string } {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, any>;
  const sessoes: Sessao[] = (Array.isArray(b.sessoes) ? b.sessoes : []).filter((s: any) => s && typeof s.foco === 'string' && s.foco.trim()).slice(0, 7).map((s: any) => ({
    dia: DIAS_SEMANA.includes(s.dia) ? s.dia : 'segunda',
    minutos: Math.min(120, Math.max(5, Math.round(Number(s.minutos) || 15))),
    foco: String(s.foco).trim().slice(0, 120), como: String(s.como ?? '').trim().slice(0, 240),
  }));
  if (!sessoes.length) throw new Error('Plano de prática vazio');
  const minutos = sessoes.reduce((t, s) => t + s.minutos, 0);
  const resumo = typeof b.resumo === 'string' ? b.resumo.trim().slice(0, 400) : '';
  const dica = typeof b.dica === 'string' ? b.dica.trim().slice(0, 300) : '';
  const corpo = [`**Plano da semana (${minutos} min)**`, ...sessoes.map((s) => `- **${s.dia}** · ${s.minutos} min · ${s.foco}${s.como ? ` — ${s.como}` : ''}`), dica ? `\n**Dica:** ${dica}` : '']
    .filter(Boolean).join('\n');
  return { resumo, minutos, corpo };
}

/** Haiku 5.5: US$ 0,10 entrada / 0,50 saída por MTok; ~3,5 caracteres por token. Pior caso: saída inteira no max_tokens. */
export function estimarHobbyUsd(habilidades: number, systemChars: number, promptChars: number, saidaTokens = MAX_TOKENS_HOBBY): number {
  const n = Math.min(habilidades, MAX_HABILIDADES);
  return n * (((systemChars + promptChars) / 3.5) * 0.10 + saidaTokens * 0.50) / 1e6;
}
