// Leitura de iCal (Google / iCloud) para core.agenda_eventos: fusos, recorrências e exceções pelo ical.js.
import ICAL from 'npm:ical.js@2.2.1';

export type Evento = { uid: string; inicio: string; fim: string | null; dia_todo: boolean; titulo: string; local: string | null; ocupado: boolean };
export const SP = '-03:00'; // São Paulo sem horário de verão desde 2019

// deno-lint-ignore no-explicit-any
function quando(t: any): { iso: string; diaTodo: boolean } {
  const p = (n: number) => String(n).padStart(2, '0');
  if (t.isDate) return { iso: `${t.year}-${p(t.month)}-${p(t.day)}T00:00:00${SP}`, diaTodo: true };
  const tz = t.zone?.tzid;
  // Hora "flutuante" (sem fuso) vale como horário de São Paulo; com fuso, o ical.js converte.
  if (!tz || tz === 'floating') return { iso: `${t.year}-${p(t.month)}-${p(t.day)}T${p(t.hour)}:${p(t.minute)}:${p(t.second)}${SP}`, diaTodo: false };
  return { iso: t.toJSDate().toISOString(), diaTodo: false };
}

export function lerIcs(texto: string, de: Date, ate: Date): Evento[] {
  const raiz = new ICAL.Component(ICAL.parse(texto));
  for (const vtz of raiz.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(new ICAL.Timezone(vtz)); } catch { /* fuso já registrado */ }
  }
  const eventos = raiz.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
  const mestres = new Map<string, InstanceType<typeof ICAL.Event>>();
  for (const e of eventos) if (!e.isRecurrenceException()) mestres.set(e.uid, e);
  for (const e of eventos) if (e.isRecurrenceException()) mestres.get(e.uid)?.relateException(e);

  const fim = ICAL.Time.fromJSDate(ate, true);
  const ini = ICAL.Time.fromJSDate(de, true);
  const out: Evento[] = [];
  const add = (uid: string, s: unknown, e: unknown, ev: InstanceType<typeof ICAL.Event>) => {
    if (String(ev.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const a = quando(s), b = e ? quando(e) : null;
    out.push({
      uid, inicio: a.iso, fim: b?.iso ?? null, dia_todo: a.diaTodo,
      titulo: String(ev.summary || '(sem título)').slice(0, 200),
      local: ev.location ? String(ev.location).slice(0, 200) : null,
      ocupado: String(ev.component.getFirstPropertyValue('transp') ?? 'OPAQUE').toUpperCase() !== 'TRANSPARENT',
    });
  };
  for (const ev of mestres.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      const e = ev.endDate ?? ev.startDate;
      if (e.compare(ini) >= 0 && ev.startDate.compare(fim) < 0) add(ev.uid, ev.startDate, ev.endDate, ev);
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, prox = it.next(); prox && n < 5000; n++, prox = it.next()) {
      if (prox.compare(fim) >= 0) break;
      const d = ev.getOccurrenceDetails(prox);
      if (d.endDate.compare(ini) < 0) continue;
      add(`${ev.uid}#${prox.toString()}`, d.startDate, d.endDate, d.item);
    }
  }
  return out;
}

