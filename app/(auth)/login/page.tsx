'use client'

import { useEffect, useTransition, useState } from 'react'
import Link from 'next/link'
import { login } from '../actions'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [nextPath, setNextPath] = useState('')
  const [invite, setInvite] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const value = params.get('next')
    if (value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
      setNextPath(value)
    }
    const inviteValue = params.get('invite')
    if (inviteValue) setInvite(inviteValue)
    if (params.get('invite_required') === '1') {
      setError('An invite is required to finish account setup.')
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await login(formData)
      if (result?.error) setError(result.error)
    })
  }

  const signupHref = `/signup${invite ? `?invite=${encodeURIComponent(invite)}${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ''}` : nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`

  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-2">Welcome back!</h1>
      <p className="text-[var(--text-muted)] text-center text-sm mb-8">
        Sign in to continue to SideBar
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
            autoComplete="current-password"
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
          {isPending ? 'Signing in…' : 'Log In'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-muted)] mt-6">
        Don&apos;t have an account?{' '}
        <Link href={signupHref} className="text-[var(--accent)] hover:underline">
          Sign up
        </Link>
      </p>

      <p className="text-center mt-4">
        <Link href="/install" className="text-xs hover:underline" style={{ color: 'var(--text-faint)' }}>
          Install as app
        </Link>
      </p>
    </div>
  )
}
