// IARA · agenda (pedido do Leo, 10/11). Sem OAuth, nas duas direções, por iCal:
//   POST {action:'sync'} (pg_cron de hora em hora ou botão do hub): lê a agenda do Leo pelos links iCal
//     secretos do secret IARA_AGENDA_ICS_URLS (Google: "endereço secreto no formato iCal"; iPhone/iCloud:
//     link da agenda pública; vários separados por espaço) e grava os próximos 21 dias em core.agenda_eventos.
//   GET ?t=<core.perfil.config.agenda_token>: feed iCal que o Leo assina no iPhone/Google, com os compromissos
//     que ele marca no hub e os itens com horário do plano da semana confirmado.
// Sem IA, sem custo.
import { authenticate, CORS, json, perfis, sql } from './_shared/common.ts';
import { lerIcs, SP } from './ics.ts';

type Perfil = { user_id: string };
const JANELA_DIAS = 21;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method === 'GET') return feed(new URL(req.url).searchParams.get('t') ?? '');
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'sync') return json(400, { error: 'ação desconhecida' });
  const urls = (Deno.env.get('IARA_AGENDA_ICS_URLS') ?? '').split(/\s+/).filter(Boolean);
  if (!urls.length) return json(200, { ok: false, motivo: 'Agenda não conectada (secret IARA_AGENDA_ICS_URLS vazio).' });
  const lista = (await perfis(caller)) as unknown as Perfil[];
  const res = [];
  for (const p of lista) res.push(await sincronizar(p.user_id, urls));
  return json(200, { ok: true, resultado: res });
});

// ── Leitura da agenda ────────────────────────────────────────────────────────────────────────────
function fonteDe(url: string, i: number, vistas: Map<string, number>): string {
  const host = (() => { try { return new URL(url.replace(/^webcal:/i, 'https:')).host; } catch { return ''; } })();
  const base = host.includes('google') ? 'google' : host.includes('icloud') ? 'icloud' : 'ics';
  const n = (vistas.get(base) ?? 0) + 1;
  vistas.set(base, n);
  return n === 1 ? base : `${base}${n}`;
}

async function sincronizar(userId: string, urls: string[]) {
  const de = new Date(Date.now() - 864e5), ate = new Date(Date.now() + JANELA_DIAS * 864e5);
  const vistas = new Map<string, number>();
  const resumo: Record<string, number | string> = {};
  for (const [i, url] of urls.entries()) {
    const fonte = fonteDe(url, i, vistas);
    try {
      const r = await fetch(url.replace(/^webcal:/i, 'https:'), { headers: { accept: 'text/calendar' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const evs = lerIcs(await r.text(), de, ate);
      await sql.begin(async (tx) => {
        // A janela é regravada inteira: evento apagado ou movido na agenda some daqui também.
        await tx`delete from core.agenda_eventos where user_id = ${userId} and fonte = ${fonte}`;
        for (const e of evs) {
          await tx`insert into core.agenda_eventos (user_id, fonte, uid, inicio, fim, dia_todo, titulo, local, ocupado)
            values (${userId}, ${fonte}, ${e.uid}, ${e.inicio}, ${e.fim}, ${e.dia_todo}, ${e.titulo}, ${e.local}, ${e.ocupado})
            on conflict (user_id, fonte, uid, inicio) do nothing`;
        }
      });
      resumo[fonte] = evs.length;
    } catch (e) {
      // Uma agenda fora do ar não apaga o que já estava salvo dela.
      resumo[fonte] = `erro: ${String(e).slice(0, 120)}`;
    }
  }
  return resumo;
}

// ── Feed iCal do hub ─────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function dobrar(linha: string): string {
  // RFC 5545: linhas de até 75 octetos, continuação começa com espaço.
  const bytes = new TextEncoder().encode(linha);
  if (bytes.length <= 75) return linha;
  const partes: string[] = [];
  let atual = '';
  for (const ch of linha) {
    if (new TextEncoder().encode(atual + ch).length > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; }
    atual += ch;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}
/** Data e hora de São Paulo → UTC no formato iCal. */
function utc(data: string, hora: string, somaMin = 0): string {
  const d = new Date(new Date(`${data}T${hora.slice(0, 5)}:00${SP}`).getTime() + somaMin * 6e4);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function feed(token: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('não encontrado', { status: 404 });
  const [p] = await sql`select user_id from core.perfil where config ->> 'agenda_token' = ${token}`;
  if (!p) return new Response('não encontrado', { status: 404 });
  const desde = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const comps = await sql`select id, data::text, to_char(inicio, 'HH24:MI') inicio, to_char(fim, 'HH24:MI') fim, titulo, tipo, local, updated_at
    from core.compromissos where user_id = ${p.user_id} and not cancelado and data >= ${desde}`;
  const itens = await sql`select i.id, i.data::text, to_char(i.hora, 'HH24:MI') hora, i.minutos, i.area, i.titulo, i.detalhe
    from core.planos_semana_itens i join core.planos_semana s on s.id = i.plano_id and s.status = 'confirmado'
    where i.user_id = ${p.user_id} and i.incluido and i.hora is not null and i.data >= ${desde}`;
  const agora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const AREA: Record<string, string> = { saude: 'ClaudIA', financas: 'AIrton', aprender: 'SabIA', casa: 'Casa' };
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IARA HQ//Semana//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:IARA HQ', 'X-WR-TIMEZONE:America/Sao_Paulo', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const c of comps) {
    const ev = [`UID:comp-${c.id}@iara-hq`, `DTSTAMP:${agora}`, `SUMMARY:${esc(c.titulo)}`];
    if (c.inicio) {
      ev.push(`DTSTART:${utc(c.data, c.inicio)}`, `DTEND:${c.fim ? utc(c.data, c.fim) : utc(c.data, c.inicio, 60)}`);
    } else {
      const d = c.data.replace(/-/g, '');
      ev.push(`DTSTART;VALUE=DATE:${d}`);
    }
    if (c.local) ev.push(`LOCATION:${esc(c.local)}`);
    ev.push(`CATEGORIES:${esc(c.tipo)}`);
    linhas.push('BEGIN:VEVENT', ...ev, 'END:VEVENT');
  }
  for (const i of itens) {
    linhas.push('BEGIN:VEVENT', `UID:semana-${i.id}@iara-hq`, `DTSTAMP:${agora}`,
      `SUMMARY:${esc(`${i.titulo} · ${AREA[i.area] ?? i.area}`)}`,
      `DTSTART:${utc(i.data, i.hora)}`, `DTEND:${utc(i.data, i.hora, Number(i.minutos) || 30)}`,
      ...(i.detalhe ? [`DESCRIPTION:${esc(i.detalhe)}`] : []), 'END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return new Response(linhas.map(dobrar).join('\r\n') + '\r\n', {
    headers: { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
