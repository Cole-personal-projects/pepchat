export { deriveProviderRoomName } from '@/lib/voice/providerRoomName'

const GENERIC_VOICE_DENIAL = 'Cannot join this room.'
const DEFAULT_TTL_SECONDS = 5 * 60
const MAX_TTL_SECONDS = 10 * 60

type LiveKitEnv = Partial<Pick<NodeJS.ProcessEnv, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET' | 'NODE_ENV'>>

export type MintLiveKitTokenInput = {
  providerRoomName: string
  userId: string
  displayName?: string
  ttlSeconds?: number
}

export type MintLiveKitTokenResult =
  | {
      ok: true
      provider: 'livekit'
      livekitUrl: string
      token: string
      expiresAt: string
    }
  | { error: string }

function ttlSeconds(input?: number): number {
  if (!Number.isFinite(input) || !input || input <= 0) return DEFAULT_TTL_SECONDS
  return Math.min(Math.floor(input), MAX_TTL_SECONDS)
}

function isForbiddenProductionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
    || normalized.startsWith('10.')
    || normalized.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
}

function validateLiveKitEnv(env: LiveKitEnv = process.env): { ok: true; url: string; apiKey: string; apiSecret: string } | { error: string } {
  const url = env.LIVEKIT_URL?.trim()
  const apiKey = env.LIVEKIT_API_KEY?.trim()
  const apiSecret = env.LIVEKIT_API_SECRET?.trim()

  if (!url || !apiKey || !apiSecret) return { error: GENERIC_VOICE_DENIAL }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: GENERIC_VOICE_DENIAL }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') return { error: GENERIC_VOICE_DENIAL }
  if (env.NODE_ENV === 'production' && isForbiddenProductionHost(parsed.hostname)) {
    return { error: GENERIC_VOICE_DENIAL }
  }

  return { ok: true, url, apiKey, apiSecret }
}

function isValidProviderRoomName(providerRoomName: string): boolean {
  const trimmed = providerRoomName.trim()
  return Boolean(trimmed) && trimmed !== '*'
}

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function signHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64Url(JSON.stringify(header))
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

export async function mintLiveKitToken(
  input: MintLiveKitTokenInput,
  options: { env?: LiveKitEnv } = {},
): Promise<MintLiveKitTokenResult> {
  if (!input.userId || !isValidProviderRoomName(input.providerRoomName)) {
    return { error: GENERIC_VOICE_DENIAL }
  }

  const env = validateLiveKitEnv(options.env)
  if ('error' in env) return env

  try {
    const ttl = ttlSeconds(input.ttlSeconds)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const expiresAtSeconds = nowSeconds + ttl
    const token = await signHs256({
      exp: expiresAtSeconds,
      iss: env.apiKey,
      nbf: nowSeconds,
      sub: input.userId,
      ...(input.displayName ? { name: input.displayName } : {}),
      video: {
        room: input.providerRoomName,
        roomJoin: true,
        canPublish: true,
        canPublishData: false,
        canPublishSources: ['microphone'],
        canSubscribe: true,
      },
    }, env.apiSecret)

    return {
      ok: true,
      provider: 'livekit',
      livekitUrl: env.url,
      token,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    }
  } catch {
    return { error: GENERIC_VOICE_DENIAL }
  }
}
