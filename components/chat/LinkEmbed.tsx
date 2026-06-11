'use client'

import { useState } from 'react'
import { useLinkEmbed } from '@/lib/hooks/useLinkEmbed'

interface LinkEmbedProps {
  content: string
}

/**
 * Rich preview card for the first link in a message: an OG title/description/
 * thumbnail, or an inline player for recognized providers (YouTube). Renders
 * nothing until a usable embed resolves, so plain links stay plain.
 */
export default function LinkEmbed({ content }: LinkEmbedProps) {
  const embed = useLinkEmbed(content)
  const [playing, setPlaying] = useState(false)

  if (!embed) return null

  if (embed.provider === 'youtube' && embed.embedUrl) {
    return (
      <div
        data-testid="link-embed-youtube"
        className="mt-1.5 max-w-md overflow-hidden rounded-lg border border-[var(--border-soft)]"
      >
        <div className="relative aspect-video bg-black">
          {playing ? (
            <iframe
              data-testid="link-embed-iframe"
              src={`${embed.embedUrl}?autoplay=1`}
              title={embed.title ?? 'YouTube video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <button
              type="button"
              data-testid="link-embed-play"
              onClick={() => setPlaying(true)}
              className="group absolute inset-0 flex items-center justify-center"
              aria-label={`Play ${embed.title ?? 'video'}`}
            >
              {embed.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={embed.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-black/70 transition-transform group-hover:scale-110">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          )}
        </div>
        {embed.title && (
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:underline"
          >
            {embed.title}
          </a>
        )}
      </div>
    )
  }

  return (
    <a
      data-testid="link-embed-card"
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 flex max-w-md gap-3 overflow-hidden rounded-lg border-l-[3px] border-[var(--accent)] bg-[var(--bg-secondary)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
    >
      <div className="min-w-0 flex-1">
        {embed.siteName && (
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            {embed.siteName}
          </p>
        )}
        {embed.title && (
          <p className="truncate text-sm font-semibold text-[var(--accent)]">{embed.title}</p>
        )}
        {embed.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{embed.description}</p>
        )}
      </div>
      {embed.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={embed.image}
          alt=""
          className="h-16 w-16 flex-shrink-0 rounded object-cover"
          loading="lazy"
        />
      )}
    </a>
  )
}
