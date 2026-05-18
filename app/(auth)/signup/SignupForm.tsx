'use client'

import { useEffect, useTransition, useState } from 'react'
import Link from 'next/link'
import { signup } from '../actions'
import { CheckEmailView } from '@/components/auth/CheckEmailView'

type SignupFormProps = {
  invite: string
  nextPath: string
}

export default function SignupForm({ invite, nextPath: initialNextPath }: SignupFormProps) {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null)
  const [nextPath, setNextPath] = useState(initialNextPath)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const value = new URLSearchParams(window.location.search).get('next')
    if (value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
      setNextPath(value)
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    const formData = new FormData(e.currentTarget)
    const password = formData.get('password') as string
    const confirm = formData.get('confirm') as string

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    startTransition(async () => {
      const result = await signup(formData)
      if ('error' in result) {
        setError(result.error)
      } else {
        setConfirmedEmail(result.email)
      }
    })
  }

  if (confirmedEmail) {
    return <CheckEmailView email={confirmedEmail} onBack={() => setConfirmedEmail(null)} />
  }

  const loginHref = `/login?invite=${encodeURIComponent(invite)}${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ''}`

  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-2">Create your account with this invite</h1>
      <p className="text-[var(--text-muted)] text-center text-sm mb-8">
        SideBar accounts require an invite from a group admin.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="invite" value={invite} />
        {nextPath && <input type="hidden" name="next" value={nextPath} />}
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

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Password
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
            Confirm Password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
            className="bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded py-2.5 text-sm transition-colors"
        >
          {isPending ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-muted)] mt-6">
        Already have an account?{' '}
        <Link href={loginHref} className="text-[var(--accent)] hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
