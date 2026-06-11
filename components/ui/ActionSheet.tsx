'use client'

import { createPortal } from 'react-dom'
import { useAnimatedPresence } from '@/lib/hooks/useAnimatedPresence'

interface ActionSheetProps {
  open: boolean
  onClose: () => void
  /** Short context line shown above the actions (e.g. "#general"). */
  title?: string
  children: React.ReactNode
}

/**
 * Discord-style mobile bottom sheet for contextual actions: backdrop,
 * drag handle, and a stack of ActionSheetRow buttons. The mobile sibling
 * of desktop hover toolbars and context menus.
 */
export default function ActionSheet({ open, onClose, title, children }: ActionSheetProps) {
  const { mounted, exiting } = useAnimatedPresence(open)
  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-testid="action-sheet-backdrop"
      className={exiting ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        data-testid="action-sheet"
        className={exiting ? 'sheet-panel-exit' : 'modal-panel-enter'}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg-secondary)',
          borderRadius: '16px 16px 0 0',
          padding: '12px 0 calc(20px + env(safe-area-inset-bottom, 0px))',
          border: '1px solid var(--border-soft)',
          borderBottom: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 10 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>

        {title && (
          <p
            data-testid="action-sheet-title"
            style={{
              margin: '0 20px 8px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function ActionSheetRow({
  testId,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  testId?: string
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      data-testid={testId}
      className="sheet-action-row"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 20px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border-soft)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        fontSize: 15,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        textAlign: 'left',
        width: '100%',
      }}
    >
      {label}
    </button>
  )
}
