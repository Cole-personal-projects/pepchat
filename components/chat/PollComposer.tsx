'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { createPoll } from '@/app/(app)/polls/actions'

interface PollComposerProps {
  open: boolean
  onClose: () => void
  channelId: string
}

const MAX_OPTIONS = 6

/** Question + 2–6 options; submitting posts the poll message to the channel. */
export default function PollComposer({ open, onClose, channelId }: PollComposerProps) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setQuestion('')
    setOptions(['', ''])
    setError('')
  }

  function handleClose() {
    if (submitting) return
    reset()
    onClose()
  }

  function setOption(index: number, value: string) {
    setOptions(current => current.map((opt, i) => (i === index ? value : opt)))
  }

  function removeOption(index: number) {
    setOptions(current => current.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const result = await createPoll(channelId, question, options)
    setSubmitting(false)
    if (result && 'error' in result) {
      setError(result.error)
      return
    }
    reset()
    onClose()
  }

  const filledOptions = options.filter(opt => opt.trim()).length
  const canSubmit = question.trim().length > 0 && filledOptions >= 2 && !submitting

  return (
    <Modal open={open} onClose={handleClose} title="Create Poll">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="poll-composer">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="poll-question" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Question
          </label>
          <input
            id="poll-question"
            data-testid="poll-question-input"
            type="text"
            required
            maxLength={300}
            autoComplete="off"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Which game tonight?"
            className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Options
          </span>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                data-testid={`poll-option-input-${index}`}
                type="text"
                maxLength={80}
                autoComplete="off"
                value={option}
                onChange={e => setOption(index, e.target.value)}
                placeholder={`Option ${index + 1}`}
                className="flex-1 rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => removeOption(index)}
                  className="icon-btn"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              data-testid="poll-add-option"
              onClick={() => setOptions(current => [...current, ''])}
              className="self-start text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              + Add option
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded px-4 py-2 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="poll-submit"
            disabled={!canSubmit}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Posting...' : 'Post Poll'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
