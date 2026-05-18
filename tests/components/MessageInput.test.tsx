import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageInput from '@/components/chat/MessageInput'
import { MESSAGE, PROFILE_A } from '@/tests/fixtures'

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/app/(app)/messages/actions', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/klipy', () => ({
  registerShare: vi.fn(),
}))

vi.mock('@/lib/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    pendingImages: [],
    inputError: '',
    addFiles: vi.fn(),
    removeImage: vi.fn(),
    retryUpload: vi.fn(),
    clearAll: vi.fn(),
    hasUploading: false,
    attachments: [],
  }),
}))

const mockChannel = vi.fn().mockReturnThis()
const mockOn = vi.fn().mockReturnThis()
const mockSubscribe = vi.fn().mockReturnThis()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({
            data: [
              { profiles: { id: 'user-b', username: 'bob', display_name: 'Bob' } },
              { profiles: { id: 'user-c', username: 'carol', display_name: 'Carol' } },
            ],
          }),
        }),
      }),
    }),
    channel: mockChannel,
    on: mockOn,
    subscribe: mockSubscribe,
    removeChannel: vi.fn(),
  }),
}))

const BASE_PROPS = {
  channelId: 'channel-1',
  channelName: 'general',
  profile: PROFILE_A,
}

describe('MessageInput draft persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads a saved draft for the current channel', () => {
    window.localStorage.setItem('sidebar:draft:channel-1', 'Saved channel draft')

    render(<MessageInput {...BASE_PROPS} />)

    expect(screen.getByTestId('message-input-textarea')).toHaveValue('Saved channel draft')
  })

  it('pads the composer above mobile safe areas', () => {
    const { container } = render(<MessageInput {...BASE_PROPS} />)

    expect(container.firstElementChild).toHaveStyle({
      padding: '0 16px calc(14px + env(safe-area-inset-bottom, 0px))',
    })
  })

  it('saves typed drafts per channel', () => {
    render(<MessageInput {...BASE_PROPS} />)

    fireEvent.change(screen.getByTestId('message-input-textarea'), {
      target: { value: 'Remember this thought' },
    })

    expect(window.localStorage.getItem('sidebar:draft:channel-1')).toBe('Remember this thought')
  })

  it('uses a provided draft storage key', () => {
    render(<MessageInput {...BASE_PROPS} draftStorageKey="sidebar:draft:channel:channel-1" />)

    fireEvent.change(screen.getByTestId('message-input-textarea'), {
      target: { value: 'Scoped draft' },
    })

    expect(window.localStorage.getItem('sidebar:draft:channel:channel-1')).toBe('Scoped draft')
    expect(window.localStorage.getItem('sidebar:draft:channel-1')).toBeNull()
  })

  it('clears the draft after a successful send', async () => {
    const sendAction = vi.fn().mockResolvedValue({ ok: true, message: MESSAGE })
    render(<MessageInput {...BASE_PROPS} sendAction={sendAction} />)

    fireEvent.change(screen.getByTestId('message-input-textarea'), {
      target: { value: 'Ship this message' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(sendAction).toHaveBeenCalledWith('Ship this message', null, [])
      expect(window.localStorage.getItem('sidebar:draft:channel-1')).toBeNull()
    })
    expect(screen.getByTestId('message-input-textarea')).toHaveValue('')
  })

  it('shows an error instead of crashing when sending returns no result', async () => {
    const sendAction = vi.fn().mockResolvedValue(undefined)
    render(<MessageInput {...BASE_PROPS} sendAction={sendAction} />)

    fireEvent.change(screen.getByTestId('message-input-textarea'), {
      target: { value: 'This should fail gracefully' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Message failed to send. Please try again.')).toBeInTheDocument()
  })

  it('clears a typed draft from the composer', () => {
    render(<MessageInput {...BASE_PROPS} />)

    const textarea = screen.getByTestId('message-input-textarea')
    fireEvent.change(textarea, {
      target: { value: 'Do not send this' },
    })

    expect(window.localStorage.getItem('sidebar:draft:channel-1')).toBe('Do not send this')

    fireEvent.click(screen.getByTestId('message-input-clear-draft'))

    expect(textarea).toHaveValue('')
    expect(window.localStorage.getItem('sidebar:draft:channel-1')).toBeNull()
    expect(screen.queryByTestId('message-input-clear-draft')).not.toBeInTheDocument()
    expect(textarea).toHaveFocus()
  })

  it('throttles typing notifications while text changes quickly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const onTyping = vi.fn()
    render(<MessageInput {...BASE_PROPS} onTyping={onTyping} />)

    const textarea = screen.getByTestId('message-input-textarea')
    fireEvent.change(textarea, { target: { value: 'h' } })
    fireEvent.change(textarea, { target: { value: 'he' } })

    expect(onTyping).toHaveBeenCalledTimes(1)

    vi.setSystemTime(3_499)
    fireEvent.change(textarea, { target: { value: 'hel' } })

    expect(onTyping).toHaveBeenCalledTimes(1)

    vi.setSystemTime(3_500)
    fireEvent.change(textarea, { target: { value: 'hell' } })

    expect(onTyping).toHaveBeenCalledTimes(2)
  })

  it('suggests group members while typing a mention', async () => {
    render(<MessageInput {...BASE_PROPS} groupId="group-1" />)

    fireEvent.change(screen.getByTestId('message-input-textarea'), {
      target: { value: 'hello @b' },
    })

    expect(await screen.findByTestId('mention-suggestions')).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
  })
})
