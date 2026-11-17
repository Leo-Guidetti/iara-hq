// deno test supabase/functions/iara-plano/revisao-lib.test.ts  (sem banco, sem IA, sem rede)
import { ehPrimeiroDomingo, incluiLongo, MAX_PROPOSTAS, normalizarPropostas, TETO_REVISAO_USD, type MetaRev } from './revisao-lib.ts';
import { estimarSmart, garantirTeto } from './plano-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const METAS: MetaRev[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, plano_id: 1, prazo: '2027-06-01', status: 'ativa', demanda: { reais_mes: 1000 }, medida: { alvo: 10 } }));
const HOJE = '2026-11-17';

Deno.test('1º domingo do mês e revisão trimestral', () => {
  ok(ehPrimeiroDomingo('2026-12-06', 0) && !ehPrimeiroDomingo('2026-12-13', 0) && !ehPrimeiroDomingo('2026-12-02', 3), 'primeiro domingo');
  ok(incluiLongo('2027-01-03') && incluiLongo('2026-10-04') && !incluiLongo('2026-12-06'), 'trimestral');
});

Deno.test('normaliza: no máximo 5, meta de fora e campo inválido caem, valor no formato do campo', () => {
  const bruta = { propostas: [
    { meta_id: 1, campo: 'prazo', valor: { prazo: '2027-12-01', reais_mes: null }, motivo: 'atrasada 2 checagens' },
    { meta_id: 1, campo: 'prazo', valor: { prazo: '2028-01-01' }, motivo: 'repetida' },
    { meta_id: 99, campo: 'prazo', valor: { prazo: '2027-12-01' }, motivo: 'meta de fora' },
    { meta_id: 2, campo: 'cor', valor: {}, motivo: 'campo inválido' },
    { meta_id: 2, campo: 'prazo', valor: { prazo: '2020-01-01' }, motivo: 'no passado' },
    { meta_id: 2, campo: 'prazo', valor: { prazo: '2027-06-01' }, motivo: 'igual ao atual' },
    { meta_id: 3, campo: 'demanda', valor: { reais_mes: 800, minutos_semana: null }, motivo: 'renda caiu' },
    { meta_id: 3, campo: 'demanda', valor: { reais_mes: 1000 }, motivo: 'igual' },
    { meta_id: 4, campo: 'medida', valor: { alvo: 12 }, motivo: 'subir alvo' },
    { meta_id: 5, campo: 'status', valor: { status: 'pausada' }, motivo: 'sem tempo' },
    { meta_id: 5, campo: 'status', valor: { status: 'ativa' }, motivo: 'status não proposto' },
    { meta_id: 6, campo: 'medida', valor: { alvo: -1 }, motivo: 'alvo inválido' },
    { meta_id: 6, campo: 'status', valor: { status: 'cancelada' }, motivo: '' },
    { meta_id: 7, campo: 'status', valor: { status: 'concluida' }, motivo: 'ok 5' },
    { meta_id: 8, campo: 'status', valor: { status: 'cancelada' }, motivo: 'passou de 5' },
  ] };
  const r = normalizarPropostas(bruta, METAS, HOJE);
  ok(r.length === MAX_PROPOSTAS, `esperava 5, veio ${r.length}`);
  ok(r[0].campo === 'prazo' && r[0].valor === '2027-12-01', 'prazo');
  ok(JSON.stringify(r[1].valor) === '{"reais_mes":800}', `demanda: ${JSON.stringify(r[1].valor)}`);
  ok(JSON.stringify(r[2].valor) === '{"alvo":12}' && r[3].valor === 'pausada' && r[4].valor === 'concluida', 'medida/status');
  ok(!r.some((p) => p.meta_id === 99 || p.meta_id === 8), 'fora/excedente');
  ok(normalizarPropostas(null, METAS, HOJE).length === 0 && normalizarPropostas({ propostas: 'x' }, METAS, HOJE).length === 0, 'lixo');
});

Deno.test('teto da revisão: US$ 0,08 por execução', () => {
  // ~12 mil caracteres de contexto e 1.500 tokens de saída: pior caso < teto
  const pior = estimarSmart(12000 + 1500, 1500);
  ok(pior < TETO_REVISAO_USD, `pior caso ${pior}`);
  let abortou = false;
  try { garantirTeto(0.03, estimarSmart(100000, 1500), TETO_REVISAO_USD); } catch { abortou = true; }
  ok(abortou, 'contexto enorme aborta antes de chamar');
});

Deno.test('UX-22: cada proposta leva fala curta (1 frase, <= 25 palavras, sem markdown); sem fala vira null e a proposta fica', () => {
  const r = normalizarPropostas({ propostas: [
    { meta_id: 1, campo: 'prazo', valor: { prazo: '2027-12-01' }, motivo: 'atrasada', fala: '**Adiar** o prazo da meta para dezembro de 2027. ' + Array(40).fill('Mais').join(' ') + '.' },
    { meta_id: 2, campo: 'prazo', valor: { prazo: '2027-12-01' }, motivo: 'sem fala' },
  ] }, METAS, HOJE);
  ok(r.length === 2, 'as duas ficam');
  ok(r[0].fala === 'Adiar o prazo da meta para dezembro de 2027.' && !/[*#]/.test(r[0].fala!), `fala: ${r[0].fala}`);
  ok(r[1].fala === null, 'sem fala = null');
});
