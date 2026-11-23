// IARA · lista de mercado (pedido do Leo, 23/11). Usuário logado. Uma chamada Haiku por pedido (effort low, JSON schema).
// POST {action:'adicionar', texto}: lê texto livre ("2 kg de arroz, leite, 1 dúzia de ovos") e devolve cada item com
//   quantidade, unidade, corredor e preço médio (com faixa mín–máx) em supermercado de São Paulo. Grava por
//   core.mercado_incluir, que soma item repetido e prefere a memória de preço (o preço corrigido pelo Leo vale mais).
// POST {action:'estimar'}: itens abertos sem preço ou sem corredor (ex.: os que entraram pela voz) -> mesma estimativa.
// Custo: ~US$ 0,0003 a 0,001 por chamada. Feature `mercado-estimar`, chave IARA_ANTHROPIC_KEY_MERCADO (reserva ANTHROPIC_API_KEY).
import { authenticate, CORS, fecharRun, iniciarRun, json, sql } from './_shared/common.ts';
import { anthropicJson, MODELS } from './_shared/ai.ts';

const CATEGORIAS = ['Hortifruti', 'Padaria', 'Açougue e peixaria', 'Frios e laticínios', 'Mercearia', 'Bebidas', 'Congelados', 'Limpeza', 'Higiene', 'Pet', 'Outros'];
const UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz'];

type Lido = { nome: string; quantidade: number; unidade: string; categoria: string; preco_unit: number | null; preco_min: number | null; preco_max: number | null };
type Aberto = { id: number; nome: string; quantidade: string; unidade: string };

const ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nome: { type: 'string' },
    quantidade: { type: 'number' },
    unidade: { type: 'string', enum: UNIDADES },
    categoria: { type: 'string', enum: CATEGORIAS },
    preco_unit: { type: ['number', 'null'] },
    preco_min: { type: ['number', 'null'] },
    preco_max: { type: ['number', 'null'] },
  },
  required: ['nome', 'quantidade', 'unidade', 'categoria', 'preco_unit', 'preco_min', 'preco_max'],
};
const SCHEMA = { type: 'object', additionalProperties: false, properties: { itens: { type: 'array', items: ITEM } }, required: ['itens'] };

const SYSTEM = `Você organiza a lista de mercado do Leo, em São Paulo, e estima quanto ele vai gastar.
Para cada item:
- nome: curto, com inicial maiúscula, sem quantidade ("Arroz branco", "Leite integral", "Ovos"). Mantenha a marca se ele citar.
- quantidade e unidade: o que ele pediu. Sem quantidade = 1. Unidades: un, kg, g, L, ml, pct (pacote), cx (caixa), dz (dúzia).
  "1 dúzia de ovos" = 1 dz; "6 ovos" = 6 un; "2 kg de arroz" = 2 kg; "leite" = 1 un (1 caixa de 1 L).
- categoria: o corredor do supermercado, da lista dada.
- preco_unit: preço médio em reais por UMA unidade da unidade escolhida, em supermercado comum de São Paulo (nem atacado, nem gourmet), em valores atuais.
  un = como o item costuma ser vendido (1 caixa de leite de 1 L, 1 detergente de 500 ml). Marca citada: preço dela; sem marca: marca de preço médio.
- preco_min e preco_max: faixa realista entre mercados mais baratos e mais caros, por unidade.
- Item que não é de supermercado ou impossível de estimar: preços null.
Responda só com o JSON pedido.`;

const num = (v: unknown, max = 5000) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'user') return json(400, { error: 'Só pelo app.' });
  const userId = caller.userId as string;
  const body = await req.json().catch(() => ({}));

  if (body.action === 'adicionar') {
    const texto = String(body.texto ?? '').trim().slice(0, 600);
    if (!texto) return json(400, { error: 'Escreva o que precisa comprar.' });
    const run = await iniciarRun('iara', userId, 'mercado_adicionar', { caracteres: texto.length });
    try {
      const lidos = await ler(`Lista do Leo (texto livre):\n${texto}`, run);
      const feitos: unknown[] = [];
      for (const it of lidos.slice(0, 30)) {
        const [r] = await sql`select core.mercado_incluir(${userId}::uuid, ${it.nome.slice(0, 120)}, ${num(it.quantidade, 9999) || 1}, ${it.unidade},
          ${it.categoria}, ${num(it.preco_unit)}, ${num(it.preco_min)}, ${num(it.preco_max)}) as v`;
        feitos.push(r.v);
      }
      await fecharRun(run, 'ok', { output: { itens: feitos.length } });
      return json(200, { ok: true, itens: feitos });
    } catch (e) {
      await fecharRun(run, 'erro', { erro: String((e as Error).message ?? e).slice(0, 300) }).catch(() => {});
      return json(200, { ok: false, error: 'Não consegui ler a lista agora.' });
    }
  }

  if (body.action !== 'estimar') return json(400, { error: 'Ação desconhecida.' });
  const abertos = await sql<Aberto[]>`select id, nome, quantidade::text, unidade from core.mercado
    where user_id = ${userId} and arquivado_em is null and (preco_unit is null or categoria is null) order by criado_em limit 40`;
  if (!abertos.length) return json(200, { ok: true, estimados: 0 });

  const run = await iniciarRun('iara', userId, 'mercado_estimar', { itens: abertos.length });
  try {
    const lista = abertos.map((a) => `- ${a.nome} (${a.quantidade} ${a.unidade})`).join('\n');
    const lidos = await ler(`Itens já na lista. Mantenha nome, quantidade e unidade e devolva na mesma ordem:\n${lista}`, run);
    let n = 0;
    for (let i = 0; i < abertos.length; i++) {
      const a = abertos[i], it = lidos[i];
      if (!it) continue;
      const cat = CATEGORIAS.includes(it.categoria) ? it.categoria : 'Outros';
      const p = num(it.preco_unit), mn = num(it.preco_min) ?? p, mx = num(it.preco_max) ?? p;
      await sql`update core.mercado set categoria = coalesce(categoria, ${cat}),
          preco_unit = coalesce(preco_unit, ${p}), preco_min = coalesce(preco_min, ${mn}), preco_max = coalesce(preco_max, ${mx}),
          preco_fonte = coalesce(preco_fonte, case when ${p}::numeric is null then null else 'ia' end)
        where id = ${a.id}`;
      if (p != null) {
        await sql`insert into core.mercado_precos (user_id, chave, preco, fonte, categoria, preco_min, preco_max)
          values (${userId}, core.mercado_chave(${a.nome}, ${a.unidade}), ${p}, 'ia', ${cat}, ${mn}, ${mx})
          on conflict (user_id, chave) do nothing`;
      }
      n++;
    }
    await fecharRun(run, 'ok', { output: { pedidos: abertos.length, estimados: n } });
    return json(200, { ok: true, estimados: n });
  } catch (e) {
    await fecharRun(run, 'erro', { erro: String((e as Error).message ?? e).slice(0, 300) }).catch(() => {});
    return json(200, { ok: false, error: 'Não consegui estimar os preços agora.' });
  }
});

async function ler(pedido: string, run: unknown): Promise<Lido[]> {
  const r = await anthropicJson({
    model: MODELS.fast, max_tokens: 3000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Corredores: ${CATEGORIAS.join(', ')}.\n\n${pedido}` }],
  }, { run, feature: 'mercado-estimar', papel: 'worker', chave: 'mercado' }) as { itens?: Lido[] };
  return (r.itens ?? []).filter((i) => i && typeof i.nome === 'string' && i.nome.trim());
}
