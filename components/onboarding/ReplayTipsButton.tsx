'use client'

import { useState } from 'react'
import { useFeatureHintContext } from '@/lib/context/FeatureHintContext'

/** Settings control to re-show the contextual feature hints. */
export default function ReplayTipsButton() {
  const { replayAll } = useFeatureHintContext()
  const [done, setDone] = useState(false)

  return (
    <section
      aria-labelledby="tips-heading"
      className="rounded-xl border border-white/10 p-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      <h2 id="tips-heading" className="text-sm font-semibold text-[var(--text-primary)]">
        Tips &amp; help
      </h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Replay the little in-app tips that point out features the first time you use them.
      </p>
      <button
        type="button"
        data-testid="replay-tips-btn"
        onClick={() => {
          replayAll()
          setDone(true)
          window.setTimeout(() => setDone(false), 3000)
        }}
        className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-[var(--text-primary)] hover:bg-white/5 transition-colors"
      >
        {done ? "Tips reset — they'll reappear as you explore" : 'Replay tips'}
      </button>
    </section>
  )
}
