'use server'

import { withAuth } from '@/lib/actions/withAuth'
import type { Poll, PollOption, PollResults } from '@/lib/types'

const MAX_OPTIONS = 6
const MIN_OPTIONS = 2

type PollResult = { error: string } | { ok: true; poll: Poll }
type VoteResult = { error: string } | { ok: true }
type ResultsResult = { error: string } | { ok: true; results: PollResults }

/**
 * Creates a poll and the chat message carrying it (a 'poll' attachment).
 * The message is the poll's home: deleting it cascades the poll away.
 */
export const createPoll = withAuth(
  async ({ supabase, user }, channelId: string, question: string, optionLabels: string[]): Promise<PollResult> => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return { error: 'Poll question is required.' }
    if (trimmedQuestion.length > 300) return { error: 'Question must be 300 characters or fewer.' }

    const labels = optionLabels.map(label => label.trim()).filter(Boolean)
    if (labels.length < MIN_OPTIONS) return { error: `A poll needs at least ${MIN_OPTIONS} options.` }
    if (labels.length > MAX_OPTIONS) return { error: `A poll can have at most ${MAX_OPTIONS} options.` }
    if (labels.some(label => label.length > 80)) return { error: 'Options must be 80 characters or fewer.' }

    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, group_id')
      .eq('id', channelId)
      .maybeSingle()

    if (channelError || !channel) return { error: 'Channel not found.' }
    const groupId = (channel as { group_id: string }).group_id

    const options: PollOption[] = labels.map((label, index) => ({ id: `opt-${index + 1}`, label }))

    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        group_id: groupId,
        channel_id: channelId,
        creator_id: user.id,
        question: trimmedQuestion,
        options,
      })
      .select('*')
      .single()

    if (pollError || !poll) return { error: pollError?.message ?? 'Could not create the poll.' }
    const pollRow = poll as Poll

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        user_id: user.id,
        content: '',
        attachments: [{ type: 'poll', poll_id: pollRow.id }],
      })
      .select('id')
      .single()

    if (messageError || !message) {
      // Orphaned poll carries no message — remove it so it can't linger.
      await supabase.from('polls').delete().eq('id', pollRow.id)
      return { error: messageError?.message ?? 'Could not post the poll.' }
    }

    await supabase
      .from('polls')
      .update({ message_id: (message as { id: string }).id })
      .eq('id', pollRow.id)

    return { ok: true, poll: { ...pollRow, message_id: (message as { id: string }).id } }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Casts or changes the caller's single vote. Closed polls refuse. */
export const votePoll = withAuth(
  async ({ supabase, user }, pollId: string, optionId: string): Promise<VoteResult> => {
    const { data: pollRow } = await supabase
      .from('polls')
      .select('id, options, closed_at')
      .eq('id', pollId)
      .maybeSingle()

    const poll = pollRow as Pick<Poll, 'id' | 'options' | 'closed_at'> | null
    if (!poll) return { error: 'Poll not found.' }
    if (poll.closed_at) return { error: 'This poll is closed.' }
    if (!poll.options.some(option => option.id === optionId)) {
      return { error: 'That option is not part of this poll.' }
    }

    const { error } = await supabase
      .from('poll_votes')
      .upsert(
        { poll_id: pollId, option_id: optionId, user_id: user.id },
        { onConflict: 'poll_id,user_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Closes a poll. RLS limits this to the creator or a group admin. */
export const closePoll = withAuth(
  async ({ supabase }, pollId: string): Promise<VoteResult> => {
    const { data: updated, error } = await supabase
      .from('polls')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', pollId)
      .is('closed_at', null)
      .select('id')

    if (error) return { error: error.message }
    if (!updated || updated.length === 0) {
      return { error: 'Only the poll creator or an admin can close an open poll.' }
    }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Poll + live tallies + the caller's own vote. */
export const getPollResults = withAuth(
  async ({ supabase, user }, pollId: string): Promise<ResultsResult> => {
    const { data: pollRow, error: pollError } = await supabase
      .from('polls')
      .select('*')
      .eq('id', pollId)
      .maybeSingle()

    if (pollError || !pollRow) return { error: 'Poll not found.' }
    const poll = pollRow as Poll

    const { data: voteRows, error: votesError } = await supabase
      .from('poll_votes')
      .select('option_id, user_id')
      .eq('poll_id', pollId)

    if (votesError) return { error: votesError.message }
    const votes = (voteRows ?? []) as Array<{ option_id: string; user_id: string }>

    const counts: Record<string, number> = {}
    for (const option of poll.options) counts[option.id] = 0
    let ownVote: string | null = null
    for (const vote of votes) {
      counts[vote.option_id] = (counts[vote.option_id] ?? 0) + 1
      if (vote.user_id === user.id) ownVote = vote.option_id
    }

    return {
      ok: true,
      results: { poll, counts, totalVotes: votes.length, ownVote },
    }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
