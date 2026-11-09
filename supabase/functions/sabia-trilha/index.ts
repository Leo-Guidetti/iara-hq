// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// SabIA · trilha do dia no padrão "planeja grande, executa pequeno".
//   1. Plano determinístico: minutos por tema pelos pesos (sem IA).
//   2. Workers, um por tema, em paralelo. Primeiro os feeds RSS das fontes (grátis) com o Haiku escolhendo
//      pelo índice; só se vierem menos de 2 candidatos, busca na web (Gemini → Haiku + web search, 2 buscas).
//      Toda URL vem de um feed ou de uma busca, nunca do modelo.
//   3. Orquestradora (Sonnet, sem ferramentas): escolhe e escreve a trilha a partir dos candidatos.
// Sábado = deep dive; domingo = recap (só a orquestradora, sem busca).
// Chamada pelo pg_cron (core_private.call_function) ou pelo app com { "force": true }.
import { agoraSP, authenticate, CORS, DIAS, fecharRun, iniciarRun, json, perfis, sql } from './_shared/common.ts';
import { anthropic, comBusca, extrairJson, geminiBusca, hasGemini, MODELS, normalizar, textOf } from './_shared/ai.ts';
const FORMATOS = new Set([
  'artigo',
  'newsletter',
  'podcast',
  'video',
  'paper',
  'recap',
  'livro'
]);
const SABIA_SYSTEM = `Você é a SabIA, curadora de conhecimento do Leo. Escolha pouco e bem: uma trilha curta que o deixa atualizado e mais afiado em IA, negócios de tecnologia e empreendedorismo, investimentos e política — nessa ordem de prioridade.
- Sinal acima de ruído: o que muda a forma de pensar ou de trabalhar.
- Fontes primárias primeiro (anúncio oficial, paper, documento, dado), depois boa análise.
- Tempo honesto (texto ~230 palavras/min; em áudio/vídeo indique o trecho).
- Nada de listas genéricas, patrocinado, clickbait ou paywall duro sem alternativa.
- Política: fatos, linhas editoriais diversas ao longo da semana, sem opinião.
- Investimentos: contexto e educação; nunca recomende comprar ou vender ativo.
- Nunca invente URL.`;
const WORKER_SYSTEM = `Você é um worker de pesquisa da SabIA. Pesquise UM tema e devolva candidatos de leitura com evidência. Use a busca na web. Só cite URLs de páginas que apareceram na busca, copiadas exatamente. Não escreva análise longa: só os candidatos no formato pedido.`;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(()=>({}));
  const lista = await perfis(caller);
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  EdgeRuntime.waitUntil(Promise.all(lista.map((p)=>gerar(p.user_id, p.config ?? {}, body.force === true))));
  return json(202, {
    ok: true,
    perfis: lista.length
  });
});
async function gerar(userId, config, force) {
  const { data, dow } = agoraSP();
  const tipo = dow === 6 ? 'deep_dive' : dow === 0 ? 'recap' : 'diaria';
  const minutos = Number(config.minutos_trilha ?? 25);
  const [existente] = await sql`select id from sabia.trilhas where user_id = ${userId} and data = ${data} and tipo = ${tipo}`;
  if (existente && !force) return;
  const run = await iniciarRun('sabia', userId, `trilha_${tipo}`, {
    data,
    minutos,
    force
  });
  try {
    const ctx = await contexto(userId);
    const r = tipo === 'recap' ? await recap(run, ctx, data) : await curadoria(run, ctx, tipo, minutos, data, dow, String(config.contexto ?? ''));
    const total = r.itens.reduce((s, i)=>s + i.minutos, 0);
    await sql.begin(async (tx)=>{
      if (existente) await tx`delete from sabia.trilhas where id = ${existente.id}`;
      const [t] = await tx`insert into sabia.trilhas (user_id, data, tipo, minutos_total, resumo, run_id)
        values (${userId}, ${data}, ${tipo}, ${total}, ${r.resumo ?? null}, ${run.id}) returning id`;
      for (const [i, it] of r.itens.entries()){
        await tx`insert into sabia.itens (trilha_id, user_id, ordem, tema, titulo, fonte, url, formato, idioma, minutos, por_que, takeaway, corpo)
          values (${t.id}, ${userId}, ${i + 1}, ${it.tema}, ${it.titulo}, ${it.fonte ?? null}, ${it.url ?? null}, ${it.formato},
            ${it.idioma === 'pt' || it.idioma === 'en' ? it.idioma : null}, ${it.minutos}, ${it.por_que ?? null}, ${it.takeaway ?? null}, ${it.corpo ?? null})`;
      }
    });
    await fecharRun(run, 'ok', {
      output: {
        tipo,
        itens: r.itens.length,
        minutos: total,
        ...r.stats
      }
    });
  } catch (e) {
    await fecharRun(run, 'erro', {
      erro: String(e),
      descartado: true
    });
  }
}
async function contexto(userId) {
  const [temas, fontes, recentes, semana, livros] = await Promise.all([
    sql`select slug, nome, prioridade, peso::float, descricao from sabia.temas where ativo order by prioridade`,
    sql`select dominio, nome, tema, paywall, idioma, rss_url from sabia.fontes`,
    sql`select url, titulo, tema, fonte, reacao from sabia.itens where user_id = ${userId} and created_at > now() - interval '30 days'`,
    sql`select titulo, tema, status, reacao, takeaway from sabia.itens where user_id = ${userId} and created_at > now() - interval '7 days'`,
    sql`select titulo, autor, status, pagina_atual, paginas from sabia.livros where user_id = ${userId}`
  ]);
  return {
    temas,
    fontes,
    semana,
    livros,
    urlsRecentes: new Set(recentes.map((i)=>i.url).filter(Boolean).map((u)=>normalizar(u))),
    gostou: recentes.filter((i)=>i.reacao === 1).map((i)=>`${i.titulo} (${i.fonte})`),
    naoGostou: recentes.filter((i)=>i.reacao === -1).map((i)=>`${i.titulo} (${i.fonte})`)
  };
}
/** Minutos por tema pelos pesos (maior resto), somando exatamente o total. */ function alocar(temas, total) {
  const base = temas.map((t)=>{
    const x = t.peso * total;
    return {
      slug: t.slug,
      min: Math.floor(x),
      frac: x - Math.floor(x)
    };
  });
  let resto = total - base.reduce((s, b)=>s + b.min, 0);
  [
    ...base
  ].sort((a, b)=>b.frac - a.frac).forEach((b)=>{
    if (resto-- > 0) b.min++;
  });
  return Object.fromEntries(base.map((b)=>[
      b.slug,
      b.min
    ]));
}
/**
 * Casa a URL que o modelo escreveu com uma página que de fato veio da busca.
 * URL exata vale; senão, mesma origem e o caminho mais parecido (o Gemini às vezes encurta o link).
 */ function casarUrl(url, fontes) {
  const u = normalizar(url);
  if (fontes.has(u)) return u;
  let alvo;
  try {
    alvo = new URL(u);
  } catch  {
    return null;
  }
  const partes = new Set(alvo.pathname.split(/[/\-_.]+/).filter((p)=>p.length > 2));
  let melhor = null, nota = 0;
  for (const f of fontes){
    let fu;
    try {
      fu = new URL(f);
    } catch  {
      continue;
    }
    if (fu.host.replace(/^www\./, '') !== alvo.host.replace(/^www\./, '')) continue;
    const n = fu.pathname.split(/[/\-_.]+/).filter((p)=>partes.has(p)).length;
    if (n > nota) {
      nota = n;
      melhor = f;
    }
  }
  return nota >= 2 ? melhor : null;
}
const limpar = (x)=>x?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();
/** Lê um feed RSS ou Atom e devolve os itens com data. Falha de rede ou XML estranho = lista vazia. */ async function lerFeed(f) {
  try {
    const r = await fetch(f.rss_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SabIA/1.0; leitor de RSS)'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return [];
    const xml = (await r.text()).slice(0, 800_000);
    const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
    return blocos.slice(0, 30).map((b)=>{
      const tag = (n)=>b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`))?.[1];
      const url = limpar(tag('link')) || b.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
      const quando = Date.parse(limpar(tag('pubDate') ?? tag('published') ?? tag('updated') ?? tag('dc:date')) ?? '');
      return {
        titulo: limpar(tag('title')) ?? '',
        url,
        quando,
        resumo: limpar(tag('description') ?? tag('summary'))?.slice(0, 280),
        fonte: f.nome,
        idioma: f.idioma,
        paywall: f.paywall
      };
    }).filter((i)=>i.titulo && /^https?:\/\//.test(i.url) && Number.isFinite(i.quando));
  } catch  {
    return [];
  }
}
/**
 * Worker: um tema.
 *   1. Feeds RSS das fontes do tema (custo zero) → o Haiku escolhe pelo índice, sem ferramentas.
 *   2. Se sobrarem menos de 2 candidatos: busca na web, Gemini primeiro e Haiku + web search (2 buscas) de reserva.
 */ async function worker(run, ctx, tema, minutosTema, recencia, horas, data) {
  const validar = (cands, fontes)=>(cands ?? []).filter((c)=>{
      if (!c?.url || !FORMATOS.has(c.formato)) return false;
      const u = fontes && fontes.size ? casarUrl(c.url, fontes) : normalizar(c.url);
      if (!u || ctx.urlsRecentes.has(u)) return false;
      c.url = u;
      c.minutos = Math.min(30, Math.max(1, Math.round(Number(c.minutos) || 5)));
      return true;
    });
  // 1) Feeds
  const feeds = ctx.fontes.filter((f)=>f.tema === tema.slug && f.rss_url);
  const desde = Date.now() - horas * 3_600_000;
  const itens = (await Promise.all(feeds.map((f)=>lerFeed(f)))).flat().filter((i)=>i.quando >= desde && !ctx.urlsRecentes.has(normalizar(i.url))).sort((a, b)=>b.quando - a.quando).slice(0, 30);
  if (itens.length >= 3) {
    const lista = itens.map((i, n)=>`[${n}] ${i.titulo} — ${i.fonte}${i.paywall ? ' [paywall]' : ''} (${new Date(i.quando).toISOString().slice(0, 10)})${i.resumo ? `\n    ${i.resumo}` : ''}`).join('\n');
    const prompt = `Hoje é ${data}. Tema: ${tema.nome}.
Escopo: ${tema.descricao}
A trilha terá ~${minutosTema} min deste tema.

Itens recentes dos feeds das fontes preferidas:
${lista}

Escolha de 2 a 4 itens, do mais relevante ao menos, que valem a leitura dentro do escopo. Se nenhum servir, devolva [].
Responda só dentro de <candidatos></candidatos>:
[{"i":0,"formato":"artigo|newsletter|podcast|video|paper","minutos":5,"resumo":"o que diz, em 1-2 frases factuais"}]`;
    try {
      const r = await anthropic({
        model: MODELS.fast,
        max_tokens: 1200,
        system: WORKER_SYSTEM,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        output_config: {
          effort: 'low'
        }
      }, {
        run,
        feature: 'trilha-worker',
        papel: 'worker'
      });
      const escolhas = extrairJson(textOf(r.content), 'candidatos') ?? [];
      const cands = escolhas.filter((e)=>itens[e.i]).map((e)=>{
        const it = itens[e.i];
        return {
          titulo: it.titulo,
          fonte: it.fonte,
          url: it.url,
          formato: e.formato,
          idioma: it.idioma,
          minutos: e.minutos,
          resumo: e.resumo ?? it.resumo,
          publicado: new Date(it.quando).toISOString().slice(0, 10)
        };
      });
      const ok = validar(cands, null);
      if (ok.length >= 2) return ok;
      console.warn(`[sabia] ${tema.slug}: feeds deram ${ok.length} candidato(s); indo para a busca`);
    } catch (e) {
      console.warn(`[sabia] ${tema.slug}: seleção pelos feeds falhou (${String(e).slice(0, 160)}); indo para a busca`);
    }
  }
  // 2) Busca na web (reserva)
  const fontesPref = ctx.fontes.filter((f)=>f.tema === tema.slug).map((f)=>`${f.nome} (${f.dominio})${f.paywall ? ' [paywall]' : ''}`).join('; ');
  const prompt = `Hoje é ${data}. Tema: ${tema.nome}.
Escopo: ${tema.descricao}
Recência: ${recencia}. A trilha terá ~${minutosTema} min deste tema.
Fontes preferidas (não exclusivas): ${fontesPref}
Não repita: ${[
    ...ctx.urlsRecentes
  ].slice(0, 30).join(' ') || 'nada'}

Faça até 2 buscas e devolva de 3 a 4 candidatos, do mais relevante ao menos, dentro de <candidatos></candidatos>:
[{"titulo":"...","fonte":"...","url":"https://...","formato":"artigo|newsletter|podcast|video|paper","idioma":"pt|en","minutos":5,"publicado":"aaaa-mm-dd ou ?","resumo":"o que diz, em 1-2 frases factuais"}]`;
  if (hasGemini('trilha-search')) {
    try {
      const g = await geminiBusca({
        system: WORKER_SYSTEM,
        prompt,
        maxTokens: 2000
      }, {
        run,
        feature: 'trilha-search',
        papel: 'worker'
      });
      const ok = validar(extrairJson(g.text, 'candidatos'), g.urls);
      if (ok.length >= 2) return ok;
    } catch (e) {
      console.warn(`[sabia] ${tema.slug}: Gemini falhou (${String(e).slice(0, 160)}); usando o Claude`);
    }
  }
  const r = await comBusca({
    model: MODELS.fast,
    max_tokens: 1500,
    system: WORKER_SYSTEM,
    prompt,
    maxUses: 2
  }, {
    run,
    feature: 'trilha-worker',
    papel: 'worker'
  });
  return validar(extrairJson(r.text, 'candidatos'), r.urls);
}
async function curadoria(run, ctx, tipo, minutos, data, dow, perfil) {
  const orc = alocar(ctx.temas, minutos);
  const alvo = tipo === 'deep_dive' ? ctx.temas.filter((t)=>t.slug === 'ia' || t.slug === 'negocios') : ctx.temas;
  const recencia = (t)=>tipo === 'deep_dive' ? 'última semana; prefira peças longas (análise, ensaio, podcast, palestra)' : t.slug === 'ia' || t.slug === 'politica' ? 'últimas 48h' : 'últimos 7 dias';
  const horas = (t)=>tipo !== 'deep_dive' && (t.slug === 'ia' || t.slug === 'politica') ? 48 : 168;
  // Workers em paralelo; um tema que falhar não derruba a trilha.
  const res = await Promise.allSettled(alvo.map((t)=>worker(run, ctx, t, orc[t.slug], recencia(t), horas(t), data)));
  const porTema = {};
  const falhas = [];
  res.forEach((r, i)=>r.status === 'fulfilled' ? porTema[alvo[i].slug] = r.value : falhas.push(`${alvo[i].slug}: ${String(r.reason).slice(0, 120)}`));
  const nCands = Object.values(porTema).reduce((s, c)=>s + c.length, 0);
  if (nCands < 3) throw new Error(`Poucos candidatos (${nCands}). Falhas: ${falhas.join(' | ')}`);
  const candTxt = Object.entries(porTema).map(([slug, cs])=>`## ${slug} (~${orc[slug]} min)\n` + cs.map((c)=>`- ${c.titulo} | ${c.fonte ?? ''} | ${c.formato} | ${c.idioma ?? ''} | ${c.minutos} min | ${c.publicado ?? '?'} | ${c.url}\n  ${c.resumo ?? ''}`).join('\n')).join('\n\n');
  const pedido = tipo === 'deep_dive' ? `Hoje é sábado: monte o DEEP DIVE (~${minutos} min): 1 peça longa (~20 min) + 1 complemento curto (~5 min) com outro ângulo. Continuidade com a semana, sem repetir: ${ctx.semana.map((i)=>i.titulo).join(' | ') || 'nada registrado'}` : `Monte a trilha diária (${minutos} min, aceitável 20–30): 4 a 6 itens, pelo menos 1 por tema com candidatos; IA pode ter 2. Respeite o orçamento por tema.`;
  const prompt = `Hoje é ${DIAS[dow]}, ${data}. Quem é o Leo: ${perfil}

Candidatos pesquisados pelos workers (use SÓ estes, com a URL exata):
${candTxt}

${pedido}
Ele gostou de: ${ctx.gostou.slice(0, 10).join(' | ') || 'sem sinal ainda'}
Ele não gostou de: ${ctx.naoGostou.slice(0, 10).join(' | ') || 'sem sinal ainda'}

Para cada item: "por_que" liga ao contexto do Leo em 1 frase; "takeaway" é a ideia central em 1 frase.
Responda só com o JSON dentro de <trilha></trilha>:
{"resumo":"fio condutor do dia em 1 frase","itens":[{"tema":"ia","titulo":"...","fonte":"...","url":"https://...","formato":"artigo","idioma":"pt","minutos":5,"por_que":"...","takeaway":"..."}]}`;
  const r = await anthropic({
    model: MODELS.smart,
    max_tokens: 2500,
    system: SABIA_SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }, {
    run,
    feature: 'trilha-orquestrador',
    papel: 'orquestrador'
  });
  const saida = extrairJson(textOf(r.content), 'trilha');
  const validas = new Map(Object.entries(porTema).flatMap(([slug, cs])=>cs.map((c)=>[
        c.url,
        slug
      ])));
  const vistos = new Set();
  const itens = (saida.itens ?? []).filter((i)=>{
    const u = i.url ? normalizar(i.url) : '';
    if (!validas.has(u) || vistos.has(u) || !FORMATOS.has(i.formato)) return false;
    vistos.add(u);
    i.url = u;
    i.tema = validas.get(u);
    i.minutos = Math.min(30, Math.max(1, Math.round(Number(i.minutos) || 5)));
    return true;
  });
  if (itens.length < (tipo === 'deep_dive' ? 1 : 3)) throw new Error(`Poucos itens válidos (${itens.length})`);
  return {
    resumo: saida.resumo,
    itens,
    stats: {
      candidatos: nCands,
      escolhidos: itens.length,
      descartados: nCands - itens.length,
      falhas_workers: falhas
    }
  };
}
async function recap(run, ctx, data) {
  const lendo = ctx.livros.find((l)=>l.status === 'lendo') ?? ctx.livros.find((l)=>l.status === 'pausado');
  const fila = ctx.livros.filter((l)=>l.status === 'quero_ler').map((l)=>`${l.titulo} (${l.autor})`);
  const prompt = `Hoje é domingo, ${data}. Monte o RECAP da semana do Leo (~25 min).

Itens da semana (status, reação, takeaway):
${ctx.semana.map((i)=>`- [${i.tema}] ${i.titulo} — ${i.status}${i.reacao ? ` (reação ${i.reacao})` : ''}${i.takeaway ? ` — ${i.takeaway}` : ''}`).join('\n') || '- nada registrado'}

Livros: lendo/pausado = ${lendo ? `${lendo.titulo}, pág. ${lendo.pagina_atual ?? '?'}/${lendo.paginas ?? '?'}` : 'nenhum'}; fila = ${fila.join(', ') || 'vazia'}.

Gere 2 itens:
1) tema "recap", formato "recap", ~10 min: em "corpo" (markdown) as ideias mais importantes da semana conectadas, o que muda para o trabalho dele em produto/IA, e 3 perguntas de revisão com respostas no fim. Se a semana está vazia, diga isso em 1 linha e proponha o foco da próxima.
2) tema "livros", formato "livro", ~15 min: meta concreta de páginas no livro em andamento; se não houver, sugerir o próximo da fila e por quê. "corpo" com a meta e 1 pergunta para pensar.

Responda só com o JSON dentro de <trilha></trilha>:
{"resumo":"...","itens":[{"tema":"recap","titulo":"Recap da semana","formato":"recap","minutos":10,"por_que":"...","corpo":"..."},{"tema":"livros","titulo":"...","formato":"livro","minutos":15,"por_que":"...","corpo":"..."}]}`;
  const r = await anthropic({
    model: MODELS.smart,
    max_tokens: 3000,
    system: SABIA_SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }, {
    run,
    feature: 'trilha-recap',
    papel: 'orquestrador'
  });
  const saida = extrairJson(textOf(r.content), 'trilha');
  const itens = (saida.itens ?? []).filter((i)=>FORMATOS.has(i.formato)).map((i)=>({
      ...i,
      minutos: Math.min(30, Math.max(1, Math.round(Number(i.minutos) || 10)))
    }));
  if (!itens.length) throw new Error('Recap vazio');
  return {
    resumo: saida.resumo,
    itens,
    stats: {}
  };
}
