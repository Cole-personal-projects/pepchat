'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedPresence } from '@/lib/hooks/useAnimatedPresence'

interface ModalShellProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** Wider variant for two-column modals (default: md = 448px) */
  size?: 'md' | 'lg'
}

export default function ModalShell({ open, onClose, title, children, size = 'md' }: ModalShellProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const { mounted, exiting } = useAnimatedPresence(open)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || typeof document === 'undefined') return null

  const maxW = size === 'lg' ? 640 : 448

  return createPortal(
    <div
      ref={backdropRef}
      data-testid="modal-backdrop"
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 ${exiting ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className={`w-full rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col ${exiting ? 'modal-panel-exit' : 'modal-panel-enter'}`}
        style={{
          maxWidth: maxW,
          maxHeight: 'calc(100dvh - 48px)',
          background: 'var(--bg-secondary)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0 flex-shrink-0">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
          <button
            data-testid="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="px-6 pt-4 pb-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
