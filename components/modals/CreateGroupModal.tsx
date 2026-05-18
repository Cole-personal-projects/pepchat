'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import ModalShell from '@/components/ui/ModalShell'
import { createGroup, joinGroup } from '@/app/(app)/groups/actions'

type Tab = 'create' | 'join'

interface CreateGroupModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialTab?: Tab
}

export default function CreateGroupModal({ open, onClose, onSuccess, initialTab = 'create' }: CreateGroupModalProps) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleClose() {
    if (isPending) return
    setError('')
    onClose()
  }

  function handleTabChange(t: Tab) {
    setTab(t)
    setError('')
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = tab === 'create' ? await createGroup(formData) : await joinGroup(formData)
      if ('error' in result) {
        setError(result.error)
      } else {
        onClose()
        onSuccess?.()
        router.push(result.redirectTo)
      }
    })
  }

  return (
    <ModalShell open={open} onClose={handleClose} title={tab === 'create' ? 'Create a Group' : 'Join a Group'}>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 rounded-lg bg-black/20">
        <button
          data-testid="tab-create"
          type="button"
          onClick={() => handleTabChange('create')}
          className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
            tab === 'create'
              ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Create
        </button>
        <button
          data-testid="tab-join"
          type="button"
          onClick={() => handleTabChange('join')}
          className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
            tab === 'join'
              ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Join
        </button>
      </div>

      <p className="text-sm text-[var(--text-muted)] mb-4">
        {tab === 'create'
          ? 'Create your first shared space. SideBar will add a welcome channel for new members and a general channel for regular chat.'
          : 'Paste an invite code or invite link to join an existing group.'}
      </p>

      <form onSubmit={handleSubmit} aria-label="group form" className="flex flex-col gap-4">
        {tab === 'create' ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cg-name"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            >
              Group Name
            </label>
            <input
              id="cg-name"
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="off"
              className="bg-[var(--bg-primary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="My Awesome Group"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="jg-code"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            >
              Invite Code
            </label>
            <input
              id="jg-code"
              name="invite_code"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              className="bg-[var(--bg-primary)] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="abc12345 or /join/abc12345"
            />
          </div>
        )}

        {error && (
          <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 mt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending
              ? tab === 'create' ? 'Creating…' : 'Joining…'
              : tab === 'create' ? 'Create Group' : 'Join Group'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
