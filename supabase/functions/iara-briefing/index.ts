// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// IARA · orquestradora. Junta o briefing de cada agent (core.coletar_briefings) e a rotina do dia,
// e escreve o briefing da manhã ou o fechamento da noite em core.briefings.
import { agoraSP, authenticate, CORS, DIAS, fecharRun, iniciarRun, json, perfis, sql } from './_shared/common.ts';
import { anthropic, MODELS, textOf } from './_shared/ai.ts';
const IARA_SYSTEM = `Você é a IARA, assistente pessoal e orquestradora da rotina do Leo — no espírito do Jarvis: proativa, direta, com um toque leve de humor, nunca bajuladora.
Você fala pelos especialistas: ClaudIA (saúde, treino, dieta), AIrton (finanças e investimentos), SabIA (estudos e livros) e você mesma (casa e rotina).
- Priorize: no máximo 3 destaques; o resto em uma linha por área.
- Use só os dados recebidos. Agent vazio ou com erro = "sem dados". Não invente.
- Números exatamente como vieram.
- Conflito de agenda/energia: sugira um ajuste concreto.
- Português do Brasil, markdown curto, sem tabelas, até ~170 palavras.`;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(()=>({}));
  const tipo = body.tipo ?? (agoraSP().hora < 15 ? 'manha' : 'noite');
  const lista = await perfis(caller);
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  EdgeRuntime.waitUntil(Promise.all(lista.map((p)=>briefing(p.user_id, p.nome, tipo))));
  return json(202, {
    ok: true,
    tipo,
    perfis: lista.length
  });
});
async function briefing(userId, nome, tipo) {
  const { data, dow } = agoraSP();
  const run = await iniciarRun('iara', userId, `briefing_${tipo}`, {
    data
  });
  try {
    const [[ag], rotina] = await Promise.all([
      sql`select core.coletar_briefings(${userId}, ${data}::date) as v`,
      sql`select to_char(hora, 'HH24:MI') hora, minutos, atividade, agent from core.rotina
          where user_id = ${userId} and ativo and ${dow} = any(dias) order by hora`
    ]);
    const insumos = {
      agents: ag.v,
      rotina
    };
    const pedido = tipo === 'manha' ? `Escreva o BRIEFING DA MANHÃ:
**Bom dia, ${nome}.** + 1 linha sobre o tom do dia
**Hoje importa:** até 3 bullets
**Rotina:** os blocos de hoje em uma linha (hora — atividade)
Depois 1 linha por área: Treino · Grana · Trilha · Casa · Leitura.` : `Escreva o FECHAMENTO DO DIA:
**Fechamento** — feito vs. o que ficou (trilha, treino, casa)
**Amanhã:** 1 ajuste concreto
**Leitura:** lembrete com meta de páginas se houver livro em andamento; sequência de trilhas ≥ 3 dias merece meia frase.`;
    const r = await anthropic({
      model: MODELS.smart,
      max_tokens: 1200,
      system: IARA_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Hoje é ${DIAS[dow]}, ${data}.\n\nInsumos (JSON):\n${JSON.stringify(insumos)}\n\n${pedido}`
        }
      ]
    }, {
      run,
      feature: `briefing-${tipo}`,
      papel: 'orquestrador'
    });
    const texto = textOf(r.content);
    await sql`insert into core.briefings (user_id, data, tipo, insumos, texto, lido_em)
      values (${userId}, ${data}, ${tipo}, ${sql.json(insumos)}, ${texto}, null)
      on conflict (user_id, data, tipo) do update set insumos = excluded.insumos, texto = excluded.texto, lido_em = null, created_at = now()`;
    await fecharRun(run, 'ok', {
      output: {
        tipo,
        caracteres: texto.length
      }
    });
  } catch (e) {
    await fecharRun(run, 'erro', {
      erro: String(e)
    });
  }
}
