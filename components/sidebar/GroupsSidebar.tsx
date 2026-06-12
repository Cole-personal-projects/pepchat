'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import GroupIcon from '@/components/ui/GroupIcon'
import type { Group } from '@/lib/types'

interface GroupsSidebarProps {
  groups: Group[]
  currentUserId: string
  unreadGroupIds?: Set<string>
  isDMActive?: boolean
  onCreateGroup: () => void
  onJoinGroup: () => void
  onDMsHome?: () => void
}

export default function GroupsSidebar({
  groups,
  currentUserId: _currentUserId,
  unreadGroupIds = new Set(),
  isDMActive = false,
  onCreateGroup,
  onJoinGroup,
  onDMsHome,
}: GroupsSidebarProps) {
  const params = useParams()
  const activeGroupId = params?.groupId as string | undefined
  const [hovered, setHovered] = useState<string | null>(null)

  function handleKeyboardActivate(e: React.KeyboardEvent, action: () => void) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    action()
  }

  return (
    <nav
      data-testid="groups-sidebar"
      style={{
        width: 72,
        flexShrink: 0,
        background: 'var(--bg-rail)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0',
        gap: 4,
        borderRight: '1px solid var(--border-soft)',
        overflowY: 'auto',
      }}
    >
      {/* DMs home */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Direct Messages"
        onMouseEnter={() => setHovered('home')}
        onMouseLeave={() => setHovered(null)}
        onClick={onDMsHome}
        onKeyDown={(e) => handleKeyboardActivate(e, () => onDMsHome?.())}
        onPointerDown={(e) => { if (e.pointerType === 'touch') { e.preventDefault(); onDMsHome?.() } }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 0',
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <AccentBar active={isDMActive} hovered={hovered === 'home'} />
        <div
          data-testid="dms-home-button"
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: isDMActive
              ? 'linear-gradient(145deg, #e08452, #c94a2a)'
              : 'var(--bg-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isDMActive ? '#fbf6ee' : 'var(--text-muted)',
            transition: 'all 180ms ease',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        {hovered === 'home' && <Tooltip>Direct Messages</Tooltip>}
      </div>

      <Divider />

      {/* Group tiles */}
      {groups.map((group) => {
        const isActive = group.id === activeGroupId

        return (
          <div
            key={group.id}
            data-testid={`group-tile-${group.id}`}
            onMouseEnter={() => setHovered(group.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 0',
            }}
          >
            <AccentBar active={isActive} hovered={hovered === group.id} />
            <Link
              href={`/groups/${group.id}`}
              aria-label={group.name}
              style={{ display: 'flex', textDecoration: 'none', touchAction: 'manipulation' }}
            >
              <GroupIcon group={group} size={44} active={isActive} />
            </Link>
            {hovered === group.id && (
              <Tooltip data-testid={`tooltip-${group.id}`}>{group.name}</Tooltip>
            )}
            {unreadGroupIds.has(group.id) && (
              <span
                data-testid={`unread-badge-${group.id}`}
                style={{
                  position: 'absolute', bottom: 4, right: 6,
                  width: 12, height: 12,
                  borderRadius: '50%',
                  background: '#ef4444',
                  border: '2px solid var(--bg-deepest)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        )
      })}

      <Divider />

      {/* Create group */}
      <div
        data-testid="create-group-tile"
        role="button"
        tabIndex={0}
        aria-label="Create Group"
        onMouseEnter={() => setHovered('create')}
        onMouseLeave={() => setHovered(null)}
        onClick={onCreateGroup}
        onKeyDown={(e) => handleKeyboardActivate(e, onCreateGroup)}
        onPointerDown={(e) => { if (e.pointerType === 'touch') { e.preventDefault(); onCreateGroup() } }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 0',
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <AccentBar active={false} hovered={hovered === 'create'} />
        <div
          data-testid="create-group-button"
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: 'transparent',
            border: '1.5px dashed var(--border-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
            fontSize: 22, fontWeight: 300,
            transition: 'all 180ms ease',
          }}
        >+</div>
        {hovered === 'create' && <Tooltip>Create Group</Tooltip>}
      </div>

      {/* Join group */}
      <div
        data-testid="join-group-tile"
        role="button"
        tabIndex={0}
        aria-label="Join Group"
        onMouseEnter={() => setHovered('join')}
        onMouseLeave={() => setHovered(null)}
        onClick={onJoinGroup}
        onKeyDown={(e) => handleKeyboardActivate(e, onJoinGroup)}
        onPointerDown={(e) => { if (e.pointerType === 'touch') { e.preventDefault(); onJoinGroup() } }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 0',
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <AccentBar active={false} hovered={hovered === 'join'} />
        <div
          data-testid="join-group-button"
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: 'transparent',
            border: '1.5px solid var(--border-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
            transition: 'all 180ms ease',
          }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <path d="M10 17l5-5-5-5" />
            <path d="M15 12H3" />
          </svg>
        </div>
        {hovered === 'join' && <Tooltip>Join Group</Tooltip>}
      </div>
    </nav>
  )
}

function AccentBar({ active, hovered }: { active: boolean; hovered: boolean }) {
  return (
    <div
      style={{
        position: 'absolute', left: 0, top: '50%',
        transform: `translateY(-50%) scaleY(${active ? 1 : hovered ? 0.4 : 0})`,
        width: 4,
        height: active ? 28 : 12,
        background: 'var(--accent)',
        borderRadius: '0 3px 3px 0',
        transition: 'all 180ms ease',
        pointerEvents: 'none',
      }}
    />
  )
}

function Divider() {
  return (
    <div style={{
      height: 1,
      margin: '4px 14px',
      background: 'var(--border-soft)',
      flexShrink: 0,
    }} />
  )
}

function Tooltip({ children, ...props }: { children: React.ReactNode; 'data-testid'?: string }) {
  return (
    <div
      {...props}
      style={{
        position: 'absolute', left: '100%', marginLeft: 8,
        top: '50%', transform: 'translateY(-50%)',
        padding: '6px 10px',
        background: 'var(--bg-deepest)',
        border: '1px solid var(--border-soft)',
        borderRadius: 6,
        fontSize: 12, fontWeight: 500,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        zIndex: 100,
        pointerEvents: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {children}
    </div>
  )
}
