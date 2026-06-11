/**
 * Link unfurling: SSRF-guarded URL validation and Open Graph / Twitter Card
 * metadata extraction. Pure and dependency-free so it unit-tests without a
 * network or DOM; the edge route wraps it with fetch + caching.
 */

export interface LinkEmbed {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  /** Set for recognized providers that render inline (e.g. youtube). */
  provider?: 'youtube'
  /** Embeddable player URL for inline providers. */
  embedUrl?: string
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
])

/**
 * Rejects non-http(s) URLs and hosts that resolve to private, loopback,
 * link-local, or cloud-metadata space — the core SSRF guard. DNS rebinding
 * is mitigated at fetch time (the edge route also blocks redirects to new
 * hosts); this catches the obvious literal cases up front.
 */
export function isUnfurlableUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host)) return false
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false

  // IPv4 literal in private / loopback / link-local / unspecified ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number)
    if (ipv4.slice(1).map(Number).some(n => n > 255)) return false
    if (a === 10) return false
    if (a === 127) return false
    if (a === 0) return false
    if (a === 169 && b === 254) return false // link-local + AWS metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  }

  // IPv6 loopback / unique-local / link-local literals.
  if (host === '::1' || host === '::') return false
  if (host.startsWith('fc') || host.startsWith('fd')) return false // unique local fc00::/7
  if (host.startsWith('fe80')) return false // link-local
  if (host.startsWith('::ffff:')) return false // IPv4-mapped

  return true
}

/** Returns the first http(s) URL in message text, or null. */
export function firstUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s<>()]+/i)
  if (!match) return null
  // Trim trailing punctuation that commonly hugs a pasted URL.
  return match[0].replace(/[.,;:!?)\]]+$/, '')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeEntities(match[1].trim())
  }
  return null
}

function metaFor(html: string, property: string): string | null {
  // Matches both attribute orders: content-before-property and after.
  return metaContent(html, [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ])
}

/** YouTube video id from watch / youtu.be / shorts / embed URLs. */
export function youtubeId(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1)
    return /^[\w-]{11}$/.test(id) ? id : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v')
      return id && /^[\w-]{11}$/.test(id) ? id : null
    }
    const seg = parsed.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)
    if (seg) return seg[1]
  }
  return null
}

/**
 * Builds a LinkEmbed from a fetched HTML document. Title falls back to the
 * <title> tag; the YouTube provider is recognized from the URL so the player
 * renders inline regardless of OG completeness.
 */
export function parseEmbed(url: string, html: string): LinkEmbed {
  const title =
    metaFor(html, 'og:title') ??
    metaFor(html, 'twitter:title') ??
    metaContent(html, [/<title[^>]*>([^<]*)<\/title>/i])
  const description = metaFor(html, 'og:description') ?? metaFor(html, 'twitter:description') ?? metaFor(html, 'description')
  const rawImage = metaFor(html, 'og:image') ?? metaFor(html, 'twitter:image') ?? metaFor(html, 'twitter:image:src')
  const siteName = metaFor(html, 'og:site_name')

  // Only allow absolute http(s) images so the card can't smuggle in a
  // javascript:/data: payload via the og:image tag.
  let image: string | null = null
  if (rawImage) {
    try {
      const abs = new URL(rawImage, url)
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.toString()
    } catch {
      image = null
    }
  }

  const ytId = youtubeId(url)
  if (ytId) {
    return {
      url,
      title,
      description,
      image: image ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      siteName: siteName ?? 'YouTube',
      provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
    }
  }

  return { url, title, description, image, siteName }
}

/** True when the embed has at least something worth rendering. */
export function hasEmbedContent(embed: LinkEmbed): boolean {
  return Boolean(embed.title || embed.description || embed.image || embed.provider)
}
