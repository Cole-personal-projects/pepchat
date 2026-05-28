'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { PERMISSIONS } from '@/lib/permissions'
import { gateGroupRole } from '@/lib/permissions/gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintLiveKitToken } from '@/lib/voice/livekit'
import {
  createOrReuseVoiceRoom,
  getVoiceRoomParticipantCount,
  markVoiceParticipantLeft,
  resolveVoiceChannel,
  resolveVoiceRoom,
  upsertVoiceParticipant,
} from '@/lib/voice/rooms'

const VOICE_DENIED = 'Cannot join this room.'

type VoiceActionError = { error: string }

type StartVoiceRoomResult =
  | {
      ok: true
      room: {
        id: string
        channelId: string
        groupId: string
        status: 'open' | 'closed'
        participantCount: number
      }
    }
  | VoiceActionError

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

function createVoiceAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('voice admin client is not configured')
  }
  return createAdminClient()
}

export const startVoiceRoom = withAuth(
  async function startVoiceRoomBody({ supabase, user }, channelId: string): Promise<StartVoiceRoomResult> {
    try {
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

      const adminClient = createVoiceAdminClient()
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

export const mintVoiceToken = withAuth(
  async function mintVoiceTokenBody(
    { supabase, user },
    roomId: string,
    _clientInput?: { providerRoomName?: string },
  ): Promise<MintVoiceTokenResult> {
    try {
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room || room.status !== 'open') return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const adminClient = createVoiceAdminClient()
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
      const room = await resolveVoiceRoom(supabase, roomId)
      if (!room) return denied()

      const gate = await gateGroupRole(supabase, {
        groupId: room.groupId,
        userId: user.id,
        predicate: (role) => PERMISSIONS.canJoinVoiceRoom(role, room.channelName ?? '', Boolean(room.noobAccess)),
        deniedMessage: VOICE_DENIED,
      })
      if ('error' in gate) return denied()

      const result = await markVoiceParticipantLeft(createVoiceAdminClient(), { roomId: room.id, userId: user.id })
      return 'error' in result ? denied() : { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)
