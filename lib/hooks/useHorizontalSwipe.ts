'use client'

import { useCallback, useEffect, useRef } from 'react'

interface UseHorizontalSwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Minimum horizontal travel in px before the gesture fires. */
  threshold?: number
  enabled?: boolean
}

/** Horizontal travel must beat vertical by this factor, otherwise the
    gesture is treated as a scroll and ignored. */
const DOMINANCE = 1.5

/** Travel before the gesture commits to an axis. */
const LOCK_DISTANCE = 12

/** Swipes slower than this are drags (text selection, hesitation), not
    navigation intents. */
const MAX_DURATION_MS = 600

/**
 * A swipe that starts inside horizontally scrollable content (code blocks,
 * admin tables, media strips) is scrolling that content, not navigating.
 *
 * Vertical scrollers are exempt: when only overflow-y is authored, CSS
 * computes overflow-x to `auto` as well, so a chat scroller with one
 * pixel of stray horizontal overflow would otherwise swallow every swipe.
 */
function startsInHorizontalScroller(start: EventTarget | null, boundary: HTMLElement): boolean {
  let el = start instanceof Element ? start : null
  while (el && el !== boundary) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX, overflowY } = getComputedStyle(el)
      const scrollsX = overflowX === 'auto' || overflowX === 'scroll'
      const isVerticalScroller =
        el.scrollHeight > el.clientHeight + 1 && (overflowY === 'auto' || overflowY === 'scroll')
      if (scrollsX && !isVerticalScroller) return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Discord-style swipe navigation primitive: detects a quick, decisively
 * horizontal touch swipe and fires the matching callback on release.
 *
 * Returns a callback ref to put on the swipe surface. Listeners are
 * attached natively (not through React) because the touchmove handler
 * must be non-passive: once a gesture locks horizontal we preventDefault
 * so the browser's own horizontal gestures — most importantly Chrome's
 * swipe-back history navigation — can't hijack the swipe. React installs
 * its touch listeners as passive, which makes that impossible via props.
 *
 * Vertical scrolling is untouched (vertical-locked gestures are never
 * canceled) and swipes starting inside horizontally scrollable content
 * are ignored entirely so code blocks and tables keep panning.
 */
export function useHorizontalSwipe(options: UseHorizontalSwipeOptions) {
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options })

  // Detach/attach is driven entirely by the callback ref: React invokes it
  // with null on unmount. No unmount effect — under StrictMode an effect
  // cleanup would detach the listeners during the simulated remount while
  // the ref (which StrictMode does not re-invoke) never re-attaches them.
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((el: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!el) return

    let start: { x: number; y: number; t: number; skip: boolean } | null = null
    let axis: 'h' | 'v' | null = null

    const onTouchStart = (e: TouchEvent) => {
      axis = null
      if (!(optionsRef.current.enabled ?? true) || e.touches.length !== 1) {
        start = null
        return
      }
      const touch = e.touches[0]
      start = {
        x: touch.clientX,
        y: touch.clientY,
        t: Date.now(),
        skip: startsInHorizontalScroller(e.target, el),
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!start || start.skip || !(optionsRef.current.enabled ?? true)) return
      const touch = e.touches[0]
      if (!touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (!axis && (Math.abs(dx) > LOCK_DISTANCE || Math.abs(dy) > LOCK_DISTANCE)) {
        axis = Math.abs(dx) > Math.abs(dy) * DOMINANCE ? 'h' : 'v'
      }
      if (axis === 'h' && e.cancelable) e.preventDefault()
    }

    const onTouchEnd = (e: TouchEvent) => {
      const gesture = start
      const gestureAxis = axis
      start = null
      axis = null
      if (!gesture || gesture.skip || !(optionsRef.current.enabled ?? true)) return
      if (gestureAxis === 'v') return
      const touch = e.changedTouches[0]
      if (!touch) return
      if (Date.now() - gesture.t > MAX_DURATION_MS) return

      const dx = touch.clientX - gesture.x
      const dy = touch.clientY - gesture.y
      const threshold = optionsRef.current.threshold ?? 60
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return

      if (dx > 0) optionsRef.current.onSwipeRight?.()
      else optionsRef.current.onSwipeLeft?.()
    }

    const onTouchCancel = () => {
      start = null
      axis = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })
    cleanupRef.current = () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [])
}
