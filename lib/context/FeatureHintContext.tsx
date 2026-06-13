'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_PREFIX = 'pep:hint-seen:'

function storageKey(id: string) {
  return `${STORAGE_PREFIX}${id}`
}

function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const seen = new Set<string>()
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) seen.add(key.slice(STORAGE_PREFIX.length))
    }
  } catch {
    // localStorage unavailable — hints simply re-show next mount.
  }
  return seen
}

interface FeatureHintContextValue {
  /** True once the client has mounted (avoids SSR/hydration flashes). */
  ready: boolean
  isSeen: (id: string) => boolean
  register: (id: string, priority: number) => void
  unregister: (id: string) => void
  /** The single hint allowed to display right now (lowest priority unseen). */
  activeId: string | null
  dismiss: (id: string) => void
  /** Re-show every hint (and the welcome tour) — the "Replay tips" control. */
  replayAll: () => void
}

const FeatureHintContext = createContext<FeatureHintContextValue | null>(null)

export function FeatureHintProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => new Set())
  const [registered, setRegistered] = useState<Record<string, number>>({})

  useEffect(() => {
    setSeen(readSeen())
    setReady(true)
  }, [])

  const register = useCallback((id: string, priority: number) => {
    setRegistered(prev => (prev[id] === priority ? prev : { ...prev, [id]: priority }))
  }, [])

  const unregister = useCallback((id: string) => {
    setRegistered(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    try {
      window.localStorage.setItem(storageKey(id), '1')
    } catch {
      // Best-effort; the hint just reappears next session.
    }
    setSeen(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const replayAll = useCallback(() => {
    try {
      const keys: string[] = []
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (key?.startsWith(STORAGE_PREFIX) || key === 'welcome-tour-dismissed') keys.push(key)
      }
      keys.forEach(key => window.localStorage.removeItem(key))
    } catch {
      // ignore
    }
    setSeen(new Set())
  }, [])

  const isSeen = useCallback((id: string) => seen.has(id), [seen])

  // Active hint: the registered, unseen hint with the lowest priority number.
  const activeId = useMemo(() => {
    if (!ready) return null
    let best: string | null = null
    let bestPriority = Number.POSITIVE_INFINITY
    for (const [id, priority] of Object.entries(registered)) {
      if (seen.has(id)) continue
      if (priority < bestPriority) {
        best = id
        bestPriority = priority
      }
    }
    return best
  }, [ready, registered, seen])

  const value = useMemo<FeatureHintContextValue>(() => ({
    ready,
    isSeen,
    register,
    unregister,
    activeId,
    dismiss,
    replayAll,
  }), [ready, isSeen, register, unregister, activeId, dismiss, replayAll])

  return <FeatureHintContext.Provider value={value}>{children}</FeatureHintContext.Provider>
}

export function useFeatureHintContext(): FeatureHintContextValue {
  const ctx = useContext(FeatureHintContext)
  if (!ctx) {
    // Safe no-op default so components work outside the provider (e.g. tests).
    return {
      ready: false,
      isSeen: () => true,
      register: () => {},
      unregister: () => {},
      activeId: null,
      dismiss: () => {},
      replayAll: () => {},
    }
  }
  return ctx
}
