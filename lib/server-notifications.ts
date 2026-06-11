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
  urlBuilder?: (args: { channelId: string; messageId: string }) => string
}

type ThreadReplyNotificationInput = {
  threadRootId: string
  newReplyId: string
  newReplyAuthorId: string
  newReplyAuthorName: string
  channelId: string
  content: string
  attachments?: Attachment[] | null
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

/**
 * Role-mention tokens. Role names are hyphenated slugs ("group-buy"), so the
 * token charset is wider than usernames and uses a lookahead boundary.
 */
export function extractMentionRoleTokens(content: string): string[] {
  const pattern = /(^|[^\w-])@([a-zA-Z0-9_][a-zA-Z0-9_-]{0,59})(?![\w-])/g
  const tokens = new Set<string>()
  let match = pattern.exec(content)

  while (match) {
    tokens.add(match[2].toLowerCase())
    match = pattern.exec(content)
  }

  return Array.from(tokens)
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

export function buildThreadReplyUrl(channelId: string, rootId: string, messageId: string): string {
  return `/channels/${channelId}?thread=${rootId}#${messageId}`
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
      url: input.urlBuilder
        ? input.urlBuilder({ channelId: input.channelId, messageId: input.messageId })
        : `/channels/${input.channelId}#${input.messageId}`,
    }))

  if (rows.length === 0) return

  await supabase
    .from('notification_events')
    .insert(rows)
}

/**
 * Fans out @role-name mentions to every member holding a mentionable role.
 * Runs after the direct-mention pass; the (user_id, type, source_id) unique
 * constraint dedupes users hit by both, so rows are upserted ignore-style.
 */
export async function enqueueRoleMentionNotifications(
  supabase: SupabaseClient,
  input: MentionNotificationInput
): Promise<void> {
  const tokens = extractMentionRoleTokens(input.content)
  if (tokens.length === 0) return

  const { data: channel } = await supabase
    .from('channels')
    .select('id, group_id, noob_access, name')
    .eq('id', input.channelId)
    .maybeSingle()

  if (!channel) return
  const groupId = (channel as ChannelAccessRow).group_id

  const { data: roleRows } = await supabase
    .from('roles')
    .select('id, name')
    .eq('group_id', groupId)
    .eq('mentionable', true)
    .eq('is_default', false)

  const tokenSet = new Set(tokens)
  const mentionedRoles = ((roleRows ?? []) as Array<{ id: string; name: string }>)
    .filter(role => tokenSet.has(role.name.toLowerCase()))

  if (mentionedRoles.length === 0) return

  const { data: assignments } = await supabase
    .from('member_roles')
    .select('user_id, role_id')
    .in('role_id', mentionedRoles.map(role => role.id))

  const roleNameById = new Map(mentionedRoles.map(role => [role.id, role.name]))
  // First mentioned role wins for the notification title.
  const roleNameByUserId = new Map<string, string>()
  for (const row of (assignments ?? []) as Array<{ user_id: string; role_id: string }>) {
    if (row.user_id === input.senderId) continue
    if (!roleNameByUserId.has(row.user_id)) {
      roleNameByUserId.set(row.user_id, roleNameById.get(row.role_id) ?? 'role')
    }
  }

  if (roleNameByUserId.size === 0) return

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', Array.from(roleNameByUserId.keys()))

  const authorizedProfiles = await mentionableRecipientsForChannel(
    supabase,
    input.channelId,
    (profiles ?? []) as MentionProfile[]
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
      title: `${input.senderName} mentioned @${roleNameByUserId.get(profile.id)}`,
      body: notificationBody(input.content),
      url: input.urlBuilder
        ? input.urlBuilder({ channelId: input.channelId, messageId: input.messageId })
        : `/channels/${input.channelId}#${input.messageId}`,
    }))

  if (rows.length === 0) return

  // ignoreDuplicates: a user directly @named AND in a mentioned role keeps
  // the direct-mention row instead of erroring the whole batch.
  await supabase
    .from('notification_events')
    .upsert(rows, { onConflict: 'user_id,type,source_id', ignoreDuplicates: true })
}

export async function enqueueThreadReplyNotifications(
  supabase: SupabaseClient,
  input: ThreadReplyNotificationInput
): Promise<void> {
  const { data: root } = await supabase
    .from('messages')
    .select('user_id')
    .eq('id', input.threadRootId)
    .maybeSingle()

  const rootAuthorId = (root as { user_id?: string } | null)?.user_id
  const recipients = new Set<string>()
  if (rootAuthorId && rootAuthorId !== input.newReplyAuthorId) recipients.add(rootAuthorId)

  const { data: participantRows } = await supabase
    .from('messages')
    .select('user_id')
    .eq('thread_root_id', input.threadRootId)

  for (const row of (participantRows ?? []) as Array<{ user_id?: string | null }>) {
    if (row.user_id && row.user_id !== input.newReplyAuthorId) recipients.add(row.user_id)
  }

  const recipientIds = Array.from(recipients)
  if (recipientIds.length === 0) return

  const rows = recipientIds
    .map(userId => ({
      user_id: userId,
      actor_id: input.newReplyAuthorId,
      type: 'thread_reply',
      source_table: 'messages',
      source_id: input.newReplyId,
      conversation_id: null,
      channel_id: input.channelId,
      title: `${input.newReplyAuthorName} replied in a thread`,
      body: notificationBody(input.content, input.attachments),
      url: buildThreadReplyUrl(input.channelId, input.threadRootId, input.newReplyId),
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
      await enqueueRoleMentionNotifications(supabase, draft.payload as MentionNotificationInput)
      break

    case 'dm_message':
      await enqueueDirectMessageNotification(supabase, draft.payload as DirectMessageNotificationInput)
      break

    case 'thread_reply':
      await enqueueThreadReplyNotifications(supabase, draft.payload as ThreadReplyNotificationInput)
      break

    default:
      console.warn(`[notifications] Unknown type: ${draft.type}`)
  }
}
