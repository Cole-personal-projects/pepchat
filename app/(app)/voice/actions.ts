'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { PERMISSIONS } from '@/lib/permissions'
import { gateGroupRole } from '@/lib/permissions/gate'

const VOICE_DENIED = 'Cannot join this room.'

type VoiceActionError = { error: string }

type VoiceRoomSummary = {
  id: string
  channelId: string
  groupId: string
  status: 'open' | 'closed'
  participantCount: number
}

type StartVoiceRoomResult =
  | {
      ok: true
      room: VoiceRoomSummary
    }
  | VoiceActionError

type CurrentVoiceRoomResult = { ok: true; room: VoiceRoomSummary | null } | VoiceActionError

type MintVoiceTokenResult =
  | {
      ok: true
      provider: 'livekit'
      livekitUrl: string
      token: string
      expiresAt: string
    }
  | VoiceActionError

type LeaveVoiceRoomResult = { ok: true } | VoiceActionError

function denied(): VoiceActionError {
  return { error: VOICE_DENIED }
}

async function createVoiceAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('voice admin client is not configured')
  }
  const { createAdminClient } = await import('@/lib/supabase/admin')
  return createAdminClient()
}

async function voiceRooms() {
  return import('@/lib/voice/rooms')
}

export const startVoiceRoom = withAuth(
  async function startVoiceRoomBody({ supabase, user }, channelId: string): Promise<StartVoiceRoomResult> {
    try {
      const { createOrReuseVoiceRoom, getVoiceRoomParticipantCount, resolveVoiceChannel } = await voiceRooms()
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

      const adminClient = await createVoiceAdminClient()
      const room = await createOrReuseVoiceRoom(adminClient, {
        channelId: channel.id,
        groupId: channel.groupId,
        createdBy: user.id,
      })
      if ('error' in room) return denied()

      return {
        ok: true,
        room: {
          id: room.id,
          channelId: room.channelId,
          groupId: room.groupId,
          status: room.status,
          participantCount: await getVoiceRoomParticipantCount(adminClient, room.id),
        },
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
      const { getOpenVoiceRoomForChannel, getVoiceRoomParticipantCount, resolveVoiceChannel } = await voiceRooms()
      const channel = await resolveVoiceChannel(supabase, channelId)
      if (!channel) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: channel.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, channel.name, channel.noobAccess),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const adminClient = await createVoiceAdminClient()
      const room = await getOpenVoiceRoomForChannel(adminClient, channel.id)
      if (!room) return { ok: true, room: null }

      return {
        ok: true,
        room: {
          id: room.id,
          channelId: room.channelId,
          groupId: room.groupId,
          status: room.status,
          participantCount: await getVoiceRoomParticipantCount(adminClient, room.id),
        },
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
      const { resolveVoiceRoom, upsertVoiceParticipant } = await voiceRooms()
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room || room.status !== 'open') return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const adminClient = await createVoiceAdminClient()
      const participant = await upsertVoiceParticipant(adminClient, { roomId: room.id, userId: user.id })
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

export const leaveVoiceRoom = withAuth(
  async function leaveVoiceRoomBody({ supabase, user }, roomId: string): Promise<LeaveVoiceRoomResult> {
    try {
      const { markVoiceParticipantLeft, resolveVoiceRoom } = await voiceRooms()
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const result = await markVoiceParticipantLeft(await createVoiceAdminClient(), { roomId: room.id, userId: user.id })
      return 'error' in result ? denied() : { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)
