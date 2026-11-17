// deno test supabase/functions/iara-plano/plano-lib.test.ts  (sem banco, sem IA, sem rede)
import { decidirRodada, estimarSmart, falaRascunho, garantirTeto, normalizarExtracao, normalizarMetas, viabilidade } from './plano-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const HOJE = '2026-11-17';

// Saída "de exemplo" do smart para "Quero comprar um apartamento de 800 mil até 2030", com defeitos de propósito.
const SAIDA = {
  metas: [
    { horizonte: 'longo', dono: 'iara', titulo: 'Morar no apartamento', medida: { tipo: 'marco', unidade: null, alvo: null, inicio: null, valor_inicial: null }, prazo: '2030-12-31', cadencia: null, reais_mes: null, minutos_semana: null, ref: null },
    { horizonte: 'medio', dono: 'airton', titulo: 'Juntar a entrada de 160 mil', medida: { tipo: 'valor', unidade: 'BRL', alvo: 160000, inicio: null, valor_inicial: null }, prazo: '2029-12-31', cadencia: 'mensal', reais_mes: 3900, minutos_semana: null, ref: 'airton.goals:inventada' },
    { horizonte: 'medio', dono: 'airton', titulo: 'Reserva para ITBI e escritura', medida: { tipo: 'valor', unidade: 'BRL', alvo: 40000, inicio: null, valor_inicial: null }, prazo: '2030-06-30', cadencia: null, reais_mes: 800, minutos_semana: null, ref: null },
    { horizonte: 'semanal', dono: 'leo', titulo: 'Visitar 2 bairros', medida: { tipo: 'contagem', unidade: 'visitas', alvo: 6, inicio: null, valor_inicial: null }, prazo: '2026-12-10', cadencia: null, reais_mes: 500, minutos_semana: 120, ref: 'sabia.livros:ano' },
    { horizonte: 'medio', dono: 'robo', titulo: 'Entender financiamento', medida: { tipo: 'habito' }, prazo: '2027-03-01', cadencia: null, reais_mes: null, minutos_semana: 90, ref: 'sabia.livros:ano' },
  ],
  primeiro_passo: { titulo: 'Definir o teto de preço e 3 bairros', dono: 'iara', detalhe: null },
};

Deno.test('rascunho do apartamento: >= 1 meta por horizonte, todas com dono válido', () => {
  const n = normalizarMetas(SAIDA, { tipo: 'imovel', titulo: 'Apartamento', alvo: { valor: 800000, data: '2030-12-31' }, hoje: HOJE });
  for (const h of ['curto', 'medio', 'longo']) ok(n.metas.some((m) => m.horizonte === h), `sem meta ${h}`);
  for (const m of n.metas) ok(['iara', 'claudia', 'airton', 'sabia'].includes(m.dono), `dono ${m.dono}`);
  ok(n.metas.filter((m) => m.dono === 'airton' && m.medida.tipo === 'valor').length === 1, 'só 1 valor do airton');
  ok(n.metas.every((m) => !m.ref?.startsWith('airton.')), 'ref airton inventada some');
  const visita = n.metas.find((m) => m.titulo === 'Visitar 2 bairros')!;
  ok(visita.dono === 'iara' && visita.horizonte === 'curto' && visita.ref === null && visita.demanda.reais_mes === undefined, 'dono/horizonte/ref consertados');
  const fin = n.metas.find((m) => m.titulo === 'Entender financiamento')!;
  ok(fin.dono === 'iara' && fin.ref === null, 'dono inválido vira iara; ref sabia só para dono sabia');
  ok(n.avisos.length > 0, 'avisos registrados');
});

Deno.test('saída vazia ou lixo: completa os 3 horizontes com marcos da IARA', () => {
  for (const lixo of [null, {}, { metas: 'x' }, { metas: [{ titulo: '' }, null] }]) {
    const n = normalizarMetas(lixo, { tipo: 'outro', titulo: 'Algo', alvo: { valor: null, data: null }, hoje: HOJE });
    ok(n.metas.length === 3 && ['curto', 'medio', 'longo'].every((h) => n.metas.some((m) => m.horizonte === h && m.dono === 'iara')), 'completou');
  }
});

Deno.test('D1: carreira e hobby têm todas as metas com dono iara', () => {
  const n = normalizarMetas({ metas: [{ horizonte: 'medio', dono: 'sabia', titulo: 'Estudar teoria', medida: { tipo: 'habito' }, prazo: '2027-06-01', ref: null }], primeiro_passo: { titulo: 'x', dono: 'sabia' } },
    { tipo: 'habilidade', titulo: 'Violão', alvo: { valor: null, data: '2027-11-17' }, hoje: HOJE });
  ok(n.metas.every((m) => m.dono === 'iara') && n.primeiro_passo.dono === 'iara', 'tudo iara');
});

Deno.test('formatos dos adapters: livros do ano, peso e sessões', () => {
  const n = normalizarMetas({ metas: [
    { horizonte: 'longo', dono: 'sabia', titulo: 'Ler 12 livros', medida: { tipo: 'valor', alvo: 12 }, prazo: '2026-12-31', ref: 'sabia.livros:ano' },
    { horizonte: 'medio', dono: 'claudia', titulo: 'Chegar a 80 kg', medida: { tipo: 'valor', alvo: 80 }, prazo: '2027-03-01', ref: 'claudia.peso' },
    { horizonte: 'curto', dono: 'claudia', titulo: '3 treinos por semana', medida: { tipo: 'habito', alvo: 3 }, prazo: '2026-12-15', ref: 'claudia.sessoes:semana' },
    { horizonte: 'curto', dono: 'claudia', titulo: 'Peso sem alvo', medida: { tipo: 'valor' }, prazo: '2026-12-15', ref: 'claudia.peso' },
  ], primeiro_passo: null }, { tipo: 'habito', titulo: 'Saúde', alvo: { valor: null, data: null }, hoje: HOJE, pesoAtual: 86.4 });
  const por = (t: string) => n.metas.find((m) => m.titulo === t)!;
  ok(por('Ler 12 livros').ref === 'sabia.livros:ano' && por('Ler 12 livros').medida.alvo === 12, 'livros');
  ok(por('Chegar a 80 kg').ref === 'claudia.peso' && por('Chegar a 80 kg').medida.valor_inicial === 86.4, 'peso com valor_inicial');
  ok(por('3 treinos por semana').ref === 'claudia.sessoes:semana', 'sessoes');
  ok(por('Peso sem alvo').ref === null, 'peso sem alvo perde ref');
});

Deno.test('D2: rodadas contadas em código (valor e prazo; máx. 3)', () => {
  const sem = normalizarExtracao({ tipo: 'imovel', titulo: 'Apartamento', envolve_dinheiro: true, valor: null, data: null, pergunta: null }, HOJE);
  ok(decidirRodada(sem, [])?.rodada === 1, 'rodada 1');
  ok(decidirRodada(sem, [{}, {}])?.rodada === 3, 'rodada 3');
  ok(decidirRodada(sem, [{}, {}, {}]) === null, 'depois da 3ª, segue sem perguntar');
  const completo = normalizarExtracao({ tipo: 'imovel', titulo: 'Apartamento', valor: 800000, data: '2030-12-31' }, HOJE);
  ok(decidirRodada(completo, []) === null, 'frase completa não pergunta');
  const semPrazo = normalizarExtracao({ tipo: 'habilidade', titulo: 'Violão', envolve_dinheiro: false, valor: null, data: '2020-01-01' }, HOJE);
  ok(decidirRodada(semPrazo, [])?.opcoes.length === 0, 'data no passado = prazo faltando; pergunta padrão sem opções');
  const comOpcoes = normalizarExtracao({ tipo: 'outro', titulo: 'x', valor: null, data: null, pergunta: { texto: 'Até quando?', opcoes: ['2027', '2028', '2029', '2030'] } }, HOJE);
  ok(comOpcoes.pergunta!.opcoes.length === 3, 'opções limitadas a 3');
});

Deno.test('teto de US$ 0,10 por execução e fala', () => {
  let barrou = false;
  try { garantirTeto(0.08, estimarSmart(8000, 3500)); } catch { barrou = true; }
  ok(barrou, 'aborta antes de passar');
  garantirTeto(0.002, estimarSmart(8000, 3500)); // pior caso do smart (~US$ 0,04) cabe
  const f = falaRascunho('Apartamento *novo*', 4, { cabe: false });
  ok(!/[*#_]/.test(f) && f.split(/[.?!]/).filter((s) => s.trim()).length <= 2, f);
  ok(viabilidade([{ horizonte: 'medio', dono: 'airton', titulo: 'x', medida: {}, prazo: null, cadencia: null, demanda: { reais_mes: 3900 }, ref: null }], { poupanca_base: 5000, aporte_total_metas: 2000 })!.cabe === false, 'viabilidade');
});
