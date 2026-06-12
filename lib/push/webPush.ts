/**
 * Dependency-free Web Push sender built on WebCrypto so the same code runs
 * on Cloudflare Workers (next-on-pages server actions) and Node (dev, tests).
 *
 * Implements:
 *  - RFC 8291 payload encryption (aes128gcm content encoding, RFC 8188)
 *  - RFC 8292 VAPID authorization (ES256 JWT)
 */

const textEncoder = new TextEncoder()

// ── base64url helpers ───────────────────────────────────────

export function base64UrlToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** BufferSource view WebCrypto accepts without tripping on SharedArrayBuffer types. */
function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

// ── HKDF (RFC 5869) via WebCrypto ───────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', asBuffer(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: asBuffer(salt), info: asBuffer(info) },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

// ── RFC 8291 payload encryption ─────────────────────────────

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

interface EncryptOverrides {
  /** Test injection: fixed app-server ECDH keypair and salt for known-answer vectors. */
  asKeyPair?: CryptoKeyPair
  salt?: Uint8Array
}

/**
 * Encrypts `plaintext` for a push subscription, returning the full
 * aes128gcm body (header || ciphertext) ready to POST to the endpoint.
 */
export async function encryptPayload(
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  plaintext: string,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array> {
  const uaPublicBytes = base64UrlToBytes(subscription.p256dh) // 65-byte uncompressed point
  const authSecret = base64UrlToBytes(subscription.auth)      // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    asBuffer(uaPublicBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  const asKeyPair =
    overrides.asKeyPair ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256),
  )

  // ikm = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concatBytes(textEncoder.encode('WebPush: info\0'), uaPublicBytes, asPublicBytes)
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32)

  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const contentEncryptionKey = await hkdf(salt, ikm, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, textEncoder.encode('Content-Encoding: nonce\0'), 12)

  // Single record: plaintext || 0x02 delimiter (last record marker).
  const padded = concatBytes(textEncoder.encode(plaintext), new Uint8Array([0x02]))
  const aesKey = await crypto.subtle.importKey('raw', asBuffer(contentEncryptionKey), 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuffer(nonce) }, aesKey, asBuffer(padded)),
  )

  // aes128gcm header: salt(16) || record_size(4, BE) || keyid_len(1) || keyid(=as_public, 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublicBytes.length
  header.set(asPublicBytes, 21)

  return concatBytes(header, ciphertext)
}

// ── RFC 8292 VAPID ──────────────────────────────────────────

export interface VapidConfig {
  /** base64url uncompressed P-256 public key (65 bytes). */
  publicKey: string
  /** base64url raw private scalar `d` (32 bytes). */
  privateKey: string
  /** Contact URI, e.g. mailto:ops@example.com. */
  subject: string
}

async function importVapidSigningKey(config: VapidConfig): Promise<CryptoKey> {
  const publicBytes = base64UrlToBytes(config.publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point.')
  }
  // JWK import needs the x/y coordinates, which live inside the public point.
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: config.privateKey,
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** Builds the `Authorization: vapid t=...,k=...` header for a push endpoint. */
export async function vapidAuthorization(endpoint: string, config: VapidConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const audience = new URL(endpoint).origin
  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToBase64Url(
    textEncoder.encode(
      JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 60 * 60, sub: config.subject }),
    ),
  )
  const signingInput = `${header}.${payload}`
  const key = await importVapidSigningKey(config)
  // WebCrypto ECDSA emits the raw 64-byte r||s form JWS ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, asBuffer(textEncoder.encode(signingInput))),
  )
  return `vapid t=${signingInput}.${bytesToBase64Url(signature)}, k=${config.publicKey}`
}

// ── Sender ──────────────────────────────────────────────────

export type WebPushSendResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string; subscriptionGone: boolean }

/**
 * Encrypts and POSTs one payload to one subscription endpoint.
 * `subscriptionGone` flags endpoints the push service reports as dead
 * (404/410) so callers can prune the stored subscription.
 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidConfig,
): Promise<WebPushSendResult> {
  try {
    const body = await encryptPayload(subscription, payload)
    const authorization = await vapidAuthorization(subscription.endpoint, vapid)

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body: asBuffer(body),
    })

    if (response.ok || response.status === 201) {
      return { ok: true, statusCode: response.status }
    }
    return {
      ok: false,
      statusCode: response.status,
      error: `Push service responded ${response.status}`,
      subscriptionGone: response.status === 404 || response.status === 410,
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      error: err instanceof Error ? err.message : 'Push delivery failed',
      subscriptionGone: false,
    }
  }
}
