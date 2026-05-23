import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ThreadPanel from '@/components/chat/ThreadPanel'
import { CHANNEL, GROUP, MESSAGE, PROFILE_A } from '@/tests/fixtures'
import type { MessageWithProfile } from '@/lib/types'

const fetchThreadRepliesMock = vi.hoisted(() => vi.fn())
const markThreadReadMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/(app)/messages/thread-actions', () => ({
  fetchThreadReplies: fetchThreadRepliesMock,
  markThreadRead: markThreadReadMock,
}))

vi.mock('@/components/chat/MessageInput', () => ({
  default: () => <div data-testid="thread-composer" />,
}))

const ROOT_MESSAGE: MessageWithProfile = {
  ...MESSAGE,
  id: 'root-1',
  channel_id: CHANNEL.id,
  content: 'Root message',
  thread_root_id: null,
  thread_reply_count: 0,
  thread_last_reply_at: null,
}

describe('ThreadPanel message actions context', () => {
  beforeEach(() => {
    fetchThreadRepliesMock.mockReset()
    markThreadReadMock.mockReset()
    fetchThreadRepliesMock.mockResolvedValue({ ok: true, messages: [], nextCursor: null })
    markThreadReadMock.mockResolvedValue({ ok: true })
  })

  it('renders real thread messages without the channel MessageList provider', async () => {
    render(
      <ThreadPanel
        open
        rootMessage={ROOT_MESSAGE}
        channelName={CHANNEL.name}
        profile={PROFILE_A}
        currentUserId={PROFILE_A.id}
        groupId={GROUP.id}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('thread-root')).toHaveTextContent('Root message')
    await waitFor(() => expect(screen.getByTestId('thread-empty')).toHaveTextContent('No replies yet'))
    expect(screen.getByTestId('thread-composer')).toBeInTheDocument()
  })
})
