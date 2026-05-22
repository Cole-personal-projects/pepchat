import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ChannelMessageActionsProvider,
  useMessageActions,
  type MessageActions,
} from '@/components/chat/MessageActionsContext'

function makeActions(): MessageActions {
  return {
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    changeEditContent: vi.fn(),
    submitEdit: vi.fn(),
    delete: vi.fn(),
    react: vi.fn(),
    reply: vi.fn(),
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
}

function Consumer() {
  const actions = useMessageActions()
  actions.reply('msg-1')
  return <div data-testid="consumer">provided</div>
}

describe('MessageActionsContext', () => {
  it('throws outside ChannelMessageActionsProvider', () => {
    expect(() => render(<Consumer />)).toThrow(
      'useMessageActions must be used inside a <ChannelMessageActionsProvider>',
    )
  })

  it('exposes the provider value to consumers', () => {
    const actions = makeActions()

    render(
      <ChannelMessageActionsProvider value={actions}>
        <Consumer />
      </ChannelMessageActionsProvider>,
    )

    expect(screen.getByTestId('consumer')).toHaveTextContent('provided')
    expect(actions.reply).toHaveBeenCalledWith('msg-1')
  })
})
