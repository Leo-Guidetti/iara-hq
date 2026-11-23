// deno test --allow-read supabase/functions/iara-comando/comando-lib.test.ts  (sem banco, sem IA, sem rede)
import { estimarRotaUsd, pedidoDesfazer, limparFala, montarSystem, montarUsuario, numerosDoTexto, processar, validarSlots, type AcaoInfo, type Acoes, type Contexto, type Deps, type Destino, type Intencao, type Turno } from './comando-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const CATALOGO: Intencao[] = JSON.parse(await Deno.readTextFile(new URL('./catalogo.fixture.json', import.meta.url)));
const CTX: Contexto = {
  itens: [{ id: 41, origem: 'iara', titulo: 'Trocar o filtro' }, { id: 42, origem: 'iara', titulo: 'Pagar o condomínio' }],
  trilha: [{ id: 7, titulo: 'Artigo sobre sono' }], semana: { id: 9, status: 'rascunho' },
  planos: [{ id: 3, titulo: 'Apartamento', status: 'ativo' }], lancamentos: [{ id: 'tx1', descricao: 'Mercado', valor: -120 }], categorias: [{ id: 'alimentacao', nome: 'Alimentação' }],
};
type Chamada = { destino: Destino; args: Record<string, unknown> };
/** Ações em memória que imitam as RPCs hub_acao_*: confirmar executa a ação GRAVADA; expirada não executa. */
function acoesFake(opts: { expirada?: boolean; resultado?: unknown } = {}) {
  const f = {
    criadas: [] as { intencao: string; args: Record<string, unknown>; pergunta: string }[], executadas: [] as number[], canceladas: [] as number[], desfeitas: 0,
    criar: async (intencao: string, args: Record<string, unknown>, pergunta: string): Promise<AcaoInfo> => {
      f.criadas.push({ intencao, args, pergunta });
      return { acao_id: 70 + f.criadas.length, status: 'pendente', expira_em: '2026-11-17T13:00:00Z' };
    },
    confirmar: async (id: number): Promise<AcaoInfo> => {
      const c = f.criadas[id - 71];
      if (opts.expirada || !c) return { acao_id: id, status: 'expirada', fala: 'Essa confirmação expirou, quer refazer?' };
      f.executadas.push(id);
      return { acao_id: id, status: 'executada', intencao: c.intencao, args: c.args, resultado: opts.resultado ?? 4, desfazer: { acao_id: id, ate: '2026-11-17T13:10:00Z' } };
    },
    cancelar: async (id: number): Promise<AcaoInfo> => { f.canceladas.push(id); return { acao_id: id, status: 'cancelada' }; },
    desfazerUltima: async () => { f.desfeitas++; return { ok: true, fala: 'Desfiz a leitura. Voltou para a página 120.' }; },
  } satisfies Acoes & Record<string, unknown>;
  return f;
}
function deps(rota: Record<string, unknown>, resultado: unknown = {}, turnos: Turno[] = []): Deps & { chamadas: Chamada[]; roteou: number; acoes: ReturnType<typeof acoesFake> } {
  const d = {
    catalogo: CATALOGO, turnos, contexto: CTX, hoje: '2026-11-17', chamadas: [] as Chamada[], roteou: 0, acoes: acoesFake(),
    rotear: async () => { d.roteou++; return { pergunta_esclarecimento: null, opcoes: [], ...rota, slots_json: JSON.stringify(rota.slots ?? {}) }; },
    chamar: async (destino: Destino, args: Record<string, unknown>) => { d.chamadas.push({ destino, args }); return resultado; },
  };
  return d;
}

Deno.test('(1) "li até a página 150" chama hub_leitura_registrar(p_pagina=150) sem abrir /aprender', async () => {
  const d = deps({ intencao: 'leitura.registrar', slots: { p_pagina: 150 }, confianca: 0.95 }, { fala: 'Anotei: página 150.' });
  const r = await processar('li até a página 150', d);
  eq(d.chamadas, [{ destino: { via: 'rpc', schema: null, nome: 'hub_leitura_registrar' }, args: { p_pagina: 150 } }], 'chamada');
  eq(r.fala, 'Anotei: página 150.', 'fala'); ok(r.pendente === null, 'sem pendente');
});

Deno.test('peso: número tem de aparecer no texto (nunca adivinhado)', async () => {
  const d = deps({ intencao: 'peso.registrar', slots: { p_kg: 82.4 }, confianca: 0.9 });
  const r = await processar('registra 82,4 quilos', d);
  eq(d.chamadas[0].args, { p_kg: 82.4 }, 'args'); eq(r.fala, 'Anotei 82,4 kg.', 'fala');
  const d2 = deps({ intencao: 'peso.registrar', slots: { p_kg: 80 }, confianca: 0.9 });
  const r2 = await processar('anota meu peso de hoje', d2);
  ok(d2.chamadas.length === 0 && r2.pendente?.tipo === 'pergunta', 'valor inventado vira pergunta');
});

Deno.test('compromisso (médio): executa e repete o entendido', async () => {
  const d = deps({ intencao: 'agenda.compromisso_salvar', slots: { p: { titulo: 'Jantar', data: '2026-11-19', inicio: '20:00', local: 'Bar X' } }, confianca: 0.9 }, 5);
  const r = await processar('jantar quinta às 20h no Bar X', d);
  eq(d.chamadas[0].args, { p: { titulo: 'Jantar', data: '2026-11-19', inicio: '20:00', local: 'Bar X' } }, 'args');
  eq(r.fala, 'Marquei "Jantar" quinta, 19/11 às 20h, Bar X.', 'fala');
});

Deno.test('compromisso sem data: pergunta, não executa', async () => {
  const d = deps({ intencao: 'agenda.compromisso_salvar', slots: { p: { titulo: 'Dentista' } }, confianca: 0.9 });
  const r = await processar('marca dentista', d);
  ok(d.chamadas.length === 0 && r.pendente?.tipo === 'pergunta', 'pergunta');
});

Deno.test('marcar item feito: id só vale se for candidato', async () => {
  const d = deps({ intencao: 'casa.item_status', slots: { p_id: 41, p_status: 'feito' }, confianca: 0.9 }, true);
  const r = await processar('o filtro já troquei', d);
  eq(d.chamadas[0].args, { p_id: 41, p_status: 'feito' }, 'args'); eq(r.fala, 'Marquei "Trocar o filtro" como feito.', 'fala');
  const d2 = deps({ intencao: 'casa.item_status', slots: { p_id: 999, p_status: 'adiado' }, confianca: 0.9 });
  const r2 = await processar('adia aquilo', d2);
  ok(d2.chamadas.length === 0 && r2.pendente?.tipo === 'pergunta', 'id inventado vira pergunta');
});

Deno.test('(2) "quanto posso gastar hoje?" vai ao airton-ai (chat) e a resposta é encurtada e arredondada', async () => {
  const d = deps({ intencao: 'financas.quanto_posso_gastar', slots: { pergunta: 'quanto posso gastar hoje?' }, confianca: 0.95 },
    { reply: '**Hoje você pode gastar R$ 187,60.** O disponível do mês é R$ 2.340,45. Segue a lista:\n- aluguel\n- mercado' });
  const r = await processar('quanto posso gastar hoje?', d);
  const c = d.chamadas[0];
  ok(c.destino.via === 'fn' && c.destino.funcao === 'airton-ai' && c.destino.acao === 'chat', 'destino airton-ai/chat');
  eq(r.fala, 'Hoje você pode gastar R$ 188. O disponível do mês é R$ 2.340.', 'fala curta, sem markdown, arredondada');
});

Deno.test('intenção "pergunta" de dinheiro e de planos mapeia para o especialista', async () => {
  const d = deps({ intencao: 'pergunta', slots: { dominio: 'dinheiro' }, confianca: 0.9 }, { reply: 'Sobram R$ 500.' });
  await processar('sobra quanto?', d);
  ok(d.chamadas[0].destino.via === 'fn', 'airton');
  const d2 = deps({ intencao: 'planos.status', slots: {}, confianca: 0.9 }, [{ titulo: 'Apartamento', status: 'ativo' }, { titulo: 'Carro', status: 'rascunho' }]);
  const r2 = await processar('como estão meus planos?', d2);
  eq(d2.chamadas[0].destino, { via: 'rpc', schema: null, nome: 'hub_planos' }, 'hub_planos');
  ok(r2.fala.startsWith('Você tem 2 planos, 1 ativo'), r2.fala);
});

Deno.test('(3) frase fora do catálogo devolve pergunta, não erro', async () => {
  const d = deps({ intencao: 'fora', slots: {}, confianca: 0.9 });
  const r = await processar('qual a capital da Mongólia?', d);
  ok(d.chamadas.length === 0, 'não executa'); ok(r.pendente?.tipo === 'pergunta', 'pendente pergunta'); ok(r.fala.includes('Posso anotar'), r.fala);
  const d2 = deps({ intencao: 'slug.inventado', slots: {}, confianca: 0.99 });
  const r2 = await processar('faz algo', d2);
  ok(r2.pendente?.tipo === 'pergunta' && d2.chamadas.length === 0, 'slug fora do catálogo vira pergunta');
});

Deno.test('ambiguidade: confiança baixa devolve a pergunta fechada do roteador com até 3 opções', async () => {
  const d = deps({ intencao: 'casa.item_status', slots: {}, confianca: 0.4, pergunta_esclarecimento: 'Qual item você adiou?', opcoes: ['Trocar o filtro', 'Pagar o condomínio', 'Outro', 'Quarta opção'] });
  const r = await processar('adia isso', d);
  ok(d.chamadas.length === 0, 'não executa'); eq(r.pendente?.opcoes, ['Trocar o filtro', 'Pagar o condomínio', 'Outro'], 'máx 3 opções');
  eq(r.fala, 'Qual item você adiou?', 'fala');
});

Deno.test('(1) risco alto (confirmar semana): NÃO executa; grava a ação pendente e devolve acao_id', async () => {
  const d = deps({ intencao: 'semana.confirmar', slots: { p_plano: 9 }, confianca: 0.95 });
  const r = await processar('confirma a semana', d);
  ok(d.chamadas.length === 0 && d.acoes.executadas.length === 0, 'não executou');
  eq(d.acoes.criadas, [{ intencao: 'semana.confirmar', args: { p_plano: 9 }, pergunta: 'Vou confirmar o plano da semana. Confirma?' }], 'ação gravada');
  eq(r.pendente, { tipo: 'confirmacao', intencao: 'semana.confirmar', slots: { p_plano: 9 }, pergunta: 'Vou confirmar o plano da semana. Confirma?', acao_id: 71, expira_em: '2026-11-17T13:00:00Z' }, 'pendente');
  // plano da semana único: completa o id sozinho
  const d2 = deps({ intencao: 'semana.confirmar', slots: {}, confianca: 0.95 });
  const r2 = await processar('fecha a semana', d2);
  eq((r2.pendente as any).slots, { p_plano: 9 }, 'id completado');
});

Deno.test('todo risco alto ou confirmacao "sim" do catálogo só grava pendente, nunca chama a RPC', async () => {
  const altos = CATALOGO.filter((c) => c.risco === 'alto' || c.confirmacao === 'sim');
  ok(altos.length >= 7, `catálogo tem ${altos.length} intenções de risco alto`);
  const slotsOk: Record<string, Record<string, unknown>> = {
    'semana.confirmar': { p_plano: 9 }, 'plano.confirmar': { p_id: 3 }, 'decisao.decidir': { p_id: 1, p_escolha: 'a' }, 'proposta.decidir': { p_id: 2, p_aceitar: true },
    'plano.salvar': { p: { titulo: 'X' } }, 'meta.salvar_plano': { p: { plano_id: 3, horizonte: 'curto', dono: 'iara', titulo: 'Y' } }, 'meta.salvar': { p: { name: 'Carro', target_amount: 80000 } },
  };
  for (const c of altos) {
    const d = deps({ intencao: c.slug, slots: slotsOk[c.slug] ?? {}, confianca: 0.95 });
    const r = await processar('faz isso, 80000', d);
    ok(d.chamadas.length === 0 && d.acoes.executadas.length === 0, `${c.slug} não executou`);
    ok(r.tela?.executou !== true, `${c.slug} executou=false`);
  }
});

Deno.test('(1) "sim" dentro dos 10 min executa a ação GRAVADA (status confirmada -> executada) e devolve desfazer', async () => {
  const d = deps({ intencao: 'semana.confirmar', slots: { p_plano: 9 }, confianca: 0.95 });
  const r1 = await processar('confirma a semana', d);
  const turnos: Turno[] = [{ papel: 'leo', texto: 'confirma a semana' }, { papel: 'iara', texto: r1.fala, pendente: r1.pendente, at: new Date().toISOString() }];
  const d2 = { ...deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, turnos), acoes: d.acoes };
  const r = await processar('sim', d2);
  eq(d.acoes.executadas, [71], 'executou a ação 71'); ok(d2.roteou === 0 && d2.chamadas.length === 0, 'sem IA e sem chamada direta');
  eq(r.fala, 'Confirmei a semana: 4 itens entraram no seu dia.', 'fala'); eq(r.desfazer, { acao_id: 71, ate: '2026-11-17T13:10:00Z' }, 'desfazer'); ok(r.pendente === null, 'sem pendente');
});

Deno.test('(3) "sim" depois dos 10 min (ação expirada) não executa nada', async () => {
  const pend = { tipo: 'confirmacao', intencao: 'semana.confirmar', slots: { p_plano: 9 }, pergunta: 'Vou confirmar. Confirma?', acao_id: 71 };
  const turnos: Turno[] = [{ papel: 'iara', texto: 'Vou confirmar. Confirma?', pendente: pend, at: new Date().toISOString() }];
  const d = deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, turnos);
  d.acoes = acoesFake({ expirada: true });
  const r = await processar('sim', d);
  ok(d.acoes.executadas.length === 0 && d.chamadas.length === 0 && d.roteou === 0, 'nada executou');
  eq(r.fala, 'Essa confirmação expirou, quer refazer?', 'fala'); ok(r.pendente === null, 'sem pendente');
});

Deno.test('"não" cancela a ação pendente; confirmação sem acao_id (legado) nunca executa', async () => {
  const pend = { tipo: 'confirmacao', intencao: 'semana.confirmar', slots: { p_plano: 9 }, pergunta: 'x', acao_id: 71 };
  const turnos: Turno[] = [{ papel: 'iara', texto: 'x', pendente: pend, at: new Date().toISOString() }];
  const d = deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, turnos);
  const r = await processar('não', d);
  eq(d.acoes.canceladas, [71], 'cancelou'); eq(r.fala, 'Certo, não fiz nada.', 'fala'); ok(r.pendente === null, 'sem pendente');
  const { acao_id: _, ...semId } = pend;
  const d2 = deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, [{ papel: 'iara', texto: 'x', pendente: semId, at: new Date().toISOString() }]);
  const r2 = await processar('sim', d2);
  ok(d2.acoes.executadas.length === 0 && r2.fala.includes('expirou'), 'sem acao_id não executa');
});

Deno.test('"desfaz" é reconhecido em código (sem IA) e desfaz a última ação', async () => {
  for (const f of ['desfaz', 'Desfaz isso', 'desfazer', 'volta atrás']) ok(pedidoDesfazer(f), f);
  ok(!pedidoDesfazer('desfaz o plano do apartamento') && !pedidoDesfazer('não'), 'só a frase curta');
  const d = deps({ intencao: 'fora', slots: {}, confianca: 1 });
  const r = await processar('desfaz', d);
  ok(d.acoes.desfeitas === 1 && d.roteou === 0, 'chamou desfazerUltima sem IA'); eq(r.fala, 'Desfiz a leitura. Voltou para a página 120.', 'fala');
});

Deno.test('risco baixo executa e devolve desfazer {acao_id, ate} quando o banco registra a ação', async () => {
  const d = deps({ intencao: 'leitura.registrar', slots: { p_pagina: 150 }, confianca: 0.95 },
    { acao_id: 12, status: 'executada', resultado: { fala: 'Anotei: página 150.' }, desfazer: { acao_id: 12, ate: '2026-11-17T13:10:00Z' } });
  const r = await processar('li até a página 150', d);
  eq(r.fala, 'Anotei: página 150.', 'fala'); eq(r.desfazer, { acao_id: 12, ate: '2026-11-17T13:10:00Z' }, 'desfazer');
  // o banco manda pendente (política única): vira confirmação, não execução
  const d2 = deps({ intencao: 'peso.registrar', slots: { p_kg: 82.4 }, confianca: 0.9 }, { acao_id: 13, status: 'pendente', pergunta: 'Confirma?' });
  const r2 = await processar('registra 82,4 quilos', d2);
  ok(r2.pendente?.tipo === 'confirmacao' && r2.pendente?.acao_id === 13 && r2.tela?.executou === false, 'banco exigiu sim');
});

Deno.test('erro da RPC vira fala, nunca exceção', async () => {
  const d = deps({ intencao: 'peso.registrar', slots: { p_kg: 82.4 }, confianca: 0.9 });
  d.chamar = async () => { throw new Error('peso fora do intervalo'); };
  const r = await processar('registra 82,4 quilos', d);
  ok(r.fala.startsWith('Não consegui') && r.pendente === null, r.fala);
});

Deno.test('validarSlots: tipos, enum, opcional, jsonb aninhado e lista', () => {
  const v = (spec: Record<string, string>, s: Record<string, unknown>, t = '') => validarSlots(spec, s, t);
  ok(v({ p_id: 'bigint' }, { p_id: '12' }).ok, 'bigint em string');
  ok(!v({ p_id: 'bigint' }, { p_id: 1.5 }).ok, 'bigint inválido');
  ok(!v({ p_status: 'text(pendente|feito)' }, { p_status: 'lixo' }).ok, 'enum');
  ok(v({ p_reacao: 'int(-1|0|1)?' }, {}).ok, 'opcional ausente');
  ok(!v({ p_reacao: 'int(-1|0|1)?' }, { p_reacao: 5 }).ok, 'enum int');
  ok(!v({ p_ids: 'text[]' }, { p_ids: [] }).ok, 'lista vazia');
  ok(v({ p_hora: 'text(HH:MM)' }, { p_hora: '18:00' }).ok && !v({ p_hora: 'text(HH:MM)' }, { p_hora: '6pm' }).ok, 'HH:MM');
  const spec = { p: 'jsonb{titulo:text,alvo?:jsonb{valor?:number,data?:date}}' };
  ok(v(spec, { p: { titulo: 'X', alvo: { valor: 800000, data: '2030-12-31' } } }, 'apartamento de 800 mil até 2030').ok, 'aninhado ok');
  ok(!v(spec, { p: { titulo: 'X', alvo: { valor: 900000 } } }, 'apartamento de 800 mil').ok, 'valor em dinheiro inventado');
  ok(!v(spec, { p: {} }).ok, 'título obrigatório');
  eq(numerosDoTexto('R$ 1.200,50 e 80 mil, 82,4'), [1200.5, 80, 80000, 82.4], 'numeros');
});

Deno.test('contrato de fala: sem markdown, até 2 frases', () => {
  eq(limparFala('# Título\n**Uma.** Duas. Três.'), 'Título Uma. Duas.', 'corte');
});

Deno.test('(5) custo da rota <= US$ 0,001 por comando (com e sem cache)', () => {
  const sys = montarSystem(CATALOGO);
  const usr = montarUsuario('jantar quinta às 20h no Bar X', '2026-11-17', 'terça', [{ papel: 'leo', texto: 'oi' }], CTX);
  const comCache = estimarRotaUsd(sys.length, usr.length), semCache = estimarRotaUsd(sys.length, usr.length, 120, false);
  console.log(`system ${sys.length} chars (~${Math.round(sys.length / 3.5)} tokens); rota com cache US$ ${comCache.toFixed(6)}, sem cache US$ ${semCache.toFixed(6)}`);
  ok(comCache <= 0.001 && semCache <= 0.001, `custo ${semCache}`);
  eq(sys, montarSystem([...CATALOGO].reverse()), 'system estável (independe da ordem do banco) -> cacheável');
});

Deno.test('UX-17: "pratiquei violão 20 minutos" chama hub_pratica_registrar e devolve o desfazer; "toquei 30 min hoje" sem habilidade', async () => {
  const d = deps({ intencao: 'pratica.registrar', slots: { p_minutos: 20, p_habilidade: 'violão' }, confianca: 0.95 },
    { acao_id: 21, status: 'executada', resultado: { pratica_id: 5, fala: 'Anotei: 20 min de violão. Faltam 40 para a meta da semana.' }, desfazer: { acao_id: 21, ate: '2026-11-17T13:10:00Z' } });
  const r = await processar('pratiquei violão 20 minutos', d);
  eq(d.chamadas, [{ destino: { via: 'rpc', schema: null, nome: 'hub_pratica_registrar' }, args: { p_minutos: 20, p_habilidade: 'violão' } }], 'chamada');
  eq(r.fala, 'Anotei: 20 min de violão. Faltam 40 para a meta da semana.', 'fala'); eq(r.desfazer, { acao_id: 21, ate: '2026-11-17T13:10:00Z' }, 'desfazer');
  const d2 = deps({ intencao: 'pratica.registrar', slots: { p_minutos: 30 }, confianca: 0.9 }, { fala: 'Anotei: 30 min de violão.' });
  await processar('toquei 30 min hoje', d2);
  eq(d2.chamadas[0].args, { p_minutos: 30 }, 'habilidade opcional');
  const c = CATALOGO.find((x) => x.slug === 'pratica.registrar')!;
  ok(c.risco === 'baixo' && c.confirmacao === 'nenhuma' && c.desfazer_rpc === 'public.hub_pratica_desfazer', 'política da intenção');
});

// ---------- UX-23: contexto da tela ----------
import { descreverTela, lerTela, type Tela } from './comando-lib.ts';
const TELA: Tela = { rota: '/planos', itens: [
  { tipo: 'plano', id: '5', titulo: 'Apartamento', detalhe: 'ativo', visivel: true },
  { tipo: 'meta', id: '12', titulo: 'Juntar a entrada', detalhe: 'horizonte medio, dono airton, prazo 2027-12-31, ativa', visivel: true },
  { tipo: 'meta', id: '13', titulo: 'Quitar o carro', visivel: false },
] };
const comTela = (d: ReturnType<typeof deps>, tela: Tela | null = TELA) => Object.assign(d, { tela });

Deno.test('UX-23 lerTela: só tipos conhecidos, id curto, no máximo 25, lixo vira null', () => {
  eq(lerTela(null), null, 'null'); eq(lerTela([1]), null, 'array');
  const t = lerTela({ rota: '/planos', itens: [{ tipo: 'meta', id: 12, titulo: 'X', visivel: true }, { tipo: 'hack', id: '1', titulo: 'Y' }, { tipo: 'meta', id: '1; drop', titulo: 'Z' }, { tipo: 'plano', id: '3', titulo: '' }] });
  eq(t, { rota: '/planos', itens: [{ tipo: 'meta', id: '12', titulo: 'X', visivel: true }] }, 'filtrado');
  const muitos = lerTela({ rota: '/semana', itens: Array.from({ length: 40 }, (_, i) => ({ tipo: 'semana_item', id: String(i + 1), titulo: `item ${i}` })) });
  eq(muitos?.itens.length, 25, 'teto 25');
});

Deno.test('UX-23 montarUsuario: bloco "Na tela" numerado na ordem, fora da vista marcado', () => {
  const u = montarUsuario('muda o prazo dessa meta', '2026-11-23', 'segunda', [], {}, TELA);
  ok(u.includes('Na tela (/planos):\n1. plano id=5 "Apartamento" ("ativo")\n2. meta id=12 "Juntar a entrada"'), u);
  ok(u.includes('3. meta id=13 "Quitar o carro" [fora da vista]'), 'fora da vista');
  ok(!montarUsuario('oi', '2026-11-23', 'segunda', [], {}).includes('Na tela'), 'sem tela, sem bloco');
  eq(descreverTela({ rota: '/hoje', itens: [] }), 'Na tela (/hoje): nada marcado.\n', 'vazia');
  ok(montarSystem(CATALOGO).includes('"Na tela" lista o que o Leo está vendo'), 'regra no system');
});

Deno.test('UX-23 critério 1: "Muda o prazo dessa meta para 2028" em /planos age na meta visível e pede "sim"', async () => {
  const d = comTela(deps({ intencao: 'meta.salvar_plano', slots: { p: { id: '12', prazo: '2028-12-31' } }, confianca: 0.9 }));
  const r = await processar('Muda o prazo dessa meta para 2028', d);
  ok(d.chamadas.length === 0, 'não executa sem sim');
  eq(r.pendente?.tipo, 'confirmacao', 'confirmação');
  eq(r.fala, 'Vou mudar o prazo para 31/12/2028 da meta "Juntar a entrada". Confirma?', 'fala');
  eq(d.acoes.criadas[0], { intencao: 'meta.salvar_plano', args: { p: { id: 12, prazo: '2028-12-31' } }, pergunta: r.fala }, 'ação gravada com o id da tela');
  const s = await processar('sim', Object.assign(d, { turnos: [{ papel: 'iara', texto: r.fala, pendente: r.pendente, at: new Date().toISOString() }] as Turno[] }));
  eq(d.acoes.executadas, [71], 'sim executa a ação gravada'); eq(s.fala, 'Pronto, atualizei a meta.', 'fala depois');
});

Deno.test('UX-23: id de meta que não está na tela não edita (vira meta nova e pergunta o que falta)', async () => {
  const d = comTela(deps({ intencao: 'meta.salvar_plano', slots: { p: { id: 999, prazo: '2028-12-31' } }, confianca: 0.9 }));
  const r = await processar('muda o prazo dessa meta para 2028', d);
  ok(d.acoes.criadas.length === 0 && r.pendente?.tipo === 'pergunta', 'pergunta');
});

Deno.test('UX-23: pausar meta da tela descreve a ação; plano da tela vale como candidato', async () => {
  const d = comTela(deps({ intencao: 'meta.salvar_plano', slots: { p: { id: 13, status: 'pausada' } }, confianca: 0.9 }));
  const r = await processar('pausa a segunda meta', d);
  eq(r.fala, 'Vou pausar a meta "Quitar o carro". Confirma?', 'pausar');
  const d2 = comTela(deps({ intencao: 'plano.confirmar', slots: { p_id: '5' }, confianca: 0.9 }));
  const r2 = await processar('ativa esse plano', d2);
  eq(d2.acoes.criadas[0]?.args, { p_id: 5 }, 'id do plano da tela (não estava no contexto do servidor)'); eq(r2.pendente?.tipo, 'confirmacao', 'pede sim');
});

Deno.test('UX-23: compromisso continua pedindo título e data (RPC sem coalesce); id do contexto do servidor vale com tela', async () => {
  const ctx = { ...CTX, compromissos: [{ id: 30, titulo: 'Dentista', data: '2026-11-26' }] };
  const d = comTela(Object.assign(deps({ intencao: 'agenda.compromisso_salvar', slots: { p: { id: 30, inicio: '16:00' } }, confianca: 0.9 }, 30), { contexto: ctx }));
  const r = await processar('muda o dentista para as 16h', d);
  ok(d.chamadas.length === 0 && r.pendente?.tipo === 'pergunta', 'parcial não passa');
  const d2 = comTela(Object.assign(deps({ intencao: 'agenda.compromisso_salvar', slots: { p: { id: 30, titulo: 'Dentista', data: '2026-11-26', inicio: '16:00' } }, confianca: 0.9 }, 30), { contexto: ctx }));
  const r2 = await processar('muda o dentista para as 16h', d2);
  eq(d2.chamadas[0]?.args, { p: { id: 30, titulo: 'Dentista', data: '2026-11-26', inicio: '16:00' } }, 'edição completa');
  eq(r2.fala, 'Marquei "Dentista" quinta, 26/11 às 16h.', 'fala'); ok((r2.tela as any)?.executou === true, 'executou');
});

Deno.test('UX-23: sem tela (Atalho), id de meta inventado não edita', async () => {
  const d = comTela(deps({ intencao: 'meta.salvar_plano', slots: { p: { id: 7, status: 'cancelada' } }, confianca: 0.9 }), null);
  const r = await processar('cancela essa meta', d);
  ok(d.acoes.criadas.length === 0 && r.pendente?.tipo === 'pergunta', 'pergunta');
});

Deno.test('UX-23: decisão sem tela orienta abrir Planos', async () => {
  const d = comTela(deps({ intencao: 'decisao.decidir', slots: { p_id: 4, p_escolha: 'a' }, confianca: 0.9 }), null);
  const r = await processar('decide pela primeira opção', d);
  eq(r.fala, 'Abra Planos e me diga de novo: assim eu vejo de qual decisão você fala.', 'fala');
});
