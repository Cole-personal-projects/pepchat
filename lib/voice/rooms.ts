import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveProviderRoomName } from '@/lib/voice/providerRoomName'

export type VoiceChannel = {
  id: string
  groupId: string
  name: string
  noobAccess: boolean
}

export type VoiceRoom = {
  id: string
  channelId: string
  groupId: string
  status: 'open' | 'closed'
  providerRoomName: string
  channelName?: string
  noobAccess?: boolean
}

type ChannelRow = {
  id: string
  group_id: string
  name: string
  noob_access?: boolean | null
}

type VoiceRoomRow = {
  id: string
  channel_id: string
  group_id: string
  status: 'open' | 'closed'
  provider_room_name: string
  channels?: {
    name?: string | null
    noob_access?: boolean | null
  } | null
}

const MISSING_ROW = 'PGRST116'

function mapChannel(row: ChannelRow): VoiceChannel {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    noobAccess: Boolean(row.noob_access),
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

export async function resolveVoiceChannel(supabase: SupabaseClient, channelId: string): Promise<VoiceChannel | null> {
  if (!channelId) return null

  const { data, error } = await supabase
    .from('channels')
    .select('id, group_id, name, noob_access')
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

export async function createOrReuseVoiceRoom(
  adminClient: SupabaseClient,
  input: { channelId: string; groupId: string; createdBy: string },
): Promise<VoiceRoom | { error: string }> {
  const existing = await getOpenVoiceRoomForChannel(adminClient, input.channelId)
  if (existing) return existing

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
    const racedRoom = await getOpenVoiceRoomForChannel(adminClient, input.channelId)
    if (racedRoom) return racedRoom
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
