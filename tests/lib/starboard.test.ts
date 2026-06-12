// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { maybeStarboardMessage, starboardPreview, STARBOARD_EMOJI } from '@/lib/starboard'

const MESSAGE = {
  id: 'msg-1',
  channel_id: 'chan-general',
  user_id: 'author-1',
  content: 'the funniest thing ever said',
  is_system: false,
  attachments: null,
}

const CHANNEL = { id: 'chan-general', group_id: 'group-1', name: 'general' }
const GROUP = { id: 'group-1', starboard_channel_id: 'chan-highlights', starboard_threshold: 2 }
const AUTHOR = { username: 'ashe', display_name: 'Ashe' }

type TableConfig = {
  messages?: unknown
  channels?: unknown
  groups?: unknown
  profiles?: unknown
  reactionCount?: number
  existingEntry?: unknown
  entryInsert?: { data?: unknown; error?: { message: string } | null }
}

/** Chainable stub returning per-table canned data and recording writes. */
function makeSupabase(config: TableConfig) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []

  function builder(table: string) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const single = {
      messages: config.messages === undefined ? MESSAGE : config.messages,
      channels: config.channels === undefined ? CHANNEL : config.channels,
      groups: config.groups === undefined ? GROUP : config.groups,
      profiles: config.profiles === undefined ? AUTHOR : config.profiles,
      starboard_entries: config.existingEntry ?? null,
    }[table]

    chain.select = vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (table === 'message_reactions' && opts?.head) {
        const result = { count: config.reactionCount ?? 0, error: null }
        chain.eq = vi.fn(() => chain)
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      }
      return chain
    })
    chain.eq = vi.fn(self)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: single ?? null, error: null })
    chain.single = vi.fn().mockResolvedValue({
      data: table === 'messages' ? { id: 'starboard-msg-1' } : null,
      error: null,
    })
    chain.insert = vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values })
      if (table === 'starboard_entries') {
        const result = config.entryInsert ?? { data: { id: 'entry-1' }, error: null }
        chain.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
      }
      return chain
    })
    chain.update = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values })
      chain.eq = vi.fn(() => Promise.resolve({ data: null, error: null }))
      return chain
    })
    return chain
  }

  return { client: { from: vi.fn((table: string) => builder(table)) }, inserts, updates }
}

describe('maybeStarboardMessage', () => {
  it('reposts to the highlights channel when the threshold is reached', async () => {
    const { client, inserts, updates } = makeSupabase({ reactionCount: 2 })

    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)

    const entry = inserts.find(i => i.table === 'starboard_entries')
    expect(entry?.values).toMatchObject({ group_id: 'group-1', message_id: 'msg-1', star_count: 2 })

    const repost = inserts.find(i => i.table === 'messages')
    expect(repost?.values).toMatchObject({
      channel_id: 'chan-highlights',
      is_system: true,
      system_type: 'starboard',
    })
    expect((repost?.values.system_data as Record<string, unknown>)).toMatchObject({
      author_name: 'Ashe',
      preview: 'the funniest thing ever said',
      star_count: 2,
      original_message_id: 'msg-1',
      original_channel_name: 'general',
    })

    expect(updates.find(u => u.table === 'starboard_entries')?.values).toEqual({
      starboard_message_id: 'starboard-msg-1',
    })
  })

  it('does nothing below the threshold', async () => {
    const { client, inserts } = makeSupabase({ reactionCount: 1 })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts).toHaveLength(0)
  })

  it('ignores non-star emoji without touching the database', async () => {
    const { client } = makeSupabase({})
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', '🔥')
    expect(client.from).not.toHaveBeenCalled()
  })

  it('does nothing when the group has no starboard channel', async () => {
    const { client, inserts } = makeSupabase({
      reactionCount: 5,
      groups: { ...GROUP, starboard_channel_id: null },
    })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts).toHaveLength(0)
  })

  it('never re-boards messages inside the highlights channel', async () => {
    const { client, inserts } = makeSupabase({
      reactionCount: 5,
      messages: { ...MESSAGE, channel_id: 'chan-highlights' },
      channels: { ...CHANNEL, id: 'chan-highlights' },
    })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts).toHaveLength(0)
  })

  it('skips system messages (pins, earlier starboard posts)', async () => {
    const { client, inserts } = makeSupabase({
      reactionCount: 5,
      messages: { ...MESSAGE, is_system: true },
    })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts).toHaveLength(0)
  })

  it('skips messages that are already on the board', async () => {
    const { client, inserts } = makeSupabase({ reactionCount: 5, existingEntry: { id: 'entry-old' } })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts).toHaveLength(0)
  })

  it('stops after losing the entry race (no duplicate repost)', async () => {
    const { client, inserts } = makeSupabase({
      reactionCount: 3,
      entryInsert: { data: null, error: { message: 'duplicate key value violates unique constraint' } },
    })
    await maybeStarboardMessage(client as never, 'msg-1', 'actor-1', STARBOARD_EMOJI)
    expect(inserts.find(i => i.table === 'messages')).toBeUndefined()
  })
})

describe('starboardPreview', () => {
  it('passes short text through', () => {
    expect(starboardPreview('hello', null)).toBe('hello')
  })

  it('truncates long text with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const preview = starboardPreview(long, null)
    expect(preview.length).toBe(201)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('describes attachment-only messages', () => {
    expect(starboardPreview('', [{ type: 'image' }])).toBe('📎 attachment')
    expect(starboardPreview('', [{ type: 'image' }, { type: 'gif' }])).toBe('📎 2 attachments')
    expect(starboardPreview('', null)).toBe('(no text)')
  })
})
