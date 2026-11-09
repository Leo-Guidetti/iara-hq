// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
/**
 * Web Push sem dependências — só WebCrypto.
 *  • VAPID (RFC 8292): JWT ES256 assinado com a chave privada do servidor.
 *  • Cifra do conteúdo (RFC 8291, "aes128gcm"): ECDH efêmero + HKDF + AES-128-GCM, num único registro.
 */ const enc = new TextEncoder();
export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for(let i = 0; i < u8.length; i++)s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for(let i = 0; i < bin.length; i++)out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const len = parts.reduce((s, p)=>s + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(len));
  let o = 0;
  for (const p of parts){
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([
    1
  ])));
  return okm.slice(0, length);
}
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({
    name: 'ECDSA',
    namedCurve: 'P-256'
  }, true, [
    'sign',
    'verify'
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: b64urlEncode(raw),
    privateJwk
  };
}
export async function vapidAuthorization(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({
    typ: 'JWT',
    alg: 'ES256'
  })));
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject
  })));
  const jwk = {
    ...keys.privateJwk,
    key_ops: [
      'sign'
    ],
    ext: true
  };
  const key = await crypto.subtle.importKey('jwk', jwk, {
    name: 'ECDSA',
    namedCurve: 'P-256'
  }, false, [
    'sign'
  ]);
  const sig = await crypto.subtle.sign({
    name: 'ECDSA',
    hash: 'SHA-256'
  }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}
export async function encryptPayload(plaintext, p256dh, authSecret, opts = {}) {
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('Assinatura push inválida (chaves).');
  const server = opts.serverKeys ?? await crypto.subtle.generateKey({
    name: 'ECDH',
    namedCurve: 'P-256'
  }, true, [
    'deriveBits'
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, {
    name: 'ECDH',
    namedCurve: 'P-256'
  }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'ECDH',
    public: uaKey
  }, server.privateKey, 256));
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const rs = 4096;
  if (plaintext.length > rs - 17) throw new Error('Mensagem push grande demais.');
  const record = concat(plaintext, new Uint8Array([
    2
  ]));
  const aesKey = await crypto.subtle.importKey('raw', cek, {
    name: 'AES-GCM'
  }, false, [
    'encrypt'
  ]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: nonce,
    tagLength: 128
  }, aesKey, record));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}
export async function sendWebPush(target, payload, vapid, subject, opts = {}) {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(payload)), target.keys.p256dh, target.keys.auth);
    const headers = {
      Authorization: await vapidAuthorization(target.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 6 * 3600),
      Urgency: opts.urgency ?? 'normal'
    };
    if (opts.topic) headers.Topic = opts.topic;
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers,
      body
    });
    const gone = res.status === 404 || res.status === 410;
    if (res.ok) return {
      ok: true,
      status: res.status,
      gone: false
    };
    const text = await res.text().catch(()=>'');
    return {
      ok: false,
      status: res.status,
      gone,
      error: text.slice(0, 300)
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      gone: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
