// Web Push, written out (RFC 8291 "aes128gcm" encryption and RFC 8292 VAPID), with WebCrypto only.
// Small on purpose: each push runs in its own background job, often on a fresh isolate, so less code to compile
// means less CPU. The signed VAPID token is kept per push service for 12 hours, so most pushes skip signing.
const enc = new TextEncoder();
const b64u = (bytes) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const subtle = () => crypto.subtle;

async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// The encrypted body for one device: salt, record size, our public key, then the AES-GCM sealed payload.
export async function encrypt(p256dh, auth, plaintext) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const as = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await subtle().exportKey('raw', as.publicKey));
  const uaKey = await subtle().importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const derive = async (info, n) => new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, prk, n * 8));
  const [cek, nonce] = await Promise.all([derive('Content-Encoding: aes128gcm\0', 16), derive('Content-Encoding: nonce\0', 12)]);
  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(plaintext), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length;
  return cat(head, asPub, sealed);
}

// VAPID: a token signed with the server's key, one per push service origin, reused for 12 hours.
const tokens = new Map();
let signer;
export async function vapidHeader(privateJwk, audience, subject, now = Date.now()) {
  const hit = tokens.get(audience);
  if (hit && hit.until > now) return hit.value;
  const jwk = typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk;
  if (!signer || signer.d !== jwk.d) signer = { d: jwk.d, key: await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const unsigned = b64u(enc.encode('{"typ":"JWT","alg":"ES256"}')) + '.' + b64u(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.key, enc.encode(unsigned));
  const value = `vapid t=${unsigned}.${b64u(sig)}, k=${b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)))}`;
  tokens.set(audience, { value, until: now + 11 * 3600e3 });
  return value;
}

// Everything needed to send one push: the address, the headers and the encrypted body.
export async function pushRequest({ privateJwk, subject, subscription, payload, ttl = 3600, urgency = 'high', topic }) {
  const body = await encrypt(subscription.p256dh, subscription.auth, typeof payload === 'string' ? payload : JSON.stringify(payload));
  const headers = { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency,
    authorization: await vapidHeader(privateJwk, new URL(subscription.endpoint).origin, subject) };
  if (topic) headers.topic = topic;
  return { endpoint: subscription.endpoint, headers, body };
}
