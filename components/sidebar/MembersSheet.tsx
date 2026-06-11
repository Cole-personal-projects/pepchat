'use client'

import MembersPanel from '@/components/sidebar/MembersPanel'
import type { Role } from '@/lib/permissions'

interface MembersSheetProps {
  open: boolean
  onClose: () => void
  groupId: string
  groupName: string
  currentUserId: string
  currentUserRole: Role
}

/**
 * Discord-style member list: a sheet that slides in from the right on
 * mobile. Desktop keeps the members panel in the channels sidebar; this
 * sheet is the phone-sized home for it (md:hidden).
 */
export default function MembersSheet({
  open,
  onClose,
  groupId,
  groupName,
  currentUserId,
  currentUserRole,
}: MembersSheetProps) {
  return (
    <>
      {open && (
        <div
          data-testid="members-sheet-backdrop"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden modal-backdrop-enter"
          onClick={onClose}
        />
      )}

      <div
        data-testid="members-sheet"
        aria-hidden={!open}
        className={`
          app-sidebar fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-[320px] flex-col
          border-l border-[var(--border-soft)] bg-[var(--bg-secondary)] shadow-2xl
          transform transition-transform ease-[var(--ease-pep-spring)] duration-[var(--motion-panel)]
          ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
          md:hidden
        `}
      >
        {/* Header */}
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--text-primary)]">Members</p>
            <p className="truncate text-[11px] text-[var(--text-faint)]">{groupName}</p>
          </div>
          <button
            type="button"
            data-testid="members-sheet-close"
            onClick={onClose}
            aria-label="Close members"
            className="icon-btn"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Member list */}
        <div className="sidebar-scroll flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
          {open && (
            <MembersPanel
              groupId={groupId}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              variant="sheet"
            />
          )}
        </div>
      </div>
    </>
  )
}
