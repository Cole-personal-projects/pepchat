import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DMConversationView from '@/components/dm/DMConversationView'
import { DM_MESSAGE, PROFILE_A, PROFILE_B } from '@/tests/fixtures'

const mockMessageList = vi.hoisted(() => vi.fn(({ highlightedMessageId, messageLinkBasePath, messagesReadyForHashFallback }: any) => (
  <div>
    <div data-testid="dm-message-link-base">{messageLinkBasePath}</div>
    <div data-testid="dm-message-highlight">{highlightedMessageId ?? ''}</div>
    <div data-testid="dm-message-hash-ready">{String(messagesReadyForHashFallback)}</div>
  </div>
)))

const { mockReplace, mockBack, mockMarkDMsRead, mockDMMessageCount, mockDMInitialMessagesLoaded, mockOnlineUsers, mockDMHeader, mockMessageInput, mockDMEmptyState } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockBack: vi.fn(),
  mockMarkDMsRead: vi.fn().mockResolvedValue(undefined),
  mockDMMessageCount: { value: 1 },
  mockDMInitialMessagesLoaded: { value: true },
  mockOnlineUsers: { value: [] as Array<{ user_id: string; username: string; avatar_url: string | null }> },
  mockDMHeader: vi.fn((_props: any) => <div data-testid="dm-header" />),
  mockMessageInput: vi.fn((_props: any) => <div data-testid="message-input" />),
  mockDMEmptyState: vi.fn((_props: any) => <div data-testid="dm-empty-state" />),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}))

vi.mock('@/components/chat/MessageList', () => ({ default: (props: any) => mockMessageList(props) }))
vi.mock('@/components/chat/MessageInput', () => ({ default: (props: any) => mockMessageInput(props) }))
vi.mock('@/components/chat/TypingIndicator', () => ({ default: () => <div data-testid="typing-indicator" /> }))
vi.mock('@/components/dm/DMHeader', () => ({ default: (props: any) => mockDMHeader(props) }))
vi.mock('@/components/dm/DMEmptyState', () => ({ default: (props: any) => mockDMEmptyState(props) }))

vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: () => ({ onlineUsers: mockOnlineUsers.value, typingUsernames: [], broadcastTyping: vi.fn() }),
}))

vi.mock('@/lib/hooks/useDMs', () => ({
  useDMMessages: () => ({
    messages: Array.from({ length: mockDMMessageCount.value }, (_, index) => ({
      id: `dm-${index + 1}`,
      channel_id: 'conv-1',
      user_id: index === 0 ? 'user-a' : 'user-b',
      content: index === 0 ? 'Hey Bob!' : 'New reply',
      reply_to_id: null,
      edited_at: null,
      created_at: `2024-03-01T10:0${index}:00Z`,
      attachments: [],
      profiles: { username: index === 0 ? 'alice' : 'bob', avatar_url: null, display_name: index === 0 ? 'Alice' : 'Bob' },
      reactions: [],
      replied_to: null,
    })),
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    addMessage: vi.fn(),
    removeMessage: vi.fn(),
    updateMessageContent: vi.fn(),
    initialMessagesLoaded: mockDMInitialMessagesLoaded.value,
  }),
}))

vi.mock('@/app/(app)/dm/actions', () => ({
  sendDM: vi.fn(),
  editDM: vi.fn(),
  deleteDM: vi.fn(),
  markDMsRead: mockMarkDMsRead,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: PROFILE_A.id } } }) },
    from: (table: string) => {
      const data = table === 'dm_conversations'
        ? {
            id: DM_MESSAGE.conversation_id,
            user_a: PROFILE_A.id,
            user_b: PROFILE_B.id,
            user_a_profile: PROFILE_A,
            user_b_profile: PROFILE_B,
          }
        : PROFILE_A
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) builder[method] = vi.fn(() => builder)
      builder.single = vi.fn().mockResolvedValue({ data, error: null })
      return builder
    },
  }),
}))

describe('DMConversationView — message links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDMMessageCount.value = 1
    mockDMInitialMessagesLoaded.value = true
    mockOnlineUsers.value = []
    window.history.replaceState(null, '', `/dm/${DM_MESSAGE.conversation_id}`)
  })

  it('renders a chat skeleton while conversation participants load', () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    expect(screen.getByLabelText('Loading conversation')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Loading conversation…')).toBeNull()
  })

  it('passes the DM message link base path to MessageList', async () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(screen.getByTestId('dm-message-link-base')).toHaveTextContent('/dm'))
  })

  it('passes the URL hash message id to MessageList for highlighting on mount', async () => {
    window.history.replaceState(null, '', `/dm/${DM_MESSAGE.conversation_id}#${DM_MESSAGE.id}`)

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(screen.getByTestId('dm-message-highlight')).toHaveTextContent(DM_MESSAGE.id))
  })

  it('does not mark hash fallback ready before the initial DM messages finish loading', async () => {
    mockDMInitialMessagesLoaded.value = false
    mockDMMessageCount.value = 0
    window.history.replaceState(null, '', `/dm/${DM_MESSAGE.conversation_id}#${DM_MESSAGE.id}`)

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMessageList).toHaveBeenCalled())
    expect(mockDMEmptyState).not.toHaveBeenCalled()
    expect(mockMessageList).toHaveBeenLastCalledWith(expect.objectContaining({
      highlightedMessageId: DM_MESSAGE.id,
      messagesReadyForHashFallback: false,
    }))
  })

  it('marks hash fallback ready after initial DM messages load with a valid hash target', async () => {
    window.history.replaceState(null, '', `/dm/${DM_MESSAGE.conversation_id}#dm-1`)

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMessageList).toHaveBeenLastCalledWith(expect.objectContaining({
      highlightedMessageId: 'dm-1',
      messagesReadyForHashFallback: true,
    })))
    expect(screen.getByTestId('dm-message-hash-ready')).toHaveTextContent('true')
  })

  it('permits missing-target fallback after initial DM messages load', async () => {
    window.history.replaceState(null, '', `/dm/${DM_MESSAGE.conversation_id}#missing-dm`)

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMessageList).toHaveBeenLastCalledWith(expect.objectContaining({
      highlightedMessageId: 'missing-dm',
      messagesReadyForHashFallback: true,
    })))
  })

  it('disables channel-style mark unread for DM messages', async () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMessageList.mock.calls.at(-1)?.[0].allowMarkUnread).toBe(false))
  })

  it('disables channel-style reports for DM messages', async () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMessageList.mock.calls.at(-1)?.[0].allowReports).toBe(false))
  })

  it('marks new messages read while the DM conversation is open', async () => {
    const { rerender } = render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMarkDMsRead).toHaveBeenCalledWith(DM_MESSAGE.conversation_id))
    mockMarkDMsRead.mockClear()

    mockDMMessageCount.value = 2
    rerender(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => expect(mockMarkDMsRead).toHaveBeenCalledWith(DM_MESSAGE.conversation_id))
  })

  it('passes online presence for the other DM participant to the header', async () => {
    mockOnlineUsers.value = [{ user_id: PROFILE_B.id, username: PROFILE_B.username, avatar_url: PROFILE_B.avatar_url }]

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => {
      expect(mockDMHeader).toHaveBeenLastCalledWith(expect.objectContaining({ isOnline: true }))
    })
  })

  it('passes a direct-message placeholder to the composer', async () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => {
      expect(mockMessageInput).toHaveBeenLastCalledWith(expect.objectContaining({ placeholder: 'Message Bob' }))
    })
  })

  it('scopes composer drafts to the DM conversation', async () => {
    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => {
      expect(mockMessageInput).toHaveBeenLastCalledWith(
        expect.objectContaining({ draftStorageKey: `sidebar:draft:dm:${DM_MESSAGE.conversation_id}` })
      )
    })
  })

  it('passes online presence to the empty state before any messages exist', async () => {
    mockDMMessageCount.value = 0
    mockOnlineUsers.value = [{ user_id: PROFILE_B.id, username: PROFILE_B.username, avatar_url: PROFILE_B.avatar_url }]

    render(<DMConversationView conversationId={DM_MESSAGE.conversation_id} />)

    await waitFor(() => {
      expect(mockDMEmptyState).toHaveBeenLastCalledWith(expect.objectContaining({ isOnline: true }))
    })
  })
})
