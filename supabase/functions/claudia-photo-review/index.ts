// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// claudia-photo-review · compara fotos de espelho (baseline x atual) e estima uma faixa de gordura corporal.
//   POST { baseline_date?: 'YYYY-MM-DD', current_date?: 'YYYY-MM-DD' }
//   200  { review: linha de public.photo_reviews }
// Imagens vão reduzidas a ~1000 px no lado maior. Grava em public.photo_reviews com o JWT do usuário (RLS).
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { authenticate, json, CORS, DISCLAIMER } from '../_shared/claudia/common.ts';
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts';
import { obj, num, oneOf, str, strList, bool } from '../_shared/claudia/validate.ts';
const PROMPT_VERSION = 'photo-review@2';
const MAX_SIDE = 1000;
const POSES = [
  'front',
  'side',
  'back'
];
const POSE_PT = {
  front: 'frente',
  side: 'perfil',
  back: 'costas'
};
const RULES = `Tarefa: avaliar fotos de progresso de espelho (frente, perfil, costas) de um homem adulto e estimar uma FAIXA de percentual de gordura corporal, comparando a data de referência (baseline) com a atual quando houver as duas.
Método:
- Estimativa visual tem erro grande (±3–5 pontos); dê sempre uma faixa de no máximo 6 pontos e a confiança (low, medium, high). Use as medidas da fita (RFM e Marinha dos EUA) como âncora quando existirem; se a foto e a fita discordarem, diga.
- Compare as mesmas poses entre datas: cintura, flancos, abdômen inferior, definição de ombros/braços e postura. Diferença de luz, distância, hora e jejum invalida comparações finas: marque protocol_consistent=false nesses casos.
- Separe mudança provável de gordura de mudança de retenção hídrica ou de luz.
- Não comente aparência de forma estética ou julgadora; descreva só o que importa para composição corporal.
Formato: <review>{"bf_low": número, "bf_high": número, "confidence": "low"|"medium"|"high", "protocol_consistent": true|false, "summary": "2–4 frases", "changes": ["..."], "caveats": ["..."], "next_photo_tips": ["..."], "refs": ["..."]}</review>`;
function validate(v) {
  const o = obj(v);
  const bf_low = num(o.bf_low, 'bf_low', 3, 60);
  const bf_high = num(o.bf_high, 'bf_high', 3, 60);
  if (bf_low > bf_high) throw new Error('bf_low maior que bf_high');
  if (bf_high - bf_low > 8) throw new Error('faixa larga demais (máx. 8 pontos)');
  return {
    bf_low: Math.round(bf_low * 10) / 10,
    bf_high: Math.round(bf_high * 10) / 10,
    confidence: oneOf(o.confidence, 'confidence', [
      'low',
      'medium',
      'high'
    ]),
    protocol_consistent: bool(o.protocol_consistent, 'protocol_consistent'),
    summary: str(o.summary, 'summary', 1200),
    changes: strList(o.changes, 'changes', 8),
    caveats: strList(o.caveats, 'caveats', 8),
    next_photo_tips: strList(o.next_photo_tips, 'next_photo_tips', 6),
    refs: strList(o.refs ?? [], 'refs', 6)
  };
}
function b64(bytes) {
  let s = '';
  for(let i = 0; i < bytes.length; i += 0x8000)s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Baixa a foto (prefere a versão .review.jpg gerada no upload) e garante JPEG de até 1000 px. */ async function loadImage(db, p) {
  const storage = db.storage.from('progress-photos');
  const review = p.storage_path.replace(/\.[a-z0-9]+$/i, '.review.jpg');
  let { data } = await storage.download(review);
  if (!data) ({ data } = await storage.download(p.storage_path));
  if (!data) throw new Error(`não consegui baixar a foto ${p.id}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isJpeg) {
    const img = await Image.decode(bytes);
    const scale = MAX_SIDE / Math.max(img.width, img.height);
    if (scale < 1) img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
    return b64(await img.encodeJPEG(82));
  }
  // WebP/HEIC sem versão .review.jpg: o app novo sempre gera a versão; aqui é só um fallback
  throw new Error(`foto ${p.id} sem versão JPEG para análise; reenvie pelo app`);
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  if (req.method !== 'POST') return json(405, {
    error: 'Use POST.'
  });
  const who = await authenticate(req);
  if (who instanceof Response) return who;
  const body = await req.json().catch(()=>({}));
  const { db } = who;
  const { data: all } = await db.from('progress_photos').select('id, local_date, pose, storage_path, protocol').order('local_date');
  if (!all?.length) return json(400, {
    error: 'Nenhuma foto registrada.'
  });
  const dates = [
    ...new Set(all.map((p)=>p.local_date))
  ];
  const current = body.current_date && dates.includes(body.current_date) ? body.current_date : dates.at(-1);
  let baseline = body.baseline_date && dates.includes(body.baseline_date) ? body.baseline_date : dates[0];
  if (baseline >= current) baseline = null;
  const pick = (d)=>POSES.map((pose)=>all.filter((p)=>p.local_date === d && p.pose === pose).at(-1)).filter(Boolean);
  const cur = pick(current);
  const base = baseline ? pick(baseline) : [];
  if (!cur.length) return json(400, {
    error: 'Sem fotos na data atual.'
  });
  // contexto numérico curto: fita e peso perto de cada data
  const { data: comp } = await db.from('body_comp_estimates').select('local_date, waist_cm, neck_cm, bf_rfm, bf_navy, bf_mean, weight_ref_kg, lean_mass_kg, fat_mass_kg').order('local_date');
  const near = (d)=>(comp ?? []).filter((c)=>c.local_date <= d).at(-1);
  const { data: profile } = await db.from('profiles').select('height_cm, sex, birth_date').eq('id', who.userId).single();
  const ctx = (label, d, photos)=>{
    const c = near(d);
    return `${label} (${d}): fotos ${photos.map((p)=>POSE_PT[p.pose]).join(', ')}; protocolo ${JSON.stringify(photos[0]?.protocol ?? {})}` + (c ? `; fita em ${c.local_date}: cintura ${c.waist_cm} cm, pescoço ${c.neck_cm ?? '—'} cm, RFM ${c.bf_rfm ?? '—'}%, Marinha ${c.bf_navy ?? '—'}%, peso ref. ${c.weight_ref_kg ?? '—'} kg` : '; sem medida de fita próxima');
  };
  const content = [
    {
      type: 'text',
      text: `Perfil: ${profile?.sex ?? 'sexo não informado'}, ${profile?.height_cm ?? '?'} cm, nascido em ${profile?.birth_date ?? '?'}.\n` + (baseline ? ctx('Baseline', baseline, base) + '\n' : 'Sem baseline: avalie só a data atual.\n') + ctx('Atual', current, cur) + '\nAs imagens a seguir vêm na ordem: ' + [
        ...base.map((p)=>`baseline ${POSE_PT[p.pose]}`),
        ...cur.map((p)=>`atual ${POSE_PT[p.pose]}`)
      ].join(', ') + '.'
    }
  ];
  try {
    for (const p of [
      ...base,
      ...cur
    ]){
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: await loadImage(db, p)
        }
      });
    }
    const { data, usage } = await callJson({
      model: MODELS.smart,
      maxTokens: 2000,
      system: system(RULES),
      content,
      tag: 'review',
      validate,
      feature: 'photo-review',
      userId: who.userId,
      effort: 'medium'
    });
    const { data: row, error } = await db.from('photo_reviews').insert({
      user_id: who.userId,
      baseline_date: baseline,
      current_date_ref: current,
      photo_ids: [
        ...base,
        ...cur
      ].map((p)=>p.id),
      bf_low: data.bf_low,
      bf_high: data.bf_high,
      confidence: data.confidence,
      protocol_consistent: data.protocol_consistent,
      summary: data.summary,
      observations: {
        changes: data.changes,
        caveats: data.caveats,
        next_photo_tips: data.next_photo_tips,
        refs: data.refs,
        disclaimer: DISCLAIMER
      },
      model: MODELS.smart,
      prompt_version: PROMPT_VERSION,
      input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      output_tokens: usage.output_tokens
    }).select().single();
    if (error) throw new Error(error.message);
    return json(200, {
      review: row
    });
  } catch (e) {
    console.error('photo-review', e);
    return json(502, {
      error: e.message
    });
  }
});
