import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHorizontalSwipe } from '@/lib/hooks/useHorizontalSwipe'

type Point = { clientX: number; clientY: number }

function fireTouch(el: HTMLElement, type: string, points: Point[]): boolean {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, {
    touches: type === 'touchend' ? [] : points,
    changedTouches: points,
  })
  return el.dispatchEvent(e)
}

function attach(options: Parameters<typeof useHorizontalSwipe>[0]) {
  const { result, unmount } = renderHook(() => useHorizontalSwipe(options))
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => { result.current(el) })
  return { el, unmount }
}

function swipe(el: HTMLElement, from: [number, number], to: [number, number]) {
  fireTouch(el, 'touchstart', [{ clientX: from[0], clientY: from[1] }])
  const midX = (from[0] + to[0]) / 2
  const midY = (from[1] + to[1]) / 2
  fireTouch(el, 'touchmove', [{ clientX: midX, clientY: midY }])
  fireTouch(el, 'touchmove', [{ clientX: to[0], clientY: to[1] }])
  fireTouch(el, 'touchend', [{ clientX: to[0], clientY: to[1] }])
}

describe('useHorizontalSwipe', () => {
  it('fires onSwipeRight for a fast rightward swipe', () => {
    const onSwipeRight = vi.fn()
    const onSwipeLeft = vi.fn()
    const { el } = attach({ onSwipeRight, onSwipeLeft })

    swipe(el, [20, 300], [140, 310])
    expect(onSwipeRight).toHaveBeenCalledOnce()
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('fires onSwipeLeft for a fast leftward swipe', () => {
    const onSwipeLeft = vi.fn()
    const { el } = attach({ onSwipeLeft })

    swipe(el, [300, 200], [180, 195])
    expect(onSwipeLeft).toHaveBeenCalledOnce()
  })

  it('ignores swipes below the horizontal threshold', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    swipe(el, [20, 300], [70, 300]) // 50px < default 60px
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('ignores vertically dominated gestures (scrolling)', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    swipe(el, [20, 100], [100, 250]) // dx=80, dy=150: a scroll
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('cancels touchmove once the gesture locks horizontal (blocks browser swipe-back)', () => {
    const { el } = attach({ onSwipeRight: vi.fn() })

    fireTouch(el, 'touchstart', [{ clientX: 20, clientY: 300 }])
    // Past the 12px lock distance and decisively horizontal.
    const notCanceled = fireTouch(el, 'touchmove', [{ clientX: 60, clientY: 302 }])
    expect(notCanceled).toBe(false) // dispatchEvent returns false when preventDefault was called
  })

  it('does not cancel touchmove for vertical gestures (scrolling stays native)', () => {
    const { el } = attach({ onSwipeRight: vi.fn() })

    fireTouch(el, 'touchstart', [{ clientX: 20, clientY: 300 }])
    const notCanceled = fireTouch(el, 'touchmove', [{ clientX: 22, clientY: 360 }])
    expect(notCanceled).toBe(true)
  })

  it('ignores slow drags', () => {
    vi.useFakeTimers()
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    fireTouch(el, 'touchstart', [{ clientX: 20, clientY: 300 }])
    vi.advanceTimersByTime(800)
    fireTouch(el, 'touchend', [{ clientX: 140, clientY: 300 }])
    expect(onSwipeRight).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does nothing when disabled', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight, enabled: false })

    swipe(el, [20, 300], [200, 300])
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('ignores swipes starting inside horizontally scrollable content', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    const scroller = document.createElement('pre')
    scroller.style.overflowX = 'auto'
    Object.defineProperty(scroller, 'scrollWidth', { value: 500 })
    Object.defineProperty(scroller, 'clientWidth', { value: 200 })
    const inner = document.createElement('code')
    scroller.appendChild(inner)
    el.appendChild(scroller)

    // Start the touch on the inner element so the scroller is an ancestor.
    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.assign(start, { touches: [{ clientX: 20, clientY: 300 }], changedTouches: [{ clientX: 20, clientY: 300 }] })
    inner.dispatchEvent(start)
    fireTouch(el, 'touchend', [{ clientX: 200, clientY: 300 }])
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('respects a custom threshold', () => {
    const onSwipeLeft = vi.fn()
    const { el } = attach({ onSwipeLeft, threshold: 100 })

    swipe(el, [300, 200], [220, 200]) // 80px < 100px
    expect(onSwipeLeft).not.toHaveBeenCalled()

    swipe(el, [300, 200], [190, 200]) // 110px > 100px
    expect(onSwipeLeft).toHaveBeenCalledOnce()
  })

  it('ignores multi-touch gestures', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.assign(start, {
      touches: [{ clientX: 20, clientY: 300 }, { clientX: 60, clientY: 320 }],
      changedTouches: [{ clientX: 20, clientY: 300 }],
    })
    el.dispatchEvent(start)
    fireTouch(el, 'touchend', [{ clientX: 200, clientY: 300 }])
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('resets on touchcancel', () => {
    const onSwipeRight = vi.fn()
    const { el } = attach({ onSwipeRight })

    fireTouch(el, 'touchstart', [{ clientX: 20, clientY: 300 }])
    fireTouch(el, 'touchcancel', [])
    fireTouch(el, 'touchend', [{ clientX: 200, clientY: 300 }])
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('detaches listeners when the ref is nulled (unmount)', () => {
    const onSwipeRight = vi.fn()
    const { result } = renderHook(() => useHorizontalSwipe({ onSwipeRight }))
    const el = document.createElement('div')
    act(() => { result.current(el) })
    act(() => { result.current(null) }) // React calls the callback ref with null on unmount

    swipe(el, [20, 300], [200, 300])
    expect(onSwipeRight).not.toHaveBeenCalled()
  })
})
