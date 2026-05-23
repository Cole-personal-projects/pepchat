'use client'

import { useRef, useState, useTransition, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { sendMessage } from '@/app/(app)/messages/actions'
import { sendThreadReply } from '@/app/(app)/messages/thread-actions'
import { useImageUpload } from '@/lib/hooks/useImageUpload'
import { useMentionCandidates } from '@/lib/hooks/useMentionCandidates'
import type { MessageWithProfile, Profile, GifAttachment, Attachment } from '@/lib/types'
import { registerShare } from '@/lib/klipy'
import type { KlipyGif } from '@/lib/klipy'

const GifPicker = dynamic(() => import('./GifPicker'), { ssr: false })

const KLIPY_ENABLED = !!process.env.NEXT_PUBLIC_KLIPY_API_KEY
const TYPING_BROADCAST_INTERVAL_MS = 1500

interface MessageInputProps {
  channelId: string
  groupId?: string
  channelName: string
  profile: Profile
  replyingTo?: MessageWithProfile | null
  onCancelReply?: () => void
  onTyping?: () => void
  onSent?: (message: MessageWithProfile) => void
  placeholder?: string
  draftStorageKey?: string
  allowVideoUpload?: boolean
  mode?: 'channel' | 'thread'
  threadRootId?: string
  /** When provided, called instead of the default sendMessage server action. */
  sendAction?: (content: string, replyToId: string | null, attachments: Attachment[]) => Promise<{ error: string } | { ok: true; message?: MessageWithProfile }>
}

const SEND_FAILURE_MESSAGE = 'Message failed to send. Please try again.'

type SendResult = { error: string } | { ok: true; message?: MessageWithProfile }

function isSendResult(result: unknown): result is SendResult {
  return typeof result === 'object' && result !== null && ('error' in result || 'ok' in result)
}

export default function MessageInput({
  channelId,
  groupId,
  channelName,
  profile,
  replyingTo,
  onCancelReply,
  onTyping,
  onSent,
  placeholder,
  draftStorageKey: providedDraftStorageKey,
  allowVideoUpload = true,
  mode = 'channel',
  threadRootId,
  sendAction,
}: MessageInputProps) {
  const draftStorageKey = providedDraftStorageKey ?? `sidebar:draft:${channelId}`
  const [content, setContent] = useState(() => readDraft(draftStorageKey))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [isDragging, setIsDragging] = useState(false)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [mentionUsers, setMentionUsers] = useState<Array<{ id: string; username: string; display_name?: string | null }>>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gifPickerRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)
  const skipNextDraftWriteRef = useRef(false)
  const lastTypingBroadcastAtRef = useRef(0)

  const { pendingImages, inputError, addFiles, removeImage, retryUpload, clearAll, hasUploading, attachments } =
    useImageUpload({ allowVideo: allowVideoUpload })

  useEffect(() => {
    skipNextDraftWriteRef.current = true
    setContent(readDraft(draftStorageKey))
  }, [draftStorageKey])
  // Fetch mention candidates — extracted to useMentionCandidates hook (Finding 4)
  const { candidates: mentionCandidates } = useMentionCandidates(groupId, profile.id)
  useEffect(() => {
    setMentionUsers(mentionCandidates)
  }, [mentionCandidates])

  useEffect(() => {
    if (skipNextDraftWriteRef.current) {
      skipNextDraftWriteRef.current = false
      return
    }
    writeDraft(draftStorageKey, content)
  }, [content, draftStorageKey])

  // Document-level drag listeners so the overlay covers the whole page
  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      dragCounterRef.current++
      setIsDragging(true)
    }
    function onDragLeave() {
      dragCounterRef.current--
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0
        setIsDragging(false)
      }
    }
    function onDocDrop() {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDocDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDocDrop)
    }
  }, [])

  // Close GIF picker on outside click
  useEffect(() => {
    if (!gifPickerOpen) return
    function onPointerDown(e: MouseEvent) {
      if (gifPickerRef.current && !gifPickerRef.current.contains(e.target as Node)) {
        setGifPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [gifPickerOpen])

  function handleGifSelect(gif: KlipyGif) {
    setGifPickerOpen(false)
    registerShare(gif.id, profile.id) // required by Klipy ToS
    const gifAttachment: GifAttachment = {
      url: gif.file.hd?.gif?.url ?? gif.file.md?.gif?.url,
      type: 'gif',
      name: gif.title ?? gif.slug,
      preview: gif.file.sm?.gif?.url ?? gif.file.md?.gif?.url ?? gif.file.hd?.gif?.url,
      width: gif.file.hd?.gif?.width ?? gif.file.md?.gif?.width ?? 0,
      height: gif.file.hd?.gif?.height ?? gif.file.md?.gif?.height ?? 0,
      source: 'klipy',
    }
    startTransition(async () => {
      const result = await sendSafely(() => sendCurrentMessage('', [gifAttachment]))
      if ('error' in result) {
        setError(result.error ?? '')
      } else {
        textareaRef.current?.focus()
        onCancelReply?.()
        const sentMessage = result.message
        if (sentMessage) onSent?.(sentMessage)
      }
    })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    dragCounterRef.current = 0
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (files.length > 0) addFiles(files, profile.id)
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length === 0) return
    e.preventDefault()
    addFiles(imageFiles, profile.id)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return
    addFiles(e.target.files, profile.id)
    e.target.value = ''
  }

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    setMentionIndex(0)
    setError('')
    autoResize()
    const now = Date.now()
    if (now - lastTypingBroadcastAtRef.current >= TYPING_BROADCAST_INTERVAL_MS) {
      lastTypingBroadcastAtRef.current = now
      onTyping?.()
    }
  }

  function clearDraft() {
    setContent('')
    setError('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (activeMentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(index => (index + 1) % activeMentionSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(index => (index - 1 + activeMentionSuggestions.length) % activeMentionSuggestions.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        applyMention(activeMentionSuggestions[mentionIndex] ?? activeMentionSuggestions[0])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape' && replyingTo) {
      onCancelReply?.()
    }
  }

  function submit() {
    const trimmed = content.trim()
    const hasContent = trimmed.length > 0 || attachments.length > 0
    if (!hasContent || isPending || hasUploading) return
    setError('')
    startTransition(async () => {
      const result = await sendSafely(() => sendCurrentMessage(trimmed, attachments))
      if ('error' in result) {
        setError(result.error ?? '')
      } else {
        removeDraft(draftStorageKey)
        setContent('')
        clearAll()
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        if (window.innerWidth < 768) {
          textareaRef.current?.blur()
        } else {
          textareaRef.current?.focus()
        }
        onCancelReply?.()
        const sentMessage = result.message
        if (sentMessage) onSent?.(sentMessage)
      }
    })
  }

  async function sendSafely(send: () => Promise<unknown>): Promise<SendResult> {
    try {
      const result = await send()
      return isSendResult(result) ? result : { error: SEND_FAILURE_MESSAGE }
    } catch {
      return { error: SEND_FAILURE_MESSAGE }
    }
  }

  function sendCurrentMessage(messageContent: string, messageAttachments: Attachment[]) {
    if (sendAction) return sendAction(messageContent, replyingTo?.id ?? null, messageAttachments)
    if (mode === 'thread') {
      if (!threadRootId) return Promise.resolve({ error: 'Missing thread root.' })
      return sendThreadReply({ rootId: threadRootId, content: messageContent, attachments: messageAttachments })
    }
    return sendMessage(channelId, messageContent, replyingTo?.id, messageAttachments)
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !isPending && !hasUploading
  const inputPlaceholder = replyingTo
    ? `Reply to @${replyingTo.profiles?.username}…`
    : (placeholder ?? (mode === 'thread' ? 'Reply…' : `Message #${channelName}`))
  const activeMention = findActiveMention(content)
  const activeMentionSuggestions = activeMention
    ? mentionUsers
        .filter(user => user.username.toLowerCase().startsWith(activeMention.query.toLowerCase()))
        .slice(0, 5)
    : []

  function applyMention(user: { username: string }) {
    if (!activeMention) return
    const nextContent = `${content.slice(0, activeMention.start)}@${user.username} ${content.slice(activeMention.end)}`
    setContent(nextContent)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const cursor = activeMention.start + user.username.length + 2
      textareaRef.current?.setSelectionRange(cursor, cursor)
      autoResize()
    })
  }

  return (
    <div
      className="flex-shrink-0"
      style={{ padding: '0 16px calc(14px + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Full-viewport drag-and-drop overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.65)', outline: '3px dashed var(--accent)', outlineOffset: '-12px' }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <p className="text-2xl font-semibold text-white pointer-events-none select-none">
            Drop image here
          </p>
        </div>
      )}

      {/* Reply preview bar */}
      {replyingTo && (
        <div
          className="flex items-center gap-2 px-3 py-2 mb-1 rounded-t-lg border-l-2 border-[var(--accent)]"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <svg className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span className="text-xs text-[var(--text-muted)]">
            Replying to{' '}
            <span className="font-semibold text-[var(--accent)]">
              @{replyingTo.profiles?.username}
            </span>
          </span>
          <span className="flex-1 text-xs text-[var(--text-muted)] truncate opacity-70">
            {replyingTo.content.length > 80 ? replyingTo.content.slice(0, 80) + '…' : replyingTo.content}
          </span>
          <button
            onClick={onCancelReply}
            title="Cancel reply (Esc)"
            className="flex-shrink-0 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {(error || inputError) && (
        <p className="text-xs text-[var(--danger)] mb-1.5 px-1">{error || inputError}</p>
      )}

      <div
        className={`flex flex-col ${replyingTo ? 'rounded-b-[14px]' : 'rounded-[14px]'}`}
        style={{
          background: 'var(--bg-composer)',
          border: '1px solid var(--border-soft)',
          transition: 'border-color 120ms ease',
        }}
        onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
        onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border-soft)')}
      >
        {/* Textarea row */}
        <div className="flex items-end gap-2 px-3 py-2.5 relative">
          {activeMentionSuggestions.length > 0 && (
            <div
              className="absolute bottom-full left-10 mb-2 max-h-48 w-64 overflow-y-auto rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-1 shadow-xl"
              data-testid="mention-suggestions"
            >
              {activeMentionSuggestions.map((user, index) => (
                <button
                  key={user.id}
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault()
                    applyMention(user)
                  }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                    index === mentionIndex ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>@{user.username}</span>
                  {user.display_name && <span className="truncate pl-2 text-xs opacity-70">{user.display_name}</span>}
                </button>
              ))}
            </div>
          )}
          {/* Paperclip / attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image or video"
            className="flex-shrink-0 p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />

          {/* GIF picker button */}
          {KLIPY_ENABLED && (
            <div ref={gifPickerRef} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setGifPickerOpen(o => !o)}
                title="Send a GIF"
                className={`p-1.5 rounded text-xs font-bold leading-none transition-colors ${
                  gifPickerOpen
                    ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10'
                }`}
              >
                GIF
              </button>
              {gifPickerOpen && (
                <GifPicker onSelect={handleGifSelect} onClose={() => setGifPickerOpen(false)} />
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            data-testid="message-input-textarea"
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={inputPlaceholder}
            disabled={isPending}
            rows={1}
            className="composer-input flex-1 text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none leading-relaxed disabled:opacity-50"
            style={{ maxHeight: 200 }}
          />
          {content.length > 0 && (
            <button
              type="button"
              data-testid="message-input-clear-draft"
              onClick={clearDraft}
              disabled={isPending}
              title="Clear draft"
              aria-label="Clear message draft"
              className="flex-shrink-0 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            onClick={submit}
            disabled={!canSend}
            title="Send message"
            style={{
              padding: '6px 12px',
              background: canSend ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: canSend ? '#fff' : 'var(--text-faint)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontWeight: 600,
              cursor: canSend ? 'pointer' : 'default',
              transition: 'background 120ms ease, color 120ms ease',
              flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>

        {/* Image preview strip */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 px-3 pb-3 flex-wrap">
            {pendingImages.map(img => {
              const isVideo = img.file.type.startsWith('video/')
              return (
              <div key={img.id} className="relative flex-shrink-0" style={{ width: 72, height: 72 }}>
                {isVideo ? (
                  <video
                    src={img.localUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full h-full object-cover rounded-lg border border-white/20 bg-black"
                  />
                ) : (
                  <img
                    src={img.localUrl}
                    alt={img.file.name}
                    className="w-full h-full object-cover rounded-lg border border-white/20"
                  />
                )}

                {img.state === 'uploading' && (
                  <div className="absolute inset-0 rounded-lg bg-black/55 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}

                {img.state === 'done' && (
                  <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center pointer-events-none">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}

                {img.state === 'error' && (
                  <div className="absolute inset-0 rounded-lg bg-red-900/65 flex items-center justify-center">
                    <button
                      onClick={() => retryUpload(img.id, profile.id)}
                      title={img.error ?? 'Retry upload'}
                      className="text-white text-base bg-black/40 rounded px-2 py-0.5 hover:bg-black/60"
                    >
                      ↺
                    </button>
                  </div>
                )}

                {/* Remove button */}
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--bg-primary)] border border-white/20 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-1 px-1">
        <p className="text-[10px] text-[var(--text-muted)]">
          Enter to send · Shift+Enter for new line{replyingTo ? ' · Esc to cancel reply' : ''}{allowVideoUpload ? ' · video: 50MB/60s' : ''}
        </p>
        <p className="hidden md:flex text-[10px] text-[var(--text-muted)] gap-2 font-mono">
          <span>**bold**</span>
          <span>*italic*</span>
          <span>`code`</span>
          <span>```block```</span>
          <span>&gt; quote</span>
        </p>
      </div>
    </div>
  )
}

function findActiveMention(content: string): { start: number; end: number; query: string } | null {
  const beforeCursor = content
  const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]{0,32})$/)
  if (!match || match.index === undefined) return null
  const prefixLength = match[1].length
  const start = match.index + prefixLength
  return { start, end: beforeCursor.length, query: match[2] }
}

function readDraft(key: string): string {
  if (typeof window === 'undefined') return ''

  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(key: string, value: string) {
  if (typeof window === 'undefined') return

  try {
    if (value.length > 0) {
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // localStorage can be unavailable in private browsing or embedded contexts.
  }
}

function removeDraft(key: string) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // localStorage can be unavailable in private browsing or embedded contexts.
  }
}
