'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import { gateGroupRole } from '@/lib/permissions/gate'

const VOICE_DENIED = 'Cannot join this room.'

type VoiceActionError = { error: string }
type VoiceRoomStatus = 'open' | 'idle' | 'closed'

type VoiceRoomSummary = {
  id: string
  channelId: string
  groupId: string
  status: VoiceRoomStatus
  participantCount: number
}

type VoiceChannelSummary = {
  channelId: string
  groupId: string
  name: string
  noobAccess: boolean
  room: { id: string; status: VoiceRoomStatus } | null
  participantCount: number
}

type StartVoiceRoomResult =
  | {
      ok: true
      room: VoiceRoomSummary
    }
  | VoiceActionError

type CurrentVoiceRoomResult = { ok: true; room: VoiceRoomSummary | null } | VoiceActionError

type ListVoiceChannelsResult = { ok: true; channels: VoiceChannelSummary[] } | VoiceActionError

type MintVoiceTokenResult =
  | {
      ok: true
      provider: 'livekit'
      livekitUrl: string
      token: string
      expiresAt: string
    }
  | VoiceActionError

type JoinVoiceChannelResult =
  | ({
      ok: true
      room: VoiceRoomSummary
    } & Extract<MintVoiceTokenResult, { ok: true }>)
  | VoiceActionError

type LeaveVoiceRoomResult = { ok: true } | VoiceActionError

function denied(): VoiceActionError {
  return { error: VOICE_DENIED }
}

async function voiceRooms() {
  return import('@/lib/voice/rooms')
}

/** Service-role client for ephemeral channel lifecycle; null when not configured. */
async function adminClientOrNull() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const { createAdminClient } = await import('@/lib/supabase/admin')
  return createAdminClient()
}

function roomSummary(room: { id: string; channelId: string; groupId: string; status: VoiceRoomStatus }, participantCount: number): VoiceRoomSummary {
  return {
    id: room.id,
    channelId: room.channelId,
    groupId: room.groupId,
    status: room.status,
    participantCount,
  }
}

function canAccessGroup(role: Role): boolean {
  return ['admin', 'moderator', 'user', 'noob'].includes(role)
}

export const listVoiceChannels = withAuth(
  async function listVoiceChannelsBody({ supabase, user }, groupId: string): Promise<ListVoiceChannelsResult> {
    try {
      const { cleanupStaleVoiceParticipants, listAccessibleVoiceChannelsWithOccupancy } = await voiceRooms()
      const gate = await gateGroupRole(supabase, {
        groupId,
        userId: user.id,
        predicate: canAccessGroup,
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      // Lazy reaper: drop join-to-create rooms that emptied out (covers
      // crashed clients that never called leaveVoiceRoom). Stale-participant
      // cleanup must run with the admin client — RLS limits the user client
      // to its own participant rows, which left abandoned rooms undeletable.
      const admin = await adminClientOrNull()
      if (admin) {
        const { sweepEmptyEphemeralChannels } = await voiceRooms()
        await sweepEmptyEphemeralChannels(admin, { groupId })
      } else {
        await cleanupStaleVoiceParticipants(supabase, { groupId })
      }

      const channels = await listAccessibleVoiceChannelsWithOccupancy(supabase, {
        groupId,
        role: gate.membership.role,
      })
      if ('error' in channels) return denied()

      return { ok: true, channels }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

/**
 * Reaps abandoned join-to-create rooms for a group. Wired to sidebar mount —
 * the sweep must run from a path the UI actually hits, otherwise ephemeral
 * channels orphaned by crashed clients linger forever.
 */
export const sweepVoiceRooms = withAuth(
  async function sweepVoiceRoomsBody({ supabase, user }, groupId: string): Promise<{ ok: true } | VoiceActionError> {
    try {
      const gate = await gateGroupRole(supabase, {
        groupId,
        userId: user.id,
        predicate: canAccessGroup,
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const admin = await adminClientOrNull()
      if (admin) {
        const { sweepEmptyEphemeralChannels } = await voiceRooms()
        await sweepEmptyEphemeralChannels(admin, { groupId })
      } else {
        const { cleanupStaleVoiceParticipants } = await voiceRooms()
        await cleanupStaleVoiceParticipants(supabase, { groupId })
      }

      return { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const startVoiceRoom = withAuth(
  async function startVoiceRoomBody({ supabase, user }, channelId: string): Promise<StartVoiceRoomResult> {
    try {
      const { cleanupStaleVoiceParticipants, createOrReuseVoiceRoom, getVoiceRoomParticipantCount, resolveVoiceChannel } = await voiceRooms()
      const channel = await resolveVoiceChannel(supabase, channelId)
      if (!channel) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: channel.groupId,
        userId: user.id,
        predicate: PERMISSIONS.canStartVoiceRoom,
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()
      if (!PERMISSIONS.canAccessChannel(gate.membership.role, channel.name, channel.noobAccess)) return denied()

      await cleanupStaleVoiceParticipants(supabase, { channelId: channel.id })
      const room = await createOrReuseVoiceRoom(supabase, {
        channelId: channel.id,
        groupId: channel.groupId,
        createdBy: user.id,
      })
      if ('error' in room) return denied()

      return {
        ok: true,
        room: roomSummary(room, await getVoiceRoomParticipantCount(supabase, room.id)),
      }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const getCurrentVoiceRoom = withAuth(
  async function getCurrentVoiceRoomBody({ supabase, user }, channelId: string): Promise<CurrentVoiceRoomResult> {
    try {
      const { cleanupStaleVoiceParticipants, getOpenVoiceRoomForChannel, getVoiceRoomParticipantCount, resolveVoiceChannel } = await voiceRooms()
      const channel = await resolveVoiceChannel(supabase, channelId)
      if (!channel) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: channel.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, channel.name, channel.noobAccess),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      await cleanupStaleVoiceParticipants(supabase, { channelId: channel.id })
      const room = await getOpenVoiceRoomForChannel(supabase, channel.id)
      if (!room) return { ok: true, room: null }

      return {
        ok: true,
        room: roomSummary(room, await getVoiceRoomParticipantCount(supabase, room.id)),
      }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const joinVoiceChannel = withAuth(
  async function joinVoiceChannelBody({ supabase, user }, channelId: string): Promise<JoinVoiceChannelResult> {
    try {
      const { mintLiveKitToken } = await import('@/lib/voice/livekit')
      const {
        cleanupStaleVoiceParticipants,
        createOrReuseVoiceRoom,
        getVoiceRoomParticipantCount,
        resolveVoiceChannel,
        upsertVoiceParticipant,
      } = await voiceRooms()
      const channel = await resolveVoiceChannel(supabase, channelId)
      if (!channel) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: channel.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, channel.name, channel.noobAccess),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      await cleanupStaleVoiceParticipants(supabase, { channelId: channel.id })
      const room = await createOrReuseVoiceRoom(supabase, {
        channelId: channel.id,
        groupId: channel.groupId,
        createdBy: user.id,
      })
      if ('error' in room) return denied()

      const participant = await upsertVoiceParticipant(supabase, { roomId: room.id, userId: user.id })
      if ('error' in participant) return denied()

      const token = await mintLiveKitToken({
        providerRoomName: room.providerRoomName,
        userId: user.id,
      })
      if ('error' in token) return denied()

      return {
        ok: true,
        room: roomSummary(room, await getVoiceRoomParticipantCount(supabase, room.id)),
        provider: token.provider,
        livekitUrl: token.livekitUrl,
        token: token.token,
        expiresAt: token.expiresAt,
      }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const mintVoiceToken = withAuth(
  async function mintVoiceTokenBody(
    { supabase, user },
    roomId: string,
    _clientInput?: { providerRoomName?: string },
  ): Promise<MintVoiceTokenResult> {
    try {
      const { mintLiveKitToken } = await import('@/lib/voice/livekit')
      const { cleanupStaleVoiceParticipants, resolveVoiceRoom, upsertVoiceParticipant } = await voiceRooms()
      await cleanupStaleVoiceParticipants(supabase, { roomId })
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room || room.status !== 'open') return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const participant = await upsertVoiceParticipant(supabase, { roomId: room.id, userId: user.id })
      if ('error' in participant) return denied()

      const token = await mintLiveKitToken({
        providerRoomName: room.providerRoomName,
        userId: user.id,
      })
      if ('error' in token) return denied()
      return token
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const heartbeatVoiceRoom = withAuth(
  async function heartbeatVoiceRoomBody({ supabase, user }, roomId: string): Promise<LeaveVoiceRoomResult> {
    try {
      const { resolveVoiceRoom, touchVoiceParticipant } = await voiceRooms()
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room || room.status !== 'open') return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const result = await touchVoiceParticipant(supabase, { roomId: room.id, userId: user.id })
      return 'error' in result ? denied() : { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

export const leaveVoiceRoom = withAuth(
  async function leaveVoiceRoomBody({ supabase, user }, roomId: string): Promise<LeaveVoiceRoomResult> {
    try {
      const { closeVoiceRoomIfEmpty, markVoiceParticipantLeft, resolveVoiceRoom } = await voiceRooms()
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const result = await markVoiceParticipantLeft(supabase, { roomId: room.id, userId: user.id })
      if ('error' in result) return denied()
      const closeResult = await closeVoiceRoomIfEmpty(supabase, { roomId: room.id })
      if ('error' in closeResult) return denied()

      // Join-to-create rooms disappear when the last participant leaves.
      if (closeResult.closed) {
        const admin = await adminClientOrNull()
        if (admin) {
          const { deleteEphemeralChannelIfEmpty } = await voiceRooms()
          await deleteEphemeralChannelIfEmpty(admin, { channelId: room.channelId })
        }
      }

      return { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

const MAX_TEMP_ROOM_NAME_LENGTH = 60

type CreateTempVoiceRoomResult = { ok: true; channelId: string } | VoiceActionError

/**
 * Join-to-create: spawns an ephemeral voice channel that auto-deletes when
 * the last participant leaves. Open to every role except noob.
 */
export const createTempVoiceRoom = withAuth(
  async function createTempVoiceRoomBody(
    { supabase, user },
    groupId: string,
    requestedName?: string,
  ): Promise<CreateTempVoiceRoomResult> {
    try {
      if (!groupId) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId,
        userId: user.id,
        predicate: PERMISSIONS.canCreateTempVoiceChannel,
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      // Channel inserts are manager-gated under RLS, so member-created
      // ephemeral rooms go through the service-role client after gating.
      const admin = await adminClientOrNull()
      const writer = admin ?? supabase

      let name = (requestedName ?? '').trim().replace(/\s+/g, ' ')
      if (!name) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, display_name')
          .eq('id', user.id)
          .single()
        const owner = (profile?.display_name as string | null) ?? (profile?.username as string | null) ?? 'New'
        name = `${owner}'s Room`
      }
      if (name.length > MAX_TEMP_ROOM_NAME_LENGTH) {
        name = name.slice(0, MAX_TEMP_ROOM_NAME_LENGTH)
      }

      const { data: existingPositions } = await writer
        .from('channels')
        .select('position')
        .eq('group_id', groupId)
        .order('position', { ascending: false })
        .limit(1)

      const nextPosition =
        existingPositions && existingPositions.length > 0 ? existingPositions[0].position + 1 : 0

      const { data: channel, error } = await writer
        .from('channels')
        .insert({
          group_id: groupId,
          name,
          description: null,
          noob_access: false,
          position: nextPosition,
          kind: 'voice',
          is_ephemeral: true,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (error || !channel) return denied()
      return { ok: true, channelId: (channel as { id: string }).id }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)

type CloseVoiceChannelResult = { ok: true; deletedChannel: boolean } | VoiceActionError

/**
 * Channel-manager escape hatch for stuck voice rooms: force-disconnects all
 * tracked participants, closes the live rooms, and deletes the channel when
 * it is an ephemeral join-to-create room.
 */
export const closeVoiceChannel = withAuth(
  async function closeVoiceChannelBody({ supabase, user }, channelId: string): Promise<CloseVoiceChannelResult> {
    try {
      const { forceCloseVoiceChannel, resolveVoiceChannel } = await voiceRooms()
      const channel = await resolveVoiceChannel(supabase, channelId)
      if (!channel) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: channel.groupId,
        userId: user.id,
        predicate: PERMISSIONS.canManageChannels,
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      // Clearing other users' participant rows requires the service-role
      // client; the user client falls back for channel-only cleanup.
      const admin = await adminClientOrNull()
      const result = await forceCloseVoiceChannel(admin ?? supabase, { channelId: channel.id })
      if ('error' in result) return denied()

      return { ok: true, deletedChannel: result.deletedChannel }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)
