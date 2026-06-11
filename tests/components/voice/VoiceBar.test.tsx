import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VoiceBar from '@/components/voice/VoiceBar'

const BASE = {
  channelName: 'Lounge',
  participantCount: 3,
  muted: false,
  isSpeaking: false,
  activeSpeakerCount: 0,
  busy: false,
  onToggleMute: vi.fn(),
  onLeave: vi.fn(),
}

describe('VoiceBar', () => {
  it('shows the channel name and participant count', () => {
    render(<VoiceBar {...BASE} />)
    expect(screen.getByTestId('voice-bar')).toHaveTextContent('Lounge')
    expect(screen.getByTestId('voice-bar')).toHaveTextContent('3 connected')
  })

  it('reflects the speaking state on the indicator', () => {
    const { rerender } = render(<VoiceBar {...BASE} isSpeaking={false} />)
    expect(screen.getByTestId('voice-bar-speaking')).toHaveAttribute('data-speaking', 'false')
    rerender(<VoiceBar {...BASE} isSpeaking />)
    expect(screen.getByTestId('voice-bar-speaking')).toHaveAttribute('data-speaking', 'true')
  })

  it('surfaces remote speakers in the hint', () => {
    render(<VoiceBar {...BASE} activeSpeakerCount={2} />)
    expect(screen.getByTestId('voice-bar')).toHaveTextContent('2 talking')
  })

  it('toggles mute and leaves', () => {
    const onToggleMute = vi.fn()
    const onLeave = vi.fn()
    render(<VoiceBar {...BASE} onToggleMute={onToggleMute} onLeave={onLeave} />)

    fireEvent.click(screen.getByTestId('voice-bar-mute'))
    expect(onToggleMute).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('voice-bar-leave'))
    expect(onLeave).toHaveBeenCalled()
  })

  it('marks the mute button pressed when muted and disables controls while busy', () => {
    render(<VoiceBar {...BASE} muted busy />)
    expect(screen.getByTestId('voice-bar-mute')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('voice-bar-mute')).toBeDisabled()
    expect(screen.getByTestId('voice-bar-leave')).toBeDisabled()
  })
})
