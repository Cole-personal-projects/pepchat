import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

// DOMPurify is alias-mocked in vitest.config.ts → tests/__mocks__/dompurify.ts
// The mock strips <script>, on* attributes, and <img> tags.
// marked is the real library — all rendering behavior is exercised against it.

describe('renderMarkdown — inline formatting', () => {
  it('renders bold', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
  })

  it('renders italic', () => {
    expect(renderMarkdown('_italic_')).toContain('<em>italic</em>')
  })

  it('renders strikethrough (GFM)', () => {
    expect(renderMarkdown('~~del~~')).toContain('<del>del</del>')
  })

  it('renders inline code with custom class', () => {
    const html = renderMarkdown('`myFunc()`')
    expect(html).toContain('<code')
    expect(html).toContain('myFunc()')
    expect(html).toContain('bg-zinc-800')
  })
})

describe('renderMarkdown — code blocks', () => {
  it('renders fenced code block with language label', () => {
    const html = renderMarkdown('```typescript\nconst x = 1\n```')
    expect(html).toContain('typescript')
    expect(html).toContain('bg-zinc-900')
    expect(html).toContain('const x = 1')
  })

  it('renders fenced code block without language', () => {
    const html = renderMarkdown('```\nhello\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('hello')
  })

  it('escapes HTML inside code blocks', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('renderMarkdown — links', () => {
  it('renders links with target=_blank and rel=noopener noreferrer', () => {
    const html = renderMarkdown('[click](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('applies indigo styling class to links', () => {
    const html = renderMarkdown('[link](https://example.com)')
    expect(html).toContain('text-indigo-400')
  })

  it('escapes special characters in link href', () => {
    const html = renderMarkdown('[x](https://example.com?a=1&b=2)')
    expect(html).toContain('&amp;')
  })
})

describe('renderMarkdown — disabled elements', () => {
  it('renders headings as plain paragraphs (headings disabled)', () => {
    const html = renderMarkdown('# Big Title')
    expect(html).not.toMatch(/<h[1-6]/)
    expect(html).toContain('<p>')
    expect(html).toContain('Big Title')
  })

  it('renders all heading levels as paragraphs', () => {
    for (let i = 1; i <= 6; i++) {
      const html = renderMarkdown(`${'#'.repeat(i)} heading`)
      expect(html).not.toMatch(/<h[1-6]/)
    }
  })

  it('suppresses horizontal rules', () => {
    const html = renderMarkdown('---')
    expect(html).not.toContain('<hr')
  })

  it('suppresses images (use upload system instead)', () => {
    const html = renderMarkdown('![alt](https://example.com/image.png)')
    // Our DOMPurify mock strips <img> tags; real DOMPurify would too via PURIFY_CONFIG
    expect(html).not.toContain('<img')
  })
})

describe('renderMarkdown — XSS protection', () => {
  it('strips <script> tags', () => {
    const html = renderMarkdown('<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("xss")')
  })

  it('strips inline event handlers', () => {
    const html = renderMarkdown('<a href="x" onerror="alert(1)">click</a>')
    expect(html).not.toContain('onerror')
  })

  it('strips onload attributes', () => {
    const html = renderMarkdown('<img src="x" onload="alert(1)">')
    expect(html).not.toContain('onload')
  })
})

describe('renderMarkdown — plain text', () => {
  it('returns output containing the original text for plain strings', () => {
    const html = renderMarkdown('hello world')
    expect(html).toContain('hello world')
  })

  it('does not crash on empty string', () => {
    expect(() => renderMarkdown('')).not.toThrow()
  })
})

describe('role mention highlighting', () => {
  it('wraps hyphenated role slugs in mention tokens', () => {
    const html = renderMarkdown('calling @group-buy to #general')
    expect(html).toContain('<span class="mention-token">@group-buy</span>')
  })

  it('still wraps plain usernames', () => {
    const html = renderMarkdown('hey @alice')
    expect(html).toContain('<span class="mention-token">@alice</span>')
  })

  it('does not tokenize email addresses', () => {
    const html = renderMarkdown('mail cole@example.com please')
    expect(html).not.toContain('mention-token')
  })
})
