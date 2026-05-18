'use client'

import { useEffect, useTransition, useState } from 'react'
import { setupProfile } from '../actions'

export default function SetupProfilePage() {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [nextPath, setNextPath] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const value = new URLSearchParams(window.location.search).get('next')
    if (value?.startsWith('/') && !value.startsWith('//')) {
      setNextPath(value)
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await setupProfile(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-2">Choose a username</h1>
      <p className="text-[var(--text-muted)] text-center text-sm mb-8">
        This is how others will see you in SideBar
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {nextPath && <input type="hidden" name="next" value={nextPath} />}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="username"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            minLength={2}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="bg-[var(--bg-primary)] border border-black/20 rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="cooluser42"
          />
          <p className="text-xs text-[var(--text-muted)]">
            Letters, numbers, underscores, dots, and hyphens only.
          </p>
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
          {isPending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
