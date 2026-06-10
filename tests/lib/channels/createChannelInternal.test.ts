import { describe, expect, it, vi } from 'vitest'
import { createChannelInternal } from '@/lib/channels/createChannelInternal'

type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeSelectBuilder(result: unknown): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  return builder
}

function makeListBuilder(result: unknown): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue(result)
  return builder
}

function makeInsertBuilder(result: unknown): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(result)
  return builder
}

describe('createChannelInternal', () => {
  it('surfaces is_ephemeral on created persistent voice channels', async () => {
    const duplicate = makeSelectBuilder({ data: null, error: null })
    const positions = makeListBuilder({ data: [{ position: 1 }], error: null })
    const insert = makeInsertBuilder({
      data: {
        id: 'voice-channel-1',
        group_id: 'group-1',
        name: 'war-room',
        description: 'Voice standup',
        noob_access: false,
        position: 2,
        is_ephemeral: false,
        channel_kind: 'persistent_voice',
      },
      error: null,
    })
    const builders = [duplicate, positions, insert]
    const supabase = {
      from: vi.fn(() => {
        const builder = builders.shift()
        if (!builder) throw new Error('unexpected channels call')
        return builder
      }),
    }

    await expect(createChannelInternal(supabase as never, {
      groupId: 'group-1',
      name: 'War Room',
      description: 'Voice standup',
      kind: 'persistent_voice',
      isEphemeral: false,
    })).resolves.toEqual({
      ok: true,
      channel: {
        id: 'voice-channel-1',
        group_id: 'group-1',
        name: 'war-room',
        description: 'Voice standup',
        noob_access: false,
        position: 2,
        is_ephemeral: false,
        channel_kind: 'persistent_voice',
      },
    })
    expect(insert.select).toHaveBeenCalledWith('id, group_id, name, description, noob_access, position, is_ephemeral, channel_kind')
  })

  it('persists persistent voice channel kind on voice channel creation', async () => {
    const duplicate = makeSelectBuilder({ data: null, error: null })
    const positions = makeListBuilder({ data: [], error: null })
    const insert = makeInsertBuilder({
      data: {
        id: 'voice-channel-1',
        group_id: 'group-1',
        name: 'war-room',
        description: null,
        noob_access: false,
        position: 0,
        is_ephemeral: false,
        channel_kind: 'persistent_voice',
      },
      error: null,
    })
    const builders = [duplicate, positions, insert]
    const supabase = {
      from: vi.fn(() => {
        const builder = builders.shift()
        if (!builder) throw new Error('unexpected channels call')
        return builder
      }),
    }

    await createChannelInternal(supabase as never, {
      groupId: 'group-1',
      name: 'War Room',
      kind: 'persistent_voice',
      isEphemeral: false,
    })

    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({
      channel_kind: 'persistent_voice',
      is_ephemeral: false,
    }))
  })
})
