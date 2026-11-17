// deno test --allow-read supabase/functions/iara-comando/comando-lib.test.ts  (sem banco, sem IA, sem rede)
import { estimarRotaUsd, limparFala, montarSystem, montarUsuario, numerosDoTexto, processar, validarSlots, type Contexto, type Deps, type Destino, type Intencao, type Turno } from './comando-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const CATALOGO: Intencao[] = JSON.parse(await Deno.readTextFile(new URL('./catalogo.fixture.json', import.meta.url)));
const CTX: Contexto = {
  itens: [{ id: 41, origem: 'iara', titulo: 'Trocar o filtro' }, { id: 42, origem: 'iara', titulo: 'Pagar o condomínio' }],
  trilha: [{ id: 7, titulo: 'Artigo sobre sono' }], semana: { id: 9, status: 'rascunho' },
  planos: [{ id: 3, titulo: 'Apartamento', status: 'ativo' }], lancamentos: [{ id: 'tx1', descricao: 'Mercado', valor: -120 }], categorias: [{ id: 'alimentacao', nome: 'Alimentação' }],
};
type Chamada = { destino: Destino; args: Record<string, unknown> };
function deps(rota: Record<string, unknown>, resultado: unknown = {}, turnos: Turno[] = []): Deps & { chamadas: Chamada[]; roteou: number } {
  const d = {
    catalogo: CATALOGO, turnos, contexto: CTX, hoje: '2026-11-17', chamadas: [] as Chamada[], roteou: 0,
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

Deno.test('risco alto (confirmar semana): NÃO executa, devolve pendente de confirmação', async () => {
  const d = deps({ intencao: 'semana.confirmar', slots: { p_plano: 9 }, confianca: 0.95 });
  const r = await processar('confirma a semana', d);
  ok(d.chamadas.length === 0, 'não executou');
  eq(r.pendente, { tipo: 'confirmacao', intencao: 'semana.confirmar', slots: { p_plano: 9 }, pergunta: 'Vou confirmar o plano da semana. Confirma?' }, 'pendente');
  // plano da semana único: completa o id sozinho
  const d2 = deps({ intencao: 'semana.confirmar', slots: {}, confianca: 0.95 });
  const r2 = await processar('fecha a semana', d2);
  eq((r2.pendente as any).slots, { p_plano: 9 }, 'id completado');
});

Deno.test('"sim" com confirmação pendente: sem executar neste item (UX-16), pendente preservado; "não" cancela', async () => {
  const pend = { tipo: 'confirmacao', intencao: 'semana.confirmar', slots: { p_plano: 9 }, pergunta: 'Vou confirmar. Confirma?' };
  const turnos: Turno[] = [{ papel: 'leo', texto: 'confirma a semana' }, { papel: 'iara', texto: 'Vou confirmar. Confirma?', pendente: pend, at: new Date().toISOString() }];
  const d = deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, turnos);
  const r = await processar('sim', d);
  ok(d.chamadas.length === 0 && d.roteou === 0 && r.pendente?.tipo === 'confirmacao', 'sem execução nem IA');
  const r2 = await processar('não', deps({ intencao: 'fora', slots: {}, confianca: 1 }, {}, turnos));
  ok(r2.pendente === null, 'cancelado');
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
