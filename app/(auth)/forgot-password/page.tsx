'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from '../actions'

export default function ForgotPasswordPage() {
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await requestPasswordReset(formData)
      if ('error' in result) setError(result.error)
      else setSent(true)
    })
  }

  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-2">Reset your password</h1>
      <p className="text-[var(--text-muted)] text-center text-sm mb-8">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {sent ? (
        <div data-testid="reset-email-sent" className="text-center">
          <p className="text-sm text-[var(--text-primary)]">
            📬 If an account exists for that email, a reset link is on its way.
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Check your spam folder if it doesn&apos;t arrive within a couple of minutes.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="request-reset-btn"
            disabled={isPending}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded py-2.5 text-sm transition-colors"
          >
            {isPending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-[var(--text-muted)] mt-6">
        Remembered it?{' '}
        <Link href="/login" className="text-[var(--accent)] hover:underline">
          Back to login
        </Link>
      </p>
    </div>
  )
}
