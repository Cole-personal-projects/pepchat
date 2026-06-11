import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeVoiceChannel,
  createTempVoiceRoom,
  getCurrentVoiceRoom,
  heartbeatVoiceRoom,
  joinVoiceChannel,
  leaveVoiceRoom,
  listVoiceChannels,
  mintVoiceToken,
  startVoiceRoom,
  sweepVoiceRooms,
} from '@/app/(app)/voice/actions'

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockResolveVoiceChannel,
  mockResolveVoiceRoom,
  mockCreateOrReuseVoiceRoom,
  mockGetOpenVoiceRoomForChannel,
  mockGetVoiceRoomParticipantCount,
  mockListAccessibleVoiceChannelsWithOccupancy,
  mockCleanupStaleVoiceParticipants,
  mockCloseVoiceRoomIfEmpty,
  mockTouchVoiceParticipant,
  mockUpsertVoiceParticipant,
  mockMarkVoiceParticipantLeft,
  mockDeleteEphemeralChannelIfEmpty,
  mockSweepEmptyEphemeralChannels,
  mockForceCloseVoiceChannel,
  mockMintLiveKitToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockResolveVoiceChannel: vi.fn(),
  mockResolveVoiceRoom: vi.fn(),
  mockCreateOrReuseVoiceRoom: vi.fn(),
  mockGetOpenVoiceRoomForChannel: vi.fn(),
  mockGetVoiceRoomParticipantCount: vi.fn(),
  mockListAccessibleVoiceChannelsWithOccupancy: vi.fn(),
  mockCleanupStaleVoiceParticipants: vi.fn(),
  mockCloseVoiceRoomIfEmpty: vi.fn(),
  mockTouchVoiceParticipant: vi.fn(),
  mockUpsertVoiceParticipant: vi.fn(),
  mockMarkVoiceParticipantLeft: vi.fn(),
  mockDeleteEphemeralChannelIfEmpty: vi.fn(),
  mockSweepEmptyEphemeralChannels: vi.fn(),
  mockForceCloseVoiceChannel: vi.fn(),
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
  listAccessibleVoiceChannelsWithOccupancy: mockListAccessibleVoiceChannelsWithOccupancy,
  cleanupStaleVoiceParticipants: mockCleanupStaleVoiceParticipants,
  closeVoiceRoomIfEmpty: mockCloseVoiceRoomIfEmpty,
  touchVoiceParticipant: mockTouchVoiceParticipant,
  upsertVoiceParticipant: mockUpsertVoiceParticipant,
  markVoiceParticipantLeft: mockMarkVoiceParticipantLeft,
  deleteEphemeralChannelIfEmpty: mockDeleteEphemeralChannelIfEmpty,
  sweepEmptyEphemeralChannels: mockSweepEmptyEphemeralChannels,
  forceCloseVoiceChannel: mockForceCloseVoiceChannel,
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
    }
    setupUserClient()
    mockResolveVoiceChannel.mockResolvedValue(channel)
    mockResolveVoiceRoom.mockResolvedValue(room)
    mockCreateOrReuseVoiceRoom.mockResolvedValue(createdRoom)
    mockGetOpenVoiceRoomForChannel.mockResolvedValue(createdRoom)
    mockGetVoiceRoomParticipantCount.mockResolvedValue(0)
    mockListAccessibleVoiceChannelsWithOccupancy.mockResolvedValue([
      {
        channelId: 'voice-channel-1',
        groupId: 'group-1',
        name: 'General Voice',
        noobAccess: false,
        room: null,
        participantCount: 0,
      },
      {
        channelId: 'voice-channel-2',
        groupId: 'group-1',
        name: 'Raid Voice',
        noobAccess: false,
        room: { id: 'room-2', status: 'open' },
        participantCount: 3,
      },
    ])
    mockCleanupStaleVoiceParticipants.mockResolvedValue({ ok: true })
    mockCloseVoiceRoomIfEmpty.mockResolvedValue({ ok: true, closed: true })
    mockTouchVoiceParticipant.mockResolvedValue({ ok: true })
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


  it('lists persistent voice channels with occupancy and keeps idle channels visible', async () => {
    setupUserClient({ role: 'user' })

    await expect(listVoiceChannels('group-1')).resolves.toEqual({
      ok: true,
      channels: [
        {
          channelId: 'voice-channel-1',
          groupId: 'group-1',
          name: 'General Voice',
          noobAccess: false,
          room: null,
          participantCount: 0,
        },
        {
          channelId: 'voice-channel-2',
          groupId: 'group-1',
          name: 'Raid Voice',
          noobAccess: false,
          room: { id: 'room-2', status: 'open' },
          participantCount: 3,
        },
      ],
    })

    expect(mockListAccessibleVoiceChannelsWithOccupancy).toHaveBeenCalledWith(expect.anything(), {
      groupId: 'group-1',
      role: 'user',
    })
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


  it('lets authorized users join a persistent voice channel directly and mint a token for the server session', async () => {
    setupUserClient({ role: 'user' })

    await expect(joinVoiceChannel('channel-1')).resolves.toEqual({
      ok: true,
      room: { id: 'room-1', channelId: 'channel-1', groupId: 'group-1', status: 'open', participantCount: 0 },
      provider: 'livekit',
      livekitUrl: 'https://voice.example.com',
      token: 'token.jwt',
      expiresAt: '2026-05-26T00:05:00.000Z',
    })

    expect(mockCleanupStaleVoiceParticipants).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channelId: 'channel-1' }))
    expect(mockCreateOrReuseVoiceRoom).toHaveBeenCalledWith(expect.anything(), {
      channelId: 'channel-1',
      groupId: 'group-1',
      createdBy: 'user-1',
    })
    expect(mockUpsertVoiceParticipant).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1', userId: 'user-1' })
    expect(mockMintLiveKitToken).toHaveBeenCalledWith({
      providerRoomName: 'sidebar:voice:room-1',
      userId: 'user-1',
    })
  })

  it('refreshes participant heartbeat for an authorized active room member', async () => {
    setupUserClient({ role: 'user' })

    await expect(heartbeatVoiceRoom('room-1')).resolves.toEqual({ ok: true })

    expect(mockTouchVoiceParticipant).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1', userId: 'user-1' })
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
    expect(mockCloseVoiceRoomIfEmpty).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1' })
  })
})

describe('createTempVoiceRoom', () => {
  const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  function makeTempRoomClient(role: 'admin' | 'moderator' | 'user' | 'noob' | null) {
    const gate: Record<string, ReturnType<typeof vi.fn>> = {}
    gate.select = vi.fn(() => gate)
    gate.eq = vi.fn(() => gate)
    gate.single = vi.fn().mockResolvedValue(role
      ? { data: { role }, error: null }
      : { data: null, error: { message: 'missing', code: 'PGRST116' } })

    const profile: Record<string, ReturnType<typeof vi.fn>> = {}
    profile.select = vi.fn(() => profile)
    profile.eq = vi.fn(() => profile)
    profile.single = vi.fn().mockResolvedValue({ data: { username: 'cole', display_name: 'Cole' }, error: null })

    const from = vi.fn((table: string) => {
      if (table === 'group_members') return gate
      if (table === 'profiles') return profile
      throw new Error(`unexpected user-scoped table ${table}`)
    })

    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from,
    })

    const positions: Record<string, ReturnType<typeof vi.fn>> = {}
    positions.select = vi.fn(() => positions)
    positions.eq = vi.fn(() => positions)
    positions.order = vi.fn(() => positions)
    positions.limit = vi.fn().mockResolvedValue({ data: [{ position: 4 }], error: null })

    const insert: Record<string, ReturnType<typeof vi.fn>> = {}
    insert.insert = vi.fn(() => insert)
    insert.select = vi.fn(() => insert)
    insert.single = vi.fn().mockResolvedValue({ data: { id: 'channel-temp' }, error: null })

    let adminCall = 0
    const adminFrom = vi.fn((table: string) => {
      if (table !== 'channels') throw new Error(`unexpected admin table ${table}`)
      adminCall += 1
      return adminCall === 1 ? positions : insert
    })

    mockCreateAdminClient.mockReturnValue({ from: adminFrom })

    return { insert, adminFrom }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  afterEach(() => {
    if (ORIGINAL_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
  })

  it('denies noobs', async () => {
    makeTempRoomClient('noob')

    await expect(createTempVoiceRoom('group-1')).resolves.toEqual({ error: 'Cannot join this room.' })
  })

  it('creates an ephemeral voice channel via the admin client with a derived name', async () => {
    const { insert } = makeTempRoomClient('user')

    await expect(createTempVoiceRoom('group-1')).resolves.toEqual({ ok: true, channelId: 'channel-temp' })

    expect(insert.insert).toHaveBeenCalledWith({
      group_id: 'group-1',
      name: "Cole's Room",
      description: null,
      noob_access: false,
      position: 5,
      kind: 'voice',
      is_ephemeral: true,
      created_by: 'user-1',
    })
  })

  it('uses the requested name when provided', async () => {
    const { insert } = makeTempRoomClient('user')

    await expect(createTempVoiceRoom('group-1', '  Game   Night  ')).resolves.toEqual({ ok: true, channelId: 'channel-temp' })

    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Game Night' }))
  })
})

describe('ephemeral cleanup wiring', () => {
  const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockResolveVoiceRoom.mockResolvedValue({
      id: 'room-1',
      channelId: 'channel-1',
      groupId: 'group-1',
      status: 'open',
      providerRoomName: 'sidebar:voice:room-1',
      channelName: 'general',
      noobAccess: false,
    })
    mockMarkVoiceParticipantLeft.mockResolvedValue({ ok: true })
    mockDeleteEphemeralChannelIfEmpty.mockResolvedValue({ ok: true, deleted: true })
    mockSweepEmptyEphemeralChannels.mockResolvedValue({ ok: true })
    mockCleanupStaleVoiceParticipants.mockResolvedValue({ ok: true })
    mockListAccessibleVoiceChannelsWithOccupancy.mockResolvedValue([])

    const gate: Record<string, ReturnType<typeof vi.fn>> = {}
    gate.select = vi.fn(() => gate)
    gate.eq = vi.fn(() => gate)
    gate.single = vi.fn().mockResolvedValue({ data: { role: 'user' }, error: null })
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from: vi.fn(() => gate),
    })
  })

  afterEach(() => {
    if (ORIGINAL_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
  })

  it('deletes the ephemeral channel after the room closes on leave', async () => {
    mockCloseVoiceRoomIfEmpty.mockResolvedValue({ ok: true, closed: true })

    await expect(leaveVoiceRoom('room-1')).resolves.toEqual({ ok: true })

    expect(mockDeleteEphemeralChannelIfEmpty).toHaveBeenCalledWith(expect.anything(), { channelId: 'channel-1' })
  })

  it('does not attempt deletion while the room still has participants', async () => {
    mockCloseVoiceRoomIfEmpty.mockResolvedValue({ ok: true, closed: false })

    await expect(leaveVoiceRoom('room-1')).resolves.toEqual({ ok: true })

    expect(mockDeleteEphemeralChannelIfEmpty).not.toHaveBeenCalled()
  })

  it('sweeps empty ephemeral channels when listing voice channels', async () => {
    await expect(listVoiceChannels('group-1')).resolves.toEqual({ ok: true, channels: [] })

    expect(mockSweepEmptyEphemeralChannels).toHaveBeenCalledWith(expect.anything(), { groupId: 'group-1' })
  })

  it('lets any member trigger the lazy reaper via sweepVoiceRooms', async () => {
    await expect(sweepVoiceRooms('group-1')).resolves.toEqual({ ok: true })

    expect(mockSweepEmptyEphemeralChannels).toHaveBeenCalledWith(expect.anything(), { groupId: 'group-1' })
  })

  it('falls back to user-client stale cleanup when no service role key is configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    await expect(sweepVoiceRooms('group-1')).resolves.toEqual({ ok: true })

    expect(mockSweepEmptyEphemeralChannels).not.toHaveBeenCalled()
    expect(mockCleanupStaleVoiceParticipants).toHaveBeenCalledWith(expect.anything(), { groupId: 'group-1' })
  })
})

describe('closeVoiceChannel', () => {
  const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const adminClient = { from: vi.fn() }

  function setupClose(role: 'admin' | 'moderator' | 'user' | 'noob' | null) {
    const gate: Record<string, ReturnType<typeof vi.fn>> = {}
    gate.select = vi.fn(() => gate)
    gate.eq = vi.fn(() => gate)
    gate.single = vi.fn().mockResolvedValue(role
      ? { data: { role }, error: null }
      : { data: null, error: { message: 'missing', code: 'PGRST116' } })
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from: vi.fn(() => gate),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    mockCreateAdminClient.mockReturnValue(adminClient)
    mockResolveVoiceChannel.mockResolvedValue({ ...channel, kind: 'voice' })
    mockForceCloseVoiceChannel.mockResolvedValue({ ok: true, deletedChannel: true })
  })

  afterEach(() => {
    if (ORIGINAL_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
  })

  it('lets channel managers force-close a voice channel via the admin client', async () => {
    for (const role of ['admin', 'moderator'] as const) {
      vi.clearAllMocks()
      mockCreateAdminClient.mockReturnValue(adminClient)
      mockResolveVoiceChannel.mockResolvedValue({ ...channel, kind: 'voice' })
      mockForceCloseVoiceChannel.mockResolvedValue({ ok: true, deletedChannel: true })
      setupClose(role)

      await expect(closeVoiceChannel('channel-1')).resolves.toEqual({ ok: true, deletedChannel: true })
      expect(mockForceCloseVoiceChannel).toHaveBeenCalledWith(adminClient, { channelId: 'channel-1' })
    }
  })

  it('denies regular members and noobs', async () => {
    for (const role of ['user', 'noob'] as const) {
      vi.clearAllMocks()
      mockResolveVoiceChannel.mockResolvedValue({ ...channel, kind: 'voice' })
      setupClose(role)

      await expect(closeVoiceChannel('channel-1')).resolves.toEqual({ error: GENERIC })
      expect(mockForceCloseVoiceChannel).not.toHaveBeenCalled()
    }
  })

  it('denies when the channel cannot be resolved', async () => {
    setupClose('admin')
    mockResolveVoiceChannel.mockResolvedValue(null)

    await expect(closeVoiceChannel('channel-x')).resolves.toEqual({ error: GENERIC })
    expect(mockForceCloseVoiceChannel).not.toHaveBeenCalled()
  })
})
