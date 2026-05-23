'use client'

import { useState } from 'react'
import ReactDOM from 'react-dom'
import dynamic from 'next/dynamic'
import { useMessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'

const EmojiPickerPopover = dynamic(
  () => import('@/components/chat/EmojiPickerPopover'),
  { ssr: false }
)

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢']

export interface MessageModalProps {
  open: boolean
  msg: MessageWithProfile | null
  isOwn: boolean
  canDeleteAny: boolean
  canPin: boolean
  allowReactions: boolean
  allowReplies: boolean
  canMarkUnread?: boolean
  canReport?: boolean
  closeModal: () => void
  messageLinkBasePath?: string
}

export default function MessageModal({
  open,
  msg,
  isOwn,
  canDeleteAny,
  canPin,
  allowReactions,
  allowReplies,
  canMarkUnread = false,
  canReport = false,
  closeModal,
  messageLinkBasePath = '/channels',
}: MessageModalProps) {
  const actions = useMessageActions()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showFullPicker, setShowFullPicker] = useState(false)

  if (!open || !msg) return null

  const canDelete = isOwn || canDeleteAny

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) closeModal()
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    actions.delete(msg!.id)
    setConfirmingDelete(false)
    closeModal()
  }

  function handleCancelDelete() {
    setConfirmingDelete(false)
  }

  function handleCopyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}${messageLinkBasePath}/${msg!.channel_id}#${msg!.id}`)
    closeModal()
  }

  const content = (
    <div
      data-testid="modal-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        data-testid="message-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg-secondary)',
          borderRadius: '16px 16px 0 0',
          padding: '12px 0 32px',
          border: '1px solid var(--border-soft)',
          borderBottom: 'none',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>

        {/* Message preview */}
        <div
          data-testid="modal-message-preview"
          style={{
            margin: '0 16px 12px',
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {msg.content}
        </div>

        {/* Quick reactions */}
        {allowReactions && (
          <div
            data-testid="quick-reactions"
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
              padding: '8px 16px 12px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            {QUICK_EMOJIS.map(emoji => (
              <button
                key={emoji}
                data-testid={`quick-react-${emoji}`}
                onClick={() => { actions.react(msg.id, emoji); closeModal() }}
                style={{
                  fontSize: 24,
                  background: 'var(--bg-tertiary)',
                  border: 'none',
                  borderRadius: 8,
                  width: 48,
                  height: 48,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 100ms ease',
                }}
              >
                {emoji}
              </button>
            ))}
            <button
              data-testid="quick-react-more"
              onClick={() => setShowFullPicker(true)}
              style={{
                fontSize: 20,
                background: 'var(--bg-tertiary)',
                border: 'none',
                borderRadius: 8,
                width: 48,
                height: 48,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              +
            </button>
          </div>
        )}

        {/* Action rows */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {allowReplies && (
            <ActionRow
              testId="modal-action-reply"
              label="Reply"
              onClick={() => { actions.reply(msg.id); closeModal() }}
            />
          )}

          {allowReplies && !msg.thread_root_id && (
            <ActionRow
              testId="modal-action-reply-thread"
              label="Reply in Thread"
              onClick={() => { actions.openThread(msg.id); closeModal() }}
            />
          )}

          <ActionRow
            testId="modal-action-copy"
            label="Copy Text"
            onClick={() => { navigator.clipboard?.writeText(msg.content); closeModal() }}
          />

          <ActionRow
            testId="modal-action-copy-link"
            label="Copy Message Link"
            onClick={handleCopyLink}
          />

          {isOwn && (
            <ActionRow
              testId="modal-action-edit"
              label="Edit Message"
              onClick={() => { actions.startEdit(msg.id); closeModal() }}
            />
          )}

          {canPin && (
            <ActionRow
              testId="modal-action-pin"
              label="Pin Message"
              onClick={() => { actions.pin(msg.id); closeModal() }}
            />
          )}

          {canMarkUnread && (
            <ActionRow
              testId="modal-action-mark-unread"
              label="Mark Unread"
              onClick={() => { actions.markUnread(msg.id); closeModal() }}
            />
          )}

          {canReport && (
            <ActionRow
              testId="modal-action-report"
              label="Report Message"
              onClick={() => { actions.report(msg.id); closeModal() }}
            />
          )}

          {canDelete && !confirmingDelete && (
            <ActionRow
              testId="modal-action-delete"
              label="Delete Message"
              danger
              onClick={handleDelete}
            />
          )}

          {canDelete && confirmingDelete && (
            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                Delete this message? This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  data-testid="modal-delete-confirm"
                  onClick={handleDelete}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: 'var(--danger)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
                <button
                  data-testid="modal-delete-cancel"
                  onClick={handleCancelDelete}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-soft)',
                    borderRadius: 8,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full emoji picker overlay */}
      {showFullPicker && (
        <div
          data-testid="full-emoji-picker-overlay"
          onClick={() => setShowFullPicker(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
              padding: '16px 16px 32px',
            }}
          >
            <EmojiPickerPopover
              onSelect={emoji => {
                actions.react(msg!.id, emoji)
                setShowFullPicker(false)
                closeModal()
              }}
              onClose={() => setShowFullPicker(false)}
            />
          </div>
        </div>
      )}
    </div>
  )

  return typeof document !== 'undefined'
    ? ReactDOM.createPortal(content, document.body)
    : null
}

function ActionRow({
  testId,
  label,
  danger = false,
  onClick,
}: {
  testId: string
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 20px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border-soft)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        fontSize: 15,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      {label}
    </button>
  )
}
