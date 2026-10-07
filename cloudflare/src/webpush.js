// Web Push bez knižníc (len WebCrypto):
// - šifrovanie obsahu podľa RFC 8291 (aes128gcm, RFC 8188),
// - prihlásenie odosielateľa VAPID podľa RFC 8292 (JWT podpísaný ES256).
// Kľúče VAPID si server vytvorí sám pri prvom použití a drží ich v D1.

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Nový pár kľúčov VAPID: { publicKey (base64url, 65 B), privateJwk }. */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64urlEncode(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

/** Hlavička Authorization pre push službu (JWT platný 12 hodín). */
export async function vapidAuthorization(endpoint, vapid, subject) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
    )
  );
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** Zašifruje obsah pre odberateľa (keys.p256dh, keys.auth) – telo požiadavky aes128gcm. */
export async function encryptPayload(subscriptionKeys, payload) {
  const uaPublic = b64urlDecode(subscriptionKeys.p256dh);
  const authSecret = b64urlDecode(subscriptionKeys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Neplatné kľúče odberu.');

  const asPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256)
  );

  // RFC 8291 §3.4: IKM z ECDH tajomstva a auth tajomstva odberateľa.
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plaintext = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  // Hlavička RFC 8188: salt (16) | veľkosť záznamu (4) | dĺžka keyid (1) | keyid = verejný kľúč odosielateľa.
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/**
 * Pošle push správu. Vráti HTTP stav push služby (201 = doručené do fronty,
 * 404/410 = odber už neplatí).
 */
export async function sendWebPush(subscription, payload, vapid, subject, { ttl = 24 * 3600, urgency = 'normal' } = {}) {
  const body = await encryptPayload(subscription.keys, payload);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(subscription.endpoint, vapid, subject),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(ttl),
      urgency,
    },
    body,
  });
  return res.status;
}
