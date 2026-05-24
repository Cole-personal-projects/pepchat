import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import MessageActionBar from '@/components/chat/MessageActionBar'
import { ChannelMessageActionsProvider, type MessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'
import type React from 'react'

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
  msg: MSG,
  isOwn: false,
  canDeleteAny: false,
  canPin: false,
  allowReactions: true,
  allowReplies: true,
  atReactionLimit: false,
  pickerOpenFor: null as string | null,
}

function render(ui: React.ReactElement, actions: Partial<MessageActions> = {}) {
  return rtlRender(
    <ChannelMessageActionsProvider value={{ ...BASE_ACTIONS, ...actions }}>
      {ui}
    </ChannelMessageActionsProvider>,
  )
}

describe('MessageActionBar — visibility', () => {
  it('renders emoji button when allowReactions=true', () => {
    render(<MessageActionBar {...BASE} />)
    expect(screen.getByTestId('action-react')).toBeInTheDocument()
  })

  it('hides emoji button when allowReactions=false', () => {
    render(<MessageActionBar {...BASE} allowReactions={false} />)
    expect(screen.queryByTestId('action-react')).not.toBeInTheDocument()
  })

  it('renders reply button when allowReplies=true', () => {
    render(<MessageActionBar {...BASE} />)
    expect(screen.getByTestId('action-reply')).toBeInTheDocument()
  })

  it('renders thread reply action for root messages when allowReplies=true', () => {
    render(<MessageActionBar {...BASE} />)
    expect(screen.getByTestId('action-reply-thread')).toHaveAttribute('title', 'Reply in Thread')
  })

  it('hides thread reply action for messages already inside a thread', () => {
    render(<MessageActionBar {...BASE} msg={{ ...MSG, thread_root_id: 'msg-root' } as MessageWithProfile} />)
    expect(screen.queryByTestId('action-reply-thread')).not.toBeInTheDocument()
  })

  it('hides reply button when allowReplies=false', () => {
    render(<MessageActionBar {...BASE} allowReplies={false} />)
    expect(screen.queryByTestId('action-reply')).not.toBeInTheDocument()
  })

  it('shows edit button for own message', () => {
    render(<MessageActionBar {...BASE} isOwn={true} />)
    expect(screen.getByTestId('action-edit')).toBeInTheDocument()
  })

  it('hides edit button for other message', () => {
    render(<MessageActionBar {...BASE} isOwn={false} />)
    expect(screen.queryByTestId('action-edit')).not.toBeInTheDocument()
  })

  it('shows delete button for own message', () => {
    render(<MessageActionBar {...BASE} isOwn={true} />)
    expect(screen.getByTestId('action-delete')).toBeInTheDocument()
  })

  it('shows delete button when canDeleteAny=true regardless of ownership', () => {
    render(<MessageActionBar {...BASE} isOwn={false} canDeleteAny={true} />)
    expect(screen.getByTestId('action-delete')).toBeInTheDocument()
  })

  it('hides delete button when not own and canDeleteAny=false', () => {
    render(<MessageActionBar {...BASE} isOwn={false} canDeleteAny={false} />)
    expect(screen.queryByTestId('action-delete')).not.toBeInTheDocument()
  })

  it('shows pin button when canPin=true', () => {
    render(<MessageActionBar {...BASE} canPin={true} />)
    expect(screen.getByTestId('action-pin')).toBeInTheDocument()
  })

  it('hides pin button when canPin=false', () => {
    render(<MessageActionBar {...BASE} canPin={false} />)
    expect(screen.queryByTestId('action-pin')).not.toBeInTheDocument()
  })
})

describe('MessageActionBar — callbacks', () => {
  it('calls onPickerToggle with msg.id when emoji button clicked', () => {
    const onPickerToggle = vi.fn()
    render(<MessageActionBar {...BASE} />, { togglePicker: onPickerToggle })
    fireEvent.click(screen.getByTestId('action-react'))
    expect(onPickerToggle).toHaveBeenCalledWith('msg-1')
  })

  it('calls onReply with msg when reply button clicked', () => {
    const onReply = vi.fn()
    render(<MessageActionBar {...BASE} />, { reply: onReply })
    fireEvent.click(screen.getByTestId('action-reply'))
    expect(onReply).toHaveBeenCalledWith(MSG.id)
  })

  it('calls onOpenThread with msg id when thread reply button clicked', () => {
    const onOpenThread = vi.fn()
    render(<MessageActionBar {...BASE} />, { openThread: onOpenThread })
    fireEvent.click(screen.getByTestId('action-reply-thread'))
    expect(onOpenThread).toHaveBeenCalledWith(MSG.id)
  })

  it('calls onStartEdit with msg when edit button clicked', () => {
    const onStartEdit = vi.fn()
    render(<MessageActionBar {...BASE} isOwn={true} />, { startEdit: onStartEdit })
    fireEvent.click(screen.getByTestId('action-edit'))
    expect(onStartEdit).toHaveBeenCalledWith(MSG.id)
  })

  it('calls onDelete with msg.id when delete button clicked', () => {
    const onDelete = vi.fn()
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<MessageActionBar {...BASE} isOwn={true} />, { delete: onDelete })
    fireEvent.click(screen.getByTestId('action-delete'))
    expect(onDelete).toHaveBeenCalledWith('msg-1')
    vi.unstubAllGlobals()
  })

  it('calls onPin with msg.id when pin button clicked', () => {
    const onPin = vi.fn()
    render(<MessageActionBar {...BASE} canPin={true} />, { pin: onPin })
    fireEvent.click(screen.getByTestId('action-pin'))
    expect(onPin).toHaveBeenCalledWith('msg-1')
  })

  it('emoji button is disabled and has title when atReactionLimit=true and user has not reacted', () => {
    render(<MessageActionBar {...BASE} atReactionLimit={true} />)
    const btn = screen.getByTestId('action-react')
    expect(btn).toBeDisabled()
  })
})
