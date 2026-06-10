import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempVoiceChannel, getCurrentVoiceRoom, leaveVoiceRoom, mintVoiceToken, startVoiceRoom } from '@/app/(app)/voice/actions'

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockResolveVoiceChannel,
  mockResolveVoiceRoom,
  mockCreateOrReuseVoiceRoom,
  mockGetOpenVoiceRoomForChannel,
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
  mockGetOpenVoiceRoomForChannel: vi.fn(),
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
  getOpenVoiceRoomForChannel: mockGetOpenVoiceRoomForChannel,
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
  profile = null as { username?: string | null; display_name?: string | null } | null,
}: { userId?: string | null; role?: 'admin' | 'moderator' | 'user' | 'noob' | null; profile?: { username?: string | null; display_name?: string | null } | null } = {}) {
  const gate = makeGateBuilder(role)
  const profileBuilder = makeResolvedBuilder({ data: profile, error: null })
  const from = vi.fn((table: string) => {
    if (table === 'profiles') return profileBuilder
    if (table !== 'group_members') throw new Error(`unexpected user-scoped table ${table}`)
    return gate
  })
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from,
  }
  mockCreateClient.mockResolvedValue(supabase)
  return { supabase, gate, from, profileBuilder }
}

function makeResolvedBuilder(result: unknown): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

function setupAdminClient() {
  const positionBuilder = makeResolvedBuilder({ data: [{ position: 6 }], error: null })
  const insertBuilder = makeResolvedBuilder({
    data: { id: 'temp-channel-1', group_id: 'group-1', name: 'alice-room', noob_access: false, position: 7 },
    error: null,
  })
  const channelBuilders = [positionBuilder, insertBuilder]
  const adminClient = {
    from: vi.fn((table: string) => {
      if (table !== 'channels') throw new Error(`unexpected admin table ${table}`)
      const builder = channelBuilders.shift()
      if (!builder) throw new Error('unexpected channels admin call')
      return builder
    }),
  }
  mockCreateAdminClient.mockReturnValue(adminClient)
  return { adminClient, positionBuilder, insertBuilder }
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
const CREATE_GENERIC = 'Cannot create voice chat.'
const ORIGINAL_ENV = process.env

describe('voice actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.com',
    }
    setupUserClient()
    mockResolveVoiceChannel.mockResolvedValue(channel)
    mockResolveVoiceRoom.mockResolvedValue(room)
    mockCreateOrReuseVoiceRoom.mockResolvedValue(createdRoom)
    mockGetOpenVoiceRoomForChannel.mockResolvedValue(createdRoom)
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
    setupAdminClient()
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns generic denial for unauthenticated start, mint, and leave calls', async () => {
    setupUserClient({ userId: null })

    await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    await expect(createTempVoiceChannel('group-1')).resolves.toEqual({ error: CREATE_GENERIC })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })
    await expect(leaveVoiceRoom('room-1')).resolves.toEqual({ error: GENERIC })
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('denies non-members before admin writes or token minting', async () => {
    setupUserClient({ role: null })

    await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    await expect(createTempVoiceChannel('group-1')).resolves.toEqual({ error: CREATE_GENERIC })
    await expect(mintVoiceToken('room-1')).resolves.toEqual({ error: GENERIC })

    expect(mockCreateAdminClient).not.toHaveBeenCalled()
    expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    expect(mockUpsertVoiceParticipant).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('denies noobs before creating temporary voice channels', async () => {
    setupUserClient({ role: 'noob' })

    await expect(createTempVoiceChannel('group-1', 'Noob room')).resolves.toEqual({ error: CREATE_GENERIC })

    expect(mockCreateAdminClient).not.toHaveBeenCalled()
    expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    expect(mockUpsertVoiceParticipant).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it.each(['user', 'moderator', 'admin'] as const)(
    'lets %s create a temporary voice channel, joins them, and returns a token',
    async (role) => {
      setupUserClient({ role })
      const { adminClient, positionBuilder, insertBuilder } = setupAdminClient()
      mockGetVoiceRoomParticipantCount.mockResolvedValue(1)
      mockCreateOrReuseVoiceRoom.mockResolvedValue({ ...createdRoom, channelId: 'temp-channel-1' })

      await expect(createTempVoiceChannel('group-1', 'Alice Room')).resolves.toEqual({
        ok: true,
        room: { id: 'room-1', channelId: 'temp-channel-1', groupId: 'group-1', status: 'open', participantCount: 1, isEphemeral: true },
        provider: 'livekit',
        livekitUrl: 'https://voice.example.com',
        token: 'token.jwt',
        expiresAt: '2026-05-26T00:05:00.000Z',
      })

      expect(mockCreateAdminClient).toHaveBeenCalledOnce()
      expect(adminClient.from).toHaveBeenNthCalledWith(1, 'channels')
      expect(positionBuilder.select).toHaveBeenCalledWith('position')
      expect(positionBuilder.eq).toHaveBeenCalledWith('group_id', 'group-1')
      expect(positionBuilder.order).toHaveBeenCalledWith('position', { ascending: false })
      expect(positionBuilder.limit).toHaveBeenCalledWith(1)
      expect(insertBuilder.insert).toHaveBeenCalledWith({
        group_id: 'group-1',
        name: 'alice-room',
        is_ephemeral: true,
        created_by: 'user-1',
        noob_access: false,
        position: 7,
      })
      expect(mockCreateOrReuseVoiceRoom).toHaveBeenCalledWith(adminClient, {
        channelId: 'temp-channel-1',
        groupId: 'group-1',
        createdBy: 'user-1',
      })
      expect(mockUpsertVoiceParticipant).toHaveBeenCalledWith(adminClient, { roomId: 'room-1', userId: 'user-1' })
      expect(mockMintLiveKitToken).toHaveBeenCalledWith({
        providerRoomName: 'sidebar:voice:room-1',
        userId: 'user-1',
      })
    },
  )

  it('uses a sanitized profile default when temporary voice channel name is omitted', async () => {
    setupUserClient({ role: 'user', profile: { username: 'alice', display_name: "Alice's Display" } })
    const { insertBuilder } = setupAdminClient()
    mockGetVoiceRoomParticipantCount.mockResolvedValue(1)
    mockCreateOrReuseVoiceRoom.mockResolvedValue({ ...createdRoom, channelId: 'temp-channel-1' })

    await expect(createTempVoiceChannel('group-1')).resolves.toMatchObject({
      ok: true,
      room: { id: 'room-1', channelId: 'temp-channel-1', groupId: 'group-1', status: 'open', participantCount: 1, isEphemeral: true },
    })

    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'alice-s-display-s-room',
      is_ephemeral: true,
      created_by: 'user-1',
    }))
  })

  it('allows admins, but not moderators, users, or noobs, to start voice rooms', async () => {
    for (const role of ['admin'] as const) {
      vi.clearAllMocks()
      setupUserClient({ role })
      mockResolveVoiceChannel.mockResolvedValue(channel)
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

    for (const role of ['moderator', 'user', 'noob'] as const) {
      vi.clearAllMocks()
      setupUserClient({ role })
      mockResolveVoiceChannel.mockResolvedValue(role === 'noob' ? welcomeChannel : channel)
      await expect(startVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
      expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    }
  })

  it('allows authorized users to discover the current open room without provider metadata', async () => {
    setupUserClient({ role: 'user' })
    mockGetOpenVoiceRoomForChannel.mockResolvedValue(createdRoom)
    mockGetVoiceRoomParticipantCount.mockResolvedValue(2)

    await expect(getCurrentVoiceRoom('channel-1')).resolves.toEqual({
      ok: true,
      room: { id: 'room-1', channelId: 'channel-1', groupId: 'group-1', status: 'open', participantCount: 2 },
    })

    expect(mockGetOpenVoiceRoomForChannel).toHaveBeenCalledWith(expect.anything(), 'channel-1')
    expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    const result = await getCurrentVoiceRoom('channel-1')
    expect(JSON.stringify(result)).not.toContain('providerRoomName')
    expect(JSON.stringify(result)).not.toContain('sidebar:voice')
  })

  it('returns null when authorized room discovery finds no open room', async () => {
    setupUserClient({ role: 'user' })
    mockGetOpenVoiceRoomForChannel.mockResolvedValue(null)

    await expect(getCurrentVoiceRoom('channel-1')).resolves.toEqual({ ok: true, room: null })
  })

  it('denies unauthorized current-room discovery before admin reads', async () => {
    setupUserClient({ role: null })

    await expect(getCurrentVoiceRoom('channel-1')).resolves.toEqual({ error: GENERIC })
    expect(mockGetOpenVoiceRoomForChannel).not.toHaveBeenCalled()
  })


  it('lets authorized non-admin users discover an already-open room for a channel', async () => {
    setupUserClient({ role: 'user' })
    mockGetVoiceRoomParticipantCount.mockResolvedValue(3)

    await expect(getCurrentVoiceRoom('channel-1')).resolves.toEqual({
      ok: true,
      room: { id: 'room-1', channelId: 'channel-1', groupId: 'group-1', status: 'open', participantCount: 3 },
    })

    expect(mockGetOpenVoiceRoomForChannel).toHaveBeenCalledWith(expect.anything(), 'channel-1')
    expect(mockCreateOrReuseVoiceRoom).not.toHaveBeenCalled()
    expect(mockMintLiveKitToken).not.toHaveBeenCalled()
  })

  it('returns null current room without leaking room existence details when none is open', async () => {
    setupUserClient({ role: 'user' })
    mockGetOpenVoiceRoomForChannel.mockResolvedValue(null)

    await expect(getCurrentVoiceRoom('channel-1')).resolves.toEqual({ ok: true, room: null })
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
    mockUpsertVoiceParticipant.mockResolvedValue({ ok: true })
    mockMintLiveKitToken.mockResolvedValue({ ok: true, provider: 'livekit', livekitUrl: 'https://voice.example.com', token: 'token.jwt', expiresAt: 'soon' })
    await expect(mintVoiceToken('room-1')).resolves.toMatchObject({ ok: true })

    vi.clearAllMocks()
    setupUserClient({ role: 'noob' })
    mockResolveVoiceRoom.mockResolvedValue({ ...room, channelName: 'rules', noobAccess: true })
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

  it('does not require a service-role key for voice room writes and fails closed when participant writes fail', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await expect(startVoiceRoom('channel-1')).resolves.toMatchObject({ ok: true })

    vi.clearAllMocks()
    setupUserClient({ role: 'user' })
    mockResolveVoiceRoom.mockResolvedValue(room)
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
