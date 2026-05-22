import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import MessageList from '@/components/chat/MessageList'
import type { MessageWithProfile } from '@/lib/types'

// Minimal Message mock — emits the same edit events as the real component
vi.mock('@/components/chat/Message', () => ({
  default: ({ msg, editingId, editContent, onStartEdit, onSubmitEdit, onCancelEdit, onEditContentChange, onDelete, onOpenActions, onOpenContextMenu, onJumpToMessage }: any) => {
    const isEditing = editingId === msg.id
    return (
      <div data-testid={`msg-${msg.id}`}>
        <span data-testid={`content-${msg.id}`}>{msg.content}</span>
        {msg.replied_to && (
          <button data-testid={`reply-quote-${msg.id}`} onClick={() => onJumpToMessage?.(msg.replied_to.id)}>
            Reply to {msg.replied_to.content}
          </button>
        )}
        {isEditing ? (
          <div>
            <textarea
              data-testid="edit-textarea"
              value={editContent}
              onChange={e => onEditContentChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitEdit(msg.id) }
                if (e.key === 'Escape') onCancelEdit()
              }}
            />
          </div>
        ) : (
          <>
            <button data-testid={`edit-btn-${msg.id}`} onClick={() => onStartEdit(msg)}>Edit</button>
            <button data-testid={`delete-btn-${msg.id}`} onClick={() => onDelete(msg.id)}>Delete</button>
            <button data-testid={`actions-btn-${msg.id}`} onClick={() => onOpenActions?.(msg)}>Actions</button>
            <button data-testid={`context-btn-${msg.id}`} onClick={() => onOpenContextMenu?.(msg, 100, 100)}>Context</button>
          </>
        )}
      </div>
    )
  },
}))

vi.mock('@/components/chat/SystemMessage', () => ({
  default: ({ msg, onOpenPinnedPanel }: any) => (
    <div data-testid={`system-msg-${msg.id}`}>
      <button data-testid="system-see-all" onClick={onOpenPinnedPanel}>See all</button>
    </div>
  ),
}))

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/app/(app)/messages/actions', () => ({
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  searchMessages: vi.fn(),
}))
vi.mock('@/app/admin/actions', () => ({
  reportMessage: vi.fn(),
}))
vi.mock('@/lib/channelReadState', () => ({
  getUnreadFromMessageLastReadAt: (messageCreatedAt: string) => {
    const timestamp = new Date(messageCreatedAt).getTime()
    return Number.isFinite(timestamp)
      ? new Date(Math.max(0, timestamp - 1)).toISOString()
      : new Date(0).toISOString()
  },
  markChannelUnreadFromMessage: vi.fn().mockResolvedValue(undefined),
}))

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const MSG: MessageWithProfile = {
  id: 'msg-1',
  user_id: 'u1',
  channel_id: 'ch-1',
  content: 'Hello',
  created_at: '2024-01-01T12:00:00.000Z',
  edited_at: null,
  reply_to_id: null,
  replied_to: null,
  attachments: [],
  reactions: [],
  profiles: { username: 'alice', display_name: null, avatar_url: null },
}

const OTHER_MSG: MessageWithProfile = {
  ...MSG,
  id: 'msg-2',
  user_id: 'u2',
  created_at: '2024-01-01T12:05:00.000Z',
  content: 'Needs review',
  profiles: { username: 'bob', display_name: null, avatar_url: null },
}

const SEARCH_MSG: MessageWithProfile = {
  ...MSG,
  id: 'msg-3',
  user_id: 'u3',
  created_at: '2024-01-01T12:10:00.000Z',
  content: 'Launch notes mention peppers',
  profiles: { username: 'carol', display_name: 'Carol', avatar_url: null },
}

const REPLY_MSG: MessageWithProfile = {
  ...MSG,
  id: 'msg-4',
  user_id: 'u2',
  created_at: '2024-01-01T12:15:00.000Z',
  content: 'Replying to hello',
  reply_to_id: 'msg-1',
  replied_to: {
    id: 'msg-1',
    content: 'Hello',
    user_id: 'u1',
    profiles: { username: 'alice', avatar_url: null },
  },
  profiles: { username: 'bob', display_name: null, avatar_url: null },
}

const NEW_MSG: MessageWithProfile = {
  ...MSG,
  id: 'msg-5',
  user_id: 'u2',
  created_at: '2024-01-01T12:20:00.000Z',
  content: 'Fresh update',
  profiles: { username: 'bob', display_name: null, avatar_url: null },
}

const BASE_PROPS = {
  messages: [MSG],
  hasMore: false,
  loadingMore: false,
  currentUserId: 'u1',
  currentUsername: 'alice',
  onLoadMore: vi.fn(),
  onReact: vi.fn(),
  onReply: vi.fn(),
}

function expandMessageSearch() {
  fireEvent.click(screen.getByTestId('message-search-expand'))
}

describe('MessageList — submitEdit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls editAction with messageId and trimmed content on Enter', async () => {
    const editAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} editAction={editAction} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: '  Updated  ' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(editAction).toHaveBeenCalledWith('msg-1', '  Updated  '))
  })

  it('closes edit mode when action returns { ok: true }', async () => {
    const editAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} editAction={editAction} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: 'Updated' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(screen.queryByTestId('edit-textarea')).not.toBeInTheDocument()
    })
  })

  it('shows inline error and keeps edit mode when action returns { error }', async () => {
    const editAction = vi.fn().mockResolvedValue({ error: 'Save failed' })
    render(<MessageList {...BASE_PROPS} editAction={editAction} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: 'Updated' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(screen.getByText('Save failed')).toBeInTheDocument())
    expect(screen.getByTestId('edit-textarea')).toBeInTheDocument()
  })

  it('does not crash and shows error when action throws (e.g. network error)', async () => {
    const editAction = vi.fn().mockRejectedValue(new Error('Network error'))
    render(<MessageList {...BASE_PROPS} editAction={editAction} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: 'Updated' } })

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })
    })

    // Component must still be mounted — not crashed
    expect(screen.getByTestId('msg-msg-1')).toBeInTheDocument()
    // Error message must be surfaced in the UI
    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument())
  })

  it('does not call editAction and does not close edit mode when content is whitespace-only', async () => {
    const editAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} editAction={editAction} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await new Promise(r => setTimeout(r, 50))
    expect(editAction).not.toHaveBeenCalled()
    expect(screen.getByTestId('edit-textarea')).toBeInTheDocument()
  })

  it('cancels edit mode when Escape is pressed', () => {
    render(<MessageList {...BASE_PROPS} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    expect(screen.getByTestId('edit-textarea')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Escape' })
    expect(screen.queryByTestId('edit-textarea')).not.toBeInTheDocument()
  })

  it('calls onEditSuccess with messageId and trimmed content when edit succeeds', async () => {
    const editAction = vi.fn().mockResolvedValue({ ok: true })
    const onEditSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} editAction={editAction} onEditSuccess={onEditSuccess} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: '  New content  ' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(onEditSuccess).toHaveBeenCalledWith('msg-1', '  New content  '))
  })

  it('does not call onEditSuccess when edit returns an error', async () => {
    const editAction = vi.fn().mockResolvedValue({ error: 'Failed' })
    const onEditSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} editAction={editAction} onEditSuccess={onEditSuccess} />)

    fireEvent.click(screen.getByTestId('edit-btn-msg-1'))
    fireEvent.change(screen.getByTestId('edit-textarea'), { target: { value: 'New content' } })
    fireEvent.keyDown(screen.getByTestId('edit-textarea'), { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
    expect(onEditSuccess).not.toHaveBeenCalled()
  })
})

describe('MessageList — delete success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('calls onDeleteSuccess after a successful delete', async () => {
    const deleteAction = vi.fn().mockResolvedValue({ ok: true })
    const onDeleteSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} deleteAction={deleteAction} onDeleteSuccess={onDeleteSuccess} />)

    fireEvent.click(screen.getByTestId('delete-btn-msg-1'))

    await waitFor(() => expect(deleteAction).toHaveBeenCalledWith('msg-1'))
    expect(onDeleteSuccess).toHaveBeenCalledWith('msg-1')
  })

  it('does not call onDeleteSuccess when delete returns an error', async () => {
    const deleteAction = vi.fn().mockResolvedValue({ error: 'Delete failed' })
    const onDeleteSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} deleteAction={deleteAction} onDeleteSuccess={onDeleteSuccess} />)

    fireEvent.click(screen.getByTestId('delete-btn-msg-1'))

    await waitFor(() => expect(screen.getByText('Delete failed')).toBeInTheDocument())
    expect(onDeleteSuccess).not.toHaveBeenCalled()
  })

  it('shows an error instead of crashing when delete returns no result', async () => {
    const deleteAction = vi.fn().mockResolvedValue(undefined)
    const onDeleteSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} deleteAction={deleteAction} onDeleteSuccess={onDeleteSuccess} />)

    fireEvent.click(screen.getByTestId('delete-btn-msg-1'))

    await waitFor(() => expect(screen.getByText('Failed to delete message.')).toBeInTheDocument())
    expect(onDeleteSuccess).not.toHaveBeenCalled()
  })

  it('shows an error instead of crashing when delete throws', async () => {
    const deleteAction = vi.fn().mockRejectedValue(new Error('Delete request failed'))
    const onDeleteSuccess = vi.fn()
    render(<MessageList {...BASE_PROPS} deleteAction={deleteAction} onDeleteSuccess={onDeleteSuccess} />)

    fireEvent.click(screen.getByTestId('delete-btn-msg-1'))

    await waitFor(() => expect(screen.getByText('Delete request failed')).toBeInTheDocument())
    expect(onDeleteSuccess).not.toHaveBeenCalled()
  })
})

const SYS_MSG: MessageWithProfile = {
  id: 'sys-1',
  user_id: 'u1',
  channel_id: 'ch-1',
  content: '',
  created_at: new Date().toISOString(),
  edited_at: null,
  reply_to_id: null,
  replied_to: null,
  attachments: [],
  reactions: [],
  profiles: { username: 'alice', display_name: null, avatar_url: null },
  is_system: true,
  system_type: 'pin',
  system_data: { pinned_by: 'Alice', message_id: 'msg-1' },
}

describe('MessageList — system messages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders SystemMessage instead of Message for is_system=true', () => {
    render(<MessageList {...BASE_PROPS} messages={[SYS_MSG]} />)
    expect(screen.getByTestId('system-msg-sys-1')).toBeInTheDocument()
    expect(screen.queryByTestId('msg-sys-1')).not.toBeInTheDocument()
  })

  it('still renders normal Message for regular messages', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG]} />)
    expect(screen.getByTestId('msg-msg-1')).toBeInTheDocument()
    expect(screen.queryByTestId('system-msg-msg-1')).not.toBeInTheDocument()
  })

  it('passes onOpenPinnedPanel to SystemMessage', () => {
    const onOpenPinnedPanel = vi.fn()
    render(<MessageList {...BASE_PROPS} messages={[SYS_MSG]} onOpenPinnedPanel={onOpenPinnedPanel} />)
    fireEvent.click(screen.getByTestId('system-see-all'))
    expect(onOpenPinnedPanel).toHaveBeenCalledOnce()
  })

  it('can render a mix of regular and system messages', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, SYS_MSG]} />)
    expect(screen.getByTestId('msg-msg-1')).toBeInTheDocument()
    expect(screen.getByTestId('system-msg-sys-1')).toBeInTheDocument()
  })
})

describe('MessageList — unread divider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a divider before the first loaded unread message from another user', () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG, SEARCH_MSG]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
      />
    )

    expect(screen.getByTestId('unread-divider')).toHaveTextContent('2 new messages')
    expect(screen.getAllByTestId('unread-divider')).toHaveLength(1)
  })

  it('uses a singular unread divider label for one loaded unread message', () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
      />
    )

    expect(screen.getByTestId('unread-divider')).toHaveTextContent('1 new message')
  })

  it('does not count the current user messages as unread', () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[{ ...MSG, created_at: '2024-01-01T12:05:00.000Z' }]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
      />
    )

    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
  })

  it('does not render a divider without a read-state timestamp', () => {
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} />)

    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
  })

  it('scrolls to the first loaded unread message on initial render', () => {
    const scrolledMessageIds: string[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolledMessageIds.push(this.getAttribute('data-message-id') ?? '')
    })

    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG, SEARCH_MSG]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
      />
    )

    expect(scrolledMessageIds).toContain('msg-2')
  })

  it('can jump back to the first loaded unread message from the toolbar', () => {
    const scrolledMessageIds: string[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolledMessageIds.push(this.getAttribute('data-message-id') ?? '')
    })

    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG, SEARCH_MSG]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
      />
    )

    fireEvent.click(screen.getByTestId('jump-first-unread'))

    expect(scrolledMessageIds.filter(id => id === 'msg-2')).toHaveLength(2)
  })

  it('scrolls to the bottom on initial render when there are no loaded unread messages', () => {
    const scrolledMessageIds: string[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolledMessageIds.push(this.getAttribute('data-message-id') ?? 'bottom')
    })

    render(<MessageList {...BASE_PROPS} messages={[MSG]} />)

    expect(scrolledMessageIds).toContain('bottom')
  })
})

describe('MessageList — message search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the number of loaded message matches', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, SEARCH_MSG, SYS_MSG]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'peppers' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')
  })

  it('searches loaded messages by author', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, SEARCH_MSG]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'carol' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')
  })

  it('searches loaded messages by attachment name and type', () => {
    const attachmentMsg: MessageWithProfile = {
      ...MSG,
      id: 'msg-6',
      content: '',
      attachments: [
        {
          type: 'image',
          name: 'launch-map.png',
          url: 'https://example.com/launch-map.png',
          size: 1024,
        },
      ],
    }
    render(<MessageList {...BASE_PROPS} messages={[MSG, attachmentMsg]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'launch-map' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'image' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')
  })

  it('searches loaded replies by quoted message text and author', () => {
    const replyToSearchMsg: MessageWithProfile = {
      ...REPLY_MSG,
      content: 'Following up',
      replied_to: {
        ...REPLY_MSG.replied_to!,
        content: 'Orbit window',
      },
    }
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG, replyToSearchMsg]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'orbit window' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'alice' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')
  })

  it('focuses loaded message search with slash when focus is not in an editable field', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG]} />)

    fireEvent.keyDown(document, { key: '/' })

    expect(screen.getByTestId('message-search-input')).toHaveFocus()
  })

  it('collapses the message search controls by default', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG]} />)

    expect(screen.getByTestId('message-search-expand')).toBeInTheDocument()
    expect(screen.queryByTestId('message-search-input')).not.toBeInTheDocument()
  })

  it('jumps to the first matching message when next is clicked', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, SEARCH_MSG]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'needs' } })
    fireEvent.click(screen.getByTestId('message-search-next'))

    expect(scrollSpy).toHaveBeenCalled()
  })

  it('shows the active result position after navigating search matches', () => {
    const secondPepperMsg: MessageWithProfile = {
      ...SEARCH_MSG,
      id: 'msg-6',
      created_at: '2024-01-01T12:25:00.000Z',
      content: 'Pepper status follow-up',
    }
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG, secondPepperMsg]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'pepper' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('2 results')

    fireEvent.click(screen.getByTestId('message-search-next'))

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1/2')

    fireEvent.click(screen.getByTestId('message-search-next'))

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('2/2')
  })

  it('navigates search matches with Enter and Shift+Enter', () => {
    const secondPepperMsg: MessageWithProfile = {
      ...SEARCH_MSG,
      id: 'msg-6',
      created_at: '2024-01-01T12:25:00.000Z',
      content: 'Pepper status follow-up',
    }
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG, secondPepperMsg]} />)
    expandMessageSearch()
    const input = screen.getByTestId('message-search-input')

    fireEvent.change(input, { target: { value: 'pepper' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1/2')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('2/2')

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1/2')
  })

  it('disables search navigation when there are no matches', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'missing' } })

    expect(screen.getByTestId('message-search-next')).toBeDisabled()
    expect(screen.getByTestId('message-search-prev')).toBeDisabled()
  })

  it('clears the loaded message search query', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG]} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'peppers' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')

    fireEvent.click(screen.getByTestId('message-search-clear'))

    expect(screen.getByTestId('message-search-input')).toHaveValue('')
    expect(screen.getByTestId('message-search-count')).toHaveTextContent('')
    expect(screen.queryByTestId('message-search-clear')).not.toBeInTheDocument()
  })

  it('clears the loaded message search query with Escape', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, SEARCH_MSG]} />)
    expandMessageSearch()
    const input = screen.getByTestId('message-search-input')

    fireEvent.change(input, { target: { value: 'peppers' } })

    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('')
    expect(screen.getByTestId('message-search-count')).toHaveTextContent('')
    expect(screen.queryByTestId('message-search-clear')).not.toBeInTheDocument()
  })
})

describe('MessageList — initial message motion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('staggers only the initial visible messages', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, SEARCH_MSG]} />)

    expect(document.querySelector('[data-message-id="msg-1"]')).toHaveClass('message-stagger-in')
    expect(document.querySelector('[data-message-id="msg-2"]')).toHaveStyle({ animationDelay: '14ms' })
    expect(document.querySelector('[data-message-id="msg-3"]')).toHaveClass('message-stagger-in')
  })

  it('does not stagger hash or unread jump targets', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG]} highlightedMessageId="msg-2" />)

    expect(document.querySelector('[data-message-id="msg-1"]')).not.toHaveClass('message-stagger-in')
    expect(document.querySelector('[data-message-id="msg-2"]')).not.toHaveClass('message-stagger-in')
  })

  it('does not restagger older loaded messages or appended messages', () => {
    const { rerender } = render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG]} />)

    rerender(<MessageList {...BASE_PROPS} messages={[REPLY_MSG, MSG, OTHER_MSG, NEW_MSG]} />)

    expect(document.querySelector('[data-message-id="msg-4"]')).not.toHaveClass('message-stagger-in')
    expect(document.querySelector('[data-message-id="msg-5"]')).not.toHaveClass('message-stagger-in')
  })
})

describe('MessageList — new message jump button', () => {
  beforeEach(() => vi.clearAllMocks())

  function scrollAwayFromBottom() {
    const container = screen.getByTestId('message-scroll-container')
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true })
    fireEvent.scroll(container)
  }

  it('shows a pending new-message count when another user message arrives while scrolled up', async () => {
    const { rerender } = render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG]} />)

    scrollAwayFromBottom()
    await waitFor(() => expect(screen.getByTestId('scroll-to-bottom-btn')).toBeInTheDocument())

    rerender(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, NEW_MSG]} />)

    await waitFor(() => expect(screen.getByTestId('scroll-new-count')).toHaveTextContent('1 new'))
  })

  it('clears the pending new-message count when jumping to the bottom', async () => {
    const { rerender } = render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG]} />)

    scrollAwayFromBottom()
    rerender(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, NEW_MSG]} />)
    await waitFor(() => expect(screen.getByTestId('scroll-new-count')).toHaveTextContent('1 new'))

    fireEvent.click(screen.getByTestId('scroll-to-bottom-btn'))

    expect(screen.queryByTestId('scroll-new-count')).not.toBeInTheDocument()
  })
})

describe('MessageList — reply navigation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('jumps to the replied-to message when it is loaded', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<MessageList {...BASE_PROPS} messages={[MSG, REPLY_MSG]} />)

    fireEvent.click(screen.getByTestId('reply-quote-msg-4'))

    expect(scrollSpy).toHaveBeenCalled()
  })

  it('shows guidance when the replied-to message is not loaded', () => {
    render(<MessageList {...BASE_PROPS} messages={[REPLY_MSG]} />)

    fireEvent.click(screen.getByTestId('reply-quote-msg-4'))

    expect(screen.getByText('Original message is not loaded. Load earlier messages and try again.')).toBeInTheDocument()
  })
})

describe('MessageList — mark unread', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks unread from the selected message in the desktop context menu', async () => {
    const { markChannelUnreadFromMessage } = await import('@/lib/channelReadState')
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} />)

    fireEvent.click(screen.getByTestId('context-btn-msg-2'))
    fireEvent.click(screen.getByText('Mark Unread'))

    await waitFor(() => expect(markChannelUnreadFromMessage).toHaveBeenCalledWith(
      'ch-1',
      'u1',
      OTHER_MSG.created_at
    ))
    expect(screen.getByText('Marked unread from this message.')).toBeInTheDocument()
  })

  it('shows the unread divider immediately after marking a message unread', async () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG, OTHER_MSG, SEARCH_MSG]} />)

    fireEvent.click(screen.getByTestId('context-btn-msg-2'))
    fireEvent.click(screen.getByText('Mark Unread'))

    await waitFor(() => expect(screen.getByTestId('unread-divider')).toHaveTextContent('2 new messages'))
    expect(screen.getAllByTestId('unread-divider')).toHaveLength(1)
  })

  it('marks unread from the selected message in the mobile action modal', async () => {
    const { markChannelUnreadFromMessage } = await import('@/lib/channelReadState')
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-mark-unread'))

    await waitFor(() => expect(markChannelUnreadFromMessage).toHaveBeenCalledWith(
      'ch-1',
      'u1',
      OTHER_MSG.created_at
    ))
  })

  it('can hide mark unread actions', () => {
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} allowMarkUnread={false} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))

    expect(screen.queryByTestId('modal-action-mark-unread')).not.toBeInTheDocument()
  })
})

describe('MessageList — report message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports another user message from the mobile action modal', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-report'))
    fireEvent.click(screen.getByTestId('report-reason-spam'))
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(reportAction).toHaveBeenCalledWith('msg-2', 'Spam'))
  })

  it('reports another user message from the desktop context menu', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('context-btn-msg-2'))
    fireEvent.click(screen.getByText('Report Message'))
    fireEvent.change(screen.getByTestId('report-reason-input'), { target: { value: 'Custom reason' } })
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(reportAction).toHaveBeenCalledWith('msg-2', 'Custom reason'))
  })

  it('does not show report action for own messages', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG]} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-1'))
    expect(screen.queryByTestId('modal-action-report')).not.toBeInTheDocument()
  })

  it('can hide report actions for contexts without report support', () => {
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} allowReports={false} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))

    expect(screen.queryByTestId('modal-action-report')).not.toBeInTheDocument()
  })

  it('does not call reportAction when the dialog is cancelled', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-report'))
    fireEvent.click(screen.getByTestId('report-cancel'))

    await new Promise(r => setTimeout(r, 50))
    expect(reportAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('report-submit')).not.toBeInTheDocument()
  })

  it('shows inline error when reportAction fails', async () => {
    const reportAction = vi.fn().mockResolvedValue({ error: 'Report failed' })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-report'))
    fireEvent.click(screen.getByTestId('report-reason-spam'))
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(screen.getByText('Report failed')).toBeInTheDocument())
  })

  it('shows success feedback when reportAction succeeds', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-report'))
    fireEvent.click(screen.getByTestId('report-reason-spam'))
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(screen.getByText('Report submitted for review.')).toBeInTheDocument())
    expect(screen.queryByTestId('report-submit')).not.toBeInTheDocument()
  })

  it('hides the mobile report action after a successful report', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    fireEvent.click(screen.getByTestId('modal-action-report'))
    fireEvent.click(screen.getByTestId('report-reason-spam'))
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(screen.getByText('Report submitted for review.')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('actions-btn-msg-2'))
    expect(screen.queryByTestId('modal-action-report')).not.toBeInTheDocument()
  })

  it('hides the desktop report action after a successful report', async () => {
    const reportAction = vi.fn().mockResolvedValue({ ok: true })
    render(<MessageList {...BASE_PROPS} messages={[OTHER_MSG]} reportAction={reportAction} />)

    fireEvent.click(screen.getByTestId('context-btn-msg-2'))
    fireEvent.click(screen.getByText('Report Message'))
    fireEvent.click(screen.getByTestId('report-reason-spam'))
    fireEvent.click(screen.getByTestId('report-submit'))

    await waitFor(() => expect(screen.getByText('Report submitted for review.')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('context-btn-msg-2'))
    expect(screen.queryByText('Report Message')).not.toBeInTheDocument()
  })
})

describe('MessageList — group search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches the current group and renders cross-channel results', async () => {
    const searchAction = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        {
          ...SEARCH_MSG,
          id: 'msg-group-1',
          channel_id: 'ch-2',
          content: 'Group-wide launch note',
          channels: { id: 'ch-2', name: 'announcements', group_id: 'group-1' },
        },
      ],
    })

    render(
      <MessageList
        {...BASE_PROPS}
        groupId="group-1"
        channelId="ch-1"
        channelName="general"
        messages={[MSG]}
        searchAction={searchAction}
      />
    )
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-scope'), { target: { value: 'group' } })
    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'launch' } })

    await waitFor(() => {
      expect(searchAction).toHaveBeenCalledWith({
        groupId: 'group-1',
        query: 'launch',
        author: '',
        channel: '',
        date: '',
      })
    })

    expect(await screen.findByTestId('group-search-result-msg-group-1')).toHaveTextContent('#announcements')
    expect(screen.getByTestId('message-search-count')).toHaveTextContent('1 result')
  })
})


describe('MessageList — notification hash fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('scrolls to a present highlighted message and does not show the notification fallback', async () => {
    const scrolledMessageIds: string[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolledMessageIds.push(this.getAttribute('data-message-id') ?? '')
    })

    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG]}
        highlightedMessageId="msg-2"
        messagesReadyForHashFallback={true}
      />
    )

    await waitFor(() => expect(scrolledMessageIds).toContain('msg-2'))
    expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument()
  })

  it('shows a non-success fallback notice when a highlighted hash target is missing after readiness', async () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG]}
        highlightedMessageId="missing-msg"
        messagesReadyForHashFallback={true}
      />
    )

    const notice = await screen.findByTestId('notification-fallback-notice')
    expect(notice).toHaveTextContent('That message is no longer available.')
    expect(notice).toHaveClass('text-[var(--danger)]')
    expect(notice).not.toHaveClass('text-[var(--success)]')
  })

  it('clears an earlier fallback notice immediately after a later successful hash jump', async () => {
    const { rerender } = render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG]}
        highlightedMessageId="missing-msg"
        messagesReadyForHashFallback={true}
      />
    )

    expect(await screen.findByTestId('notification-fallback-notice')).toHaveTextContent('That message is no longer available.')

    rerender(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG]}
        highlightedMessageId="msg-2"
        messagesReadyForHashFallback={true}
      />
    )

    await waitFor(() => expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument())
  })

  it('shows the fallback notice when the current hash target is removed after a successful jump', async () => {
    const { rerender } = render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG, OTHER_MSG]}
        highlightedMessageId="msg-2"
        messagesReadyForHashFallback={true}
      />
    )

    await waitFor(() => expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument())

    rerender(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG]}
        highlightedMessageId={null}
        messagesReadyForHashFallback={true}
      />
    )

    expect(await screen.findByTestId('notification-fallback-notice')).toHaveTextContent('That message is no longer available.')
  })

  it('clears the fallback notice after 4 seconds', async () => {
    vi.useFakeTimers()

    render(
      <MessageList
        {...BASE_PROPS}
        messages={[MSG]}
        highlightedMessageId="missing-msg"
        messagesReadyForHashFallback={true}
      />
    )

    expect(screen.getByTestId('notification-fallback-notice')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('keeps fallback and local confirmation notices independent', async () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[REPLY_MSG]}
        highlightedMessageId="missing-msg"
        messagesReadyForHashFallback={true}
      />
    )

    expect(await screen.findByTestId('notification-fallback-notice')).toHaveTextContent('That message is no longer available.')

    fireEvent.click(screen.getByTestId('reply-quote-msg-4'))

    expect(screen.getByText('Original message is not loaded. Load earlier messages and try again.')).toBeInTheDocument()
    expect(screen.getByTestId('notification-fallback-notice')).toHaveTextContent('That message is no longer available.')
  })

  it('does not show the fallback for missing unread auto-scroll targets', () => {
    render(
      <MessageList
        {...BASE_PROPS}
        messages={[OTHER_MSG]}
        initialLastReadAt="2024-01-01T12:01:00.000Z"
        messagesReadyForHashFallback={true}
      />
    )

    expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument()
  })

  it('does not show the fallback for search navigation with no loaded target', () => {
    render(<MessageList {...BASE_PROPS} messages={[MSG]} messagesReadyForHashFallback={true} />)
    expandMessageSearch()

    fireEvent.change(screen.getByTestId('message-search-input'), { target: { value: 'missing' } })
    fireEvent.click(screen.getByTestId('message-search-next'))

    expect(screen.queryByTestId('notification-fallback-notice')).not.toBeInTheDocument()
  })
})
