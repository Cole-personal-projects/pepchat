import { AccessToken, TrackSource } from 'livekit-server-sdk'

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

export function deriveProviderRoomName(voiceRoomId: string): string {
  if (!voiceRoomId) throw new Error('voice room id is required')
  return `sidebar:voice:${voiceRoomId}`
}

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
    const accessToken = new AccessToken(env.apiKey, env.apiSecret, {
      identity: input.userId,
      name: input.displayName,
      ttl,
    })
    accessToken.addGrant({
      room: input.providerRoomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: false,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
    })

    return {
      ok: true,
      provider: 'livekit',
      livekitUrl: env.url,
      token: await accessToken.toJwt(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    }
  } catch {
    return { error: GENERIC_VOICE_DENIAL }
  }
}
