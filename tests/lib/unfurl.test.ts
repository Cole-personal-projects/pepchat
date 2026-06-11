import { describe, it, expect } from 'vitest'
import {
  firstUrl,
  hasEmbedContent,
  isUnfurlableUrl,
  parseEmbed,
  youtubeId,
} from '@/lib/embeds/unfurl'

describe('isUnfurlableUrl — SSRF guard', () => {
  it('allows public http(s) URLs', () => {
    expect(isUnfurlableUrl('https://example.com/article')).toBe(true)
    expect(isUnfurlableUrl('http://news.ycombinator.com')).toBe(true)
  })

  it('rejects non-http protocols and credentialed URLs', () => {
    expect(isUnfurlableUrl('ftp://example.com')).toBe(false)
    expect(isUnfurlableUrl('javascript:alert(1)')).toBe(false)
    expect(isUnfurlableUrl('file:///etc/passwd')).toBe(false)
    expect(isUnfurlableUrl('https://user:pass@example.com')).toBe(false)
    expect(isUnfurlableUrl('not a url')).toBe(false)
  })

  it('blocks loopback and private hostnames', () => {
    expect(isUnfurlableUrl('http://localhost:3000')).toBe(false)
    expect(isUnfurlableUrl('http://app.local')).toBe(false)
    expect(isUnfurlableUrl('http://service.internal')).toBe(false)
    expect(isUnfurlableUrl('http://metadata.google.internal')).toBe(false)
  })

  it('blocks private and metadata IPv4 ranges', () => {
    expect(isUnfurlableUrl('http://127.0.0.1')).toBe(false)
    expect(isUnfurlableUrl('http://10.0.0.5')).toBe(false)
    expect(isUnfurlableUrl('http://192.168.1.1')).toBe(false)
    expect(isUnfurlableUrl('http://172.16.0.1')).toBe(false)
    expect(isUnfurlableUrl('http://169.254.169.254')).toBe(false) // AWS metadata
    expect(isUnfurlableUrl('http://100.64.0.1')).toBe(false) // CGNAT
    expect(isUnfurlableUrl('http://0.0.0.0')).toBe(false)
  })

  it('allows public IPv4', () => {
    expect(isUnfurlableUrl('http://8.8.8.8')).toBe(true)
    expect(isUnfurlableUrl('http://172.32.0.1')).toBe(true) // just outside private range
  })

  it('blocks IPv6 loopback and unique/link-local literals', () => {
    expect(isUnfurlableUrl('http://[::1]')).toBe(false)
    expect(isUnfurlableUrl('http://[fc00::1]')).toBe(false)
    expect(isUnfurlableUrl('http://[fe80::1]')).toBe(false)
  })
})

describe('firstUrl', () => {
  it('extracts the first link and trims trailing punctuation', () => {
    expect(firstUrl('see https://example.com/page. thanks')).toBe('https://example.com/page')
    expect(firstUrl('(https://example.com)')).toBe('https://example.com')
  })

  it('returns null when there is no link', () => {
    expect(firstUrl('just some text')).toBeNull()
  })
})

describe('youtubeId', () => {
  it('parses watch, youtu.be, shorts and embed URLs', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube and malformed ids', () => {
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeId('https://youtu.be/short')).toBeNull()
  })
})

describe('parseEmbed', () => {
  const HTML = `
    <html><head>
      <meta property="og:title" content="Example &amp; Title" />
      <meta property="og:description" content="A description here" />
      <meta property="og:image" content="https://cdn.example.com/img.png" />
      <meta property="og:site_name" content="Example Site" />
      <title>Fallback</title>
    </head></html>`

  it('extracts OG metadata and decodes entities', () => {
    const embed = parseEmbed('https://example.com/x', HTML)
    expect(embed.title).toBe('Example & Title')
    expect(embed.description).toBe('A description here')
    expect(embed.image).toBe('https://cdn.example.com/img.png')
    expect(embed.siteName).toBe('Example Site')
    expect(embed.provider).toBeUndefined()
  })

  it('falls back to the <title> tag', () => {
    const embed = parseEmbed('https://example.com/x', '<html><head><title>Only Title</title></head></html>')
    expect(embed.title).toBe('Only Title')
  })

  it('rejects non-absolute / non-http og:image values', () => {
    const embed = parseEmbed('https://example.com', '<meta property="og:image" content="javascript:alert(1)" />')
    expect(embed.image).toBeNull()
  })

  it('resolves relative og:image against the page URL', () => {
    const embed = parseEmbed('https://example.com/post', '<meta property="og:image" content="/thumb.png" />')
    expect(embed.image).toBe('https://example.com/thumb.png')
  })

  it('recognizes YouTube and builds an inline player', () => {
    const embed = parseEmbed('https://youtu.be/dQw4w9WgXcQ', '<title>Never Gonna Give You Up</title>')
    expect(embed.provider).toBe('youtube')
    expect(embed.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(embed.image).toContain('dQw4w9WgXcQ')
    expect(hasEmbedContent(embed)).toBe(true)
  })

  it('hasEmbedContent is false for an empty document', () => {
    expect(hasEmbedContent(parseEmbed('https://example.com', '<html></html>'))).toBe(false)
  })
})
