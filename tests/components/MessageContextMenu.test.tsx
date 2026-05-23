import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import MessageContextMenu from '@/components/chat/MessageContextMenu'
import { ChannelMessageActionsProvider, type MessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'
import type React from 'react'

const MSG: MessageWithProfile = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'u1',
  content: 'Hello world',
  created_at: '2024-04-19T12:00:00Z',
  edited_at: null,
  reply_to_id: null,
  pinned_at: null,
  is_system: false,
  system_type: null,
  system_data: null,
  profiles: { username: 'alice', display_name: null, avatar_url: null },
  reactions: [],
  replied_to: null,
  attachments: [],
}

const PINNED_MSG: MessageWithProfile = { ...MSG, pinned_at: '2024-04-19T12:00:00Z' }

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

const defaultProps = {
  message: MSG,
  position: { x: 100, y: 100 },
  isOwn: false,
  canDeleteAny: false,
  canPin: false,
  allowReactions: true,
  allowReplies: true,
  closeMenu: vi.fn(),
}

function render(ui: React.ReactElement, actions: Partial<MessageActions> = {}) {
  return rtlRender(
    <ChannelMessageActionsProvider value={{ ...BASE_ACTIONS, ...actions }}>
      {ui}
    </ChannelMessageActionsProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset portal target
  document.body.innerHTML = ''
})

describe('MessageContextMenu — rendering', () => {
  it('renders with context-menu class', () => {
    render(<MessageContextMenu {...defaultProps} />)
    expect(document.querySelector('.context-menu')).toBeTruthy()
  })

  it('shows 8 quick-reaction buttons', () => {
    render(<MessageContextMenu {...defaultProps} />)
    expect(document.querySelectorAll('.quick-reaction')).toHaveLength(8)
  })

  it('shows Reply when allowReplies is true', () => {
    render(<MessageContextMenu {...defaultProps} />)
    expect(screen.getByText('Reply')).toBeTruthy()
  })

  it('hides Reply when allowReplies is false', () => {
    render(<MessageContextMenu {...defaultProps} allowReplies={false} />)
    expect(screen.queryByText('Reply')).toBeNull()
  })

  it('shows Edit Message for own messages', () => {
    render(<MessageContextMenu {...defaultProps} isOwn={true} />)
    expect(screen.getByText('Edit Message')).toBeTruthy()
  })

  it('hides Edit Message for other users messages', () => {
    render(<MessageContextMenu {...defaultProps} isOwn={false} />)
    expect(screen.queryByText('Edit Message')).toBeNull()
  })

  it('shows Pin Message when canPin and message not pinned', () => {
    render(<MessageContextMenu {...defaultProps} canPin={true} />)
    expect(screen.getByText('Pin Message')).toBeTruthy()
    expect(screen.queryByText('Unpin Message')).toBeNull()
  })

  it('shows Unpin Message when canPin and message is pinned', () => {
    render(<MessageContextMenu {...defaultProps} canPin={true} message={PINNED_MSG} />)
    expect(screen.getByText('Unpin Message')).toBeTruthy()
    expect(screen.queryByText('Pin Message')).toBeNull()
  })

  it('hides Pin/Unpin when canPin is false', () => {
    render(<MessageContextMenu {...defaultProps} canPin={false} message={PINNED_MSG} />)
    expect(screen.queryByText('Pin Message')).toBeNull()
    expect(screen.queryByText('Unpin Message')).toBeNull()
  })

  it('shows Delete for own messages', () => {
    render(<MessageContextMenu {...defaultProps} isOwn={true} />)
    expect(screen.getByText('Delete Message')).toBeTruthy()
  })

  it('shows Delete when canDeleteAny is true', () => {
    render(<MessageContextMenu {...defaultProps} canDeleteAny={true} />)
    expect(screen.getByText('Delete Message')).toBeTruthy()
  })

  it('hides Delete when neither own nor canDeleteAny', () => {
    render(<MessageContextMenu {...defaultProps} isOwn={false} canDeleteAny={false} />)
    expect(screen.queryByText('Delete Message')).toBeNull()
  })

  it('hides Mark Unread when onMarkUnread is not provided', () => {
    render(<MessageContextMenu {...defaultProps} />)
    expect(screen.queryByText('Mark Unread')).toBeNull()
  })
})

describe('MessageContextMenu — dismiss behavior', () => {
  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on mousedown outside menu', () => {
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose on mousedown inside menu', () => {
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} />)
    const menu = document.querySelector('.context-menu')!
    fireEvent.mouseDown(menu)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('MessageContextMenu — actions', () => {
  it('calls onReply and onClose when Reply clicked', () => {
    const onClose = vi.fn()
    const onReply = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} />, { reply: onReply })
    fireEvent.click(screen.getByText('Reply'))
    expect(onReply).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onStartEdit and onClose when Edit clicked', () => {
    const onClose = vi.fn()
    const onStartEdit = vi.fn()
    render(<MessageContextMenu {...defaultProps} isOwn={true} closeMenu={onClose} />, { startEdit: onStartEdit })
    fireEvent.click(screen.getByText('Edit Message'))
    expect(onStartEdit).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onPin and onClose when Pin clicked', () => {
    const onClose = vi.fn()
    const onPin = vi.fn()
    render(<MessageContextMenu {...defaultProps} canPin={true} closeMenu={onClose} />, { pin: onPin })
    fireEvent.click(screen.getByText('Pin Message'))
    expect(onPin).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onPin and onClose when Unpin clicked', () => {
    const onClose = vi.fn()
    const onPin = vi.fn()
    render(<MessageContextMenu {...defaultProps} canPin={true} message={PINNED_MSG} closeMenu={onClose} />, { pin: onPin })
    fireEvent.click(screen.getByText('Unpin Message'))
    expect(onPin).toHaveBeenCalledWith(PINNED_MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onMarkUnread with message and onClose when Mark Unread clicked', () => {
    const onClose = vi.fn()
    const onMarkUnread = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} canMarkUnread />, { markUnread: onMarkUnread })

    fireEvent.click(screen.getByText('Mark Unread'))

    expect(onMarkUnread).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('copies message link with a custom base path', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<MessageContextMenu {...defaultProps} messageLinkBasePath="/dm" />)

    fireEvent.click(screen.getByText('Copy Message Link'))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dm/ch-1#msg-1`)
  })

  it('shows confirm dialog when Delete clicked, then calls onDelete on confirm', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} isOwn={true} closeMenu={onClose} />, { delete: onDelete })
    fireEvent.click(screen.getByText('Delete Message'))
    expect(screen.getByTestId('ctx-delete-confirm-dialog')).toBeTruthy()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ctx-delete-confirm'))
    expect(onDelete).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('hides confirm dialog when Cancel clicked', () => {
    render(<MessageContextMenu {...defaultProps} isOwn={true} />)
    fireEvent.click(screen.getByText('Delete Message'))
    expect(screen.getByTestId('ctx-delete-confirm-dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('ctx-delete-cancel'))
    expect(screen.queryByTestId('ctx-delete-confirm-dialog')).toBeNull()
  })

  it('calls onEmojiSelect with emoji when quick reaction clicked', () => {
    const onEmojiSelect = vi.fn()
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} closeMenu={onClose} />, { react: onEmojiSelect })
    const reactions = document.querySelectorAll('.quick-reaction')
    fireEvent.click(reactions[0])
    expect(onEmojiSelect).toHaveBeenCalledWith(MSG.id, expect.any(String))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('MessageContextMenu — report', () => {
  it('shows Report Message when onReport is provided', () => {
    render(<MessageContextMenu {...defaultProps} canReport />)
    expect(screen.getByText('Report Message')).toBeTruthy()
  })

  it('hides Report Message when onReport is not provided', () => {
    render(<MessageContextMenu {...defaultProps} />)
    expect(screen.queryByText('Report Message')).toBeNull()
  })

  it('calls onReport with message id and onClose when clicked', () => {
    const onReport = vi.fn()
    const onClose = vi.fn()
    render(<MessageContextMenu {...defaultProps} canReport closeMenu={onClose} />, { report: onReport })
    fireEvent.click(screen.getByText('Report Message'))
    expect(onReport).toHaveBeenCalledWith(MSG.id)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('MessageContextMenu — positioning', () => {
  it('renders at the given x/y position', () => {
    render(<MessageContextMenu {...defaultProps} position={{ x: 200, y: 300 }} />)
    const menu = document.querySelector('.context-menu') as HTMLElement
    expect(menu.style.left).toBe('200px')
    expect(menu.style.top).toBe('300px')
  })
})
