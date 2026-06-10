import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createForumPost } from '@/app/(app)/forums/actions'

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeInListBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function makeInsertSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeInsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
  return builder
}

function setupClient(builders: Builder[], userId: string | null = 'user-1') {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    if (!builder) throw new Error('Missing mock builder')
    return builder
  })

  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from,
  })

  return { from }
}

function postForm(input: { title?: string; content?: string; channelId?: string; tagIds?: string[] } = {}) {
  const formData = new FormData()
  formData.set('channel_id', input.channelId ?? 'ch-forum')
  if (input.title !== undefined) formData.set('title', input.title)
  if (input.content !== undefined) formData.set('content', input.content)
  for (const tagId of input.tagIds ?? []) formData.append('tag_ids', tagId)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createForumPost', () => {
  it('requires a title and body', async () => {
    setupClient([])
    await expect(createForumPost(postForm({ title: '  ', content: 'hello' }))).resolves.toEqual({
      error: 'Post title is required.',
    })
    setupClient([])
    await expect(createForumPost(postForm({ title: 'Hello', content: ' ' }))).resolves.toEqual({
      error: 'Post body is required.',
    })
  })

  it('only allows posts in forum channels', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'ch-forum', kind: 'text' } }),
    ])

    await expect(createForumPost(postForm({ title: 'Hello', content: 'World' }))).resolves.toEqual({
      error: 'Posts can only be created in forum channels.',
    })
  })

  it('creates a titled thread root', async () => {
    const insert = makeInsertSelectBuilder({ data: { id: 'post-1' } })
    setupClient([
      makeSelectBuilder({ data: { id: 'ch-forum', kind: 'forum' } }),
      insert,
    ])

    await expect(createForumPost(postForm({ title: '  Build   logs  ', content: 'Day one' }))).resolves.toEqual({
      ok: true,
      postId: 'post-1',
    })
    expect(insert.insert).toHaveBeenCalledWith({
      channel_id: 'ch-forum',
      user_id: 'user-1',
      content: 'Day one',
      thread_title: 'Build logs',
    })
  })

  it('validates tags belong to the forum and links them', async () => {
    const tagInsert = makeInsertBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'ch-forum', kind: 'forum' } }),
      makeInListBuilder({ data: [{ id: 'tag-1' }, { id: 'tag-2' }] }),
      makeInsertSelectBuilder({ data: { id: 'post-1' } }),
      tagInsert,
    ])

    await expect(
      createForumPost(postForm({ title: 'Tagged', content: 'Body', tagIds: ['tag-1', 'tag-2'] })),
    ).resolves.toEqual({ ok: true, postId: 'post-1' })
    expect(tagInsert.insert).toHaveBeenCalledWith([
      { tag_id: 'tag-1', root_message_id: 'post-1' },
      { tag_id: 'tag-2', root_message_id: 'post-1' },
    ])
  })

  it('rejects tags from other forums', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'ch-forum', kind: 'forum' } }),
      makeInListBuilder({ data: [{ id: 'tag-1' }] }),
    ])

    await expect(
      createForumPost(postForm({ title: 'Tagged', content: 'Body', tagIds: ['tag-1', 'tag-other'] })),
    ).resolves.toEqual({ error: 'One or more tags do not belong to this forum.' })
  })
})
