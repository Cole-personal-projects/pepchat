import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HelpPage from '@/app/(app)/help/page'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

describe('HelpPage', () => {
  it('makes the help content area scrollable inside the app shell', () => {
    const { container } = render(<HelpPage />)

    const page = container.querySelector('main')
    expect(page).toHaveClass('h-full')
    expect(page).toHaveClass('overflow-y-auto')
  })

  it('provides a back control to return to channels', () => {
    render(<HelpPage />)

    const backLink = screen.getByRole('link', { name: 'Back to channels' })
    expect(backLink).toHaveAttribute('href', '/channels')
  })
})
