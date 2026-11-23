// IARA · lista de mercado (pedido do Leo, 23/11): estima o preço dos itens que ainda não têm preço.
// POST {action:'estimar'} (usuário logado): pega os itens abertos sem preço (até 40), pede ao Haiku o preço médio por
//   unidade em supermercado de São Paulo e grava em core.mercado (preco_fonte 'ia') e em core.mercado_precos, que é a
//   memória: o mesmo item não volta para a IA. Preço corrigido pelo Leo ('leo') nunca é sobrescrito.
// Custo: 1 chamada Haiku (effort low, JSON) por lote, ~US$ 0,0003. Feature `mercado-estimar`, chave IARA_ANTHROPIC_KEY_MERCADO.
import { authenticate, CORS, fecharRun, iniciarRun, json, sql } from './_shared/common.ts';
import { anthropicJson, MODELS } from './_shared/ai.ts';

type Item = { id: number; nome: string; quantidade: string; unidade: string };
type Estimativa = { i: number; preco_unit: number | null };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    precos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { i: { type: 'integer' }, preco_unit: { type: ['number', 'null'] } },
        required: ['i', 'preco_unit'],
      },
    },
  },
  required: ['precos'],
};

const SYSTEM = `Você estima preços de supermercado no Brasil para uma lista de compras.
Para cada item, devolva o preço médio em reais por UMA unidade da unidade indicada, num supermercado comum de São Paulo (não atacado, não gourmet), em valores atuais.
- un = uma unidade do jeito que o item costuma ser vendido (1 caixa de leite de 1 L, 1 pacote de café de 500 g, 1 detergente).
- kg, g, L, ml = preço por 1 kg, 1 g, 1 L ou 1 ml. pct = 1 pacote; cx = 1 caixa; dz = 1 dúzia.
- Marca citada: use o preço dela. Sem marca: marca de preço médio.
- Item que não é de supermercado ou impossível de estimar: preco_unit null.
Responda só com o JSON pedido, um objeto por item, usando o índice i recebido.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'user') return json(400, { error: 'Só pelo app.' });
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'estimar') return json(400, { error: 'Ação desconhecida.' });
  const userId = caller.userId as string;

  const itens = await sql<Item[]>`select id, nome, quantidade::text, unidade from core.mercado
    where user_id = ${userId} and arquivado_em is null and preco_unit is null order by criado_em limit 40`;
  if (!itens.length) return json(200, { ok: true, estimados: 0 });

  // Memória primeiro: preço já conhecido para o item (de outra vez) não vai para a IA.
  const conhecidos = await sql<{ id: number; preco: string; fonte: string }[]>`
    select m.id, p.preco::text, p.fonte from core.mercado m join core.mercado_precos p
      on p.user_id = m.user_id and p.chave = core.mercado_chave(m.nome, m.unidade)
     where m.id = any(${itens.map((i) => i.id)})`;
  for (const k of conhecidos) {
    await sql`update core.mercado set preco_unit = ${k.preco}, preco_fonte = ${k.fonte === 'leo' ? 'leo' : 'historico'}
      where id = ${k.id} and preco_unit is null`;
  }
  const faltam = itens.filter((i) => !conhecidos.some((k) => k.id === i.id));
  if (!faltam.length) return json(200, { ok: true, estimados: 0, memoria: conhecidos.length });

  const run = await iniciarRun('iara', userId, 'mercado_estimar', { itens: faltam.length });
  try {
    const lista = faltam.map((it, i) => `${i}. ${it.nome} (${it.unidade})`).join('\n');
    const r = await anthropicJson({
      model: MODELS.fast, max_tokens: 1500, system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `Itens:\n${lista}` }],
    }, { run, feature: 'mercado-estimar', papel: 'worker', chave: 'mercado' }) as { precos?: Estimativa[] };

    let n = 0;
    for (const e of r.precos ?? []) {
      const it = faltam[e.i];
      if (!it || typeof e.preco_unit !== 'number' || !Number.isFinite(e.preco_unit) || e.preco_unit < 0 || e.preco_unit > 5000) continue;
      const preco = Math.round(e.preco_unit * 100) / 100;
      await sql`update core.mercado set preco_unit = ${preco}, preco_fonte = 'ia' where id = ${it.id} and preco_unit is null`;
      await sql`insert into core.mercado_precos (user_id, chave, preco, fonte)
        values (${userId}, core.mercado_chave(${it.nome}, ${it.unidade}), ${preco}, 'ia')
        on conflict (user_id, chave) do update set preco = excluded.preco, atualizado_em = now()
        where core.mercado_precos.fonte = 'ia'`;
      n++;
    }
    await fecharRun(run, 'ok', { output: { pedidos: faltam.length, estimados: n } });
    return json(200, { ok: true, estimados: n, memoria: conhecidos.length });
  } catch (e) {
    await fecharRun(run, 'erro', { erro: String((e as Error).message ?? e).slice(0, 300) }).catch(() => {});
    return json(200, { ok: false, error: 'Não consegui estimar os preços agora.' });
  }
});
