import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import ChannelShell from '@/components/chat/ChannelShell'
import type { MessageWithProfile, Profile } from '@/lib/types'

const { mockChatHeader, mockMessageList, mockMessageInput, mockPinnedMessagesPanel, mockThreadPanel } = vi.hoisted(() => ({
  mockChatHeader: vi.fn(({ pinnedPanelOpen, onTogglePinnedPanel }: any) => (
    <button type="button" data-testid="toggle-pins" aria-pressed={pinnedPanelOpen} onClick={onTogglePinnedPanel}>
      Toggle pins
    </button>
  )),
  mockMessageList: vi.fn(({ highlightedMessageId, messagesReadyForHashFallback }: any) => (
    <div>
      <div data-testid="message-list-highlight">{highlightedMessageId ?? ''}</div>
      <div data-testid="message-list-hash-ready">{String(messagesReadyForHashFallback)}</div>
    </div>
  )),
  mockMessageInput: vi.fn((_props: any) => <div data-testid="message-input" />),
  mockPinnedMessagesPanel: vi.fn(({ open }: any) => <div data-testid="pinned-panel">{String(open)}</div>),
  mockThreadPanel: vi.fn(({ open }: any) => <div data-testid="thread-panel">{String(open)}</div>),
}))

vi.mock('@/components/chat/ChatHeader', () => ({ default: (props: any) => mockChatHeader(props) }))
vi.mock('@/components/chat/MessageList', () => ({ default: (props: any) => mockMessageList(props) }))
vi.mock('@/components/chat/MessageInput', () => ({ default: (props: any) => mockMessageInput(props) }))
vi.mock('@/components/chat/TypingIndicator', () => ({ default: () => <div data-testid="typing-indicator" /> }))
vi.mock('@/components/chat/PresencePanel', () => ({ default: () => <div data-testid="presence-panel" /> }))
vi.mock('@/components/chat/PinnedMessagesPanel', () => ({ default: (props: any) => mockPinnedMessagesPanel(props) }))
vi.mock('@/components/chat/ThreadPanel', () => ({ default: (props: any) => mockThreadPanel(props) }))

vi.mock('@/lib/hooks/useMessages', () => ({
  useMessages: (_channelId: string, initialMessages: MessageWithProfile[]) => ({
    messages: initialMessages,
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    addMessage: vi.fn(),
    removeMessage: vi.fn(),
    broadcastNewMessage: vi.fn(),
    toggleReactionOptimistic: vi.fn(),
    broadcastReactionChange: vi.fn(),
    updateMessageContent: vi.fn(),
    updateMessagePinnedAt: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/usePinnedMessages', () => ({
  usePinnedMessages: () => ({ pinnedMessages: [], pinnedCount: 0, refetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: () => ({ onlineUsers: [], typingUsernames: [], broadcastTyping: vi.fn() }),
}))

vi.mock('@/lib/channelReadState', () => ({
  markChannelRead: vi.fn(),
}))

vi.mock('@/app/(app)/reactions/actions', () => ({
  toggleReaction: vi.fn(),
}))

vi.mock('@/app/(app)/messages/actions', () => ({
  pinMessage: vi.fn(),
  unpinMessage: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

const PROFILE: Profile = {
  id: 'u1',
  username: 'alice',
  avatar_url: null,
  display_name: 'Alice',
  bio: null,
  location: null,
  website: null,
  username_color: '#ffffff',
  banner_color: '#111111',
  badge: null,
  pronouns: null,
  member_since: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
}

const MESSAGE: MessageWithProfile = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'u1',
  content: 'Hello',
  reply_to_id: null,
  edited_at: null,
  created_at: '2024-01-01T12:00:00Z',
  attachments: [],
  reactions: [],
  replied_to: null,
  profiles: { username: 'alice', display_name: 'Alice', avatar_url: null },
}

describe('ChannelShell — message links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/channels/ch-1')
  })

  it('allows the channel shell to shrink inside the desktop app flex layout', () => {
    const { container } = render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    expect(container.firstElementChild).toHaveClass('flex-1', 'min-w-0', 'min-h-0', 'overflow-hidden')
  })

  it('passes the URL hash message id to MessageList for highlighting on mount', async () => {
    window.history.replaceState(null, '', '/channels/ch-1#msg-1')

    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    await waitFor(() => expect(screen.getByTestId('message-list-highlight')).toHaveTextContent('msg-1'))
  })

  it('responds to hash changes while the channel is open', async () => {
    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    act(() => {
      window.history.replaceState(null, '', '/channels/ch-1#msg-1')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    await waitFor(() => expect(screen.getByTestId('message-list-highlight')).toHaveTextContent('msg-1'))
  })

  it('does not treat a thread reply hash as a channel timeline jump', async () => {
    window.history.replaceState(null, '', '/channels/ch-1?thread=msg-1#reply-1')

    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    await waitFor(() => expect(mockMessageList).toHaveBeenCalled())
    expect(screen.getByTestId('message-list-highlight')).toBeEmptyDOMElement()
  })

  it('lets the pinned panel toggle take precedence over an open thread panel', async () => {
    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    act(() => {
      mockMessageList.mock.calls.at(-1)?.[0].onOpenThreadRootIdChange('msg-1')
      mockMessageList.mock.calls.at(-1)?.[0].onThreadPanelOpenChange(true)
    })

    expect(mockPinnedMessagesPanel.mock.calls.at(-1)?.[0].open).toBe(false)

    act(() => {
      screen.getByTestId('toggle-pins').click()
    })

    await waitFor(() => expect(mockPinnedMessagesPanel.mock.calls.at(-1)?.[0].open).toBe(true))
    expect(mockChatHeader.mock.calls.at(-1)?.[0].pinnedPanelOpen).toBe(true)
    expect(mockThreadPanel.mock.calls.at(-1)?.[0].open).toBe(false)
    expect(screen.getByTestId('thread-panel')).toHaveTextContent('false')
  })

  it('passes hash fallback readiness to MessageList', () => {
    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    expect(mockMessageList).toHaveBeenLastCalledWith(expect.objectContaining({ messagesReadyForHashFallback: true }))
    expect(screen.getByTestId('message-list-hash-ready')).toHaveTextContent('true')
  })

  it('passes a delete-success handler to MessageList', () => {
    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    expect(mockMessageList.mock.calls.at(-1)?.[0].onDeleteSuccess).toEqual(expect.any(Function))
  })

  it('scopes composer drafts to the channel', () => {
    render(
      <ChannelShell
        channelId="ch-1"
        channelName="general"
        initialMessages={[MESSAGE]}
        profile={PROFILE}
        userRole="user"
      />
    )

    expect(mockMessageInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ draftStorageKey: 'sidebar:draft:channel:ch-1' })
    )
  })
})
