import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const DISMISSED_KEY = 'sidebar_install_dismissed'

vi.mock('@/lib/pwa', () => ({
  isInstalled: vi.fn(() => false),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))

import { isInstalled } from '@/lib/pwa'
import InstallBanner from '@/components/ui/InstallBanner'

describe('InstallBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(isInstalled).mockReturnValue(false)
  })

  it('shows the banner when not installed and not dismissed', () => {
    render(<InstallBanner />)
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('hides the banner when already installed', () => {
    vi.mocked(isInstalled).mockReturnValue(true)
    render(<InstallBanner />)
    expect(screen.queryByTestId('install-banner')).toBeNull()
  })

  it('hides the banner when previously dismissed', () => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    render(<InstallBanner />)
    expect(screen.queryByTestId('install-banner')).toBeNull()
  })

  it('shows the banner on the very first visit (no prior state)', () => {
    render(<InstallBanner />)
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('hides banner and sets localStorage when dismiss button clicked', () => {
    render(<InstallBanner />)
    fireEvent.click(screen.getByTestId('install-banner-dismiss'))
    expect(screen.queryByTestId('install-banner')).toBeNull()
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('true')
  })

  it('never shows banner again after dismiss (simulated remount)', () => {
    const { unmount } = render(<InstallBanner />)
    fireEvent.click(screen.getByTestId('install-banner-dismiss'))
    unmount()
    render(<InstallBanner />)
    expect(screen.queryByTestId('install-banner')).toBeNull()
  })

  it('contains a link to /install', () => {
    render(<InstallBanner />)
    const link = screen.getByRole('link', { name: /install/i })
    expect(link).toHaveAttribute('href', '/install')
  })

  it('dismiss button has accessible label', () => {
    render(<InstallBanner />)
    expect(screen.getByLabelText('Dismiss install banner')).toBeInTheDocument()
  })
})
