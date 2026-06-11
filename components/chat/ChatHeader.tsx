'use client'

import { useMobileSidebar } from '@/lib/context/MobileSidebarContext'

interface ChatHeaderProps {
  channelName: string
  channelTopic?: string | null
  pinnedCount?: number
  pinnedPanelOpen?: boolean
  onTogglePinnedPanel?: () => void
}

export default function ChatHeader({ channelName, channelTopic, pinnedCount = 0, pinnedPanelOpen = false, onTogglePinnedPanel }: ChatHeaderProps) {
  const { open, openMembers } = useMobileSidebar()
  const pinnedLabel = pinnedPanelOpen
    ? `Close pinned messages (${pinnedCount})`
    : `Open pinned messages (${pinnedCount})`

  return (
    <div
      data-testid="chat-header"
      style={{
        height: 56,
        flexShrink: 0,
        padding: '0 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid var(--border-soft)',
        background: 'var(--bg-chat-header)',
      }}
    >
      <button
        data-testid="mobile-menu-btn"
        onClick={open}
        className="icon-btn md:hidden"
        aria-label="Open channel navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ opacity: 0.5, fontSize: 20, fontWeight: 600, flexShrink: 0 }}>#</span>
        <span
          data-testid="chat-header-name"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
        >
          {channelName}
        </span>
        {channelTopic && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border-soft)', flexShrink: 0 }} />
            <span
              data-testid="chat-header-topic"
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {channelTopic}
            </span>
          </>
        )}
      </div>

      {/* Right actions */}
      {onTogglePinnedPanel && (
        <button
          data-testid="pin-header-btn"
          onClick={onTogglePinnedPanel}
          className="icon-btn relative"
          aria-label={pinnedLabel}
          aria-pressed={pinnedPanelOpen}
          title="Pinned messages"
          style={{ color: pinnedCount > 0 ? 'var(--accent)' : 'var(--text-muted)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
          {pinnedCount > 0 && (
            <span
              data-testid="pin-header-badge"
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {pinnedCount}
            </span>
          )}
        </button>
      )}

      {/* Members sheet toggle — mobile only; desktop keeps the sidebar panel */}
      <button
        data-testid="members-header-btn"
        onClick={openMembers}
        className="icon-btn md:hidden"
        aria-label="Open member list"
        title="Members"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </button>
    </div>
  )
}
