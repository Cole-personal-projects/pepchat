'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFeatureHintContext } from '@/lib/context/FeatureHintContext'

type Placement = 'top' | 'bottom' | 'left' | 'right'

interface FeatureHintProps {
  /** Stable id; persistence and one-at-a-time ordering key off it. */
  id: string
  title: string
  body: string
  /** Lower shows first when several are eligible at once. Default 100. */
  priority?: number
  /** Gate a hint (e.g. admin-only). Disabled hints never register or show. */
  enabled?: boolean
  placement?: Placement
  children: React.ReactNode
}

const POPOVER_WIDTH = 260
const GAP = 10

/**
 * Contextual coachmark: the first time a user encounters the wrapped element,
 * a small dismissible popover points at it. Only one hint shows app-wide at a
 * time (coordinated by FeatureHintContext), and each is shown once ever until
 * "Replay tips" resets them.
 */
export default function FeatureHint({
  id,
  title,
  body,
  priority = 100,
  enabled = true,
  placement = 'bottom',
  children,
}: FeatureHintProps) {
  const { ready, isSeen, register, unregister, activeId, dismiss } = useFeatureHintContext()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const shouldRegister = enabled && ready && !isSeen(id)

  useEffect(() => {
    if (!shouldRegister) return
    register(id, priority)
    return () => unregister(id)
  }, [shouldRegister, id, priority, register, unregister])

  const isActive = mounted && shouldRegister && activeId === id

  // Track the anchor position while active (covers scroll/resize/layout shifts).
  // The wrapper uses display:contents (no box of its own), so measure the
  // first real child element instead.
  useLayoutEffect(() => {
    if (!isActive) return
    const update = () => {
      const el = anchorRef.current?.firstElementChild as HTMLElement | null | undefined
      if (el) setRect(el.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const interval = window.setInterval(update, 400)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.clearInterval(interval)
    }
  }, [isActive])

  function popoverPosition(): { top: number; left: number } {
    if (!rect) return { top: 0, left: 0 }
    const vw = window.innerWidth
    let top = rect.bottom + GAP
    let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2

    if (placement === 'top') top = rect.top - GAP - 0
    if (placement === 'left') {
      top = rect.top + rect.height / 2
      left = rect.left - POPOVER_WIDTH - GAP
    }
    if (placement === 'right') {
      top = rect.top + rect.height / 2
      left = rect.right + GAP
    }
    // Clamp horizontally into the viewport.
    left = Math.max(8, Math.min(left, vw - POPOVER_WIDTH - 8))
    return { top, left }
  }

  // Don't point at an anchor that's scrolled/translated off-screen (e.g. the
  // closed mobile drawer). The hint stays active and renders once visible.
  const anchorVisible = Boolean(
    rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    typeof window !== 'undefined' &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth,
  )

  return (
    <span ref={anchorRef} style={{ display: 'contents' }}>
      {children}
      {isActive && rect && anchorVisible && mounted && createPortal(
        <div
          data-testid={`feature-hint-${id}`}
          role="dialog"
          aria-label={title}
          className="fixed z-[60] rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-3 shadow-2xl"
          style={{
            width: POPOVER_WIDTH,
            ...popoverPosition(),
            ...(placement === 'top' ? { transform: 'translateY(-100%)' } : {}),
            ...(placement === 'left' || placement === 'right' ? { transform: 'translateY(-50%)' } : {}),
            animation: 'fade-in 180ms ease-out',
          }}
        >
          <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{body}</p>
          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              data-testid={`feature-hint-dismiss-${id}`}
              onClick={() => dismiss(id)}
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Got it
            </button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
