import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PromoteThreadModal from '@/components/chat/PromoteThreadModal'
import { CHANNEL, MESSAGE } from '@/tests/fixtures'
import type { MessageWithProfile } from '@/lib/types'

const promoteThreadToChannelMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/app/(app)/messages/promote-thread-action', () => ({
  promoteThreadToChannel: promoteThreadToChannelMock,
}))

const ROOT_MESSAGE: MessageWithProfile = {
  ...MESSAGE,
  id: 'root-1',
  channel_id: CHANNEL.id,
  content: 'Launch planning thread with extra words',
  thread_root_id: null,
  thread_reply_count: 2,
  thread_last_reply_at: '2024-01-15T12:10:00Z',
}

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  rootMessage: ROOT_MESSAGE,
  sourceChannelName: CHANNEL.name,
  sourceNoobAccess: true,
  replyCount: 2,
}

describe('PromoteThreadModal', () => {
  beforeEach(() => {
    promoteThreadToChannelMock.mockReset()
    pushMock.mockReset()
    BASE_PROPS.onClose.mockReset()
  })

  it('renders defaults from the root message and source channel', () => {
    render(<PromoteThreadModal {...BASE_PROPS} />)

    expect(screen.getByRole('heading', { name: 'Promote Thread' })).toBeInTheDocument()
    expect(screen.getByLabelText('Channel Name')).toHaveValue('launch-planning-thread-with-ex')
    expect(screen.getByRole('checkbox', { name: /visible to new members/i })).toBeChecked()
    expect(screen.getByTestId('promote-thread-summary')).toHaveTextContent('2 replies')
    expect(screen.getByTestId('promote-thread-summary')).toHaveTextContent('#general')
  })

  it('resets the default channel name when reused for another root message', () => {
    const { rerender } = render(<PromoteThreadModal {...BASE_PROPS} />)
    expect(screen.getByLabelText('Channel Name')).toHaveValue('launch-planning-thread-with-ex')

    rerender(
      <PromoteThreadModal
        {...BASE_PROPS}
        rootMessage={{ ...ROOT_MESSAGE, id: 'root-2', content: 'Support escalation follow up' }}
      />
    )

    expect(screen.getByLabelText('Channel Name')).toHaveValue('support-escalation-follow-up')
  })

  it('submits promotion, closes, and navigates to the new channel', async () => {
    promoteThreadToChannelMock.mockResolvedValueOnce({ newChannelId: 'new-channel-id', movedReplyCount: 2 })
    const onPromoted = vi.fn()
    render(<PromoteThreadModal {...BASE_PROPS} onPromoted={onPromoted} />)

    fireEvent.change(screen.getByLabelText('Channel Name'), { target: { value: 'New Channel' } })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Promoted topic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Promote to channel' }))

    await waitFor(() => expect(promoteThreadToChannelMock).toHaveBeenCalledWith({
      rootMessageId: 'root-1',
      channelName: 'new-channel',
      channelTopic: 'Promoted topic',
      noobAccess: true,
    }))
    expect(onPromoted).toHaveBeenCalledWith('new-channel-id', 'new-channel')
    expect(BASE_PROPS.onClose).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/channels/new-channel-id')
  })

  it('surfaces server action errors', async () => {
    promoteThreadToChannelMock.mockResolvedValueOnce({ error: 'Name already exists.' })
    render(<PromoteThreadModal {...BASE_PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: 'Promote to channel' }))

    expect(await screen.findByText('Name already exists.')).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
