/** TypeScript interfaces matching the Supabase database schema. */

export interface ImageAttachment {
  url: string
  type: 'image'
  name: string
  size: number
  width?: number
  height?: number
}

export interface GifAttachment {
  url: string
  type: 'gif'
  name: string
  preview: string
  width: number
  height: number
  source: 'klipy'
}

export interface VideoAttachment {
  url: string
  type: 'video'
  name: string
  size: number
  duration: number
  mime_type: string
}

export type Attachment = ImageAttachment | GifAttachment | VideoAttachment

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  display_name: string | null
  bio: string | null
  location: string | null
  website: string | null
  username_color: string
  banner_color: string
  badge: string | null
  pronouns: string | null
  member_since: string
  updated_at: string
  created_at: string
}

export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'username' | 'member_since' | 'updated_at' | 'created_at'>>

export interface Group {
  id: string
  name: string
  description: string | null
  icon_url: string | null
  owner_id: string
  invite_code: string
  created_at: string
}

export interface GroupMember {
  id: string
  group_id: string
  user_id: string
  role: 'admin' | 'moderator' | 'user' | 'noob'
  joined_at: string
  /** Joined from profiles — populated by select queries */
  profiles?: Pick<Profile, 'username' | 'avatar_url'>
}

export interface Channel {
  id: string
  group_id: string
  name: string
  description: string | null
  noob_access?: boolean
  position: number
  created_at: string
}

/** Minimal shape of a quoted (replied-to) message. */
export interface QuotedMessage {
  id: string
  content: string
  user_id: string
  profiles: Pick<Profile, 'username' | 'avatar_url'>
}

export interface Reaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
  /** Joined from profiles — populated by select queries */
  profiles?: Pick<Profile, 'username'>
}

export interface Message {
  id: string
  channel_id: string
  user_id: string
  content: string
  reply_to_id: string | null
  thread_root_id?: string | null
  thread_reply_count?: number
  thread_last_reply_at?: string | null
  mirrored_from_thread_id?: string | null
  edited_at: string | null
  pinned_at?: string | null
  is_system?: boolean
  system_type?: string | null
  system_data?: Record<string, any> | null
  created_at: string
  attachments?: Attachment[]
  /** Joined from profiles — populated by select queries */
  profiles?: Pick<Profile, 'username' | 'avatar_url'>
  /** Joined quoted message — null when original was deleted */
  replied_to?: QuotedMessage | null
}

/** Message with the profiles join always present (used in chat components). */
export type MessageWithProfile = Message & {
  profiles: Pick<Profile, 'username' | 'avatar_url' | 'display_name'>
  replied_to?: QuotedMessage | null
  reactions?: Reaction[]
}

export interface ThreadSummary {
  rootId: string
  replyCount: number
  lastReplyAt: string
  lastReplyAuthorIds: string[]
}

export type MessageSearchResult = MessageWithProfile & {
  channels?: {
    id: string
    name: string
    group_id?: string
  } | null
}

export interface PinnedMessage {
  id: string
  channel_id: string
  message_id: string
  pinned_by_id: string | null
  system_message_id: string | null
  pinned_at: string
  message: {
    id: string
    content: string
    created_at: string
    user_id: string
    profiles: {
      username: string
      display_name: string | null
      avatar_url: string | null
      username_color: string
    }
  } | null
}

export interface DirectMessage {
  id: string
  conversation_id: string
  sender_id: string
  recipient_id: string
  content: string
  attachments: Attachment[]
  edited_at: string | null
  read_at: string | null
  created_at: string
}

export type DirectMessageWithProfile = DirectMessage & {
  sender: Profile
}

export type DMConversation = {
  id: string
  user_a: string
  user_b: string
  last_message: string | null
  last_message_at: string | null
  created_at: string
  other_user: Profile
  unread_count: number
}

export interface ChannelReadState {
  id: string
  user_id: string
  channel_id: string
  last_read_at: string
}

export interface NotificationPreferences {
  user_id: string
  dm_messages: boolean
  mentions: boolean
  group_messages: boolean
  created_at: string
  updated_at: string
}

export type NotificationPreferenceUpdate = Partial<
  Pick<NotificationPreferences, 'dm_messages' | 'mentions' | 'group_messages'>
>

export interface NotificationSubscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  updated_at: string
}

export interface NotificationSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  user_agent?: string | null
}

export type NotificationEventType = 'dm_message' | 'mention' | 'group_message' | 'thread_reply'

export interface NotificationEvent {
  id: string
  user_id: string
  actor_id: string | null
  type: NotificationEventType
  source_table: string
  source_id: string
  conversation_id: string | null
  channel_id: string | null
  title: string
  body: string | null
  url: string | null
  read_at: string | null
  pushed_at: string | null
  push_error: string | null
  created_at: string
}

/** Admin dashboard types */

export interface AdminUser {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  role: 'admin' | 'moderator' | 'user' | 'noob'
  group_id: string
  joined_at: string
  last_active: string | null
  is_banned: boolean
}

export interface AdminGroup {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  owner_username: string
  member_count: number
  channel_count: number
  created_at: string
}

export interface AdminReport {
  id: string
  message_id: string
  message_content: string
  message_author_id: string | null
  message_author_username: string | null
  channel_id: string | null
  channel_name: string | null
  reported_by: string
  reporter_username: string
  category?: string | null
  reason: string | null
  moderation_note?: string | null
  status: 'pending' | 'reviewed' | 'dismissed'
  created_at: string
}

export interface AuditEntry {
  id: string
  admin_id: string
  admin_username: string
  admin_avatar_url: string | null
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, any> | null
  created_at: string
}

/** Presence payload for a single online user */
export interface PresenceUser {
  user_id: string
  username: string
  avatar_url: string | null
  online_at: string
}
