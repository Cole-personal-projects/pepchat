'use client'

import { useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import type { Attachment, ImageAttachment, GifAttachment, VideoAttachment, PollAttachment } from '@/lib/types'

const Lightbox = dynamic(() => import('./Lightbox'), { ssr: false })
const PollCard = dynamic(() => import('./PollCard'), { ssr: false })

interface MessageAttachmentsProps {
  attachments: Attachment[]
  /** Needed by poll attachments for the creator-only close control. */
  currentUserId?: string
}

export default function MessageAttachments({ attachments, currentUserId }: MessageAttachmentsProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [gifLightboxIndex, setGifLightboxIndex] = useState<number | null>(null)

  const images = (attachments ?? []).filter((a): a is ImageAttachment => a.type === 'image')
  const gifs = (attachments ?? []).filter((a): a is GifAttachment => a.type === 'gif')
  const videos = (attachments ?? []).filter((a): a is VideoAttachment => a.type === 'video')
  const polls = (attachments ?? []).filter((a): a is PollAttachment => a.type === 'poll')

  if (images.length === 0 && gifs.length === 0 && videos.length === 0 && polls.length === 0) return null

  return (
    <div className="mt-1.5">
      {/* Image attachments */}
      {images.length === 1 && (
        <button
          className="block cursor-zoom-in rounded-lg overflow-hidden border border-white/10 hover:border-white/25 transition-colors"
          onClick={() => setLightboxIndex(0)}
        >
          <Image
            src={images[0].url}
            alt={images[0].name}
            width={images[0].width ?? 800}
            height={images[0].height ?? 600}
            unoptimized
            loading="lazy"
            className="rounded-lg object-contain"
            style={{ maxWidth: 400, maxHeight: 300, width: 'auto', height: 'auto', display: 'block' }}
          />
        </button>
      )}

      {images.length === 2 && (
        <div className="grid grid-cols-2 gap-1" style={{ maxWidth: 400 }}>
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className="relative overflow-hidden rounded-lg border border-white/10 hover:border-white/25 transition-colors cursor-zoom-in"
              style={{ height: 160 }}
            >
              <Image src={img.url} alt={img.name} fill unoptimized loading="lazy" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {images.length === 3 && (
        <div className="grid gap-1" style={{ maxWidth: 400 }}>
          <button
            onClick={() => setLightboxIndex(0)}
            className="relative overflow-hidden rounded-lg border border-white/10 hover:border-white/25 transition-colors cursor-zoom-in"
            style={{ height: 180 }}
          >
            <Image src={images[0].url} alt={images[0].name} fill unoptimized loading="lazy" className="object-cover" />
          </button>
          <div className="grid grid-cols-2 gap-1">
            {images.slice(1).map((img, i) => (
              <button
                key={i + 1}
                onClick={() => setLightboxIndex(i + 1)}
                className="relative overflow-hidden rounded-lg border border-white/10 hover:border-white/25 transition-colors cursor-zoom-in"
                style={{ height: 130 }}
              >
                <Image src={img.url} alt={img.name} fill unoptimized loading="lazy" className="object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {images.length === 4 && (
        <div className="grid grid-cols-2 gap-1" style={{ maxWidth: 400 }}>
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className="relative overflow-hidden rounded-lg border border-white/10 hover:border-white/25 transition-colors cursor-zoom-in"
              style={{ height: 150 }}
            >
              <Image src={img.url} alt={img.name} fill unoptimized loading="lazy" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* GIF attachments */}
      {gifs.map((gif, i) => (
        <div key={i} className={images.length > 0 ? 'mt-2' : ''}>
          <button
            onClick={() => setGifLightboxIndex(i)}
            className="relative inline-block cursor-zoom-in rounded-lg overflow-hidden border border-white/10 hover:border-white/25 transition-colors"
            style={{ maxWidth: 300 }}
          >
            <img
              src={gif.url}
              alt={gif.name}
              loading="lazy"
              className="block rounded-lg h-auto"
              style={{ maxWidth: 400, width: '100%' }}
            />
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-black/60 leading-none">
              GIF
            </span>
          </button>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Powered by Klipy</p>
        </div>
      ))}

      {gifLightboxIndex !== null && (
        <Lightbox
          images={gifs}
          initialIndex={gifLightboxIndex}
          onClose={() => setGifLightboxIndex(null)}
        />
      )}

      {polls.map(poll => (
        <PollCard key={poll.poll_id} pollId={poll.poll_id} currentUserId={currentUserId ?? ''} />
      ))}

      {videos.map((video, i) => (
        <div key={i} className={images.length > 0 || gifs.length > 0 ? 'mt-2' : ''}>
          <video
            src={video.url}
            controls
            preload="metadata"
            className="block rounded-lg border border-white/10 bg-black"
            style={{ maxWidth: 420, width: '100%', maxHeight: 320 }}
          />
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            {video.name} · {Math.round(video.duration)}s
          </p>
        </div>
      ))}
    </div>
  )
}
