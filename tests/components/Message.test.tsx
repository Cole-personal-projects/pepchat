import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import Message from '@/components/chat/Message'
import { ChannelMessageActionsProvider, type MessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/chat/ReactionPicker', () => ({ default: () => null }))
vi.mock('@/components/chat/ReactionPills', () => ({ default: () => null }))
vi.mock('@/components/chat/MessageAttachments', () => ({ default: () => null }))
vi.mock('@/components/chat/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => <span>{content}</span>,
}))
vi.mock('@/lib/hooks/useThreadUnread', () => ({ useThreadUnread: () => false }))

const BASE_MSG: MessageWithProfile = {
  id: 'msg-1',
  user_id: 'u1',
  channel_id: 'ch-1',
  content: 'Hello world',
  created_at: '2024-01-15T10:00:00Z',
  edited_at: null,
  reply_to_id: null,
  replied_to: null,
  attachments: [],
  reactions: [],
  profiles: {
    username: 'alice',
    display_name: 'Alice Smith',
    avatar_url: null,
  },
}

const BASE_ACTIONS: MessageActions = {
  startEdit: vi.fn(),
  cancelEdit: vi.fn(),
  changeEditContent: vi.fn(),
  submitEdit: vi.fn(),
  delete: vi.fn(),
  react: vi.fn(),
  reply: vi.fn(),
  openThread: vi.fn(),
  jumpToMessage: vi.fn(),
  pin: vi.fn(),
  toggleSaved: vi.fn(),
  openProfile: vi.fn(),
  openActions: vi.fn(),
  openContextMenu: vi.fn(),
  togglePicker: vi.fn(),
  closePicker: vi.fn(),
  markUnread: vi.fn(),
  report: vi.fn(),
  muteUser: vi.fn(),
}

const BASE_PROPS = {
  msg: BASE_MSG,
  isCompact: false,
  isOwn: false,
  currentUserId: 'u2',
  editingId: null as string | null,
  editContent: '',
  pickerOpenFor: null as string | null,
  allowReactions: true,
  allowReplies: true,
  isPending: false,
  atReactionLimit: false,
}

function render(ui: React.ReactElement, actions: Partial<MessageActions> = {}) {
  return rtlRender(
    <ChannelMessageActionsProvider value={{ ...BASE_ACTIONS, ...actions }}>
      {ui}
    </ChannelMessageActionsProvider>,
  )
}

describe('Message — ungrouped', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:05:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows message header', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.getByTestId('message-header')).toBeInTheDocument()
  })

  it('shows display name in header', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.getByTestId('message-author-name')).toHaveTextContent('Alice Smith')
  })

  it('falls back to username when no display name', () => {
    const msg: MessageWithProfile = { ...BASE_MSG, profiles: { ...BASE_MSG.profiles, display_name: null } }
    render(<Message {...BASE_PROPS} msg={msg} />)
    expect(screen.getByTestId('message-author-name')).toHaveTextContent('alice')
  })

  it('applies username_color when present', () => {
    const msg = { ...BASE_MSG, profiles: { ...BASE_MSG.profiles } } as any
    msg.profiles.username_color = '#e6543a'
    render(<Message {...BASE_PROPS} msg={msg} />)
    expect(screen.getByTestId('message-author-name')).toHaveStyle({ color: '#e6543a' })
  })

  it('renders message content', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('does not render a thread summary for messages with no replies', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.queryByTestId('thread-chip-msg-1')).not.toBeInTheDocument()
  })

  it('renders thread summary only when the message has replies', () => {
    const msg: MessageWithProfile = {
      ...BASE_MSG,
      thread_reply_count: 1,
      thread_last_reply_at: '2024-01-15T11:56:00',
    }

    render(<Message {...BASE_PROPS} msg={msg} />)

    expect(screen.getByTestId('thread-chip-msg-1')).toHaveTextContent('1 reply · Today at 11:56 AM')
  })
})

describe('Message — grouped / compact', () => {
  it('does not show message header when isCompact=true', () => {
    render(<Message {...BASE_PROPS} isCompact />)
    expect(screen.queryByTestId('message-header')).not.toBeInTheDocument()
  })

  it('renders message content even when compact', () => {
    render(<Message {...BASE_PROPS} isCompact />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })
})

describe('Message — reply quote', () => {
  const msgWithReply: MessageWithProfile = {
    ...BASE_MSG,
    replied_to: {
      id: 'msg-0',
      content: 'Original message',
      user_id: 'u3',
      profiles: { username: 'bob', avatar_url: null },
    },
  }

  it('shows reply quote when replied_to is set', () => {
    render(<Message {...BASE_PROPS} msg={msgWithReply} />)
    expect(screen.getByTestId('message-reply-quote')).toBeInTheDocument()
  })

  it('shows quoted username in reply quote', () => {
    render(<Message {...BASE_PROPS} msg={msgWithReply} />)
    expect(screen.getByTestId('message-reply-quote')).toHaveTextContent('@bob')
  })

  it('does not show reply quote when replied_to is null', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.queryByTestId('message-reply-quote')).not.toBeInTheDocument()
  })

  it('calls onJumpToMessage when reply quote is clicked', () => {
    const onJumpToMessage = vi.fn()
    render(<Message {...BASE_PROPS} msg={msgWithReply} />, { jumpToMessage: onJumpToMessage })

    fireEvent.click(screen.getByTestId('message-reply-quote'))

    expect(onJumpToMessage).toHaveBeenCalledWith('msg-0')
  })
})

describe('Message — mobile thread entry', () => {
  it('shows a visible mobile thread affordance for root messages with no replies', () => {
    render(<Message {...BASE_PROPS} />)

    expect(screen.getByTestId('mobile-action-reply-thread')).toHaveTextContent('Thread')
  })

  it('opens the thread from the mobile thread affordance', () => {
    const openThread = vi.fn()
    render(<Message {...BASE_PROPS} />, { openThread })

    fireEvent.click(screen.getByTestId('mobile-action-reply-thread'))

    expect(openThread).toHaveBeenCalledWith('msg-1')
  })

  it('hides the mobile thread affordance for thread reply messages', () => {
    const threadReply: MessageWithProfile = { ...BASE_MSG, thread_root_id: 'root-1' }

    render(<Message {...BASE_PROPS} msg={threadReply} />)

    expect(screen.queryByTestId('mobile-action-reply-thread')).not.toBeInTheDocument()
  })

  it('hides the mobile thread affordance when replies are disabled', () => {
    render(<Message {...BASE_PROPS} allowReplies={false} />)

    expect(screen.queryByTestId('mobile-action-reply-thread')).not.toBeInTheDocument()
  })
})

describe('Message — edit mode', () => {
  it('shows edit textarea when editingId matches msg.id', () => {
    render(<Message {...BASE_PROPS} editingId="msg-1" editContent="Hello world" />)
    expect(screen.getByTestId('message-edit-textarea')).toBeInTheDocument()
  })

  it('edit textarea has current editContent value', () => {
    render(<Message {...BASE_PROPS} editingId="msg-1" editContent="Edited text" />)
    expect(screen.getByTestId('message-edit-textarea')).toHaveValue('Edited text')
  })

  it('hides edit textarea when editingId is null', () => {
    render(<Message {...BASE_PROPS} editingId={null} />)
    expect(screen.queryByTestId('message-edit-textarea')).not.toBeInTheDocument()
  })

  it('hides edit textarea when editingId does not match', () => {
    render(<Message {...BASE_PROPS} editingId="msg-other" />)
    expect(screen.queryByTestId('message-edit-textarea')).not.toBeInTheDocument()
  })
})

describe('Message — edited marker', () => {
  it('shows (edited) marker when edited_at is set', () => {
    const msg: MessageWithProfile = { ...BASE_MSG, edited_at: '2024-01-15T10:05:00Z' }
    render(<Message {...BASE_PROPS} msg={msg} />)
    expect(screen.getByText('(edited)')).toBeInTheDocument()
  })

  it('does not show (edited) marker when edited_at is null', () => {
    render(<Message {...BASE_PROPS} />)
    expect(screen.queryByText('(edited)')).not.toBeInTheDocument()
  })
})

describe('Message — edit keyboard shortcuts', () => {
  it('calls onSubmitEdit with msg.id when Enter pressed in edit textarea', () => {
    const onSubmitEdit = vi.fn()
    render(<Message {...BASE_PROPS} isOwn editingId="msg-1" editContent="edited text" />, { submitEdit: onSubmitEdit })
    fireEvent.keyDown(screen.getByTestId('message-edit-textarea'), { key: 'Enter', shiftKey: false })
    expect(onSubmitEdit).toHaveBeenCalledWith('msg-1', 'edited text')
    expect(onSubmitEdit).toHaveBeenCalledTimes(1)
  })

  it('does not call onSubmitEdit when Shift+Enter pressed', () => {
    const onSubmitEdit = vi.fn()
    render(<Message {...BASE_PROPS} isOwn editingId="msg-1" editContent="edited text" />, { submitEdit: onSubmitEdit })
    fireEvent.keyDown(screen.getByTestId('message-edit-textarea'), { key: 'Enter', shiftKey: true })
    expect(onSubmitEdit).not.toHaveBeenCalled()
  })

  it('calls onCancelEdit when Escape pressed', () => {
    const onCancelEdit = vi.fn()
    render(<Message {...BASE_PROPS} isOwn editingId="msg-1" editContent="edited text" />, { cancelEdit: onCancelEdit })
    fireEvent.keyDown(screen.getByTestId('message-edit-textarea'), { key: 'Escape' })
    expect(onCancelEdit).toHaveBeenCalled()
  })
})
