'use client'

import { useEffect, useState } from 'react'
import { firstUrl, type LinkEmbed } from '@/lib/embeds/unfurl'

// Module-level cache so re-rendering a channel doesn't re-fetch known links.
const cache = new Map<string, LinkEmbed | null>()
const inflight = new Map<string, Promise<LinkEmbed | null>>()

async function fetchEmbed(url: string): Promise<LinkEmbed | null> {
  if (cache.has(url)) return cache.get(url) ?? null
  const existing = inflight.get(url)
  if (existing) return existing

  const promise = (async () => {
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      if (!res.ok) return null
      const data = (await res.json()) as { embed?: LinkEmbed | null; redirect?: string | null }
      // One hop: a server-blocked redirect resolves to a safe target.
      if (data.redirect) {
        const hop = await fetch(`/api/unfurl?url=${encodeURIComponent(data.redirect)}`)
        if (!hop.ok) return null
        const hopData = (await hop.json()) as { embed?: LinkEmbed | null }
        return hopData.embed ?? null
      }
      return data.embed ?? null
    } catch {
      return null
    }
  })()

  inflight.set(url, promise)
  const result = await promise
  cache.set(url, result)
  inflight.delete(url)
  return result
}

/**
 * Resolves the first link in a message into an Open Graph embed. Returns null
 * until a usable embed is available; failures and content-free links stay null
 * so the card simply never appears.
 */
export function useLinkEmbed(content: string | null | undefined): LinkEmbed | null {
  const url = content ? firstUrl(content) : null
  const [embed, setEmbed] = useState<LinkEmbed | null>(() => (url ? cache.get(url) ?? null : null))

  useEffect(() => {
    if (!url) {
      setEmbed(null)
      return
    }
    let cancelled = false
    setEmbed(cache.get(url) ?? null)
    void fetchEmbed(url).then((result) => {
      if (!cancelled) setEmbed(result)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return embed
}
