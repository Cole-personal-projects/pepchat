'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isInstalled, isIOS, isAndroid } from '@/lib/pwa'

type Tab = 'ios' | 'android'

const STEP_NUM_STYLE: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={STEP_NUM_STYLE}>{n}</div>
      <div style={{ paddingTop: 4 }}>
        <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>{title}</p>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }}>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

function IOSSteps() {
  return (
    <div data-testid="steps-ios" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Step n={1} title="Open in Safari">
        Navigate to <strong>pepchat.cc</strong> in Safari. Chrome and Firefox on iOS cannot install PWAs — Safari only.
      </Step>
      <Step n={2} title="Tap the Share button">
        Tap the Share icon <ShareIcon /> at the bottom of Safari (square with arrow pointing up).
      </Step>
      <Step n={3} title='Tap "Add to Home Screen"'>
        Scroll down in the share sheet and tap <strong>Add to Home Screen</strong>.
      </Step>
      <Step n={4} title='Tap "Add" to confirm'>
        You'll see a preview with the name SideBar. Tap <strong>Add</strong> in the top-right corner.
      </Step>
      <Step n={5} title="Launch from your home screen">
        The SideBar icon will appear on your home screen. Tap it to open the app fullscreen.
      </Step>
      <div style={{
        marginTop: 4,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 12,
        color: 'var(--text-faint)',
        lineHeight: 1.5,
      }}>
        Push notifications require iOS 16.4+ and the app must be installed to your home screen first.
      </div>
    </div>
  )
}

function AndroidSteps({ onInstall, canInstall }: { onInstall: () => void; canInstall: boolean }) {
  return (
    <div data-testid="steps-android" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {canInstall && (
        <div style={{
          padding: '16px',
          borderRadius: 10,
          background: 'rgba(230, 84, 58, 0.08)',
          border: '1px solid rgba(230, 84, 58, 0.2)',
          marginBottom: 4,
        }}>
          <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
            Install SideBar
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Add to your home screen instantly
          </p>
          <button
            data-testid="android-install-btn"
            onClick={onInstall}
            style={{
              padding: '10px 20px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Install Now
          </button>
        </div>
      )}
      <Step n={1} title="Open in Chrome">
        Navigate to <strong>pepchat.cc</strong> in Chrome, Edge, or Samsung Internet.
      </Step>
      <Step n={2} title="Look for the install banner">
        Chrome may show an "Add to Home Screen" banner automatically. Tap it to install.
      </Step>
      <Step n={3} title="Or install from the menu">
        Tap the <strong>⋮</strong> menu (top right) and select <strong>Add to Home screen</strong> or <strong>Install app</strong>.
      </Step>
      <Step n={4} title="Tap Install">
        Confirm in the dialog that appears.
      </Step>
      <Step n={5} title="Launch from your home screen">
        Find SideBar in your app drawer or home screen. It opens fullscreen like a native app.
      </Step>
      <div style={{
        marginTop: 4,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 12,
        color: 'var(--text-faint)',
        lineHeight: 1.5,
      }}>
        Android has full PWA support — push notifications, background sync, and offline mode all work as expected.
      </div>
    </div>
  )
}

export default function InstallPage() {
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<Tab>('ios')
  const [installed, setInstalled] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    setMounted(true)
    setInstalled(isInstalled())
    if (isAndroid()) setTab('android')

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setDeferredPrompt(null)
    setCanInstall(false)
  }

  if (!mounted) return null

  if (installed) {
    return (
      <div style={{
        height: '100dvh',
        overflowY: 'auto',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}>
        <div data-testid="install-success" style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
            SideBar is installed!
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 28 }}>
            You're already running SideBar as an app.
          </p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
            }}
          >
            Open SideBar →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      height: '100dvh',
      overflowY: 'auto',
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Logo */}
        <div data-testid="install-logo" style={{ textAlign: 'center', marginBottom: 32 }}>
          <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px' }}>
            <span style={{ color: 'var(--accent)' }}>Side</span>
            <span style={{ color: 'var(--text-primary)' }}>Bar</span>
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 4 }}>
            your crew, your channels
          </p>
        </div>

        <div data-testid="install-guide">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Install SideBar
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
            Add SideBar to your home screen for the best experience.
          </p>

          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-soft)',
            marginBottom: 28,
            gap: 4,
          }}>
            {(['ios', 'android'] as Tab[]).map(t => (
              <button
                key={t}
                data-testid={`tab-${t}`}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                style={{
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                  textTransform: 'capitalize',
                }}
              >
                {t === 'ios' ? 'iPhone / iPad' : 'Android'}
              </button>
            ))}
          </div>

          {tab === 'ios' && <IOSSteps />}
          {tab === 'android' && <AndroidSteps onInstall={handleInstall} canInstall={canInstall} />}
        </div>
      </div>
    </div>
  )
}
