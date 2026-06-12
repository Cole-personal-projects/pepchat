'use client'

import { useState } from 'react'
import type { Reaction } from '@/lib/types'

interface ReactionGroup {
  emoji: string
  count: number
  reacted: boolean
  usernames: string[]
}

interface ReactionPillsProps {
  reactions: Reaction[]
  currentUserId: string
  onToggle: (emoji: string) => void
}

function groupReactions(reactions: Reaction[], currentUserId: string): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>()
  for (const r of reactions) {
    const existing = map.get(r.emoji)
    const username = r.profiles?.username ?? 'Unknown'
    if (existing) {
      existing.count++
      existing.usernames.push(username)
      if (r.user_id === currentUserId) existing.reacted = true
    } else {
      map.set(r.emoji, {
        emoji: r.emoji,
        count: 1,
        reacted: r.user_id === currentUserId,
        usernames: [username],
      })
    }
  }
  return Array.from(map.values())
}

function tooltipText(usernames: string[]): string {
  if (usernames.length <= 5) return usernames.join(', ')
  return usernames.slice(0, 5).join(', ') + ` +${usernames.length - 5} more`
}

export default function ReactionPills({ reactions, currentUserId, onToggle }: ReactionPillsProps) {
  const [tooltip, setTooltip] = useState<string | null>(null)

  if (!reactions || reactions.length === 0) return null

  const groups = groupReactions(reactions, currentUserId)

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {groups.map((g) => (
        <div key={g.emoji} className="relative inline-block">
          <button
            onClick={() => onToggle(g.emoji)}
            // Hover-only tooltip: on touch the simulated mouseenter would
            // mutate the DOM and make Safari swallow the tap (iPad double-tap).
            onPointerEnter={(e) => { if (e.pointerType !== 'touch') setTooltip(g.emoji) }}
            onPointerLeave={() => setTooltip(null)}
            data-reacted={g.reacted ? 'true' : undefined}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[13px] transition-colors"
            style={g.reacted ? {
              background: 'rgba(230,84,58,0.18)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            } : {
              background: 'transparent',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-muted)',
            }}
          >
            <span>{g.emoji}</span>
            <span className="text-xs font-medium">{g.count}</span>
          </button>
          {tooltip === g.emoji && (
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-[var(--bg-primary)] border border-white/10 text-[var(--text-primary)] text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg pointer-events-none z-50">
              {tooltipText(g.usernames)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
