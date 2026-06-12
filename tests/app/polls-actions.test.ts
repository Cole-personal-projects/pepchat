import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPoll, votePoll, closePoll, getPollResults } from '@/app/(app)/polls/actions'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeBuilder(result: QueryResult = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const method of ['select', 'eq', 'is', 'insert', 'update', 'upsert', 'delete']) {
    chain[method] = vi.fn(self)
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolved)
  chain.single = vi.fn().mockResolvedValue(resolved)
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resolved).then(resolve, reject)
  return chain
}

function setupClient(builders: unknown[], userId = 'user-1') {
  let index = 0
  const from = vi.fn(() => builders[Math.min(index++, builders.length - 1)])
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from,
  })
  return { from }
}

const POLL = {
  id: 'poll-1',
  group_id: 'group-1',
  channel_id: 'chan-1',
  message_id: null,
  creator_id: 'user-1',
  question: 'Which game tonight?',
  options: [
    { id: 'opt-1', label: 'Valheim' },
    { id: 'opt-2', label: 'Rocket League' },
  ],
  closed_at: null,
  created_at: '2026-06-12T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPoll', () => {
  it('creates the poll and its carrier message', async () => {
    const channel = makeBuilder({ data: { id: 'chan-1', group_id: 'group-1' } })
    const pollInsert = makeBuilder({ data: POLL })
    const messageInsert = makeBuilder({ data: { id: 'msg-1' } })
    const pollUpdate = makeBuilder({})
    setupClient([channel, pollInsert, messageInsert, pollUpdate])

    const result = await createPoll('chan-1', 'Which game tonight?', ['Valheim', 'Rocket League'])

    expect(result).toMatchObject({ ok: true, poll: { id: 'poll-1', message_id: 'msg-1' } })
    expect((pollInsert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      group_id: 'group-1',
      creator_id: 'user-1',
      question: 'Which game tonight?',
      options: [
        { id: 'opt-1', label: 'Valheim' },
        { id: 'opt-2', label: 'Rocket League' },
      ],
    })
    expect((messageInsert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      channel_id: 'chan-1',
      attachments: [{ type: 'poll', poll_id: 'poll-1' }],
    })
  })

  it('rejects fewer than two non-empty options', async () => {
    setupClient([makeBuilder({ data: { id: 'chan-1', group_id: 'group-1' } })])
    await expect(createPoll('chan-1', 'Q?', ['only one', '  '])).resolves.toEqual({
      error: 'A poll needs at least 2 options.',
    })
  })

  it('rejects an empty question', async () => {
    setupClient([makeBuilder({})])
    await expect(createPoll('chan-1', '   ', ['a', 'b'])).resolves.toEqual({
      error: 'Poll question is required.',
    })
  })

  it('cleans up the poll when the carrier message fails', async () => {
    const channel = makeBuilder({ data: { id: 'chan-1', group_id: 'group-1' } })
    const pollInsert = makeBuilder({ data: POLL })
    const messageInsert = makeBuilder({ error: { message: 'insert denied' } })
    const pollDelete = makeBuilder({})
    setupClient([channel, pollInsert, messageInsert, pollDelete])

    await expect(createPoll('chan-1', 'Q?', ['a', 'b'])).resolves.toEqual({ error: 'insert denied' })
    expect(pollDelete.delete).toHaveBeenCalled()
  })
})

describe('votePoll', () => {
  it('upserts the caller vote for a valid open option', async () => {
    const pollLookup = makeBuilder({ data: POLL })
    const upsert = makeBuilder({})
    setupClient([pollLookup, upsert])

    await expect(votePoll('poll-1', 'opt-2')).resolves.toEqual({ ok: true })
    expect(upsert.upsert).toHaveBeenCalledWith(
      { poll_id: 'poll-1', option_id: 'opt-2', user_id: 'user-1' },
      { onConflict: 'poll_id,user_id' },
    )
  })

  it('refuses votes on closed polls', async () => {
    setupClient([makeBuilder({ data: { ...POLL, closed_at: '2026-06-12T01:00:00Z' } })])
    await expect(votePoll('poll-1', 'opt-1')).resolves.toEqual({ error: 'This poll is closed.' })
  })

  it('refuses options that are not part of the poll', async () => {
    setupClient([makeBuilder({ data: POLL })])
    await expect(votePoll('poll-1', 'opt-99')).resolves.toEqual({
      error: 'That option is not part of this poll.',
    })
  })
})

describe('closePoll', () => {
  it('closes an open poll', async () => {
    setupClient([makeBuilder({ data: [{ id: 'poll-1' }] })])
    await expect(closePoll('poll-1')).resolves.toEqual({ ok: true })
  })

  it('reports when nothing was closed (already closed or not permitted)', async () => {
    setupClient([makeBuilder({ data: [] })])
    await expect(closePoll('poll-1')).resolves.toEqual({
      error: 'Only the poll creator or an admin can close an open poll.',
    })
  })
})

describe('getPollResults', () => {
  it('tallies votes per option and reports the caller vote', async () => {
    const pollLookup = makeBuilder({ data: POLL })
    const votes = makeBuilder({
      data: [
        { option_id: 'opt-1', user_id: 'user-1' },
        { option_id: 'opt-1', user_id: 'user-2' },
        { option_id: 'opt-2', user_id: 'user-3' },
      ],
    })
    setupClient([pollLookup, votes])

    const result = await getPollResults('poll-1')
    expect(result).toMatchObject({
      ok: true,
      results: {
        counts: { 'opt-1': 2, 'opt-2': 1 },
        totalVotes: 3,
        ownVote: 'opt-1',
      },
    })
  })
})
