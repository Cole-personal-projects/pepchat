import { createClient } from '@/lib/supabase/server'
import type { Attachment, NotificationPreferences } from '@/lib/types'
import type { NotificationDraft } from '@/lib/actions/sideEffects'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type DirectMessageNotificationInput = {
  recipientId: string
  senderId: string
  senderName: string
  messageId: string
  conversationId: string
  content: string
  attachments?: Attachment[] | null
}

type MentionNotificationInput = {
  senderId: string
  senderName: string
  messageId: string
  channelId: string
  content: string
}

type MentionProfile = {
  id: string
  username: string
  display_name: string | null
}

type ChannelAccessRow = {
  id: string
  group_id: string
  noob_access: boolean
  name: string
}

function attachmentFallback(attachments?: Attachment[] | null): string {
  if (!attachments || attachments.length === 0) return 'New message'
  if (attachments.length > 1) return `${attachments.length} attachments`

  const [attachment] = attachments
  if (attachment.type === 'gif') return 'GIF'
  if (attachment.type === 'image') return 'Image'
  if (attachment.type === 'video') return 'Video'
  return 'Attachment'
}

export function extractMentionUsernames(content: string): string[] {
  const mentionPattern = /(^|[^\w])@([a-zA-Z0-9_]{1,32})\b/g
  const usernames = new Set<string>()
  let match = mentionPattern.exec(content)

  while (match) {
    usernames.add(match[2].toLowerCase())
    match = mentionPattern.exec(content)
  }

  return Array.from(usernames)
}

export function notificationBody(content: string, attachments?: Attachment[] | null): string {
  const trimmed = content.trim()
  if (trimmed) return trimmed.slice(0, 140)
  return attachmentFallback(attachments)
}

async function mentionableRecipientsForChannel(
  supabase: SupabaseClient,
  channelId: string,
  profiles: MentionProfile[]
): Promise<MentionProfile[]> {
  if (profiles.length === 0) return []

  const { data: channel, error: channelError } = await supabase
    .from('channels')
    .select('id, group_id, noob_access, name')
    .eq('id', channelId)
    .maybeSingle()

  if (channelError || !channel) return []

  const channelRow = channel as ChannelAccessRow
  const { data: memberships, error: membershipError } = await supabase
    .from('group_members')
    .select('user_id, role')
    .eq('group_id', channelRow.group_id)
    .in('user_id', profiles.map(profile => profile.id))

  if (membershipError) return []

  const roleByUserId = new Map(
    ((memberships ?? []) as Array<{ user_id: string; role: string }>).map(row => [row.user_id, row.role])
  )

  return profiles.filter(profile => {
    const role = roleByUserId.get(profile.id)
    if (!role) return false
    return role !== 'noob' || channelRow.noob_access || channelRow.name === 'welcome'
  })
}

async function mentionPreferenceMap(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, boolean>> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('user_id, mentions')
    .in('user_id', userIds)

  const rows = (data ?? []) as Array<{ user_id: string; mentions: boolean }>
  return new Map(rows.map(row => [row.user_id, row.mentions]))
}

async function allowsDMNotifications(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('dm_messages')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return true
  const preferences = data as Pick<NotificationPreferences, 'dm_messages'> | null
  return preferences?.dm_messages ?? true
}

export async function enqueueDirectMessageNotification(
  supabase: SupabaseClient,
  input: DirectMessageNotificationInput
): Promise<void> {
  if (input.recipientId === input.senderId) return
  if (!await allowsDMNotifications(supabase, input.recipientId)) return

  await supabase
    .from('notification_events')
    .insert(
      {
        user_id: input.recipientId,
        actor_id: input.senderId,
        type: 'dm_message',
        source_table: 'direct_messages',
        source_id: input.messageId,
        conversation_id: input.conversationId,
        channel_id: null,
        title: input.senderName,
        body: notificationBody(input.content, input.attachments),
        url: `/dm/${input.conversationId}#${input.messageId}`,
      }
    )
}

export async function enqueueMentionNotifications(
  supabase: SupabaseClient,
  input: MentionNotificationInput
): Promise<void> {
  const usernames = extractMentionUsernames(input.content)
  if (usernames.length === 0) return

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('username', usernames)

  const mentionedProfiles = ((profiles ?? []) as MentionProfile[]).filter(profile => profile.id !== input.senderId)

  if (mentionedProfiles.length === 0) return

  // Filter recipients through channel visibility before writing body/url-bearing
  // notifications so thread reply mentions cannot leak private channel content.
  const authorizedProfiles = await mentionableRecipientsForChannel(
    supabase,
    input.channelId,
    mentionedProfiles
  )
  if (authorizedProfiles.length === 0) return

  const preferences = await mentionPreferenceMap(
    supabase,
    authorizedProfiles.map(profile => profile.id)
  )

  const rows = authorizedProfiles
    .filter(profile => preferences.get(profile.id) ?? true)
    .map(profile => ({
      user_id: profile.id,
      actor_id: input.senderId,
      type: 'mention',
      source_table: 'messages',
      source_id: input.messageId,
      conversation_id: null,
      channel_id: input.channelId,
      title: `${input.senderName} mentioned you`,
      body: notificationBody(input.content),
      url: `/channels/${input.channelId}#${input.messageId}`,
    }))

  if (rows.length === 0) return

  await supabase
    .from('notification_events')
    .insert(rows)
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher — single entry-point for side-effect pipeline
// ──────────────────────────────────────────────────────────────────────────────

export async function dispatchNotification(
  supabase: SupabaseClient,
  draft: NotificationDraft,
): Promise<void> {
  switch (draft.type) {
    case 'mention':
      await enqueueMentionNotifications(supabase, draft.payload as MentionNotificationInput)
      break

    case 'dm_message':
      await enqueueDirectMessageNotification(supabase, draft.payload as DirectMessageNotificationInput)
      break

    default:
      console.warn(`[notifications] Unknown type: ${draft.type}`)
  }
}
