// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveProviderRoomName, mintLiveKitToken } from '@/lib/voice/livekit'

const ORIGINAL_ENV = process.env

function setLiveKitEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    LIVEKIT_URL: 'https://voice.example.com',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'test-secret',
    ...overrides,
  }
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

describe('deriveProviderRoomName', () => {
  it('derives stable server room names from SideBar room IDs only', () => {
    expect(deriveProviderRoomName('room-123')).toBe('sidebar:voice:room-123')
    expect(deriveProviderRoomName('room-123')).not.toContain('general')
    expect(deriveProviderRoomName('room-123')).not.toContain('user-1')
  })

  it('rejects empty room IDs before provider room derivation', () => {
    expect(() => deriveProviderRoomName('')).toThrow('voice room id is required')
  })
})

describe('mintLiveKitToken', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-26T00:00:00.000Z'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setLiveKitEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = ORIGINAL_ENV
  })

  it('fails closed when LiveKit env is missing', async () => {
    const result = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1' }, {
      env: { LIVEKIT_URL: 'https://voice.example.com', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: 'secret' },
    })

    expect(result).toEqual({ error: 'Cannot join this room.' })
  })

  it('fails closed for invalid URL protocols', async () => {
    const result = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1' }, {
      env: { LIVEKIT_URL: 'http://voice.example.com', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' },
    })

    expect(result).toEqual({ error: 'Cannot join this room.' })
  })

  it('fails closed for localhost/non-TLS URLs in production', async () => {
    const result = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1' }, {
      env: {
        NODE_ENV: 'production',
        LIVEKIT_URL: 'https://localhost:7880',
        LIVEKIT_API_KEY: 'key',
        LIVEKIT_API_SECRET: 'secret',
      },
    })

    expect(result).toEqual({ error: 'Cannot join this room.' })
  })

  it('defaults TTL to 5 minutes and caps requested TTL at 10 minutes', async () => {
    const defaultResult = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1' })
    const cappedResult = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1', ttlSeconds: 3600 })

    expect(defaultResult).toMatchObject({ ok: true, livekitUrl: 'https://voice.example.com' })
    expect(cappedResult).toMatchObject({ ok: true })
    if ('ok' in defaultResult) expect(defaultResult.expiresAt).toBe('2026-05-26T00:05:00.000Z')
    if ('ok' in cappedResult) expect(cappedResult.expiresAt).toBe('2026-05-26T00:10:00.000Z')
  })

  it('mints audio-only grants scoped exactly to the provider room name', async () => {
    const result = await mintLiveKitToken({
      providerRoomName: 'sidebar:voice:room-1',
      userId: 'user-1',
      displayName: 'Visible Name',
    })

    expect(result).toMatchObject({ ok: true, provider: 'livekit' })
    if (!('ok' in result)) throw new Error('expected token')
    const payload = decodeJwtPayload(result.token)

    expect(payload.iss).toBe('test-key')
    expect(payload.sub).toBe('user-1')
    expect(payload.name).toBe('Visible Name')
    expect(payload.video).toEqual({
      room: 'sidebar:voice:room-1',
      roomJoin: true,
      canPublish: true,
      canPublishData: false,
      canPublishSources: ['microphone'],
      canSubscribe: true,
    })
    expect(payload.video.room).not.toBe('*')
    expect(payload.video.canPublishSources).not.toContain('camera')
    expect(payload.video.canPublishSources).not.toContain('screen_share')
  })

  it('rejects empty and wildcard provider room names', async () => {
    await expect(mintLiveKitToken({ providerRoomName: '', userId: 'user-1' })).resolves.toEqual({ error: 'Cannot join this room.' })
    await expect(mintLiveKitToken({ providerRoomName: '*', userId: 'user-1' })).resolves.toEqual({ error: 'Cannot join this room.' })
  })

  it('does not log generated JWTs or provider secrets', async () => {
    const result = await mintLiveKitToken({ providerRoomName: 'sidebar:voice:room-1', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('test-secret'))
    if ('ok' in result) {
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(result.token))
    }
  })
})
