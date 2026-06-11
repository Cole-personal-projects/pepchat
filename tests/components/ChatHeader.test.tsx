import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatHeader from '@/components/chat/ChatHeader'

const mockOpenMembers = vi.fn()

vi.mock('@/lib/context/MobileSidebarContext', () => ({
  useMobileSidebar: () => ({ open: vi.fn(), openMembers: mockOpenMembers }),
}))

describe('ChatHeader', () => {
  it('has 56px height', () => {
    const { container } = render(<ChatHeader channelName="general" />)
    const header = container.firstElementChild as HTMLElement
    expect(header).toHaveStyle({ height: '56px' })
  })

  it('renders channel name', () => {
    render(<ChatHeader channelName="general" />)
    expect(screen.getByTestId('chat-header-name')).toHaveTextContent('general')
  })

  it('truncates long channel names instead of widening the mobile header', () => {
    render(<ChatHeader channelName="very-long-channel-name-that-keeps-going" />)

    const style = getComputedStyle(screen.getByTestId('chat-header-name'))
    expect(style.minWidth).toBe('0')
    expect(style.overflow).toBe('hidden')
    expect(style.textOverflow).toBe('ellipsis')
    expect(style.whiteSpace).toBe('nowrap')
    expect(style.flexShrink).toBe('1')
  })

  it('renders topic when provided', () => {
    render(<ChatHeader channelName="general" channelTopic="All things general" />)
    expect(screen.getByTestId('chat-header-topic')).toHaveTextContent('All things general')
  })

  it('does not render topic when not provided', () => {
    render(<ChatHeader channelName="general" />)
    expect(screen.queryByTestId('chat-header-topic')).not.toBeInTheDocument()
  })

  it('does not render topic when topic is null', () => {
    render(<ChatHeader channelName="general" channelTopic={null} />)
    expect(screen.queryByTestId('chat-header-topic')).not.toBeInTheDocument()
  })

  it('renders mobile menu button', () => {
    render(<ChatHeader channelName="general" />)
    expect(screen.getByTestId('mobile-menu-btn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open channel navigation' })).toBeInTheDocument()
  })

  it('labels pinned messages toggle when closed', async () => {
    const user = userEvent.setup()
    const onTogglePinnedPanel = vi.fn()

    render(<ChatHeader channelName="general" pinnedCount={2} onTogglePinnedPanel={onTogglePinnedPanel} />)

    const button = screen.getByRole('button', { name: 'Open pinned messages (2)' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)
    expect(onTogglePinnedPanel).toHaveBeenCalledTimes(1)
  })

  it('opens the members sheet from the header people button', async () => {
    const user = userEvent.setup()
    render(<ChatHeader channelName="general" />)

    await user.click(screen.getByTestId('members-header-btn'))

    expect(mockOpenMembers).toHaveBeenCalledTimes(1)
  })

  it('labels pinned messages toggle when open', () => {
    render(
      <ChatHeader
        channelName="general"
        pinnedCount={1}
        pinnedPanelOpen
        onTogglePinnedPanel={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: 'Close pinned messages (1)' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
