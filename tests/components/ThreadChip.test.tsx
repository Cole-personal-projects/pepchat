import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThreadChip from '@/components/chat/ThreadChip'
import { PROFILE_A, PROFILE_B } from '@/tests/fixtures'

describe('ThreadChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:05:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when there are no replies', () => {
    render(<ThreadChip rootId="msg-1" replyCount={0} lastReplyAt={null} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('thread-chip-msg-1')).not.toBeInTheDocument()
  })

  it('renders reply count and relative last reply time', () => {
    render(
      <ThreadChip
        rootId="msg-1"
        replyCount={3}
        lastReplyAt="2024-01-15T12:00:00Z"
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByTestId('thread-chip-msg-1')).toHaveTextContent('3 replies · last reply 5m ago')
  })

  it('calls onOpen with the root id when clicked', () => {
    const onOpen = vi.fn()
    render(<ThreadChip rootId="msg-1" replyCount={1} lastReplyAt={null} onOpen={onOpen} />)

    fireEvent.click(screen.getByTestId('thread-chip-msg-1'))

    expect(onOpen).toHaveBeenCalledWith('msg-1')
  })

  it('shows at most three author avatars', () => {
    render(
      <ThreadChip
        rootId="msg-1"
        replyCount={4}
        lastReplyAt={null}
        authors={[PROFILE_A, PROFILE_B, PROFILE_A, PROFILE_B]}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getAllByTestId(/avatar-(photo|initials)/)).toHaveLength(3)
  })

  it('renders unread dot only when requested', () => {
    const { rerender } = render(
      <ThreadChip rootId="msg-1" replyCount={1} lastReplyAt={null} hasUnread={false} onOpen={vi.fn()} />
    )
    expect(screen.queryByTestId('thread-chip-unread-msg-1')).not.toBeInTheDocument()

    rerender(<ThreadChip rootId="msg-1" replyCount={1} lastReplyAt={null} hasUnread onOpen={vi.fn()} />)
    expect(screen.getByTestId('thread-chip-unread-msg-1')).toBeInTheDocument()
  })
})
