import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminNav from '@/components/admin/AdminNav'

describe('AdminNav', () => {
  it('renders all five nav items', () => {
    render(<AdminNav activeTab="overview" />)
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('Users')).toBeTruthy()
    expect(screen.getByText('Groups')).toBeTruthy()
    expect(screen.getByText('Reports')).toBeTruthy()
    expect(screen.getByText('Audit Log')).toBeTruthy()
  })

  it('marks the active tab with data-active', () => {
    render(<AdminNav activeTab="users" />)
    const activeLink = document.querySelector('[data-active="true"]')
    expect(activeLink).toBeTruthy()
    expect(activeLink?.textContent).toContain('Users')
  })

  it('marks the active tab as the current page', () => {
    render(<AdminNav activeTab="reports" />)

    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current')
  })

  it('only one tab is active at a time', () => {
    render(<AdminNav activeTab="groups" />)
    const activeLinks = document.querySelectorAll('[data-active="true"]')
    expect(activeLinks).toHaveLength(1)
  })

  it('renders correct hrefs for nav items', () => {
    render(<AdminNav activeTab="overview" />)
    expect(document.querySelector('a[href="/admin/overview"]')).toBeTruthy()
    expect(document.querySelector('a[href="/admin/users"]')).toBeTruthy()
    expect(document.querySelector('a[href="/admin/groups"]')).toBeTruthy()
    expect(document.querySelector('a[href="/admin/reports"]')).toBeTruthy()
    expect(document.querySelector('a[href="/admin/audit"]')).toBeTruthy()
  })

  it('renders a labeled back control to the normal app', () => {
    render(<AdminNav activeTab="overview" />)

    const backLink = screen.getByRole('link', { name: 'Back to channels' })
    expect(backLink).toHaveAttribute('href', '/channels')
    expect(backLink).not.toHaveAttribute('aria-current')
  })
})
