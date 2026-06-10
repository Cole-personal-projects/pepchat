import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

describe('renderMarkdown — Discord polish', () => {
  it('renders ||spoiler|| as a hidden span', () => {
    const html = renderMarkdown('the killer is ||the butler||!')
    expect(html).toContain('class="spoiler"')
    expect(html).toContain('the butler')
  })

  it('renders formatting inside spoilers', () => {
    const html = renderMarkdown('||**secret** plans||')
    expect(html).toContain('class="spoiler"')
    expect(html).toContain('<strong>secret</strong>')
  })

  it('leaves single pipes alone', () => {
    const html = renderMarkdown('a | b | c')
    expect(html).not.toContain('class="spoiler"')
  })

  it('preserves unordered and ordered lists through sanitization', () => {
    const unordered = renderMarkdown('- one\n- two')
    expect(unordered).toContain('<ul')
    expect(unordered).toContain('<li>one</li>')

    const ordered = renderMarkdown('1. first\n2. second')
    expect(ordered).toContain('<ol')
    expect(ordered).toContain('<li>first</li>')
  })

  it('still renders fenced code blocks with language labels', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('ts')
    expect(html).toContain('const x = 1')
    expect(html).toContain('<pre')
  })

  it('still strips dangerous markup', () => {
    const html = renderMarkdown('||<script>alert(1)</script>||')
    expect(html).not.toContain('<script>')
  })
})
