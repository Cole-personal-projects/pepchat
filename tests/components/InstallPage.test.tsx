import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/pwa', () => ({
  isInstalled: vi.fn(() => false),
  isIOS: vi.fn(() => false),
  isAndroid: vi.fn(() => false),
  isSafari: vi.fn(() => false),
  supportsInstallPrompt: vi.fn(() => false),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))

import { isInstalled, isIOS, isAndroid } from '@/lib/pwa'
import InstallPage from '@/app/install/page'

describe('InstallPage', () => {
  beforeEach(() => {
    vi.mocked(isInstalled).mockReturnValue(false)
    vi.mocked(isIOS).mockReturnValue(false)
    vi.mocked(isAndroid).mockReturnValue(false)
  })

  it('shows success state when app is already installed', () => {
    vi.mocked(isInstalled).mockReturnValue(true)
    render(<InstallPage />)
    expect(screen.getByTestId('install-success')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open sidebar/i })).toHaveAttribute('href', '/')
  })

  it('shows install guide when app is not installed', () => {
    render(<InstallPage />)
    expect(screen.queryByTestId('install-success')).toBeNull()
    expect(screen.getByTestId('install-guide')).toBeInTheDocument()
  })

  it('defaults to iOS tab on iOS', () => {
    vi.mocked(isIOS).mockReturnValue(true)
    render(<InstallPage />)
    expect(screen.getByTestId('tab-ios')).toHaveAttribute('aria-selected', 'true')
  })

  it('defaults to Android tab on Android', () => {
    vi.mocked(isAndroid).mockReturnValue(true)
    render(<InstallPage />)
    expect(screen.getByTestId('tab-android')).toHaveAttribute('aria-selected', 'true')
  })

  it('defaults to iOS tab on unknown/desktop platform', () => {
    render(<InstallPage />)
    expect(screen.getByTestId('tab-ios')).toHaveAttribute('aria-selected', 'true')
  })

  it('switching to Android tab shows Android steps', () => {
    render(<InstallPage />)
    fireEvent.click(screen.getByTestId('tab-android'))
    expect(screen.getByTestId('steps-android')).toBeInTheDocument()
    expect(screen.queryByTestId('steps-ios')).toBeNull()
  })

  it('switching to iOS tab shows iOS steps', () => {
    vi.mocked(isAndroid).mockReturnValue(true)
    render(<InstallPage />)
    fireEvent.click(screen.getByTestId('tab-ios'))
    expect(screen.getByTestId('steps-ios')).toBeInTheDocument()
    expect(screen.queryByTestId('steps-android')).toBeNull()
  })

  it('iOS steps mention Safari requirement', () => {
    render(<InstallPage />)
    expect(screen.getByTestId('steps-ios')).toHaveTextContent(/safari/i)
  })

  it('Android steps mention Chrome', () => {
    render(<InstallPage />)
    fireEvent.click(screen.getByTestId('tab-android'))
    expect(screen.getByTestId('steps-android')).toHaveTextContent(/chrome/i)
  })

  it('shows SideBar branding', () => {
    render(<InstallPage />)
    expect(screen.getByTestId('install-logo')).toBeInTheDocument()
  })
})
