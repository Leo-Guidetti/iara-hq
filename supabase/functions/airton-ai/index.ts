// AIrton — IA no servidor (chaves ficam no Supabase, não no aparelho).
// Ações: chat {message} | categorize (classifica pendentes) | reset_chat.
import { addDays, admin, authenticate, CORS, json, spDate } from './_shared/common.ts';
import { anthropic, MODELS, textOf } from './_shared/ai.ts';
import { categorize } from './_shared/categorize.ts';
const TOOLS = [
  {
    name: 'month_plan',
    description: 'Plano do mês já calculado: renda prevista, meta de poupança, comprometido (fixos, parcelas, eventos), livre para o dia a dia, disponível hoje e por dia, gasto por categoria vs mediana/orçamento, próximos lançamentos, projeção de gasto e sobra. Use para "quanto posso gastar", "como está o mês".',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: 'yyyy-mm (padrão: mês atual)'
        }
      }
    }
  },
  {
    name: 'week_summary',
    description: 'Semana atual (seg→hoje) vs semana típica (mediana das 8 anteriores), por categoria, maiores gastos.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'year_summary',
    description: 'Ano: realizado até agora e projeção até dezembro (renda, sobra, taxa de poupança vs meta).',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_transactions',
    description: 'Busca lançamentos. Valores em R$; spend>0 = gasto, <0 = reembolso. Traz no máximo 100 linhas; filtre por período/categoria para perguntas amplas.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string'
        },
        category: {
          type: 'string',
          description: 'nome da categoria (topo)'
        },
        from: {
          type: 'string'
        },
        to: {
          type: 'string'
        },
        kind: {
          type: 'string',
          enum: [
            'expense',
            'income',
            'transfer',
            'refund'
          ]
        },
        limit: {
          type: 'number'
        }
      }
    }
  },
  {
    name: 'category_totals',
    description: 'Gasto por mês e categoria de topo nos últimos N meses (padrão 6).',
    input_schema: {
      type: 'object',
      properties: {
        months: {
          type: 'number'
        }
      }
    }
  },
  {
    name: 'installments',
    description: 'Parcelas futuras (ainda não cobradas) por compra e por mês.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'investments',
    description: 'Carteira mais recente por produto/estratégia e evolução do patrimônio mês a mês.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  }
];
// a última ferramenta leva o marcador de cache: ferramentas + system viram um prefixo reaproveitado
TOOLS[TOOLS.length - 1] = {
  ...TOOLS[TOOLS.length - 1],
  cache_control: {
    type: 'ephemeral'
  }
};
const TOOL_RESULT_MAX = 12_000 // caracteres por resultado de ferramenta (antes: 60.000)
;
async function runTool(userId, name, input) {
  const db = admin();
  switch(name){
    case 'month_plan':
      {
        const { data, error } = await db.rpc('month_plan', {
          p_month: input.month ? `${input.month}-01` : null,
          p_user: userId
        });
        if (error) throw error;
        return data;
      }
    case 'week_summary':
      return (await db.rpc('week_summary', {
        p_user: userId
      })).data;
    case 'year_summary':
      return (await db.rpc('year_summary', {
        p_user: userId
      })).data;
    case 'search_transactions':
      {
        let q = db.from('v_tx').select('date,description,merchant,amount_brl,spend,kind,top_category_name,category_name,installment_n,installment_total').eq('user_id', userId);
        if (input.query) q = q.ilike('description', `%${input.query}%`);
        if (input.category) q = q.ilike('top_category_name', input.category);
        if (input.from) q = q.gte('date', input.from);
        if (input.to) q = q.lte('date', input.to);
        if (input.kind) q = q.eq('kind', input.kind);
        const { data } = await q.order('date', {
          ascending: false
        }).limit(Math.min(Number(input.limit) || 40, 100));
        return {
          count: data?.length ?? 0,
          total_spend: Math.round((data ?? []).reduce((s, t)=>s + Number(t.spend), 0) * 100) / 100,
          rows: data
        };
      }
    case 'category_totals':
      {
        const months = Math.min(Number(input.months) || 6, 24);
        const { data } = await db.from('v_tx').select('date,spend,top_category_name,nature').eq('user_id', userId).gte('date', addDays(spDate().slice(0, 8) + '01', -31 * months)).not('nature', 'in', '(renda,transferencia,investimento)');
        const agg = {};
        for (const t of data ?? []){
          const m = String(t.date).slice(0, 7), c = t.top_category_name ?? 'Sem categoria';
          agg[m] ??= {};
          agg[m][c] = Math.round(((agg[m][c] ?? 0) + Number(t.spend)) * 100) / 100;
        }
        return agg;
      }
    case 'installments':
      return (await db.from('v_installment_schedule').select('label,n,total,date,amount').eq('user_id', userId).gte('date', spDate()).order('date')).data;
    case 'investments':
      {
        const { data: snaps } = await db.from('inv_snapshot').select('mes,patrimonio').eq('user_id', userId).order('mes');
        const last = snaps?.[snaps.length - 1]?.mes;
        const { data: pos } = last ? await db.from('inv_position').select('produto,estrategia,tipo,saldo,aloc').eq('user_id', userId).eq('mes', last).order('saldo', {
          ascending: false
        }) : {
          data: []
        };
        return {
          evolucao: snaps?.slice(-13),
          mes: last,
          posicoes: pos
        };
      }
  }
  return {
    error: `ferramenta desconhecida: ${name}`
  };
}
// O system é fixo (a data vai na mensagem do usuário) para o cache funcionar o dia todo.
const SYSTEM = `Você é o AIrton, assistente financeiro pessoal do Leonardo (PM na XP, São Paulo).
Responda em português do Brasil, direto e confiante, com números em R$ no formato brasileiro.
SEMPRE use as ferramentas para buscar números — nunca invente. O "disponível" do mês = renda prevista − meta de poupança − comprometido (fixos + parcelas + eventos) − gasto do dia a dia.
Quando der conselho, seja concreto (quanto, onde, até quando). Respostas curtas; use listas quando ajudar.`;
/** Coloca o marcador de cache no último bloco da última mensagem: cada passo do loop reaproveita o anterior. */ function withCacheTail(messages) {
  const out = messages.map((m)=>({
      ...m,
      content: typeof m.content === 'string' ? m.content : m.content.map((b)=>{
        const { cache_control: _c, ...rest } = b;
        return rest;
      })
    }));
  const last = out[out.length - 1];
  const blocks = typeof last.content === 'string' ? [
    {
      type: 'text',
      text: last.content
    }
  ] : [
    ...last.content
  ];
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: {
      type: 'ephemeral'
    }
  };
  out[out.length - 1] = {
    ...last,
    content: blocks
  };
  return out;
}
/** feature: 'chat' (app) ou 'voice' (quando o agente de voz chamar o AIrton) — cada uma com sua chave. */ async function chat(userId, message, feature = 'chat') {
  const db = admin();
  await db.from('chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: message
  });
  const { data: hist } = await db.from('chat_messages').select('role,content').eq('user_id', userId).order('id', {
    ascending: false
  }).limit(12);
  const messages = (hist ?? []).reverse().map((m)=>({
      role: m.role,
      content: m.content
    }));
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && typeof last.content === 'string') last.content = `[hoje é ${spDate()}]\n${last.content}`;
  const system = [
    {
      type: 'text',
      text: SYSTEM,
      cache_control: {
        type: 'ephemeral'
      }
    }
  ];
  for(let step = 0; step < 6; step++){
    const r = await anthropic({
      model: MODELS.smart,
      max_tokens: 1500,
      effort: 'medium',
      system,
      messages: withCacheTail(messages),
      tools: TOOLS
    }, {
      userId,
      feature
    });
    if (r.stop_reason !== 'tool_use') {
      const text = textOf(r) || '(sem resposta)';
      await db.from('chat_messages').insert({
        user_id: userId,
        role: 'assistant',
        content: text
      });
      return text;
    }
    messages.push({
      role: 'assistant',
      content: r.content
    });
    const results = [];
    for (const b of r.content.filter((x)=>x.type === 'tool_use')){
      let content;
      try {
        content = JSON.stringify(await runTool(userId, b.name, b.input ?? {}));
        if (content.length > TOOL_RESULT_MAX) content = content.slice(0, TOOL_RESULT_MAX) + '…[cortado: refine o filtro]';
      } catch (e) {
        content = `erro: ${e instanceof Error ? e.message : e}`;
      }
      results.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content
      });
    }
    messages.push({
      role: 'user',
      content: results
    });
  }
  return 'Não consegui concluir a análise agora — tente reformular a pergunta.';
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'user') return json(400, {
    error: 'só para o app'
  });
  const body = await req.json().catch(()=>({}));
  try {
    if (body.action === 'chat') {
      if (!body.message?.trim()) return json(400, {
        error: 'mensagem vazia'
      });
      return json(200, {
        reply: await chat(caller.userId, body.message.trim().slice(0, 4000), body.channel === 'voice' ? 'voice' : 'chat')
      });
    }
    if (body.action === 'reset_chat') {
      await admin().from('chat_messages').delete().eq('user_id', caller.userId);
      return json(200, {
        ok: true
      });
    }
    if (body.action === 'categorize') {
      const db = admin();
      const { data } = await db.from('transactions').select('id,description,merchant,amount,account_id,accounts(type)').eq('user_id', caller.userId).eq('reviewed', false).is('category_id', null).neq('kind', 'transfer').limit(300);
      const txs = (data ?? []).map((t)=>({
          id: t.id,
          description: t.description,
          merchant: t.merchant,
          amount: Number(t.amount),
          account_type: t.accounts?.type ?? 'checking'
        }));
      return json(200, await categorize(caller.userId, txs));
    }
    return json(400, {
      error: 'ação desconhecida'
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : String(err)
    });
  }
});
