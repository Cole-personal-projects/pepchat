'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePresence } from '@/lib/hooks/usePresence'
import { useDMMessages } from '@/lib/hooks/useDMs'
import MessageList from '@/components/chat/MessageList'
import MessageInput from '@/components/chat/MessageInput'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { ChatSurfaceSkeleton } from '@/components/ui/Skeleton'
import DMHeader from './DMHeader'
import DMEmptyState from './DMEmptyState'
import { sendDM, editDM, deleteDM, markDMsRead } from '@/app/(app)/dm/actions'
import type { Profile, DirectMessageWithProfile, MessageWithProfile, Attachment } from '@/lib/types'

interface DMConversationViewProps {
  conversationId: string
}

export default function DMConversationView({ conversationId }: DMConversationViewProps) {
  const router = useRouter()
  const swipeRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)

  const [currentUser, setCurrentUser] = useState<Profile | null>(null)
  const [otherUser, setOtherUser]     = useState<Profile | null>(null)
  const [recipientId, setRecipientId] = useState<string>('')
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

  const {
    messages,
    hasMore,
    loadingMore,
    initialMessagesLoaded,
    loadMore,
    addMessage,
    removeMessage,
    updateMessageContent,
  } = useDMMessages(conversationId)

  const prevMessageCountRef = useRef(messages.length)

  // Fetch conversation participants on mount
  useEffect(() => {
    if (!conversationId) return
    const supabase = createClient()

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      const [{ data: conv }, { data: profile }] = await Promise.all([
        supabase
          .from('dm_conversations')
          .select(`
            *,
            user_a_profile:profiles!user_a(id, username, avatar_url, display_name, username_color, banner_color, badge, pronouns, bio, location, website, member_since, updated_at, created_at),
            user_b_profile:profiles!user_b(id, username, avatar_url, display_name, username_color, banner_color, badge, pronouns, bio, location, website, member_since, updated_at, created_at)
          `)
          .eq('id', conversationId)
          .single(),
        supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single(),
      ])

      if (!conv || (conv.user_a !== user.id && conv.user_b !== user.id)) {
        router.replace('/')
        return
      }

      const other = (conv.user_a === user.id ? (conv as any).user_b_profile : (conv as any).user_a_profile) as Profile
      setCurrentUser(profile as Profile)
      setOtherUser(other)
      setRecipientId(other.id)
      setLoading(false)

      // Mark messages as read
      await markDMsRead(conversationId)
    }

    init()
  }, [conversationId, router])

  useEffect(() => {
    if (!currentUser) {
      prevMessageCountRef.current = messages.length
      return
    }

    if (messages.length > prevMessageCountRef.current) {
      markDMsRead(conversationId)
    }
    prevMessageCountRef.current = messages.length
  }, [conversationId, currentUser, messages.length])

  // Swipe right from left edge to go back
  useEffect(() => {
    const el = swipeRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]
      touchStartX.current = t.clientX <= 40 ? t.clientX : null
    }

    function onTouchEnd(e: TouchEvent) {
      if (touchStartX.current === null) return
      const dx = e.changedTouches[0].clientX - touchStartX.current
      if (dx > 50) router.back()
      touchStartX.current = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [router])

  useEffect(() => {
    let clearHighlightTimer: ReturnType<typeof setTimeout> | null = null

    function jumpToHashMessage() {
      if (clearHighlightTimer) clearTimeout(clearHighlightTimer)
      const messageId = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim()
      setHighlightedMessageId(messageId || null)
      if (messageId) {
        clearHighlightTimer = setTimeout(() => setHighlightedMessageId(null), 1700)
      }
    }

    jumpToHashMessage()
    window.addEventListener('hashchange', jumpToHashMessage)
    return () => {
      window.removeEventListener('hashchange', jumpToHashMessage)
      if (clearHighlightTimer) clearTimeout(clearHighlightTimer)
    }
  }, [conversationId])

  const { onlineUsers, typingUsernames, broadcastTyping } = usePresence(
    currentUser ? `dm-presence:${conversationId}` : '__noop__',
    currentUser
      ? { user_id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url }
      : { user_id: '', username: '', avatar_url: null }
  )

  const handleSend = useCallback(async (
    content: string,
    _replyToId: string | null,
    attachments: Attachment[]
  ): Promise<{ error: string } | { ok: true; message: MessageWithProfile }> => {
    const result = await sendDM(conversationId, recipientId, content, attachments)
    if ('error' in result) return result
    addMessage(result.message)
    return { ok: true, message: { ...result.message, channel_id: conversationId, user_id: result.message.sender_id, reply_to_id: null, reactions: [], replied_to: null, profiles: { username: result.message.sender.username, avatar_url: result.message.sender.avatar_url, display_name: result.message.sender.display_name } } as MessageWithProfile }
  }, [conversationId, recipientId, addMessage])

  if (loading) {
    return <ChatSurfaceSkeleton variant="dm" />
  }

  if (error || !currentUser || !otherUser) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--danger)]">{error || 'Conversation not found.'}</p>
      </div>
    )
  }

  const isOtherUserOnline = onlineUsers.some(user => user.user_id === otherUser.id)
  const messagesReadyForHashFallback = !loading && initialMessagesLoaded

  return (
    <div ref={swipeRef} className="flex flex-col flex-1 min-h-0">
      <DMHeader
        otherUser={otherUser}
        onBack={() => router.back()}
        isOnline={isOtherUserOnline}
      />
      {messages.length === 0 && initialMessagesLoaded ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1">
            <DMEmptyState otherUser={otherUser} isOnline={isOtherUserOnline} />
          </div>
          <TypingIndicator typingUsernames={typingUsernames} />
          <MessageInput
            channelId={conversationId}
            channelName={otherUser.display_name ?? otherUser.username}
            profile={currentUser}
            draftStorageKey={`sidebar:draft:dm:${conversationId}`}
            placeholder={`Message ${otherUser.display_name ?? otherUser.username}`}
            onTyping={broadcastTyping}
            sendAction={handleSend}
            onSent={() => {}}
          />
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            hasMore={hasMore}
            loadingMore={loadingMore}
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            onLoadMore={loadMore}
            onReact={() => {}}
            onReply={() => {}}
            allowReactions={false}
            allowReplies={false}
            editAction={editDM}
            deleteAction={deleteDM}
            onEditSuccess={updateMessageContent}
            onDeleteSuccess={removeMessage}
            highlightedMessageId={highlightedMessageId}
            messagesReadyForHashFallback={messagesReadyForHashFallback}
            messageLinkBasePath="/dm"
            allowMarkUnread={false}
            allowReports={false}
          />
          <TypingIndicator typingUsernames={typingUsernames} />
          <MessageInput
            channelId={conversationId}
            channelName={otherUser.display_name ?? otherUser.username}
            profile={currentUser}
            draftStorageKey={`sidebar:draft:dm:${conversationId}`}
            placeholder={`Message ${otherUser.display_name ?? otherUser.username}`}
            onTyping={broadcastTyping}
            sendAction={handleSend}
            onSent={() => {}}
          />
        </>
      )}
    </div>
  )
}
