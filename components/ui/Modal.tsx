'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedPresence } from '@/lib/hooks/useAnimatedPresence'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

/**
 * Accessible modal dialog with backdrop click + Escape to close.
 *
 * Portaled to document.body: callers can live inside transformed containers
 * (like the mobile drawer, whose transform would otherwise become the
 * containing block for position:fixed and drag the modal offscreen with it).
 */
export default function Modal({ open, onClose, title, children }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const { mounted, exiting } = useAnimatedPresence(open)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={backdropRef}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 ${exiting ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        className={`w-full max-w-md rounded-lg shadow-xl ${exiting ? 'modal-panel-exit' : 'modal-panel-enter'}`}
        style={{ background: 'var(--bg-secondary)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded hover:bg-white/10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
