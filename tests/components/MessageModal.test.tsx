import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import MessageModal from '@/components/chat/MessageModal'
import { ChannelMessageActionsProvider, type MessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'
import type React from 'react'

vi.mock('next/dynamic', () => ({
  default: (_fn: unknown, _opts?: unknown) => {
    const MockPicker = ({ onSelect }: { onSelect: (emoji: string) => void; closeModal: () => void }) => (
      <button data-testid="mock-full-picker-emoji" onClick={() => onSelect('🔥')}>🔥</button>
    )
    MockPicker.displayName = 'MockEmojiPickerPopover'
    return MockPicker
  },
}))

const MSG: MessageWithProfile = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'u1',
  content: 'Hello world',
  reply_to_id: null,
  edited_at: null,
  created_at: '2024-01-01T12:00:00Z',
  attachments: [],
  profiles: { username: 'alice', avatar_url: null, display_name: 'Alice' },
  reactions: [],
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

const BASE = {
  open: true,
  msg: MSG,
  isOwn: false,
  canDeleteAny: false,
  canPin: false,
  allowReactions: true,
  allowReplies: true,
  closeModal: vi.fn(),
}

function render(ui: React.ReactElement, actions: Partial<MessageActions> = {}) {
  return rtlRender(
    <ChannelMessageActionsProvider value={{ ...BASE_ACTIONS, ...actions }}>
      {ui}
    </ChannelMessageActionsProvider>,
  )
}

describe('MessageModal — rendering', () => {
  it('renders nothing when open=false', () => {
    render(<MessageModal {...BASE} open={false} />)
    expect(screen.queryByTestId('message-modal')).not.toBeInTheDocument()
  })

  it('renders the sheet when open=true', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('message-modal')).toBeInTheDocument()
  })

  it('shows a preview of the message content', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('modal-message-preview')).toHaveTextContent('Hello world')
  })

  it('renders nothing when msg is null', () => {
    render(<MessageModal {...BASE} msg={null} />)
    expect(screen.queryByTestId('message-modal')).not.toBeInTheDocument()
  })
})

describe('MessageModal — quick reactions', () => {
  it('renders quick reaction buttons when allowReactions=true', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('quick-reactions')).toBeInTheDocument()
  })

  it('hides quick reactions when allowReactions=false', () => {
    render(<MessageModal {...BASE} allowReactions={false} />)
    expect(screen.queryByTestId('quick-reactions')).not.toBeInTheDocument()
  })

  it('calls onEmojiSelect with msgId and emoji when quick reaction clicked', () => {
    const onEmojiSelect = vi.fn()
    render(<MessageModal {...BASE} />, { react: onEmojiSelect })
    const firstBtn = screen.getAllByTestId(/^quick-react-/)[0]
    fireEvent.click(firstBtn)
    expect(onEmojiSelect).toHaveBeenCalledWith('msg-1', expect.any(String))
  })

  it('calls onClose after quick reaction selected', () => {
    const onClose = vi.fn()
    render(<MessageModal {...BASE} closeModal={onClose} />)
    fireEvent.click(screen.getAllByTestId(/^quick-react-/)[0])
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MessageModal — action rows', () => {
  it('renders Reply action when allowReplies=true', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('modal-action-reply')).toBeInTheDocument()
  })

  it('hides Reply action when allowReplies=false', () => {
    render(<MessageModal {...BASE} allowReplies={false} />)
    expect(screen.queryByTestId('modal-action-reply')).not.toBeInTheDocument()
  })

  it('renders Copy action always', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('modal-action-copy')).toBeInTheDocument()
  })

  it('renders Copy Message Link action always', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('modal-action-copy-link')).toBeInTheDocument()
  })

  it('renders Edit action for own message', () => {
    render(<MessageModal {...BASE} isOwn={true} />)
    expect(screen.getByTestId('modal-action-edit')).toBeInTheDocument()
  })

  it('hides Edit action for other message', () => {
    render(<MessageModal {...BASE} isOwn={false} />)
    expect(screen.queryByTestId('modal-action-edit')).not.toBeInTheDocument()
  })

  it('renders Delete action for own message', () => {
    render(<MessageModal {...BASE} isOwn={true} />)
    expect(screen.getByTestId('modal-action-delete')).toBeInTheDocument()
  })

  it('renders Delete action when canDeleteAny=true', () => {
    render(<MessageModal {...BASE} isOwn={false} canDeleteAny={true} />)
    expect(screen.getByTestId('modal-action-delete')).toBeInTheDocument()
  })

  it('hides Delete action when not own and canDeleteAny=false', () => {
    render(<MessageModal {...BASE} isOwn={false} canDeleteAny={false} />)
    expect(screen.queryByTestId('modal-action-delete')).not.toBeInTheDocument()
  })

  it('renders Pin action when canPin=true', () => {
    render(<MessageModal {...BASE} canPin={true} />)
    expect(screen.getByTestId('modal-action-pin')).toBeInTheDocument()
  })

  it('hides Pin action when canPin=false', () => {
    render(<MessageModal {...BASE} canPin={false} />)
    expect(screen.queryByTestId('modal-action-pin')).not.toBeInTheDocument()
  })

  it('renders Mark Unread action when onMarkUnread is provided', () => {
    render(<MessageModal {...BASE} canMarkUnread />)
    expect(screen.getByTestId('modal-action-mark-unread')).toBeInTheDocument()
  })

  it('hides Mark Unread action when onMarkUnread is not provided', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.queryByTestId('modal-action-mark-unread')).not.toBeInTheDocument()
  })
})

describe('MessageModal — callbacks', () => {
  it('calls onReply and onClose when Reply clicked', () => {
    const onReply = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} closeModal={onClose} />, { reply: onReply })
    fireEvent.click(screen.getByTestId('modal-action-reply'))
    expect(onReply).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onStartEdit and onClose when Edit clicked', () => {
    const onStartEdit = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} isOwn={true} closeModal={onClose} />, { startEdit: onStartEdit })
    fireEvent.click(screen.getByTestId('modal-action-edit'))
    expect(onStartEdit).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onPin and onClose when Pin clicked', () => {
    const onPin = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} canPin={true} closeModal={onClose} />, { pin: onPin })
    fireEvent.click(screen.getByTestId('modal-action-pin'))
    expect(onPin).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('copies message link and closes when Copy Message Link clicked', () => {
    const writeText = vi.fn()
    const onClose = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })

    render(<MessageModal {...BASE} closeModal={onClose} />)

    fireEvent.click(screen.getByTestId('modal-action-copy-link'))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/channels/ch-1#msg-1`)
    expect(onClose).toHaveBeenCalled()
  })

  it('copies message link with a custom base path', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })

    render(<MessageModal {...BASE} messageLinkBasePath="/dm" />)

    fireEvent.click(screen.getByTestId('modal-action-copy-link'))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dm/ch-1#msg-1`)
  })

  it('calls onMarkUnread and onClose when Mark Unread clicked', () => {
    const onMarkUnread = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} canMarkUnread closeModal={onClose} />, { markUnread: onMarkUnread })

    fireEvent.click(screen.getByTestId('modal-action-mark-unread'))

    expect(onMarkUnread).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn()
    render(<MessageModal {...BASE} closeModal={onClose} />)
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MessageModal — delete confirmation', () => {
  it('shows confirmation step when Delete clicked', () => {
    render(<MessageModal {...BASE} isOwn={true} />)
    fireEvent.click(screen.getByTestId('modal-action-delete'))
    expect(screen.getByTestId('modal-delete-confirm')).toBeInTheDocument()
  })

  it('calls onDelete and onClose when deletion confirmed', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} isOwn={true} closeModal={onClose} />, { delete: onDelete })
    fireEvent.click(screen.getByTestId('modal-action-delete'))
    fireEvent.click(screen.getByTestId('modal-delete-confirm'))
    expect(onDelete).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onDelete when deletion cancelled', () => {
    const onDelete = vi.fn()
    render(<MessageModal {...BASE} isOwn={true} />, { delete: onDelete })
    fireEvent.click(screen.getByTestId('modal-action-delete'))
    fireEvent.click(screen.getByTestId('modal-delete-cancel'))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('returns to action list when deletion cancelled', () => {
    render(<MessageModal {...BASE} isOwn={true} />)
    fireEvent.click(screen.getByTestId('modal-action-delete'))
    fireEvent.click(screen.getByTestId('modal-delete-cancel'))
    expect(screen.queryByTestId('modal-delete-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('modal-action-delete')).toBeInTheDocument()
  })
})

describe('MessageModal — full emoji picker', () => {
  it('renders a "+" more-emoji button in quick reactions', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.getByTestId('quick-react-more')).toBeInTheDocument()
  })

  it('hides the "+" button when allowReactions=false', () => {
    render(<MessageModal {...BASE} allowReactions={false} />)
    expect(screen.queryByTestId('quick-react-more')).not.toBeInTheDocument()
  })

  it('clicking "+" shows the full picker overlay', () => {
    render(<MessageModal {...BASE} />)
    fireEvent.click(screen.getByTestId('quick-react-more'))
    expect(screen.getByTestId('full-emoji-picker-overlay')).toBeInTheDocument()
  })

  it('selecting emoji from full picker calls onEmojiSelect', () => {
    const onEmojiSelect = vi.fn()
    render(<MessageModal {...BASE} />, { react: onEmojiSelect })
    fireEvent.click(screen.getByTestId('quick-react-more'))
    fireEvent.click(screen.getByTestId('mock-full-picker-emoji'))
    expect(onEmojiSelect).toHaveBeenCalledWith('msg-1', '🔥')
  })

  it('selecting emoji from full picker closes modal', () => {
    const onClose = vi.fn()
    render(<MessageModal {...BASE} closeModal={onClose} />)
    fireEvent.click(screen.getByTestId('quick-react-more'))
    fireEvent.click(screen.getByTestId('mock-full-picker-emoji'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MessageModal — report', () => {
  it('shows Report Message action when onReport is provided', () => {
    render(<MessageModal {...BASE} canReport />)
    expect(screen.getByTestId('modal-action-report')).toBeInTheDocument()
  })

  it('hides Report Message action when onReport is not provided', () => {
    render(<MessageModal {...BASE} />)
    expect(screen.queryByTestId('modal-action-report')).not.toBeInTheDocument()
  })

  it('calls onReport with message id and onClose when Report clicked', () => {
    const onReport = vi.fn()
    const onClose = vi.fn()
    render(<MessageModal {...BASE} canReport closeModal={onClose} />, { report: onReport })
    fireEvent.click(screen.getByTestId('modal-action-report'))
    expect(onReport).toHaveBeenCalledWith('msg-1')
    expect(onClose).toHaveBeenCalled()
  })
})
