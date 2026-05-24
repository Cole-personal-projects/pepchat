'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { promoteThreadToChannel } from '@/app/(app)/messages/promote-thread-action'
import type { MessageWithProfile } from '@/lib/types'

interface PromoteThreadModalProps {
  open: boolean
  onClose: () => void
  rootMessage: MessageWithProfile
  sourceChannelName: string
  sourceNoobAccess?: boolean
  replyCount: number
  onPromoted?: (newChannelId: string, channelName: string) => void
}

function slugifyChannelName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return (slug || 'promoted-thread').slice(0, 80)
}

export function defaultPromotedChannelName(content: string): string {
  return slugifyChannelName(content.slice(0, 30))
}

export default function PromoteThreadModal({
  open,
  onClose,
  rootMessage,
  sourceChannelName,
  sourceNoobAccess = false,
  replyCount,
  onPromoted,
}: PromoteThreadModalProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const defaultName = useMemo(() => defaultPromotedChannelName(rootMessage.content), [rootMessage.content])
  const [channelName, setChannelName] = useState(defaultName)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    const submittedChannelName = String(formData.get('name') ?? '').trim()
    const channelTopic = String(formData.get('description') ?? '').trim()
    startTransition(async () => {
      const result = await promoteThreadToChannel({
        rootMessageId: rootMessage.id,
        channelName: submittedChannelName,
        channelTopic,
        noobAccess: formData.get('noob_access') === 'on',
      })

      if ('error' in result) {
        setError(result.error)
        return
      }

      onPromoted?.(result.newChannelId, submittedChannelName)
      onClose()
      router.push(`/channels/${result.newChannelId}`)
    })
  }

  function handleClose() {
    if (isPending) return
    setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Promote Thread">
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Create a new channel from this thread and replace the source message with a compact link.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="promote-thread-name"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Channel Name
          </label>
          <div className="flex items-center rounded border border-black/20 bg-[var(--bg-primary)] focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <span className="select-none pl-3 text-base text-[var(--text-muted)]">#</span>
            <input
              id="promote-thread-name"
              name="name"
              type="text"
              required
              maxLength={80}
              autoComplete="off"
              value={channelName}
              onChange={e => setChannelName(slugifyChannelName(e.target.value))}
              className="flex-1 bg-transparent px-2 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              placeholder="promoted-thread"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="promote-thread-description"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Topic
          </label>
          <textarea
            id="promote-thread-description"
            name="description"
            maxLength={180}
            rows={3}
            className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="What belongs in this channel?"
          />
        </div>

        <label className="flex items-start gap-3 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            name="noob_access"
            defaultChecked={sourceNoobAccess}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block font-semibold">Visible to new members</span>
            <span className="block text-xs text-[var(--text-muted)]">
              Noob members can open this channel before being promoted.
            </span>
          </span>
        </label>

        <div data-testid="promote-thread-summary" className="rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-muted)]">
          This will move <strong>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</strong> from this thread into a new channel{' '}
          <strong>#{channelName || 'new-channel-name'}</strong>. The original message in{' '}
          <strong>#{sourceChannelName}</strong> will be replaced with a link to the new channel. This action cannot be undone.
        </div>

        {error && (
          <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded px-4 py-2 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !channelName.trim()}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Promoting…' : 'Promote to channel'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
