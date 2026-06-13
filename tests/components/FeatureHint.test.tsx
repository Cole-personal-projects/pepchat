import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { FeatureHintProvider } from '@/lib/context/FeatureHintContext'
import FeatureHint from '@/components/onboarding/FeatureHint'

// jsdom reports zero-size rects; simulate a visible on-screen anchor.
const VISIBLE_RECT = { top: 100, left: 100, right: 160, bottom: 130, width: 60, height: 30, x: 100, y: 100, toJSON: () => {} } as DOMRect

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(VISIBLE_RECT)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Hint({ id = 'tip-a', priority = 10, enabled = true, label = 'Anchor A' }) {
  return (
    <FeatureHint id={id} priority={priority} enabled={enabled} title={`${id} title`} body={`${id} body`}>
      <button>{label}</button>
    </FeatureHint>
  )
}

describe('FeatureHint', () => {
  it('shows the popover for an unseen hint', async () => {
    render(<FeatureHintProvider><Hint id="tip-a" /></FeatureHintProvider>)
    expect(await screen.findByTestId('feature-hint-tip-a')).toHaveTextContent('tip-a body')
  })

  it('dismissing persists it and hides the popover', async () => {
    render(<FeatureHintProvider><Hint id="tip-a" /></FeatureHintProvider>)
    fireEvent.click(await screen.findByTestId('feature-hint-dismiss-tip-a'))

    await waitFor(() => expect(screen.queryByTestId('feature-hint-tip-a')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('pep:hint-seen:tip-a')).toBe('1')
  })

  it('does not show a hint that was already dismissed', async () => {
    window.localStorage.setItem('pep:hint-seen:tip-a', '1')
    render(<FeatureHintProvider><Hint id="tip-a" /></FeatureHintProvider>)

    await waitFor(() => expect(screen.getByText('Anchor A')).toBeInTheDocument())
    expect(screen.queryByTestId('feature-hint-tip-a')).not.toBeInTheDocument()
  })

  it('shows only one hint at a time, lowest priority first', async () => {
    render(
      <FeatureHintProvider>
        <Hint id="tip-low" priority={5} label="Low" />
        <Hint id="tip-high" priority={50} label="High" />
      </FeatureHintProvider>,
    )

    expect(await screen.findByTestId('feature-hint-tip-low')).toBeInTheDocument()
    expect(screen.queryByTestId('feature-hint-tip-high')).not.toBeInTheDocument()

    // Dismissing the first surfaces the next.
    fireEvent.click(screen.getByTestId('feature-hint-dismiss-tip-low'))
    expect(await screen.findByTestId('feature-hint-tip-high')).toBeInTheDocument()
  })

  it('never registers a disabled hint', async () => {
    render(<FeatureHintProvider><Hint id="tip-a" enabled={false} /></FeatureHintProvider>)
    await waitFor(() => expect(screen.getByText('Anchor A')).toBeInTheDocument())
    expect(screen.queryByTestId('feature-hint-tip-a')).not.toBeInTheDocument()
  })
})
