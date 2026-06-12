'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { updatePassword } from '../actions'

export default function ResetPasswordPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updatePassword(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-2">Choose a new password</h1>
      <p className="text-[var(--text-muted)] text-center text-sm mb-8">
        You&apos;re signed in via your reset link — set a new password to finish.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="At least 8 characters"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="confirm"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Confirm new password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Repeat the new password"
          />
        </div>

        {error && (
          <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          data-testid="set-password-btn"
          disabled={isPending}
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded py-2.5 text-sm transition-colors"
        >
          {isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-muted)] mt-6">
        Link expired?{' '}
        <Link href="/forgot-password" className="text-[var(--accent)] hover:underline">
          Request a new one
        </Link>
      </p>
    </div>
  )
}
