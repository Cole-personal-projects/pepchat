'use client'

import { createPortal } from 'react-dom'

interface VoiceBarProps {
  channelName: string
  participantCount: number
  muted: boolean
  /** Local participant speaking — drives the avatar glow ring. */
  isSpeaking: boolean
  /** Remote speakers, for the "N talking" hint. */
  activeSpeakerCount: number
  busy: boolean
  onToggleMute: () => void
  onLeave: () => void
}

/**
 * Persistent voice status bar pinned to the bottom of the viewport while
 * connected, so voice stays in reach after navigating away from the sidebar.
 * Portaled to <body> above the mobile bottom-nav.
 */
export default function VoiceBar({
  channelName,
  participantCount,
  muted,
  isSpeaking,
  activeSpeakerCount,
  busy,
  onToggleMute,
  onLeave,
}: VoiceBarProps) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      data-testid="voice-bar"
      className="fixed inset-x-0 z-40 mx-auto flex max-w-2xl items-center gap-3 border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-3 py-2 shadow-2xl"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
        left: 8,
        right: 8,
        borderRadius: 14,
      }}
    >
      {/* Speaking indicator */}
      <span
        aria-hidden="true"
        data-testid="voice-bar-speaking"
        data-speaking={isSpeaking ? 'true' : 'false'}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: 'var(--bg-tertiary)',
          boxShadow: isSpeaking ? '0 0 0 2px var(--online)' : '0 0 0 1px var(--border-soft)',
          transition: 'box-shadow 120ms ease',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--online)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
          🔊 {channelName}
        </p>
        <p className="truncate text-[11px] text-[var(--text-muted)]">
          {participantCount} connected
          {activeSpeakerCount > 0 ? ` · ${activeSpeakerCount} talking` : ''}
        </p>
      </div>

      <button
        type="button"
        data-testid="voice-bar-mute"
        onClick={onToggleMute}
        disabled={busy}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] transition-colors disabled:opacity-50"
        style={{ background: muted ? 'var(--danger)' : 'var(--bg-tertiary)', color: muted ? '#fff' : 'var(--text-primary)' }}
      >
        {muted ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        )}
      </button>

      <button
        type="button"
        data-testid="voice-bar-leave"
        onClick={onLeave}
        disabled={busy}
        aria-label="Disconnect from voice"
        className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-[var(--danger)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--danger)]/85 disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
          <line x1="23" y1="1" x2="1" y2="23" />
        </svg>
        Leave
      </button>
    </div>,
    document.body,
  )
}
