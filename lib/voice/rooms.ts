import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { deriveProviderRoomName } from '@/lib/voice/providerRoomName'

export type VoiceRoomStatus = 'open' | 'idle' | 'closed'

export type VoiceChannel = {
  id: string
  groupId: string
  name: string
  noobAccess: boolean
  kind?: 'text' | 'voice'
}

export type VoiceRoom = {
  id: string
  channelId: string
  groupId: string
  status: VoiceRoomStatus
  providerRoomName: string
  channelName?: string
  noobAccess?: boolean
}

export type VoiceChannelWithOccupancy = {
  channelId: string
  groupId: string
  name: string
  noobAccess: boolean
  room: { id: string; status: VoiceRoomStatus } | null
  participantCount: number
}

type ChannelRow = {
  id: string
  group_id: string
  name: string
  noob_access?: boolean | null
  kind?: 'text' | 'voice' | null
}

type VoiceRoomRow = {
  id: string
  channel_id: string
  group_id: string
  status: VoiceRoomStatus
  provider_room_name: string
  channels?: {
    name?: string | null
    noob_access?: boolean | null
  } | null
}

const MISSING_ROW = 'PGRST116'
const DEFAULT_STALE_AFTER_SECONDS = 45

function mapChannel(row: ChannelRow): VoiceChannel {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    noobAccess: Boolean(row.noob_access),
    kind: row.kind ?? 'text',
  }
}

function mapRoom(row: VoiceRoomRow): VoiceRoom {
  return {
    id: row.id,
    channelId: row.channel_id,
    groupId: row.group_id,
    status: row.status,
    providerRoomName: row.provider_room_name,
    channelName: row.channels?.name ?? undefined,
    noobAccess: row.channels?.noob_access ?? undefined,
  }
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23505' || Boolean(error?.message?.toLowerCase().includes('duplicate'))
}

function activeCutoff(now = new Date(), staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS): string {
  return new Date(now.getTime() - staleAfterSeconds * 1000).toISOString()
}

export async function resolveVoiceChannel(supabase: SupabaseClient, channelId: string): Promise<VoiceChannel | null> {
  if (!channelId) return null

  const { data, error } = await supabase
    .from('channels')
    .select('id, group_id, name, noob_access, kind')
    .eq('id', channelId)
    .single()

  if (error || !data) return null
  return mapChannel(data as ChannelRow)
}

export async function resolveVoiceRoom(supabase: SupabaseClient, roomId: string): Promise<VoiceRoom | null> {
  if (!roomId) return null

  const { data, error } = await supabase
    .from('voice_rooms')
    .select('id, channel_id, group_id, status, provider_room_name, channels(name, noob_access)')
    .eq('id', roomId)
    .single()

  if (error || !data) return null
  return mapRoom(data as VoiceRoomRow)
}

export async function getOpenVoiceRoomForChannel(adminClient: SupabaseClient, channelId: string): Promise<VoiceRoom | null> {
  const { data, error } = await adminClient
    .from('voice_rooms')
    .select('id, channel_id, group_id, status, provider_room_name')
    .eq('channel_id', channelId)
    .eq('status', 'open')
    .maybeSingle()

  if (error || !data) return null
  return mapRoom(data as VoiceRoomRow)
}

export async function getLiveVoiceRoomForChannel(adminClient: SupabaseClient, channelId: string): Promise<VoiceRoom | null> {
  const { data, error } = await adminClient
    .from('voice_rooms')
    .select('id, channel_id, group_id, status, provider_room_name')
    .eq('channel_id', channelId)
    .in('status', ['open', 'idle'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return mapRoom(data as VoiceRoomRow)
}

export async function createOrReuseVoiceRoom(
  adminClient: SupabaseClient,
  input: { channelId: string; groupId: string; createdBy: string },
): Promise<VoiceRoom | { error: string }> {
  const existing = await getLiveVoiceRoomForChannel(adminClient, input.channelId)
  if (existing) {
    if (existing.status === 'open') return existing

    const { data, error } = await adminClient
      .from('voice_rooms')
      .update({ status: 'open', closed_at: null })
      .eq('id', existing.id)
      .select('id, channel_id, group_id, status, provider_room_name')
      .single()

    if (error || !data) return { error: 'Cannot join this room.' }
    return mapRoom(data as VoiceRoomRow)
  }

  const id = crypto.randomUUID()
  const { data, error } = await adminClient
    .from('voice_rooms')
    .insert({
      id,
      group_id: input.groupId,
      channel_id: input.channelId,
      created_by: input.createdBy,
      provider: 'livekit',
      provider_room_name: deriveProviderRoomName(id),
      status: 'open',
    })
    .select('id, channel_id, group_id, status, provider_room_name')
    .single()

  if (error && isUniqueViolation(error)) {
    const racedRoom = await getLiveVoiceRoomForChannel(adminClient, input.channelId)
    if (racedRoom) return racedRoom.status === 'idle'
      ? createOrReuseVoiceRoom(adminClient, input)
      : racedRoom
  }

  if (error || !data) return { error: 'Cannot join this room.' }
  return mapRoom(data as VoiceRoomRow)
}

export async function getVoiceRoomParticipantCount(adminClient: SupabaseClient, roomId: string): Promise<number> {
  const { count, error } = await adminClient
    .from('voice_room_participants')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .is('left_at', null)

  if (error) return 0
  return count ?? 0
}

export async function listAccessibleVoiceChannelsWithOccupancy(
  adminClient: SupabaseClient,
  input: { groupId: string; role: Role },
): Promise<VoiceChannelWithOccupancy[] | { error: string }> {
  const { data, error } = await adminClient
    .from('channels')
    .select('id, group_id, name, noob_access, kind')
    .eq('group_id', input.groupId)
    .eq('kind', 'voice')
    .order('position', { ascending: true })

  if (error || !data) return { error: 'Cannot join this room.' }

  const channels = (data as ChannelRow[])
    .map(mapChannel)
    .filter((channel) => PERMISSIONS.canJoinVoiceRoom(input.role, channel.name, channel.noobAccess))

  return Promise.all(channels.map(async (channel) => {
    const room = await getLiveVoiceRoomForChannel(adminClient, channel.id)
    const participantCount = room ? await getVoiceRoomParticipantCount(adminClient, room.id) : 0

    return {
      channelId: channel.id,
      groupId: channel.groupId,
      name: channel.name,
      noobAccess: channel.noobAccess,
      room: room ? { id: room.id, status: room.status } : null,
      participantCount,
    }
  }))
}

export async function upsertVoiceParticipant(
  adminClient: SupabaseClient,
  input: { roomId: string; userId: string },
): Promise<{ ok: true } | { error: string }> {
  const { data: existing, error: selectError } = await adminClient
    .from('voice_room_participants')
    .select('id')
    .eq('room_id', input.roomId)
    .eq('user_id', input.userId)
    .is('left_at', null)
    .maybeSingle()

  if (selectError && selectError.code !== MISSING_ROW) return { error: 'Cannot join this room.' }

  if (existing?.id) {
    const { error } = await adminClient
      .from('voice_room_participants')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id)
    return error ? { error: 'Cannot join this room.' } : { ok: true }
  }

  const { error } = await adminClient
    .from('voice_room_participants')
    .insert({
      room_id: input.roomId,
      user_id: input.userId,
    })

  return error ? { error: 'Cannot join this room.' } : { ok: true }
}

export async function touchVoiceParticipant(
  adminClient: SupabaseClient,
  input: { roomId: string; userId: string },
): Promise<{ ok: true } | { error: string }> {
  const { error } = await adminClient
    .from('voice_room_participants')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('room_id', input.roomId)
    .eq('user_id', input.userId)
    .is('left_at', null)

  return error ? { error: 'Cannot join this room.' } : { ok: true }
}

export async function markVoiceParticipantLeft(
  adminClient: SupabaseClient,
  input: { roomId: string; userId: string },
): Promise<{ ok: true } | { error: string }> {
  const { error } = await adminClient
    .from('voice_room_participants')
    .update({ left_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
    .eq('room_id', input.roomId)
    .eq('user_id', input.userId)
    .is('left_at', null)

  return error ? { error: 'Cannot join this room.' } : { ok: true }
}

export async function cleanupStaleVoiceParticipants(
  adminClient: SupabaseClient,
  input: { roomId?: string; channelId?: string; groupId?: string; staleAfterSeconds?: number } = {},
): Promise<{ ok: true } | { error: string }> {
  const cutoff = activeCutoff(new Date(), input.staleAfterSeconds)
  let roomIds: string[] | null = null

  if (input.channelId || input.groupId) {
    let roomsQuery = adminClient
      .from('voice_rooms')
      .select('id')
      .in('status', ['open', 'idle'])

    if (input.channelId) roomsQuery = roomsQuery.eq('channel_id', input.channelId)
    if (input.groupId) roomsQuery = roomsQuery.eq('group_id', input.groupId)

    const { data, error } = await roomsQuery
    if (error) return { error: 'Cannot join this room.' }
    roomIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
    if (roomIds.length === 0) return { ok: true }
  }

  let updateQuery = adminClient
    .from('voice_room_participants')
    .update({ left_at: new Date().toISOString() })
    .is('left_at', null)
    .lt('last_seen_at', cutoff)

  if (input.roomId) updateQuery = updateQuery.eq('room_id', input.roomId)
  if (roomIds) updateQuery = updateQuery.in('room_id', roomIds)

  const { error } = await updateQuery
  if (error) return { error: 'Cannot join this room.' }

  const roomsToClose = input.roomId ? [input.roomId] : roomIds ?? []
  await Promise.all(roomsToClose.map((roomId) => closeVoiceRoomIfEmpty(adminClient, { roomId })))

  return { ok: true }
}

export async function closeVoiceRoomIfEmpty(
  adminClient: SupabaseClient,
  input: { roomId: string },
): Promise<{ ok: true; closed: boolean } | { error: string }> {
  const participantCount = await getVoiceRoomParticipantCount(adminClient, input.roomId)
  if (participantCount > 0) return { ok: true, closed: false }

  const { error } = await adminClient
    .from('voice_rooms')
    .update({ status: 'idle', closed_at: new Date().toISOString() })
    .eq('id', input.roomId)
    .eq('status', 'open')

  return error ? { error: 'Cannot join this room.' } : { ok: true, closed: true }
}

/**
 * Deletes a join-to-create (ephemeral) voice channel once it has no active
 * participants. Channel deletion cascades to its voice rooms. Requires the
 * admin client — channel deletes are manager-gated under RLS.
 */
export async function deleteEphemeralChannelIfEmpty(
  adminClient: SupabaseClient,
  input: { channelId: string },
): Promise<{ ok: true; deleted: boolean } | { error: string }> {
  const { data, error } = await adminClient
    .from('channels')
    .select('id, is_ephemeral')
    .eq('id', input.channelId)
    .maybeSingle()

  if (error && error.code !== MISSING_ROW) return { error: 'Cannot join this room.' }
  if (!data || !(data as { is_ephemeral?: boolean | null }).is_ephemeral) {
    return { ok: true, deleted: false }
  }

  const room = await getLiveVoiceRoomForChannel(adminClient, input.channelId)
  if (room) {
    const participantCount = await getVoiceRoomParticipantCount(adminClient, room.id)
    if (participantCount > 0) return { ok: true, deleted: false }
  }

  const { error: deleteError } = await adminClient
    .from('channels')
    .delete()
    .eq('id', input.channelId)
    .eq('is_ephemeral', true)

  return deleteError ? { error: 'Cannot join this room.' } : { ok: true, deleted: true }
}

/**
 * Lazy reaper for a group's empty ephemeral voice channels. Run after
 * cleanupStaleVoiceParticipants so crashed clients are already marked left.
 */
export async function sweepEmptyEphemeralChannels(
  adminClient: SupabaseClient,
  input: { groupId: string },
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await adminClient
    .from('channels')
    .select('id')
    .eq('group_id', input.groupId)
    .eq('kind', 'voice')
    .eq('is_ephemeral', true)

  if (error) return { error: 'Cannot join this room.' }

  await Promise.all(
    ((data ?? []) as Array<{ id: string }>).map((row) =>
      deleteEphemeralChannelIfEmpty(adminClient, { channelId: row.id }),
    ),
  )

  return { ok: true }
}
