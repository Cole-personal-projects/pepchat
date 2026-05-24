/**
 * Shared Supabase select strings.
 * Must live outside 'use server' files since those only allow async function exports.
 */

export const MESSAGE_SELECT =
  '*, profiles(username, avatar_url, display_name, username_color), replied_to:reply_to_id(id, content, user_id, profiles(username, avatar_url, display_name)), promoted_channel:promoted_to_channel_id(id, name), mirrored_from_thread:mirrored_from_thread_id(id, thread_root_id, promoted_to_channel_id, promoted_at, promoted_channel:promoted_to_channel_id(id, name)), reactions:message_reactions(id, message_id, user_id, emoji, created_at, profiles(username))'

export const THREAD_MESSAGE_SELECT = MESSAGE_SELECT

export const DM_SELECT =
  '*, sender:profiles!sender_id(id, username, avatar_url, display_name, username_color, banner_color, badge, pronouns, bio, location, website, member_since, updated_at, created_at)'
