'use client'

import type { ReactNode } from 'react'

interface CategorySectionProps {
  categoryId: string
  name: string
  collapsed: boolean
  canManage: boolean
  isPending: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggle: (categoryId: string) => void
  onCreateChannel?: (categoryId: string) => void
  onRename?: (categoryId: string, currentName: string) => void
  onMove?: (categoryId: string, direction: 'up' | 'down') => void
  onDelete?: (categoryId: string) => void
  children: ReactNode
}

/**
 * Collapsible Discord-style category section. The header toggles collapse;
 * hover reveals management actions for channel managers.
 */
export default function CategorySection({
  categoryId,
  name,
  collapsed,
  canManage,
  isPending,
  canMoveUp,
  canMoveDown,
  onToggle,
  onCreateChannel,
  onRename,
  onMove,
  onDelete,
  children,
}: CategorySectionProps) {
  return (
    <div data-testid={`category-section-${categoryId}`} style={{ marginTop: 14 }}>
      <div
        className="group/cat"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 4px 2px 2px',
        }}
      >
        <button
          type="button"
          data-testid={`category-toggle-${categoryId}`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name} category`}
          onClick={() => onToggle(categoryId)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:text-[var(--text-primary)]"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontFamily: 'Inter, system-ui, sans-serif',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </button>

        {canManage && (
          <div className="hidden group-hover/cat:flex items-center gap-0.5 flex-shrink-0">
            {onCreateChannel && (
              <button
                type="button"
                data-testid={`category-create-channel-${categoryId}`}
                aria-label={`Create channel in ${name}`}
                onClick={() => onCreateChannel(categoryId)}
                disabled={isPending}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                title="Create channel in category"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            {onRename && (
              <button
                type="button"
                data-testid={`category-rename-${categoryId}`}
                aria-label={`Rename ${name} category`}
                onClick={() => onRename(categoryId, name)}
                disabled={isPending}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                title="Rename category"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {onMove && (
              <>
                <button
                  type="button"
                  data-testid={`category-move-up-${categoryId}`}
                  aria-label={`Move ${name} category up`}
                  onClick={() => onMove(categoryId, 'up')}
                  disabled={!canMoveUp || isPending}
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                  title="Move category up"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  data-testid={`category-move-down-${categoryId}`}
                  aria-label={`Move ${name} category down`}
                  onClick={() => onMove(categoryId, 'down')}
                  disabled={!canMoveDown || isPending}
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                  title="Move category down"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </>
            )}
            {onDelete && (
              <button
                type="button"
                data-testid={`category-delete-${categoryId}`}
                aria-label={`Delete ${name} category`}
                onClick={() => onDelete(categoryId)}
                disabled={isPending}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                title="Delete category"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Parent filters rows when collapsed (unread + active stay visible). */}
      {children}
    </div>
  )
}
