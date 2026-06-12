'use client'

import { useCallback, useEffect, useState } from 'react'
import { closePoll, getPollResults, votePoll } from '@/app/(app)/polls/actions'
import { createClient } from '@/lib/supabase/client'
import type { PollResults } from '@/lib/types'

interface PollCardProps {
  pollId: string
  currentUserId: string
}

/**
 * Live poll attached to a message: single-choice voting with changeable
 * votes, realtime tallies, and a creator/admin close control.
 */
export default function PollCard({ pollId, currentUserId }: PollCardProps) {
  const [results, setResults] = useState<PollResults | null>(null)
  const [error, setError] = useState('')
  const [pendingOption, setPendingOption] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await getPollResults(pollId)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError('')
    setResults(result.results)
  }, [pollId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live tallies: votes and the poll row (closing) both refresh the card.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`poll-${pollId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `poll_id=eq.${pollId}` }, () => { void refresh() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'polls', filter: `id=eq.${pollId}` }, () => { void refresh() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [pollId, refresh])

  async function handleVote(optionId: string) {
    if (!results || results.poll.closed_at || pendingOption) return
    const previous = results
    setPendingOption(optionId)
    // Optimistic: move own vote immediately.
    setResults(current => {
      if (!current) return current
      const counts = { ...current.counts }
      if (current.ownVote) counts[current.ownVote] = Math.max(0, (counts[current.ownVote] ?? 1) - 1)
      counts[optionId] = (counts[optionId] ?? 0) + 1
      return {
        ...current,
        counts,
        totalVotes: current.ownVote ? current.totalVotes : current.totalVotes + 1,
        ownVote: optionId,
      }
    })
    const result = await votePoll(pollId, optionId)
    setPendingOption(null)
    if (result && 'error' in result) {
      setResults(previous)
      setError(result.error)
    }
  }

  async function handleClose() {
    const result = await closePoll(pollId)
    if (result && 'error' in result) setError(result.error)
    else void refresh()
  }

  if (error && !results) {
    return (
      <div data-testid="poll-card-error" className="mt-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-muted)]">
        {error}
      </div>
    )
  }

  if (!results) {
    return (
      <div data-testid="poll-card-loading" className="mt-1 h-24 w-full max-w-md rounded-lg skeleton-pulse" />
    )
  }

  const { poll, counts, totalVotes, ownVote } = results
  const closed = Boolean(poll.closed_at)
  const isCreator = poll.creator_id === currentUserId

  return (
    <div
      data-testid="poll-card"
      className="mt-1 w-full max-w-md rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p data-testid="poll-question" className="text-sm font-semibold text-[var(--text-primary)]" style={{ overflowWrap: 'anywhere' }}>
          📊 {poll.question}
        </p>
        {closed && (
          <span data-testid="poll-closed-badge" className="flex-shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            Closed
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {poll.options.map(option => {
          const votes = counts[option.id] ?? 0
          const share = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0
          const isOwn = ownVote === option.id
          return (
            <button
              key={option.id}
              type="button"
              data-testid={`poll-option-${option.id}`}
              aria-pressed={isOwn}
              disabled={closed || pendingOption !== null}
              onClick={() => handleVote(option.id)}
              className="relative overflow-hidden rounded-md border text-left transition-colors disabled:cursor-default"
              style={{
                borderColor: isOwn ? 'var(--accent)' : 'var(--border-soft)',
                background: 'var(--bg-primary)',
                padding: '8px 10px',
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 transition-all"
                style={{
                  width: `${share}%`,
                  background: isOwn ? 'var(--accent-soft)' : 'rgba(255, 240, 220, 0.06)',
                }}
              />
              <span className="relative flex items-center justify-between gap-2 text-sm">
                <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {isOwn && <span aria-hidden="true" style={{ color: 'var(--accent)' }}>✓ </span>}
                  {option.label}
                </span>
                <span data-testid={`poll-share-${option.id}`} className="flex-shrink-0 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {share}%
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p data-testid="poll-total" className="text-[11px] text-[var(--text-faint)]">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
          {!closed && ownVote && ' · tap another option to change your vote'}
        </p>
        {!closed && isCreator && (
          <button
            type="button"
            data-testid="poll-close-btn"
            onClick={handleClose}
            className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Close poll
          </button>
        )}
      </div>

      {error && results && (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  )
}
