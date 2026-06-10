'use client'

import { useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { createChannel } from '@/app/(app)/channels/actions'

interface CreateChannelModalProps {
  open: boolean
  onClose: () => void
  groupId: string
  canCreatePersistentVoiceChannel?: boolean
}

/** Modal for creating a new text channel inside a group. */
export default function CreateChannelModal({
  open,
  onClose,
  groupId,
  canCreatePersistentVoiceChannel = false,
}: CreateChannelModalProps) {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('group_id', groupId)
    startTransition(async () => {
      const result = await createChannel(formData)
      if (result?.error) setError(result.error)
    })
  }

  function handleClose() {
    if (isPending) return
    setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create Channel">
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Channel names are lowercase with no spaces. Add a topic when the channel has a clear purpose.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {canCreatePersistentVoiceChannel && (
          <fieldset className="flex flex-col gap-2 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-1">
              Channel Type
            </legend>
            <label className="flex items-start gap-3">
              <input
                type="radio"
                name="kind"
                value="text"
                defaultChecked
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-semibold">Text</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  A persistent chat channel for messages.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="radio"
                name="kind"
                value="voice"
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-semibold">Persistent voice</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  An admin-created voice channel that stays available when empty.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="ch-name"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Channel Name
          </label>
          <div className="flex items-center bg-[var(--bg-primary)] border border-black/20 rounded focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <span className="pl-3 text-[var(--text-muted)] text-base select-none">#</span>
            <input
              id="ch-name"
              name="name"
              type="text"
              required
              maxLength={80}
              autoComplete="off"
              className="flex-1 bg-transparent px-2 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              placeholder="new-channel"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="ch-description"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Topic
          </label>
          <textarea
            id="ch-description"
            name="description"
            maxLength={180}
            rows={3}
            className="resize-none bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="What belongs in this channel?"
          />
        </div>

        <label className="flex items-start gap-3 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            name="noob_access"
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block font-semibold">Visible to new members</span>
            <span className="block text-xs text-[var(--text-muted)]">
              Noob members can open this channel before being promoted.
            </span>
          </span>
        </label>

        {error && (
          <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 mt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
