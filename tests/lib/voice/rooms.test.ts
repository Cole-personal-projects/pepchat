import { describe, expect, it, vi } from 'vitest'
import {
  cleanupStaleVoiceParticipants,
  closeVoiceRoomIfEmpty,
  createOrReuseVoiceRoom,
  forceCloseVoiceChannel,
  listAccessibleVoiceChannelsWithOccupancy,
  sweepEmptyEphemeralChannels,
} from '@/lib/voice/rooms'

type QueryResponse = { data?: unknown; error?: unknown; count?: number | null }
type Query = Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResponse>

function makeQuery(response: QueryResponse = { data: null, error: null }): Query {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    is: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    insert: vi.fn(() => query),
    update: vi.fn(() => query),
    delete: vi.fn(() => query),
    single: vi.fn().mockResolvedValue(response),
    maybeSingle: vi.fn().mockResolvedValue(response),
    then: vi.fn((resolve, reject) => Promise.resolve(response).then(resolve, reject)),
  } as unknown as Query
  return query
}

function makeSupabase(queries: Record<string, Query[]>) {
  return {
    from: vi.fn((table: string) => {
      const next = queries[table]?.shift()
      if (!next) throw new Error(`Unexpected table query: ${table}`)
      return next
    }),
  }
}

describe('voice room lifecycle helpers', () => {
  it('reopens an idle persistent room instead of creating a new provider session', async () => {
    const idleRoomLookup = makeQuery({
      data: {
        id: 'room-idle',
        channel_id: 'voice-lounge',
        group_id: 'grp-1',
        status: 'idle',
        provider_room_name: 'sidebar:voice:room-idle',
      },
      error: null,
    })
    const reopenRoom = makeQuery({
      data: {
        id: 'room-idle',
        channel_id: 'voice-lounge',
        group_id: 'grp-1',
        status: 'open',
        provider_room_name: 'sidebar:voice:room-idle',
      },
      error: null,
    })
    const supabase = makeSupabase({ voice_rooms: [idleRoomLookup, reopenRoom] })

    await expect(createOrReuseVoiceRoom(supabase as never, {
      channelId: 'voice-lounge',
      groupId: 'grp-1',
      createdBy: 'user-1',
    })).resolves.toEqual({
      id: 'room-idle',
      channelId: 'voice-lounge',
      groupId: 'grp-1',
      status: 'open',
      providerRoomName: 'sidebar:voice:room-idle',
      channelName: undefined,
      noobAccess: undefined,
    })

    expect(idleRoomLookup.in).toHaveBeenCalledWith('status', ['open', 'idle'])
    expect(reopenRoom.update).toHaveBeenCalledWith({ status: 'open', closed_at: null })
    expect(reopenRoom.eq).toHaveBeenCalledWith('id', 'room-idle')
    expect(reopenRoom.insert).not.toHaveBeenCalled()
  })

  it('idles an open room when the last active participant leaves', async () => {
    const participantCount = makeQuery({ count: 0, error: null })
    const idleRoom = makeQuery({ data: null, error: null })
    const supabase = makeSupabase({
      voice_room_participants: [participantCount],
      voice_rooms: [idleRoom],
    })

    await expect(closeVoiceRoomIfEmpty(supabase as never, { roomId: 'room-1' })).resolves.toEqual({ ok: true, closed: true })

    expect(participantCount.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(participantCount.eq).toHaveBeenCalledWith('room_id', 'room-1')
    expect(participantCount.is).toHaveBeenCalledWith('left_at', null)
    expect(idleRoom.update).toHaveBeenCalledWith({ status: 'idle', closed_at: expect.any(String) })
    expect(idleRoom.eq).toHaveBeenCalledWith('id', 'room-1')
    expect(idleRoom.eq).toHaveBeenCalledWith('status', 'open')
  })

  it('keeps an open room active while any participant is still present', async () => {
    const participantCount = makeQuery({ count: 2, error: null })
    const supabase = makeSupabase({ voice_room_participants: [participantCount] })

    await expect(closeVoiceRoomIfEmpty(supabase as never, { roomId: 'room-1' })).resolves.toEqual({ ok: true, closed: false })

    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).not.toHaveBeenCalledWith('voice_rooms')
  })

  it('expires stale participants scoped to a channel and idles the room after cleanup', async () => {
    const liveRooms = makeQuery({ data: [{ id: 'room-stale' }], error: null })
    const markStaleLeft = makeQuery({ data: null, error: null })
    const participantCount = makeQuery({ count: 0, error: null })
    const idleRoom = makeQuery({ data: null, error: null })
    const supabase = makeSupabase({
      voice_rooms: [liveRooms, idleRoom],
      voice_room_participants: [markStaleLeft, participantCount],
    })

    await expect(cleanupStaleVoiceParticipants(supabase as never, {
      channelId: 'voice-lounge',
      staleAfterSeconds: 30,
    })).resolves.toEqual({ ok: true })

    expect(liveRooms.in).toHaveBeenCalledWith('status', ['open', 'idle'])
    expect(liveRooms.eq).toHaveBeenCalledWith('channel_id', 'voice-lounge')
    expect(markStaleLeft.update).toHaveBeenCalledWith({ left_at: expect.any(String) })
    expect(markStaleLeft.is).toHaveBeenCalledWith('left_at', null)
    expect(markStaleLeft.lt).toHaveBeenCalledWith('last_seen_at', expect.any(String))
    expect(markStaleLeft.in).toHaveBeenCalledWith('room_id', ['room-stale'])
    expect(idleRoom.update).toHaveBeenCalledWith({ status: 'idle', closed_at: expect.any(String) })
  })

  it('lists accessible voice channels with open or idle occupancy', async () => {
    const channels = makeQuery({
      data: [
        { id: 'voice-general', group_id: 'grp-1', name: 'General Voice', noob_access: false, kind: 'voice' },
      ],
      error: null,
    })
    const idleRoom = makeQuery({
      data: {
        id: 'room-general',
        channel_id: 'voice-general',
        group_id: 'grp-1',
        status: 'idle',
        provider_room_name: 'sidebar:voice:room-general',
      },
      error: null,
    })
    const countGeneral = makeQuery({ count: 0, error: null })
    const supabase = makeSupabase({
      channels: [channels],
      voice_rooms: [idleRoom],
      voice_room_participants: [countGeneral],
    })

    await expect(listAccessibleVoiceChannelsWithOccupancy(supabase as never, {
      groupId: 'grp-1',
      role: 'user',
    })).resolves.toEqual([
      {
        channelId: 'voice-general',
        groupId: 'grp-1',
        name: 'General Voice',
        noobAccess: false,
        room: { id: 'room-general', status: 'idle' },
        participantCount: 0,
      },
    ])

    expect(idleRoom.in).toHaveBeenCalledWith('status', ['open', 'idle'])
    expect(countGeneral.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(countGeneral.eq).toHaveBeenCalledWith('room_id', 'room-general')
  })

  it('sweep expires stale participants with the admin client before reaping ephemeral channels', async () => {
    // Cleanup pass (admin client, group scoped)
    const cleanupRooms = makeQuery({ data: [{ id: 'room-stale' }], error: null })
    const markStaleLeft = makeQuery({ data: null, error: null })
    const countAfterCleanup = makeQuery({ count: 0, error: null })
    const idleRoom = makeQuery({ data: null, error: null })
    // Sweep pass
    const ephemeralList = makeQuery({ data: [{ id: 'chan-eph' }], error: null })
    const channelLookup = makeQuery({ data: { id: 'chan-eph', is_ephemeral: true }, error: null })
    const liveRoomForChannel = makeQuery({ data: null, error: null })
    const channelDelete = makeQuery({ data: null, error: null })
    const adminClient = makeSupabase({
      voice_rooms: [cleanupRooms, idleRoom, liveRoomForChannel],
      voice_room_participants: [markStaleLeft, countAfterCleanup],
      channels: [ephemeralList, channelLookup, channelDelete],
    })

    await expect(sweepEmptyEphemeralChannels(adminClient as never, { groupId: 'grp-1' })).resolves.toEqual({ ok: true })

    // Stale rows from any user are released before the emptiness check…
    expect(cleanupRooms.eq).toHaveBeenCalledWith('group_id', 'grp-1')
    expect(markStaleLeft.update).toHaveBeenCalledWith({ left_at: expect.any(String) })
    expect(markStaleLeft.lt).toHaveBeenCalledWith('last_seen_at', expect.any(String))
    // …so the abandoned ephemeral channel actually gets deleted.
    expect(channelDelete.delete).toHaveBeenCalled()
    expect(channelDelete.eq).toHaveBeenCalledWith('id', 'chan-eph')
    expect(channelDelete.eq).toHaveBeenCalledWith('is_ephemeral', true)
  })

  it('force-closes a stuck ephemeral voice channel: clears participants, closes rooms, deletes channel', async () => {
    const channelLookup = makeQuery({ data: { id: 'chan-eph', is_ephemeral: true, kind: 'voice' }, error: null })
    const liveRooms = makeQuery({ data: [{ id: 'room-1' }, { id: 'room-2' }], error: null })
    const participantsUpdate = makeQuery({ data: null, error: null })
    const roomsClose = makeQuery({ data: null, error: null })
    const channelDelete = makeQuery({ data: null, error: null })
    const adminClient = makeSupabase({
      channels: [channelLookup, channelDelete],
      voice_rooms: [liveRooms, roomsClose],
      voice_room_participants: [participantsUpdate],
    })

    await expect(forceCloseVoiceChannel(adminClient as never, { channelId: 'chan-eph' })).resolves.toEqual({
      ok: true,
      deletedChannel: true,
    })

    expect(participantsUpdate.update).toHaveBeenCalledWith({ left_at: expect.any(String) })
    expect(participantsUpdate.in).toHaveBeenCalledWith('room_id', ['room-1', 'room-2'])
    expect(participantsUpdate.is).toHaveBeenCalledWith('left_at', null)
    expect(roomsClose.update).toHaveBeenCalledWith({ status: 'closed', closed_at: expect.any(String) })
    expect(roomsClose.in).toHaveBeenCalledWith('id', ['room-1', 'room-2'])
    expect(channelDelete.delete).toHaveBeenCalled()
    expect(channelDelete.eq).toHaveBeenCalledWith('is_ephemeral', true)
  })

  it('force-close keeps persistent voice channels and only closes their rooms', async () => {
    const channelLookup = makeQuery({ data: { id: 'chan-voice', is_ephemeral: false, kind: 'voice' }, error: null })
    const liveRooms = makeQuery({ data: [{ id: 'room-1' }], error: null })
    const participantsUpdate = makeQuery({ data: null, error: null })
    const roomsClose = makeQuery({ data: null, error: null })
    const adminClient = makeSupabase({
      channels: [channelLookup],
      voice_rooms: [liveRooms, roomsClose],
      voice_room_participants: [participantsUpdate],
    })

    await expect(forceCloseVoiceChannel(adminClient as never, { channelId: 'chan-voice' })).resolves.toEqual({
      ok: true,
      deletedChannel: false,
    })

    expect(roomsClose.update).toHaveBeenCalledWith({ status: 'closed', closed_at: expect.any(String) })
  })

  it('force-close rejects non-voice channels', async () => {
    const channelLookup = makeQuery({ data: { id: 'chan-text', is_ephemeral: false, kind: 'text' }, error: null })
    const adminClient = makeSupabase({ channels: [channelLookup] })

    await expect(forceCloseVoiceChannel(adminClient as never, { channelId: 'chan-text' })).resolves.toEqual({
      error: 'Cannot close this room.',
    })
  })

  it('filters inaccessible voice channels before checking occupancy', async () => {
    const channels = makeQuery({
      data: [
        { id: 'voice-general', group_id: 'grp-1', name: 'General Voice', noob_access: false, kind: 'voice' },
        { id: 'voice-welcome', group_id: 'grp-1', name: 'welcome', noob_access: false, kind: 'voice' },
      ],
      error: null,
    })
    const welcomeRoom = makeQuery({ data: null, error: null })
    const supabase = makeSupabase({
      channels: [channels],
      voice_rooms: [welcomeRoom],
    })

    await expect(listAccessibleVoiceChannelsWithOccupancy(supabase as never, {
      groupId: 'grp-1',
      role: 'noob',
    })).resolves.toEqual([
      {
        channelId: 'voice-welcome',
        groupId: 'grp-1',
        name: 'welcome',
        noobAccess: false,
        room: null,
        participantCount: 0,
      },
    ])

    expect(channels.eq).toHaveBeenCalledWith('group_id', 'grp-1')
    expect(channels.eq).toHaveBeenCalledWith('kind', 'voice')
    expect(welcomeRoom.in).toHaveBeenCalledWith('status', ['open', 'idle'])
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
