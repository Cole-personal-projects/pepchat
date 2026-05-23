'use client'

import { createClient } from '@/lib/supabase/client'

export function getUnreadFromMessageLastReadAt(messageCreatedAt: string): string {
  const timestamp = new Date(messageCreatedAt).getTime()
  return Number.isFinite(timestamp)
    ? new Date(Math.max(0, timestamp - 1)).toISOString()
    : new Date(0).toISOString()
}

export async function markChannelRead(channelId: string, userId: string): Promise<void> {
  const supabase = createClient()
  await supabase
    .from('channel_read_state')
    .upsert(
      { user_id: userId, channel_id: channelId, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,channel_id' }
    )
}

export async function markChannelUnreadFromMessage(
  channelId: string,
  userId: string,
  messageCreatedAt: string
): Promise<void> {
  const lastReadAt = getUnreadFromMessageLastReadAt(messageCreatedAt)

  const supabase = createClient()
  await supabase
    .from('channel_read_state')
    .upsert(
      { user_id: userId, channel_id: channelId, last_read_at: lastReadAt },
      { onConflict: 'user_id,channel_id' }
    )
}

export async function markChannelUnread(channelId: string, userId: string): Promise<void> {
  const supabase = createClient()
  const { data: latest } = await supabase
    .from('messages')
    .select('created_at')
    .eq('channel_id', channelId)
    .is('thread_root_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await markChannelUnreadFromMessage(channelId, userId, latest?.created_at ?? new Date(0).toISOString())
}
