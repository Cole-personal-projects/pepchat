import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ThreadPanel from '@/components/chat/ThreadPanel'
import { CHANNEL, GROUP, MESSAGE, PROFILE_A, PROFILE_B } from '@/tests/fixtures'
import type { MessageWithProfile } from '@/lib/types'

const fetchThreadRepliesMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/(app)/messages/thread-actions', () => ({
  fetchThreadReplies: fetchThreadRepliesMock,
}))

vi.mock('@/components/chat/Message', () => ({
  default: ({ msg, showThreadChip }: { msg: MessageWithProfile; showThreadChip?: boolean }) => (
    <div data-testid={`message-${msg.id}`} data-show-thread-chip={String(showThreadChip)}>
      {msg.content}
    </div>
  ),
}))

vi.mock('@/components/chat/MessageInput', () => ({
  default: (props: any) => (
    <div
      data-testid="thread-composer"
      data-mode={props.mode}
      data-thread-root-id={props.threadRootId}
      data-channel-id={props.channelId}
      data-draft-storage-key={props.draftStorageKey}
    >
      <button
        type="button"
        data-testid="mock-send-thread-reply"
        onClick={() => props.onSent?.({
          ...MESSAGE,
          id: 'reply-new',
          user_id: PROFILE_A.id,
          channel_id: props.channelId,
          thread_root_id: props.threadRootId,
          content: 'New reply',
          profiles: {
            username: PROFILE_A.username,
            avatar_url: PROFILE_A.avatar_url,
            display_name: PROFILE_A.display_name,
          },
        })}
      >
        Send
      </button>
    </div>
  ),
}))

const ROOT_MESSAGE: MessageWithProfile = {
  ...MESSAGE,
  id: 'root-1',
  channel_id: CHANNEL.id,
  content: 'Root message',
  thread_root_id: null,
  thread_reply_count: 1,
  thread_last_reply_at: '2024-01-15T12:10:00Z',
}

const REPLY_MESSAGE: MessageWithProfile = {
  ...MESSAGE,
  id: 'reply-1',
  user_id: PROFILE_B.id,
  channel_id: CHANNEL.id,
  content: 'First reply',
  thread_root_id: ROOT_MESSAGE.id,
  thread_reply_count: 0,
  thread_last_reply_at: null,
  profiles: {
    username: PROFILE_B.username,
    avatar_url: PROFILE_B.avatar_url,
    display_name: PROFILE_B.display_name,
  },
}

const BASE_PROPS = {
  open: true,
  rootMessage: ROOT_MESSAGE,
  channelName: CHANNEL.name,
  profile: PROFILE_A,
  currentUserId: PROFILE_A.id,
  groupId: GROUP.id,
  canPin: true,
  onClose: vi.fn(),
}

describe('ThreadPanel', () => {
  beforeEach(() => {
    fetchThreadRepliesMock.mockReset()
    fetchThreadRepliesMock.mockResolvedValue({ ok: true, messages: [REPLY_MESSAGE], nextCursor: null })
  })

  it('renders nothing when closed', () => {
    render(<ThreadPanel {...BASE_PROPS} open={false} />)
    expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument()
  })

  it('renders nothing without a root message', () => {
    render(<ThreadPanel {...BASE_PROPS} rootMessage={null} />)
    expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument()
  })

  it('renders header, root message, fetched replies, and thread composer', async () => {
    render(<ThreadPanel {...BASE_PROPS} />)

    expect(screen.getByTestId('thread-panel-title')).toHaveTextContent('Thread')
    expect(screen.getByTestId('thread-panel-channel')).toHaveTextContent('in #general')
    expect(screen.getByTestId('message-root-1')).toHaveTextContent('Root message')
    expect(screen.getByTestId('message-root-1')).toHaveAttribute('data-show-thread-chip', 'false')
    expect(fetchThreadRepliesMock).toHaveBeenCalledWith({ rootId: 'root-1' })

    await waitFor(() => expect(screen.getByTestId('thread-reply-reply-1')).toBeInTheDocument())
    expect(screen.getByTestId('message-reply-1')).toHaveTextContent('First reply')
    expect(screen.getByTestId('thread-reply-count')).toHaveTextContent('1 reply')
    expect(screen.getByTestId('thread-composer')).toHaveAttribute('data-mode', 'thread')
    expect(screen.getByTestId('thread-composer')).toHaveAttribute('data-thread-root-id', 'root-1')
  })

  it('uses the desktop right-rail layout instead of a fixed overlay', async () => {
    render(<ThreadPanel {...BASE_PROPS} />)

    expect(screen.getByTestId('thread-panel')).toHaveClass('lg:static', 'lg:w-80', 'lg:flex-shrink-0')
    expect(screen.getByTestId('thread-panel')).not.toHaveClass('lg:right-0')
    await waitFor(() => expect(screen.getByTestId('thread-reply-reply-1')).toBeInTheDocument())
  })

  it('shows an empty state when the thread has no replies', async () => {
    fetchThreadRepliesMock.mockResolvedValueOnce({ ok: true, messages: [], nextCursor: null })

    render(<ThreadPanel {...BASE_PROPS} />)

    await waitFor(() => expect(screen.getByTestId('thread-empty')).toHaveTextContent('No replies yet'))
  })

  it('shows an error when replies fail to load', async () => {
    fetchThreadRepliesMock.mockResolvedValueOnce({ error: 'No access' })

    render(<ThreadPanel {...BASE_PROPS} />)

    await waitFor(() => expect(screen.getByTestId('thread-error')).toHaveTextContent('No access'))
  })

  it('calls onClose from close button and mobile backdrop', async () => {
    const onClose = vi.fn()
    render(<ThreadPanel {...BASE_PROPS} onClose={onClose} />)

    await waitFor(() => expect(screen.getByTestId('thread-reply-reply-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('thread-panel-close'))
    fireEvent.click(screen.getByTestId('thread-panel-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('appends a sent reply to the panel', async () => {
    fetchThreadRepliesMock.mockResolvedValueOnce({ ok: true, messages: [], nextCursor: null })
    render(<ThreadPanel {...BASE_PROPS} />)

    await waitFor(() => expect(screen.getByTestId('thread-empty')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('mock-send-thread-reply'))

    expect(screen.getByTestId('thread-reply-reply-new')).toHaveTextContent('New reply')
    expect(screen.getByTestId('thread-reply-count')).toHaveTextContent('1 reply')
  })
})
