import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAnimatedPresence } from '@/lib/hooks/useAnimatedPresence'

describe('useAnimatedPresence', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts immediately when opened', () => {
    const { result } = renderHook(({ open }) => useAnimatedPresence(open), {
      initialProps: { open: true },
    })

    expect(result.current).toEqual({ mounted: true, exiting: false })
  })

  it('stays mounted in the exiting state, then unmounts after the exit window', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => useAnimatedPresence(open, 150), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    expect(result.current).toEqual({ mounted: true, exiting: true })

    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(result.current).toEqual({ mounted: false, exiting: false })
  })

  it('cancels a pending exit when reopened', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => useAnimatedPresence(open, 150), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    rerender({ open: true })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toEqual({ mounted: true, exiting: false })
  })
})
