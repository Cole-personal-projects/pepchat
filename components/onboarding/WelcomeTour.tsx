'use client'

import { useState } from 'react'

const STORAGE_KEY = 'welcome-tour-dismissed'

const STEPS = [
  {
    title: 'Welcome to SideBar 🌶️',
    body: 'Servers are your communities. Each server has text channels, voice rooms, and forums organized into categories.',
  },
  {
    title: 'Talk your way',
    body: 'Jump into voice channels with one click, spin up temporary rooms that vanish when empty, or start titled forum discussions.',
  },
  {
    title: 'Make it yours',
    body: 'Add friends from any server, set a custom status, and pick up custom roles. Ready to dive in?',
  },
] as const

export function hasSeenWelcomeTour(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

interface WelcomeTourProps {
  open: boolean
  onFinish: () => void
}

/** App-level first-run tour, shown once before the create-your-first-server prompt. */
export default function WelcomeTour({ open, onFinish }: WelcomeTourProps) {
  const [step, setStep] = useState(0)

  if (!open) return null

  function finish() {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Best-effort persistence; the tour simply reappears next session.
    }
    onFinish()
  }

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div data-testid="welcome-tour" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[var(--bg-secondary)] p-6 text-center shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{current.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{current.body}</p>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          {STEPS.map((_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${index === step ? 'bg-[var(--accent)]' : 'bg-white/15'}`}
            />
          ))}
        </div>

        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            data-testid="welcome-tour-skip"
            onClick={finish}
            className="rounded px-4 py-2 text-sm font-semibold text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            Skip
          </button>
          <button
            type="button"
            data-testid="welcome-tour-next"
            onClick={() => (isLast ? finish() : setStep(step + 1))}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
