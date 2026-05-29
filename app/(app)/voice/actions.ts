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

      await cleanupStaleVoiceParticipants(supabase, { groupId })
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
      return 'error' in closeResult ? denied() : { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)
