import { useEffect, useState } from 'react'

/**
 * Keeps a dismissable surface (modal, sheet) mounted briefly after `open`
 * flips false so its exit animation can play before unmount.
 *
 * Returns `mounted` (render gate) and `exiting` (apply exit classes).
 */
export function useAnimatedPresence(open: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])

  return { mounted, exiting: mounted && !open }
}
