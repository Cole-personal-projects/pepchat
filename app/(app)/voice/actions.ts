'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { normalizeChannelName } from '@/lib/channels/createChannelInternal'
import { PERMISSIONS } from '@/lib/permissions'
import { gateGroupRole } from '@/lib/permissions/gate'
import { createAdminClient } from '@/lib/supabase/admin'

const VOICE_DENIED = 'Cannot join this room.'
const VOICE_CREATE_DENIED = 'Cannot create voice chat.'

type VoiceActionError = { error: string }

type VoiceRoomSummary = {
  id: string
  channelId: string
  groupId: string
  status: 'open' | 'closed'
  participantCount: number
  isEphemeral: boolean
}

type StartVoiceRoomResult =
  | {
      ok: true
      room: VoiceRoomSummary
    }
  | VoiceActionError

type CurrentVoiceRoomResult = { ok: true; room: VoiceRoomSummary | null } | VoiceActionError

type MintedToken = {
  provider: 'livekit'
  livekitUrl: string
  token: string
  expiresAt: string
}

type MintVoiceTokenResult =
  | {
      ok: true
    } & MintedToken
  | VoiceActionError

type CreateTempVoiceChannelResult = ({ ok: true; room: VoiceRoomSummary } & MintedToken) | VoiceActionError

type LeaveVoiceRoomResult = { ok: true } | VoiceActionError

function denied(): VoiceActionError {
  return { error: VOICE_DENIED }
}

function createDenied(): VoiceActionError {
  return { error: VOICE_CREATE_DENIED }
}

async function voiceRooms() {
  return import('@/lib/voice/rooms')
}

async function defaultTempVoiceChannelName(supabase: { from: (table: string) => unknown }, userId: string): Promise<string> {
  const fallback = 'Temporary Voice Chat'
  try {
    const query = supabase.from('profiles') as {
      select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data?: { username?: string | null; display_name?: string | null } | null }> } }
    }
    const { data } = await query.select('username, display_name').eq('id', userId).maybeSingle()
    const display = (data?.display_name || data?.username || '').trim()
    return display ? `${display}'s Room` : fallback
  } catch {
    return fallback
  }
}

async function createVoiceChannelRow(
  adminClient: { from: (table: string) => unknown },
  input: { groupId: string; name: string; userId: string },
): Promise<{ id: string; groupId: string } | VoiceActionError> {
  const positionsQuery = adminClient.from('channels') as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Promise<{ data?: { position: number }[] | null }> }
      }
    }
  }
  const { data: positions } = await positionsQuery
    .select('position')
    .eq('group_id', input.groupId)
    .order('position', { ascending: false })
    .limit(1)
  const nextPosition = positions && positions.length > 0 ? positions[0].position + 1 : 0

  const insertQuery = adminClient.from('channels') as {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<{ data?: { id: string; group_id: string } | null; error?: unknown }> }
    }
  }
  const { data: channel, error } = await insertQuery
    .insert({
      group_id: input.groupId,
      name: normalizeChannelName(input.name),
      channel_kind: 'ephemeral_voice',
      is_ephemeral: true,
      created_by: input.userId,
      noob_access: false,
      position: nextPosition,
    })
    .select('id, group_id')
    .single()

  if (error || !channel) return createDenied()
  return { id: channel.id, groupId: channel.group_id }
}

export const createTempVoiceChannel = withAuth(
  async function createTempVoiceChannelBody(
    { supabase, user },
    groupId: string,
    name?: string,
  ): Promise<CreateTempVoiceChannelResult> {
    try {
      const gate = await gateGroupRole(supabase, {
        groupId,
        userId: user.id,
        predicate: PERMISSIONS.canCreateTempVoiceChannel,
        deniedMessage: VOICE_CREATE_DENIED,
      })
      if ('error' in gate) return createDenied()

      const displayName = name?.trim() || (await defaultTempVoiceChannelName(supabase, user.id))
      const normalizedName = normalizeChannelName(displayName)
      if (!groupId || !normalizedName || normalizedName.length > 80 || !/^[a-z0-9][a-z0-9-]*$/.test(normalizedName)) {
        return createDenied()
      }

      const adminClient = createAdminClient()
      const channel = await createVoiceChannelRow(adminClient, { groupId, name: displayName, userId: user.id })
      if ('error' in channel) return createDenied()

      const { createOrReuseVoiceRoom, getVoiceRoomParticipantCount, upsertVoiceParticipant } = await voiceRooms()
      const room = await createOrReuseVoiceRoom(adminClient, {
        channelId: channel.id,
        groupId: channel.groupId,
        createdBy: user.id,
      })
      if ('error' in room) return createDenied()

      const participant = await upsertVoiceParticipant(adminClient, { roomId: room.id, userId: user.id })
      if ('error' in participant) return createDenied()

      const { mintLiveKitToken } = await import('@/lib/voice/livekit')
      const token = await mintLiveKitToken({ providerRoomName: room.providerRoomName, userId: user.id })
      if ('error' in token) return createDenied()

      return {
        ...token,
        room: {
          id: room.id,
          channelId: room.channelId,
          groupId: room.groupId,
          status: room.status,
          participantCount: await getVoiceRoomParticipantCount(adminClient, room.id),
          isEphemeral: true,
        },
      }
    } catch {
      return createDenied()
    }
  },
  { unauthenticated: () => createDenied() },
)

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

      const room = await createOrReuseVoiceRoom(supabase, {
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
          participantCount: await getVoiceRoomParticipantCount(supabase, room.id),
          isEphemeral: channel.isEphemeral,
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

      const room = await getOpenVoiceRoomForChannel(supabase, channel.id)
      if (!room) return { ok: true, room: null }

      return {
        ok: true,
        room: {
          id: room.id,
          channelId: room.channelId,
          groupId: room.groupId,
          status: room.status,
          participantCount: await getVoiceRoomParticipantCount(supabase, room.id),
          isEphemeral: channel.isEphemeral,
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

      const result = await markVoiceParticipantLeft(supabase, { roomId: room.id, userId: user.id })
      return 'error' in result ? denied() : { ok: true }
    } catch {
      return denied()
    }
  },
  { unauthenticated: () => denied() },
)
