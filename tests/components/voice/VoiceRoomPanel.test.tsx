import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceRoomPanel from '@/components/voice/VoiceRoomPanel'
import { startVoiceRoom, getCurrentVoiceRoom, mintVoiceToken, leaveVoiceRoom } from '@/app/(app)/voice/actions'
import { useVoiceRoomConnection } from '@/components/voice/useVoiceRoomConnection'

vi.mock('@/app/(app)/voice/actions', () => ({
  startVoiceRoom: vi.fn(),
  getCurrentVoiceRoom: vi.fn(),
  mintVoiceToken: vi.fn(),
  leaveVoiceRoom: vi.fn(),
}))

vi.mock('@/components/voice/useVoiceRoomConnection', () => ({
  useVoiceRoomConnection: vi.fn(),
}))

const room = {
  id: 'voice-room-1',
  channelId: 'channel-1',
  groupId: 'group-1',
  status: 'open' as const,
  participantCount: 0,
}

function mockConnection(overrides = {}) {
  const connection = {
    status: 'idle',
    muted: false,
    error: null,
    connect: vi.fn().mockResolvedValue({ ok: true }),
    leave: vi.fn().mockResolvedValue(undefined),
    toggleMute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  vi.mocked(useVoiceRoomConnection).mockReturnValue(connection as ReturnType<typeof useVoiceRoomConnection>)
  return connection
}

function renderPanel(role: 'admin' | 'moderator' | 'user' | 'noob' = 'admin') {
  return render(
    <VoiceRoomPanel
      channelId="channel-1"
      channelName="general"
      userRole={role}
      profileId="profile-1"
      userId="user-1"
    />,
  )
}

describe('VoiceRoomPanel', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_VOICE_ROOMS', 'true')
    vi.clearAllMocks()
    mockConnection()
    vi.mocked(startVoiceRoom).mockResolvedValue({ ok: true, room })
    vi.mocked(getCurrentVoiceRoom).mockResolvedValue({ ok: true, room: null })
    vi.mocked(mintVoiceToken).mockResolvedValue({
      ok: true,
      provider: 'livekit',
      livekitUrl: 'wss://voice.example.test',
      token: 'ephemeral-token',
      expiresAt: '2026-05-27T00:00:00.000Z',
    })
    vi.mocked(leaveVoiceRoom).mockResolvedValue({ ok: true })
  })

  it('hides all voice UI when the feature flag is off', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_VOICE_ROOMS', 'false')

    const { container } = renderPanel('admin')

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByLabelText('Voice room')).not.toBeInTheDocument()
  })

  it('shows start control for admins and moderators', () => {
    renderPanel('moderator')

    expect(screen.getByRole('button', { name: 'Start voice room' })).toBeInTheDocument()
  })

  it('does not show start control for regular users', () => {
    renderPanel('user')

    expect(screen.queryByRole('button', { name: 'Start voice room' })).not.toBeInTheDocument()
    expect(screen.getByText('No voice room active.')).toBeInTheDocument()
  })

  it('discovers an open room so an authorized user can join without starting it', async () => {
    const user = userEvent.setup()
    const connection = mockConnection()
    vi.mocked(getCurrentVoiceRoom).mockResolvedValue({ ok: true, room })

    renderPanel('user')

    await user.click(await screen.findByRole('button', { name: 'Join voice' }))

    expect(getCurrentVoiceRoom).toHaveBeenCalledWith('channel-1')
    expect(startVoiceRoom).not.toHaveBeenCalled()
    expect(mintVoiceToken).toHaveBeenCalledWith('voice-room-1')
    expect(connection.connect).toHaveBeenCalledWith({
      livekitUrl: 'wss://voice.example.test',
      token: 'ephemeral-token',
    })
  })

  it('starts a room and mints a token before connecting to LiveKit', async () => {
    const user = userEvent.setup()
    const connection = mockConnection()
    const order: string[] = []
    vi.mocked(mintVoiceToken).mockImplementation(async () => {
      order.push('mint')
      return {
        ok: true,
        provider: 'livekit',
        livekitUrl: 'wss://voice.example.test',
        token: 'ephemeral-token',
        expiresAt: '2026-05-27T00:00:00.000Z',
      }
    })
    connection.connect.mockImplementation(async () => {
      order.push('connect')
      return { ok: true }
    })

    renderPanel('admin')
    await user.click(screen.getByRole('button', { name: 'Start voice room' }))
    await user.click(await screen.findByRole('button', { name: 'Join voice' }))

    expect(startVoiceRoom).toHaveBeenCalledWith('channel-1')
    expect(mintVoiceToken).toHaveBeenCalledWith('voice-room-1')
    expect(connection.connect).toHaveBeenCalledWith({
      livekitUrl: 'wss://voice.example.test',
      token: 'ephemeral-token',
    })
    expect(order).toEqual(['mint', 'connect'])
  })

  it('shows generic copy and does not connect when token minting fails', async () => {
    const user = userEvent.setup()
    const connection = mockConnection()
    vi.mocked(mintVoiceToken).mockResolvedValue({ error: 'specific permission detail' })

    renderPanel('admin')
    await user.click(screen.getByRole('button', { name: 'Start voice room' }))
    await user.click(await screen.findByRole('button', { name: 'Join voice' }))

    expect(connection.connect).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot join this room.')
    expect(screen.queryByText('specific permission detail')).not.toBeInTheDocument()
  })

  it('lets an authorized non-admin join an already-open room discovered from the server', async () => {
    const user = userEvent.setup()
    const connection = mockConnection()
    vi.mocked(getCurrentVoiceRoom).mockResolvedValue({ ok: true, room })

    renderPanel('user')
    await user.click(await screen.findByRole('button', { name: 'Join voice' }))

    expect(startVoiceRoom).not.toHaveBeenCalled()
    expect(getCurrentVoiceRoom).toHaveBeenCalledWith('channel-1')
    expect(mintVoiceToken).toHaveBeenCalledWith('voice-room-1')
    expect(connection.connect).toHaveBeenCalledTimes(1)
  })

  it('does not disconnect locally when the server leave action fails', async () => {
    const user = userEvent.setup()
    const connection = mockConnection({ status: 'connected' })
    vi.mocked(leaveVoiceRoom).mockResolvedValue({ error: 'specific server detail' })

    renderPanel('admin')
    await user.click(screen.getByRole('button', { name: 'Start voice room' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Leave' }))

    expect(leaveVoiceRoom).toHaveBeenCalledWith('voice-room-1')
    expect(connection.leave).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Voice is unavailable.')
    expect(screen.queryByText('specific server detail')).not.toBeInTheDocument()
  })

  it('leaves by calling the server action before disconnecting locally', async () => {
    const user = userEvent.setup()
    const connection = mockConnection({ status: 'connected' })
    const order: string[] = []
    vi.mocked(leaveVoiceRoom).mockImplementation(async () => {
      order.push('server')
      return { ok: true }
    })
    connection.leave.mockImplementation(async () => {
      order.push('local')
    })

    renderPanel('admin')
    await user.click(screen.getByRole('button', { name: 'Start voice room' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Leave' }))

    expect(leaveVoiceRoom).toHaveBeenCalledWith('voice-room-1')
    expect(connection.leave).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['server', 'local'])
  })

  it('toggles the microphone mute control when connected', async () => {
    const user = userEvent.setup()
    const connection = mockConnection({ status: 'connected', muted: false })

    renderPanel('admin')
    await user.click(screen.getByRole('button', { name: 'Start voice room' }))
    await user.click(screen.getByRole('button', { name: 'Mute' }))

    expect(connection.toggleMute).toHaveBeenCalledTimes(1)
  })
})
