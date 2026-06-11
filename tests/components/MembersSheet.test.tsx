import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MembersSheet from '@/components/sidebar/MembersSheet'

vi.mock('@/components/sidebar/MembersPanel', () => ({
  default: ({ variant }: { variant?: string }) => (
    <div data-testid="members-panel-mock" data-variant={variant ?? 'sidebar'} />
  ),
}))

const BASE_PROPS = {
  groupId: 'grp-1',
  groupName: 'Design',
  currentUserId: 'u1',
  currentUserRole: 'user' as const,
}

describe('MembersSheet', () => {
  it('renders the member panel and group name when open', () => {
    render(<MembersSheet {...BASE_PROPS} open onClose={vi.fn()} />)

    expect(screen.getByTestId('members-sheet')).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByTestId('members-panel-mock')).toHaveAttribute('data-variant', 'sheet')
  })

  it('does not mount the member list while closed', () => {
    render(<MembersSheet {...BASE_PROPS} open={false} onClose={vi.fn()} />)

    expect(screen.getByTestId('members-sheet')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByTestId('members-panel-mock')).not.toBeInTheDocument()
    expect(screen.queryByTestId('members-sheet-backdrop')).not.toBeInTheDocument()
  })

  it('closes via the close button and the backdrop', () => {
    const onClose = vi.fn()
    render(<MembersSheet {...BASE_PROPS} open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('members-sheet-close'))
    fireEvent.click(screen.getByTestId('members-sheet-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
