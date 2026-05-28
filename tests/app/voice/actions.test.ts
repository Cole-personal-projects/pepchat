import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveVoiceRoom, mintVoiceToken, startVoiceRoom } from '@/app/(app)/voice/actions'

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockResolveVoiceChannel,
  mockResolveVoiceRoom,
  mockCreateOrReuseVoiceRoom,
  mockGetVoiceRoomParticipantCount,
  mockUpsertVoiceParticipant,
  mockMarkVoiceParticipantLeft,
  mockMintLiveKitToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockResolveVoiceChannel: vi.fn(),
  mockResolveVoiceRoom: vi.fn(),
  mockCreateOrReuseVoiceRoom: vi.fn(),
  mockGetVoiceRoomParticipantCount: vi.fn(),
  mockUpsertVoiceParticipant: vi.fn(),
  mockMarkVoiceParticipantLeft: vi.fn(),
  mockMintLiveKitToken: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mockCreateAdminClient }))
vi.mock('@/lib/voice/rooms', () => ({
  resolveVoiceChannel: mockResolveVoiceChannel,
  resolveVoiceRoom: mockResolveVoiceRoom,
  createOrReuseVoiceRoom: mockCreateOrReuseVoiceRoom,
  getVoiceRoomParticipantCount: mockGetVoiceRoomParticipantCount,
  upsertVoiceParticipant: mockUpsertVoiceParticipant,
  markVoiceParticipantLeft: mockMarkVoiceParticipantLeft,
}))
vi.mock('@/lib/voice/livekit', () => ({ mintLiveKitToken: mockMintLiveKitToken }))

type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeGateBuilder(role: 'admin' | 'moderator' | 'user' | 'noob' | null = 'admin'): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(role
    ? { data: { role }, error: null }
    : { data: null, error: { message: 'missing', code: 'PGRST116' } })
  return builder
}

function setupUserClient({
  userId = 'user-1',
  role = 'admin' as 'admin' | 'moderator' | 'user' | 'noob' | null,
}: { userId?: string | null; role?: 'admin' | 'moderator' | 'user' | 'noob' | null } = {}) {
  const gate = makeGateBuilder(role)
  const from = vi.fn((table: string) => {
    if (table !== 'group_members') throw new Error(`unexpected user-scoped table ${table}`)
    return gate
  })
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from,
  }
  mockCreateClient.mockResolvedValue(supabase)
  return { supabase, gate, from }
}

const channel = {
  id: 'channel-1',
  groupId: 'group-1',
  name: 'general',
  noobAccess: false,
}

const welcomeChannel = {
  ...channel,
  name: 'welcome',
}

const room = {
  id: 'room-1',
  channelId: 'channel-1',
  groupId: 'group-1',
  status: 'open',
  providerRoomName: 'sidebar:voice:room-1',
  channelName: 'general',
  noobAccess: false,
}

const createdRoom = {
  id: 'room-1',
  channelId: 'channel-1',
  groupId: 'group-1',
  status: 'open',
  providerRoomName: 'sidebar:voice:room-1',
}

const GENERIC = 'Cannot join this room.'
const ORIGINAL_ENV = process.env

describe('voice actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    }
    setupUserClient()
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockResolveVoiceChannel.mockResolvedValue(channel)
    mockResolveVoiceRoom.mockResolvedValue(room)
    mockCreateOrReuseVoiceRoom.mockResolvedValue(createdRoom)
    mockGetVoiceRoomParticipantCount.mockResolvedValue(0)
    mockUpsertVoiceParticipant.mockResolvedValue({ ok: true })
    mockMarkVoiceParticipantLeft.mockResolvedValue({ ok: true })
    mockMintLiveKitToken.mockResolvedValue({
      ok: true,
      provider: 'livekit',
      livekitUrl: 'https://voice.example.com',
      token: 'token.jwt',
      expiresAt: '2026-05-26T00:05:00.000Z',
    })
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns generic denial for unauthenticated start, mint, and leave calls', async () => {
    setupUserClient({ userId: null })

    await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    await expect(leaveVoiceRoom('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('denies non-members before admin writes or token minting', async () => {
    setupUserClient({ role: null })

    await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })

    expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    expect(mockUpsertVoiceParticipant).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('allows admins and moderators, but not users or noobs, to start voice rooms', async () => {
    for (const role of ['admin', 'moderator'] as const) {
      vi.clearAllMocks()
      setupUserClient({ role })
      mockResolveVoiceChannel.mockResolvedValue(channel)
      mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
      mockCreateOrReuseVoiceRoom.mockResolvedValue(createdRoom)
      mockGetVoiceRoomParticipantCount.mockResolvedValue(2)

      await expect(startVoiceRoom('channel-1')).resolves.toEqual({
        ok: true,
        room: { id: 'room-1', channelId: 'channel-1', groupId: 'group-1', status: 'open', participantCount: 2 },
      })
      expect(mockCreateOrReuseVoiceRoom).toHaveBeenCalledWith(expect.anything(), {
        channelId: 'channel-1',
        groupId: 'group-1',
        createdBy: 'user-1',
      })
    }

    for (const role of ['user', 'noob'] as const) {
      vi.clearAllMocks()
      setupUserClient({ role })
      mockResolveVoiceChannel.mockResolvedValue(role === 'noob' ? welcomeChannel : channel)
      await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
      expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    }
  })

  it('lets users mint tokens for open accessible rooms and omits provider secrets from output', async () => {
    setupUserClient({ role: 'user' })

    await expect(mintVoiceToken('room-1')).resolves.toEqual({
      ok: true,
      provider: 'livekit',
      livekitUrl: 'https://voice.example.com',
      token: 'token.jwt',
      expiresAt: '2026-05-26T00:05:00.000Z',
    })

    expect(mockUpsertVoiceParticipant).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1', userId: 'user-1' })
    expect(mockMintLiveKitToken).toHaveBeenCalledWith({
      providerRoomName: 'sidebar:voice:room-1',
      userId: 'user-1',
    })
    const result = await mintVoiceToken('room-1')
    expect(JSON.stringify(result)).not.toContain('LIVEKIT_API_SECRET')
    expect(JSON.stringify(result)).not.toContain('test-secret')
  })

  it('enforces noob channel access for token minting', async () => {
    setupUserClient({ role: 'noob' })
    mockResolveVoiceRoom.mockResolvedValue({ ...room, channelName: 'general', noobAccess: false })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()

    vi.clearAllMocks()
    setupUserClient({ role: 'noob' })
    mockResolveVoiceRoom.mockResolvedValue({ ...room, channelName: 'welcome', noobAccess: false })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockUpsertVoiceParticipant.mockResolvedValue({ ok: true })
    mockMintLiveKitToken.mockResolvedValue({ ok: true, provider: 'livekit', livekitUrl: 'https://voice.example.com', token: 'token.jwt', expiresAt: 'soon' })
    await expect(mintVoiceToken('room-1')).resolves.toMatchObject({ ok: true })

    vi.clearAllMocks()
    setupUserClient({ role: 'noob' })
    mockResolveVoiceRoom.mockResolvedValue({ ...room, channelName: 'rules', noobAccess: true })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockUpsertVoiceParticipant.mockResolvedValue({ ok: true })
    mockMintLiveKitToken.mockResolvedValue({ ok: true, provider: 'livekit', livekitUrl: 'https://voice.example.com', token: 'token.jwt', expiresAt: 'soon' })
    await expect(mintVoiceToken('room-1')).resolves.toMatchObject({ ok: true })
  })

  it('does not mint tokens for closed rooms', async () => {
    setupUserClient({ role: 'user' })
    mockResolveVoiceRoom.mockResolvedValue({ ...room, status: 'closed' })

    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockUpsertVoiceParticipant).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('fails closed when admin client setup or participant writes fail', async () => {
    mockCreateAdminClient.mockImplementation(() => { throw new Error('missing service role') })
    await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()

    vi.clearAllMocks()
    setupUserClient({ role: 'user' })
    mockResolveVoiceRoom.mockResolvedValue(room)
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockUpsertVoiceParticipant.mockResolvedValue({ error: 'write failed' })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('returns room metadata only from startVoiceRoom', async () => {
    const result = await startVoiceRoom('channel-1')

    expect(result).toEqual({
      ok: true,
      room: { id: 'room-1', channelId: 'channel-1', groupId: 'group-1', status: 'open', participantCount: 0 },
    })
    expect(JSON.stringify(result)).not.toContain('token')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('ignores arbitrary client room names and scopes tokens to the server-resolved provider room name', async () => {
    await expect(mintVoiceToken('room-1', { providerRoomName: 'attacker-room' })).resolves.toMatchObject({ ok: true })

    expect(mockMintLiveKitToken).toHaveBeenCalledWith({
      providerRoomName: 'sidebar:voice:room-1',
      userId: 'user-1',
    })
    expect(mockMintLiveKitToken).not.toHaveBeenCalledWith(expect.objectContaining({ providerRoomName: 'attacker-room' }))
  })

  it('marks only the caller participant as left after authorization', async () => {
    await expect(leaveVoiceRoom('room-1')).resolves.toEqual({ ok: true })

    expect(mockMarkVoiceParticipantLeft).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1', userId: 'user-1' })
  })
})
