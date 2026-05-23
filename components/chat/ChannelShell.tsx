'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMessages } from '@/lib/hooks/useMessages'
import { usePinnedMessages } from '@/lib/hooks/usePinnedMessages'
import { markChannelRead } from '@/lib/channelReadState'
import { usePresence } from '@/lib/hooks/usePresence'
import ChatHeader from '@/components/chat/ChatHeader'
import MessageList from '@/components/chat/MessageList'
import MessageInput from '@/components/chat/MessageInput'
import TypingIndicator from '@/components/chat/TypingIndicator'
import PresencePanel from '@/components/chat/PresencePanel'
import PinnedMessagesPanel from '@/components/chat/PinnedMessagesPanel'
import ThreadPanel from '@/components/chat/ThreadPanel'
import { toggleReaction } from '@/app/(app)/reactions/actions'
import { pinMessage, unpinMessage } from '@/app/(app)/messages/actions'
import { fetchThreadRoot } from '@/app/(app)/messages/thread-actions'
import { createClient } from '@/lib/supabase/client'
import { PERMISSIONS } from '@/lib/permissions'
import type { MessageWithProfile, Profile } from '@/lib/types'
import type { Role } from '@/lib/permissions'

interface ChannelShellProps {
  channelId: string
  groupId?: string
  channelName: string
  channelTopic?: string | null
  initialMessages: MessageWithProfile[]
  profile: Profile
  userRole?: Role | null
  initialLastReadAt?: string | null
  /** Auth user ID — used for message ownership checks. Defaults to profile.id. */
  userId?: string
}

/**
 * Client wrapper for the chat area.
 * Owns message state, presence state, reply-to state, and pinned panel state.
 */
export default function ChannelShell({
  channelId,
  groupId,
  channelName,
  channelTopic,
  initialMessages,
  profile,
  userRole,
  initialLastReadAt = null,
  userId,
}: ChannelShellProps) {
  const {
    messages,
    hasMore,
    loadingMore,
    loadMore,
    addMessage,
    removeMessage,
    broadcastNewMessage,
    toggleReactionOptimistic,
    broadcastReactionChange,
    updateMessageContent,
    updateMessagePinnedAt,
  } = useMessages(channelId, initialMessages, profile.id)

  const { pinnedMessages, pinnedCount, refetch: refetchPins } = usePinnedMessages(channelId)

  const { onlineUsers, typingUsernames, broadcastTyping, status, setStatus } = usePresence(channelId, {
    user_id:    profile.id,
    username:   profile.username,
    avatar_url: profile.avatar_url,
  })

  const [replyingTo, setReplyingTo] = useState<MessageWithProfile | null>(null)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)
  const [openThreadRootId, setOpenThreadRootId] = useState<string | null>(null)
  const [loadedThreadRoot, setLoadedThreadRoot] = useState<MessageWithProfile | null>(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

  const canPin = userRole ? PERMISSIONS.canPinMessages(userRole) : false
  const visibleOpenThreadRoot = openThreadRootId ? messages.find(message => message.id === openThreadRootId) ?? null : null
  const openThreadRoot = openThreadRootId
    ? visibleOpenThreadRoot ?? (loadedThreadRoot?.id === openThreadRootId ? loadedThreadRoot : null)
    : null
  const threadPanelOpen = Boolean(openThreadRootId)

  // Mark channel as read on mount (channel navigation)
  useEffect(() => {
    markChannelRead(channelId, profile.id)
  }, [channelId, profile.id])

  // Mark channel as read when a new message arrives while viewing
  const prevLengthRef = useRef(initialMessages.length)
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      prevLengthRef.current = messages.length
      markChannelRead(channelId, profile.id)
    }
  }, [messages.length, channelId, profile.id])

  useEffect(() => {
    if (!openThreadRootId) {
      setLoadedThreadRoot(null)
      return
    }
    if (visibleOpenThreadRoot) {
      setLoadedThreadRoot(null)
      return
    }

    let cancelled = false
    fetchThreadRoot({ rootId: openThreadRootId }).then(result => {
      if (cancelled) return
      if ('ok' in result && result.ok) {
        setLoadedThreadRoot(result.message)
        return
      }
      setLoadedThreadRoot(null)
    })

    return () => {
      cancelled = true
    }
  }, [openThreadRootId, visibleOpenThreadRoot])

  const handleEdit = useCallback(async (
    messageId: string,
    content: string
  ): Promise<{ error: string } | { ok: true }> => {
    const trimmed = content.trim()
    if (!trimmed) return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000) return { error: 'Message too long (max 4000 characters).' }
    const supabase = createClient()
    const { error } = await supabase
      .from('messages')
      .update({ content: trimmed, edited_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) return { error: error.message }
    return { ok: true }
  }, [])

  const handlePin = useCallback(async (messageId: string) => {
    const result = await pinMessage(messageId, channelId)
    if ('ok' in result) {
      updateMessagePinnedAt(messageId, new Date().toISOString())
      refetchPins()
    }
    return result
  }, [channelId, updateMessagePinnedAt, refetchPins])

  const handleUnpin = useCallback(async (pinnedId: string) => {
    const pin = pinnedMessages.find(p => p.id === pinnedId)
    await unpinMessage(pinnedId)
    if (pin) updateMessagePinnedAt(pin.message_id, null)
  }, [pinnedMessages, updateMessagePinnedAt])

  const handleJump = useCallback((messageId: string) => {
    setPinnedPanelOpen(false)
    setOpenThreadRootId(null)
    setHighlightedMessageId(messageId)
    // Reset after animation so the same message can be jumped to again
    setTimeout(() => setHighlightedMessageId(null), 1700)
  }, [])

  const closeThreadPanel = useCallback(() => {
    setOpenThreadRootId(null)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.delete('thread')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const handleTogglePinnedPanel = useCallback(() => {
    if (openThreadRootId) {
      closeThreadPanel()
      setPinnedPanelOpen(true)
      return
    }
    setPinnedPanelOpen(open => !open)
  }, [closeThreadPanel, openThreadRootId])

  useEffect(() => {
    function jumpToHashMessage() {
      const messageId = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim()
      const threadRootId = new URLSearchParams(window.location.search).get('thread')?.trim()
      if (messageId && !threadRootId) handleJump(messageId)
    }

    jumpToHashMessage()
    window.addEventListener('hashchange', jumpToHashMessage)
    return () => window.removeEventListener('hashchange', jumpToHashMessage)
  }, [channelId, handleJump])

  const handleReact = useCallback(async (messageId: string, emoji: string) => {
    toggleReactionOptimistic(messageId, emoji, profile.id, profile.username)

    const result = await toggleReaction(messageId, emoji)
    if ('error' in result) {
      toggleReactionOptimistic(messageId, emoji, profile.id, profile.username)
      return
    }

    broadcastReactionChange(messageId, emoji, profile.id, result.action)
  }, [broadcastReactionChange, profile.id, profile.username, toggleReactionOptimistic])

  return (
    <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
      {/* Main column */}
      <div
        className="flex flex-col flex-1 min-w-0 min-h-0"
        style={{ background: 'var(--bg-chat)' }}
      >
        <ChatHeader
          channelName={channelName}
          channelTopic={channelTopic}
          pinnedCount={pinnedCount}
          pinnedPanelOpen={pinnedPanelOpen && !threadPanelOpen}
          onTogglePinnedPanel={handleTogglePinnedPanel}
        />
        <MessageList
          messages={messages}
          hasMore={hasMore}
          loadingMore={loadingMore}
          currentUserId={userId ?? profile.id}
          currentUsername={profile.username}
          profile={profile}
          groupId={groupId}
          channelId={channelId}
          channelName={channelName}
          onLoadMore={loadMore}
          editAction={handleEdit}
          pinAction={handlePin}
          onReact={handleReact}
          onReply={setReplyingTo}
          userRole={userRole}
          onEditSuccess={updateMessageContent}
          onDeleteSuccess={removeMessage}
          onOpenPinnedPanel={() => {
            closeThreadPanel()
            setPinnedPanelOpen(true)
          }}
          onThreadPanelOpenChange={open => {
            if (!open) setOpenThreadRootId(null)
          }}
          onOpenThreadRootIdChange={rootId => {
            setOpenThreadRootId(rootId)
            if (rootId) setPinnedPanelOpen(false)
          }}
          suppressThreadPanel
          highlightedMessageId={highlightedMessageId}
          messagesReadyForHashFallback={true}
          initialLastReadAt={initialLastReadAt}
        />
        {(channelName === 'welcome' || channelName === 'general') && userRole && ['admin', 'moderator'].includes(userRole) && (
          <div className="mx-4 mb-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-primary)]">Setup checklist:</span>{' '}
            set a clear channel topic, create a limited invite, welcome new members in #welcome, and review reports from Admin.
          </div>
        )}
        <TypingIndicator typingUsernames={typingUsernames} />
        <MessageInput
          channelId={channelId}
          groupId={groupId}
          channelName={channelName}
          profile={profile}
          allowVideoUpload={userRole ? userRole !== 'noob' : false}
          draftStorageKey={`sidebar:draft:channel:${channelId}`}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          onTyping={broadcastTyping}
          onSent={(msg) => {
            addMessage(msg)
            broadcastNewMessage(msg)
            setReplyingTo(null)
          }}
        />
      </div>

      {/* Right panel: online members */}
      {!threadPanelOpen && !pinnedPanelOpen && (
        <PresencePanel onlineUsers={onlineUsers} currentStatus={status} onStatusChange={setStatus} />
      )}

      {/* Right panel: pinned messages */}
      <PinnedMessagesPanel
        open={pinnedPanelOpen && !threadPanelOpen}
        pinnedMessages={pinnedMessages}
        canPin={canPin}
        onClose={() => setPinnedPanelOpen(false)}
        onJump={handleJump}
        onUnpin={handleUnpin}
      />

      <ThreadPanel
        open={threadPanelOpen}
        rootMessage={openThreadRoot}
        channelName={channelName}
        profile={profile}
        currentUserId={userId ?? profile.id}
        groupId={groupId}
        canPin={canPin}
        onClose={closeThreadPanel}
      />
    </div>
  )
}
