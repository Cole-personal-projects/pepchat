import { NextResponse, type NextRequest } from 'next/server'
import { hasEmbedContent, isUnfurlableUrl, parseEmbed, youtubeId } from '@/lib/embeds/unfurl'

export const runtime = 'edge'

const FETCH_TIMEOUT_MS = 4000
const MAX_BYTES = 512 * 1024 // only the <head> matters; cap the read

function json(body: unknown, status = 200, cache = false) {
  return NextResponse.json(body, {
    status,
    headers: cache
      ? { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' }
      : { 'cache-control': 'no-store' },
  })
}

/**
 * Link unfurl proxy: fetches a user-supplied URL server-side and returns
 * sanitized Open Graph metadata. SSRF-guarded (lib/embeds/unfurl validates
 * the host; redirects are not followed across origins) and edge-cached.
 */
export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')
  if (!target || !isUnfurlableUrl(target)) {
    return json({ error: 'Invalid URL.' }, 400)
  }

  // YouTube embeds derive entirely from the URL — skip the page fetch
  // (faster, immune to bot-blocking, and works without outbound network).
  if (youtubeId(target)) {
    return json({ embed: parseEmbed(target, '') }, 200, true)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        // Identify as a link-preview bot; ask for HTML only.
        'user-agent': 'pepchat-linkbot/1.0 (+https://pepchat-app.pages.dev)',
        accept: 'text/html,application/xhtml+xml',
      },
    })

    // A redirect could point at an internal host — re-validate and bounce the
    // client to fetch the new location rather than following it ourselves.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        const next = new URL(location, target).toString()
        return json({ redirect: isUnfurlableUrl(next) ? next : null }, 200)
      }
      return json({ error: 'Unresolvable redirect.' }, 422)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) {
      return json({ embed: null }, 200, true)
    }

    const reader = response.body?.getReader()
    if (!reader) return json({ embed: null }, 200, true)

    const decoder = new TextDecoder()
    let html = ''
    let received = 0
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>')) break // metadata lives in <head>
    }
    await reader.cancel().catch(() => {})

    const embed = parseEmbed(target, html)
    return json({ embed: hasEmbedContent(embed) ? embed : null }, 200, true)
  } catch {
    return json({ embed: null }, 200)
  } finally {
    clearTimeout(timeout)
  }
}
