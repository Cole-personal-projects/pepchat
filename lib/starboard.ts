import type { SupabaseClient } from '@supabase/supabase-js'

/** The reaction that feeds the starboard. */
export const STARBOARD_EMOJI = '⭐'

/** Longest preview reposted into the highlights channel. */
const PREVIEW_LENGTH = 200

type MessageRow = {
  id: string
  channel_id: string
  user_id: string
  content: string
  is_system: boolean
  attachments: Array<{ type?: string }> | null
}

type GroupConfig = {
  id: string
  starboard_channel_id: string | null
  starboard_threshold: number
}

export function starboardPreview(content: string, attachments: MessageRow['attachments']): string {
  const trimmed = content.trim()
  const text = trimmed.length > PREVIEW_LENGTH ? `${trimmed.slice(0, PREVIEW_LENGTH)}…` : trimmed
  if (text) return text
  const count = attachments?.length ?? 0
  if (count > 1) return `📎 ${count} attachments`
  if (count === 1) return '📎 attachment'
  return '(no text)'
}

/**
 * Called after a ⭐ reaction is added: if the message just reached the
 * group's starboard threshold, repost it once into the highlights channel.
 *
 * Best-effort by design — failures (missing config, race losses on the
 * unique entry, RLS denials) leave chat untouched. The unique constraint on
 * starboard_entries.message_id is the dedupe: when two reactions race past
 * the threshold, exactly one insert wins and only the winner reposts.
 */
export async function maybeStarboardMessage(
  supabase: SupabaseClient,
  messageId: string,
  actorId: string,
  emoji: string,
): Promise<void> {
  if (emoji !== STARBOARD_EMOJI) return

  const { data: messageRow } = await supabase
    .from('messages')
    .select('id, channel_id, user_id, content, is_system, attachments')
    .eq('id', messageId)
    .maybeSingle()

  const message = messageRow as MessageRow | null
  // System messages (pins, prior starboard posts) never re-enter the board.
  if (!message || message.is_system) return

  const { data: channel } = await supabase
    .from('channels')
    .select('id, group_id, name')
    .eq('id', message.channel_id)
    .maybeSingle()

  if (!channel) return

  const { data: groupRow } = await supabase
    .from('groups')
    .select('id, starboard_channel_id, starboard_threshold')
    .eq('id', (channel as { group_id: string }).group_id)
    .maybeSingle()

  const group = groupRow as GroupConfig | null
  if (!group?.starboard_channel_id) return
  // Stars inside the highlights channel itself don't recurse.
  if (group.starboard_channel_id === message.channel_id) return

  const { count } = await supabase
    .from('message_reactions')
    .select('id', { count: 'exact', head: true })
    .eq('message_id', messageId)
    .eq('emoji', STARBOARD_EMOJI)

  const stars = count ?? 0
  if (stars < group.starboard_threshold) return

  // Already boarded (e.g. un-starred and re-starred) — never repost twice.
  const { data: existing } = await supabase
    .from('starboard_entries')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle()
  if (existing) return

  // Claim the entry; losing the race (or already boarded) ends here.
  const { data: entry, error: entryError } = await supabase
    .from('starboard_entries')
    .insert({ group_id: group.id, message_id: messageId, star_count: stars })
    .select('id')
    .maybeSingle()

  if (entryError || !entry) return

  const { data: author } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', message.user_id)
    .maybeSingle()

  const authorProfile = author as { username: string; display_name: string | null } | null
  const authorName = authorProfile?.display_name ?? authorProfile?.username ?? 'Someone'

  const { data: starboardMessage } = await supabase
    .from('messages')
    .insert({
      channel_id: group.starboard_channel_id,
      user_id: actorId,
      content: '',
      is_system: true,
      system_type: 'starboard',
      system_data: {
        author_name: authorName,
        preview: starboardPreview(message.content, message.attachments),
        star_count: stars,
        original_message_id: messageId,
        original_channel_id: message.channel_id,
        original_channel_name: (channel as { name: string }).name,
      },
    })
    .select('id')
    .single()

  if (starboardMessage) {
    await supabase
      .from('starboard_entries')
      .update({ starboard_message_id: (starboardMessage as { id: string }).id })
      .eq('id', (entry as { id: string }).id)
  }
}
