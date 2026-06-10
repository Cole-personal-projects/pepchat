'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearCustomStatus, setCustomStatus, setPresenceMode } from '@/app/(app)/status/actions'
import type { PresenceMode, UserStatus } from '@/lib/types'

const PRESENCE_OPTIONS: Array<{ mode: PresenceMode; label: string; color: string }> = [
  { mode: 'online', label: 'Online', color: '#3ba55d' },
  { mode: 'idle', label: 'Idle', color: '#faa81a' },
  { mode: 'dnd', label: 'Do Not Disturb', color: '#ed4245' },
  { mode: 'invisible', label: 'Invisible', color: '#747f8d' },
]

interface UserStatusMenuProps {
  userId: string
}

/**
 * Footer status control: presence mode picker + custom status text.
 * Renders the current state as the trigger; menu opens upward.
 */
export default function UserStatusMenu({ userId }: UserStatusMenuProps) {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const [isPending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    createClient()
      .from('user_status')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setStatus(data as UserStatus)
          setCustomText((data as UserStatus).status_text ?? '')
        }
      })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const presence = status?.presence ?? 'online'
  const active = PRESENCE_OPTIONS.find(option => option.mode === presence) ?? PRESENCE_OPTIONS[0]
  const customExpired = status?.status_expires_at && new Date(status.status_expires_at).getTime() <= Date.now()
  const customLine = customExpired ? null : [status?.status_emoji, status?.status_text].filter(Boolean).join(' ') || null

  function handlePresence(mode: PresenceMode) {
    startTransition(async () => {
      const result = await setPresenceMode(mode)
      if (!('error' in result)) {
        setStatus(prev => prev
          ? { ...prev, presence: mode }
          : { user_id: userId, presence: mode, status_emoji: null, status_text: null, status_expires_at: null, updated_at: new Date().toISOString() })
      }
    })
  }

  function handleCustomSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = customText.trim()
    startTransition(async () => {
      const result = text
        ? await setCustomStatus({ text })
        : await clearCustomStatus()
      if (!('error' in result)) {
        setStatus(prev => prev
          ? { ...prev, status_text: text || null, status_emoji: null, status_expires_at: null }
          : { user_id: userId, presence: 'online', status_emoji: null, status_text: text || null, status_expires_at: null, updated_at: new Date().toISOString() })
        setOpen(false)
      }
    })
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        data-testid="user-status-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          maxWidth: '100%',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: active.color, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {customLine ?? active.label.toLowerCase()}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="user-status-menu"
          style={{
            position: 'absolute',
            bottom: 22,
            left: 0,
            zIndex: 40,
            width: 210,
            background: 'var(--bg-primary)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {PRESENCE_OPTIONS.map(option => (
            <button
              key={option.mode}
              type="button"
              role="menuitem"
              data-testid={`presence-${option.mode}`}
              disabled={isPending}
              onClick={() => handlePresence(option.mode)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-50"
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: option.color, flexShrink: 0 }} />
              <span className="flex-1">{option.label}</span>
              {presence === option.mode && <span aria-hidden="true">✓</span>}
            </button>
          ))}

          <form onSubmit={handleCustomSubmit} className="mt-1 border-t border-white/10 pt-2">
            <input
              data-testid="custom-status-input"
              type="text"
              maxLength={128}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Set a custom status"
              className="w-full rounded border border-black/20 bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              {customLine && (
                <button
                  type="button"
                  data-testid="clear-custom-status"
                  disabled={isPending}
                  onClick={() => {
                    setCustomText('')
                    startTransition(async () => {
                      const result = await clearCustomStatus()
                      if (!('error' in result)) {
                        setStatus(prev => prev ? { ...prev, status_text: null, status_emoji: null, status_expires_at: null } : prev)
                        setOpen(false)
                      }
                    })
                  }}
                  className="rounded px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:bg-white/10"
                >
                  Clear
                </button>
              )}
              <button
                type="submit"
                data-testid="save-custom-status"
                disabled={isPending}
                className="rounded bg-[var(--accent)] px-2 py-1 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
