'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isInstalled } from '@/lib/pwa'

const DISMISSED_KEY = 'pepchat_install_dismissed'

export default function InstallBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isInstalled()) return
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return
    setVisible(true)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      data-testid="install-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
        height: 44,
        flexShrink: 0,
        background: 'rgba(230, 84, 58, 0.1)',
        borderBottom: '1px solid rgba(230, 84, 58, 0.2)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
        📱 Install SideBar for a better experience
      </span>
      <Link
        href="/install"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--accent)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Install
      </Link>
      <button
        data-testid="install-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="icon-btn"
        style={{ flexShrink: 0, color: 'var(--text-muted)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
