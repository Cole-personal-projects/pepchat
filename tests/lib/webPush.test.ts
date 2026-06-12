// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
  type VapidConfig,
} from '@/lib/push/webPush'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', asBuffer(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: asBuffer(salt), info: asBuffer(info) },
    key,
    length * 8,
  ))
}

/** Browser-side RFC 8291 decryption, used to round-trip-verify the encryptor. */
async function decryptPayload(
  body: Uint8Array,
  uaKeyPair: CryptoKeyPair,
  authSecret: Uint8Array,
): Promise<string> {
  const salt = body.slice(0, 16)
  const recordSize = new DataView(asBuffer(body.slice(16, 20))).getUint32(0)
  expect(recordSize).toBe(4096)
  const keyIdLength = body[20]
  expect(keyIdLength).toBe(65)
  const asPublicBytes = body.slice(21, 21 + keyIdLength)
  const ciphertext = body.slice(21 + keyIdLength)

  const asPublicKey = await crypto.subtle.importKey(
    'raw', asBuffer(asPublicBytes), { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublicKey }, uaKeyPair.privateKey, 256),
  )
  const uaPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeyPair.publicKey))

  const keyInfo = new Uint8Array([
    ...textEncoder.encode('WebPush: info\0'), ...uaPublicBytes, ...asPublicBytes,
  ])
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, textEncoder.encode('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', asBuffer(cek), 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBuffer(nonce) }, aesKey, asBuffer(ciphertext)),
  )
  expect(padded[padded.length - 1]).toBe(0x02)
  return textDecoder.decode(padded.slice(0, -1))
}

async function makeSubscriber() {
  const uaKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )
  const uaPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeyPair.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  return {
    uaKeyPair,
    authSecret,
    subscription: {
      endpoint: 'https://push.example.com/send/abc123',
      p256dh: bytesToBase64Url(uaPublicBytes),
      auth: bytesToBase64Url(authSecret),
    },
  }
}

async function makeVapid(): Promise<VapidConfig> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return {
    publicKey: bytesToBase64Url(raw),
    privateKey: jwk.d!,
    subject: 'mailto:test@example.com',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('encryptPayload (RFC 8291 aes128gcm)', () => {
  it('round-trips: the subscriber can decrypt what the sender encrypted', async () => {
    const { uaKeyPair, authSecret, subscription } = await makeSubscriber()
    const message = JSON.stringify({ title: 'Ashe mentioned you', body: 'hello!', url: '/channels/x' })

    const body = await encryptPayload(subscription, message)
    const decrypted = await decryptPayload(body, uaKeyPair, authSecret)

    expect(decrypted).toBe(message)
  })

  it('produces a well-formed aes128gcm record', async () => {
    const { subscription } = await makeSubscriber()
    const message = 'When I grow up, I want to be a watermelon'

    const body = await encryptPayload(subscription, message)

    // header(86) + plaintext + delimiter(1) + GCM tag(16)
    expect(body.length).toBe(86 + message.length + 1 + 16)
    expect(body[20]).toBe(65) // keyid is the 65-byte app-server public point
    expect(body[21]).toBe(0x04) // uncompressed point marker
  })

  it('uses a fresh salt and key per call', async () => {
    const { subscription } = await makeSubscriber()
    const a = await encryptPayload(subscription, 'same message')
    const b = await encryptPayload(subscription, 'same message')
    expect(bytesToBase64Url(a.slice(0, 16))).not.toBe(bytesToBase64Url(b.slice(0, 16)))
  })
})

describe('vapidAuthorization (RFC 8292)', () => {
  it('emits a verifiable ES256 JWT bound to the endpoint origin', async () => {
    const vapid = await makeVapid()
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz', vapid, 1_700_000_000)

    const match = header.match(/^vapid t=([^,]+), k=(.+)$/)
    expect(match).not.toBeNull()
    const [, jwt, k] = match!
    expect(k).toBe(vapid.publicKey)

    const [headerPart, payloadPart, signaturePart] = jwt.split('.')
    const claims = JSON.parse(textDecoder.decode(base64UrlToBytes(payloadPart)))
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:test@example.com')
    expect(claims.exp).toBe(1_700_000_000 + 12 * 60 * 60)

    const publicBytes = base64UrlToBytes(vapid.publicKey)
    const verifyKey = await crypto.subtle.importKey(
      'raw', asBuffer(publicBytes), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      asBuffer(base64UrlToBytes(signaturePart)),
      asBuffer(textEncoder.encode(`${headerPart}.${payloadPart}`)),
    )
    expect(valid).toBe(true)
  })
})

describe('sendWebPush', () => {
  it('POSTs an encrypted body with push-protocol headers', async () => {
    const { subscription } = await makeSubscriber()
    const vapid = await makeVapid()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWebPush(subscription, 'payload', vapid)

    expect(result).toEqual({ ok: true, statusCode: 201 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(subscription.endpoint)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Encoding']).toBe('aes128gcm')
    expect(init.headers.TTL).toBe('86400')
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/)
    expect(init.body.byteLength).toBeGreaterThan(86)
  })

  it('flags 410 responses as prunable subscriptions', async () => {
    const { subscription } = await makeSubscriber()
    const vapid = await makeVapid()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 410 })))

    const result = await sendWebPush(subscription, 'payload', vapid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(410)
      expect(result.subscriptionGone).toBe(true)
    }
  })

  it('reports network failures without throwing', async () => {
    const { subscription } = await makeSubscriber()
    const vapid = await makeVapid()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))

    const result = await sendWebPush(subscription, 'payload', vapid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.subscriptionGone).toBe(false)
      expect(result.error).toBe('socket hang up')
    }
  })
})
