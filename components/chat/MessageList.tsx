'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { editMessage, deleteMessage, searchMessages } from '@/app/(app)/messages/actions'
import { fetchThreadRoot } from '@/app/(app)/messages/thread-actions'
import { reportMessage } from '@/app/admin/actions'
import Message from '@/components/chat/Message'
import MessageModal from '@/components/chat/MessageModal'
import MessageContextMenu from '@/components/chat/MessageContextMenu'
import ThreadPanel from '@/components/chat/ThreadPanel'
import { ChannelMessageActionsProvider, type MessageActions } from '@/components/chat/MessageActionsContext'
import ReportMessageDialog from '@/components/chat/ReportMessageDialog'
import SystemMessage from '@/components/chat/SystemMessage'
import { PERMISSIONS } from '@/lib/permissions'
import { getUnreadFromMessageLastReadAt, markChannelUnreadFromMessage } from '@/lib/channelReadState'
import type { MessageSearchResult, MessageWithProfile, Profile } from '@/lib/types'
import type { Role } from '@/lib/permissions'

const ProfileCard = dynamic(() => import('@/components/profile/ProfileCard'), { ssr: false })

type SearchScope = 'channel' | 'group'

interface MessageListProps {
  messages: MessageWithProfile[]
  hasMore: boolean
  loadingMore: boolean
  currentUserId: string
  currentUsername: string
  profile?: Profile
  groupId?: string
  channelId?: string
  channelName?: string
  userRole?: Role | null
  onLoadMore: () => void
  onReact: (messageId: string, emoji: string) => void
  onReply: (msg: MessageWithProfile) => void
  allowReactions?: boolean
  allowReplies?: boolean
  editAction?: (messageId: string, content: string) => Promise<{ error: string } | { ok: true }>
  deleteAction?: (messageId: string) => Promise<{ error: string } | { ok: true }>
  pinAction?: (messageId: string) => Promise<{ error: string } | { ok: true }>
  reportAction?: (messageId: string, reason: string, category?: string) => Promise<{ error: string } | { ok: true }>
  searchAction?: (input: {
    groupId: string
    query?: string
    author?: string
    channel?: string
    date?: string
  }) => Promise<{ error: string } | { ok: true; messages: MessageSearchResult[] }>
  onEditSuccess?: (messageId: string, content: string) => void
  onDeleteSuccess?: (messageId: string) => void
  onOpenPinnedPanel?: () => void
  onThreadPanelOpenChange?: (open: boolean) => void
  onOpenThreadRootIdChange?: (rootId: string | null) => void
  suppressThreadPanel?: boolean
  highlightedMessageId?: string | null
  initialLastReadAt?: string | null
  messageLinkBasePath?: string
  allowMarkUnread?: boolean
  allowReports?: boolean
  messagesReadyForHashFallback?: boolean
  animateInitialMessages?: boolean
}

function isCompact(msg: MessageWithProfile, prev: MessageWithProfile | null): boolean {
  if (!prev) return false
  if (msg.user_id !== prev.user_id) return false
  if (msg.replied_to) return false
  return new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
}

function formatDateSeparator(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function isSameDay(a: string, b: string) {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export default function MessageList({
  messages,
  hasMore,
  loadingMore,
  currentUserId,
  profile,
  groupId,
  channelId,
  channelName,
  onLoadMore,
  onReact,
  onReply,
  allowReactions = true,
  allowReplies = true,
  userRole,
  editAction,
  deleteAction,
  pinAction,
  reportAction,
  searchAction,
  onEditSuccess,
  onDeleteSuccess,
  onOpenPinnedPanel,
  onThreadPanelOpenChange,
  onOpenThreadRootIdChange,
  suppressThreadPanel = false,
  highlightedMessageId,
  initialLastReadAt = null,
  messageLinkBasePath = '/channels',
  allowMarkUnread = true,
  allowReports = true,
  messagesReadyForHashFallback = true,
  animateInitialMessages = true,
}: MessageListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState('')
  const [editPending, setEditPending] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [profileCard, setProfileCard] = useState<{ userId: string; anchor: HTMLElement } | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [modalMsg, setModalMsg] = useState<MessageWithProfile | null>(null)
  const [contextMenu, setContextMenu] = useState<{ msg: MessageWithProfile; x: number; y: number } | null>(null)
  const [reportTarget, setReportTarget] = useState<MessageWithProfile | null>(null)
  const [notice, setNotice] = useState('')
  const [notificationFallbackNotice, setNotificationFallbackNotice] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchAuthor, setSearchAuthor] = useState('')
  const [searchChannel, setSearchChannel] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('channel')
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [groupSearchResults, setGroupSearchResults] = useState<MessageSearchResult[]>([])
  const [groupSearchPending, setGroupSearchPending] = useState(false)
  const [showSavedOnly, setShowSavedOnly] = useState(false)
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(() => readSavedMessages(currentUserId))
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(() => readMutedUsers(currentUserId))
  const [localLastReadAt, setLocalLastReadAt] = useState(initialLastReadAt)
  const [reportedMessageIds, setReportedMessageIds] = useState(() => new Set<string>())
  const [openThreadRootId, setOpenThreadRootId] = useState<string | null>(null)
  const [loadedThreadRoot, setLoadedThreadRoot] = useState<MessageWithProfile | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isAtBottomRef = useRef(true)
  const didInitialScrollRef = useRef(false)
  const activeHashTargetIdRef = useRef<string | null>(null)
  const noticedMissingHashTargetIdRef = useRef<string | null>(null)

  const knownIdsRef = useRef(new Set(messages.map(m => m.id)))
  const prevFirstIdRef = useRef(messages[0]?.id)
  const newIdsRef = useRef(new Set<string>())
  const initialStaggerIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    setLocalLastReadAt(initialLastReadAt)
  }, [initialLastReadAt])

  useEffect(() => {
    function syncThreadFromUrl() {
      const params = new URLSearchParams(window.location.search)
      const rootId = params.get('thread')?.trim() || null
      setThreadRootId(rootId)
      onThreadPanelOpenChange?.(Boolean(rootId))
    }

    syncThreadFromUrl()
    window.addEventListener('popstate', syncThreadFromUrl)
    return () => window.removeEventListener('popstate', syncThreadFromUrl)
  }, [onThreadPanelOpenChange])

  function setThreadRootId(rootId: string | null) {
    setOpenThreadRootId(rootId)
    onOpenThreadRootIdChange?.(rootId)
  }

  function replaceThreadUrl(rootId: string | null) {
    const url = new URL(window.location.href)
    if (rootId) {
      url.searchParams.set('thread', rootId)
    } else {
      url.searchParams.delete('thread')
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function openThread(messageId: string) {
    replaceThreadUrl(messageId)
    setThreadRootId(messageId)
    onThreadPanelOpenChange?.(true)
  }

  function closeThread() {
    replaceThreadUrl(null)
    setThreadRootId(null)
    onThreadPanelOpenChange?.(false)
  }

  const visibleMessages = useMemo(() => messages.filter(msg => !mutedUserIds.has(msg.user_id)), [messages, mutedUserIds])
  const mutedCount = messages.length - visibleMessages.length

  const unreadMessages = useMemo(() => {
    if (!localLastReadAt) return []
    const lastReadMs = new Date(localLastReadAt).getTime()
    if (!Number.isFinite(lastReadMs)) return []
    return visibleMessages.filter(msg => (
      !msg.is_system &&
      msg.user_id !== currentUserId &&
      new Date(msg.created_at).getTime() > lastReadMs
    ))
  }, [currentUserId, localLastReadAt, visibleMessages])
  const unreadMessageId = unreadMessages[0]?.id ?? null
  const shouldStaggerInitialMessages = animateInitialMessages && !highlightedMessageId && !unreadMessageId
  if (initialStaggerIdsRef.current === null && visibleMessages.length > 0) {
    initialStaggerIdsRef.current = shouldStaggerInitialMessages
      ? new Set(visibleMessages.slice(0, 12).map(msg => msg.id))
      : new Set()
  }
  const unreadDividerLabel = `${unreadMessages.length} new ${unreadMessages.length === 1 ? 'message' : 'messages'}`
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const normalizedAuthor = searchAuthor.trim().toLowerCase()
  const normalizedChannel = searchChannel.trim().toLowerCase().replace(/^#/, '')
  const searchMatches = useMemo(() => {
    if (!normalizedSearch && !normalizedAuthor && !normalizedChannel && !searchDate && !showSavedOnly) return []
    return visibleMessages.filter(msg => {
      if (msg.is_system) return false
      const author = `${msg.profiles?.display_name ?? ''} ${msg.profiles?.username ?? ''}`.toLowerCase()
      const currentChannelName = channelName?.toLowerCase() ?? ''
      const messageDate = new Date(msg.created_at).toISOString().slice(0, 10)
      const attachmentText = (msg.attachments ?? [])
        .map(attachment => `${attachment.type} ${attachment.name}`)
        .join(' ')
        .toLowerCase()
      const replyText = msg.replied_to
        ? `${msg.replied_to.content} ${msg.replied_to.profiles?.username ?? ''}`.toLowerCase()
        : ''
      const textMatch = !normalizedSearch || (
        msg.content.toLowerCase().includes(normalizedSearch) ||
        author.includes(normalizedSearch) ||
        attachmentText.includes(normalizedSearch) ||
        replyText.includes(normalizedSearch)
      )
      const authorMatch = !normalizedAuthor || author.includes(normalizedAuthor)
      const channelMatch = !normalizedChannel || currentChannelName.includes(normalizedChannel)
      const dateMatch = !searchDate || messageDate === searchDate
      const savedMatch = !showSavedOnly || savedMessageIds.has(msg.id)
      return textMatch && authorMatch && channelMatch && dateMatch && savedMatch
    })
  }, [channelName, visibleMessages, normalizedAuthor, normalizedChannel, normalizedSearch, savedMessageIds, searchDate, showSavedOnly])

  useEffect(() => {
    const currentFirstId = messages[0]?.id
    if (currentFirstId === prevFirstIdRef.current) {
      let appendedCount = 0
      for (const m of messages) {
        if (!knownIdsRef.current.has(m.id)) {
          newIdsRef.current.add(m.id)
          if (!isAtBottomRef.current && !m.is_system && m.user_id !== currentUserId) appendedCount++
        }
      }
      if (appendedCount > 0) setPendingNewCount(count => count + appendedCount)
    }
    for (const m of messages) knownIdsRef.current.add(m.id)
    prevFirstIdRef.current = currentFirstId
  }, [currentUserId, messages])

  function handleScroll() {
    const el = listRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottomRef.current = distFromBottom < 80
    if (isAtBottomRef.current) setPendingNewCount(0)
    setShowScrollBtn(distFromBottom > 300)
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setPendingNewCount(0)
    setShowScrollBtn(false)
  }

  useEffect(() => {
    if (didInitialScrollRef.current) return
    didInitialScrollRef.current = true
    if (unreadMessageId) {
      jumpToMessage(unreadMessageId)
      return
    }
    bottomRef.current?.scrollIntoView()
  }, [unreadMessageId])

  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    if (!messagesReadyForHashFallback || !listRef.current) return

    if (highlightedMessageId) {
      activeHashTargetIdRef.current = highlightedMessageId
      const didJump = jumpToMessage(highlightedMessageId)
      if (didJump) {
        noticedMissingHashTargetIdRef.current = null
        setNotificationFallbackNotice('')
      } else {
        showMissingHashTargetNotice(highlightedMessageId)
      }
      return
    }

    const activeHashTargetId = activeHashTargetIdRef.current
    if (!activeHashTargetId) return
    if (!findMessageElement(activeHashTargetId)) {
      showMissingHashTargetNotice(activeHashTargetId)
    }
  }, [highlightedMessageId, messagesReadyForHashFallback, messages])

  useEffect(() => {
    if (!notificationFallbackNotice) return
    const timer = window.setTimeout(() => setNotificationFallbackNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notificationFallbackNotice])

  const hasSearchFilters = Boolean(normalizedSearch || normalizedAuthor || normalizedChannel || searchDate || showSavedOnly)
  const activeSearchResults = searchScope === 'group' ? groupSearchResults : searchMatches

  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [normalizedAuthor, normalizedChannel, normalizedSearch, searchDate, searchScope, showSavedOnly])

  useEffect(() => {
    if (!isSearchExpanded) return
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [isSearchExpanded])

  useEffect(() => {
    if (searchScope !== 'group' || !groupId || !hasSearchFilters) {
      setGroupSearchResults([])
      setGroupSearchPending(false)
      return
    }

    let ignore = false
    const timer = window.setTimeout(() => {
      setGroupSearchPending(true)
      const action = searchAction ?? searchMessages
      action({
        groupId,
        query: searchQuery,
        author: searchAuthor,
        channel: searchChannel,
        date: searchDate,
      }).then(result => {
        if (ignore) return
        if ('error' in result) {
          setError(result.error ?? '')
          setGroupSearchResults([])
        } else {
          setError('')
          setGroupSearchResults(result.messages.filter(msg => (
            !mutedUserIds.has(msg.user_id) &&
            (!showSavedOnly || savedMessageIds.has(msg.id))
          )))
        }
      }).finally(() => {
        if (!ignore) setGroupSearchPending(false)
      })
    }, 250)

    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [groupId, hasSearchFilters, mutedUserIds, savedMessageIds, searchAction, searchAuthor, searchChannel, searchDate, searchQuery, searchScope, showSavedOnly])

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false
      const tagName = target.tagName.toLowerCase()
      return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
    }

    function handleDocumentKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return
      e.preventDefault()
      setIsSearchExpanded(true)
    }

    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown)
  }, [])

  function findMessageElement(messageId: string) {
    if (!listRef.current) return null
    return listRef.current.querySelector(`[data-message-id="${messageId}"]`)
  }

  function showMissingHashTargetNotice(messageId: string) {
    if (noticedMissingHashTargetIdRef.current === messageId) return
    noticedMissingHashTargetIdRef.current = messageId
    setNotificationFallbackNotice('That message is no longer available.')
  }

  function jumpToMessage(messageId: string) {
    const el = findMessageElement(messageId)
    if (!el) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('message-highlighted')
    setTimeout(() => el.classList.remove('message-highlighted'), 1600)
    return true
  }

  function jumpToSearchResult(index: number) {
    const match = activeSearchResults[index]
    if (!match) return
    setActiveSearchIndex(index)
    if (searchScope === 'group' && match.channel_id !== (channelId ?? match.channel_id)) {
      window.location.href = `${messageLinkBasePath}/${match.channel_id}#${match.id}`
      return
    }
    jumpToMessage(match.id)
  }

  function goToNextSearchResult() {
    if (activeSearchResults.length === 0) return
    jumpToSearchResult((activeSearchIndex + 1) % activeSearchResults.length)
  }

  function goToPrevSearchResult() {
    if (activeSearchResults.length === 0) return
    jumpToSearchResult((activeSearchIndex - 1 + activeSearchResults.length) % activeSearchResults.length)
  }

  function clearSearch() {
    setSearchQuery('')
    setSearchAuthor('')
    setSearchChannel('')
    setSearchDate('')
    setShowSavedOnly(false)
    setGroupSearchResults([])
    setActiveSearchIndex(-1)
  }

  function collapseSearch() {
    if (hasSearchFilters) clearSearch()
    setIsSearchExpanded(false)
  }

  function toggleSaved(msg: MessageWithProfile) {
    setSavedMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(msg.id)) next.delete(msg.id)
      else next.add(msg.id)
      writeSavedMessages(currentUserId, next)
      return next
    })
  }

  function muteUser(msg: MessageWithProfile) {
    setMutedUserIds(prev => {
      const next = new Set(prev).add(msg.user_id)
      writeMutedUsers(currentUserId, next)
      return next
    })
    setNotice(`Muted @${msg.profiles?.username ?? 'user'} on this device.`)
  }

  function clearMutedUsers() {
    setMutedUserIds(new Set())
    writeMutedUsers(currentUserId, new Set())
    setNotice('Muted users cleared on this device.')
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        goToPrevSearchResult()
      } else {
        goToNextSearchResult()
      }
    }
    if (e.key === 'Escape' && hasSearchFilters) {
      e.preventDefault()
      clearSearch()
    }
  }

  function handleJumpToReply(messageId: string) {
    if (!messages.some(m => m.id === messageId)) {
      setError('')
      setNotice('Original message is not loaded. Load earlier messages and try again.')
      return
    }
    setNotice('')
    jumpToMessage(messageId)
  }

  function findMessageById(messageId: string) {
    return messages.find(m => m.id === messageId) ?? null
  }

  useEffect(() => {
    if (!openThreadRootId) {
      setLoadedThreadRoot(null)
      return
    }
    if (findMessageById(openThreadRootId)) {
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
  }, [messages, openThreadRootId])

  function startEdit(msg: MessageWithProfile) {
    setEditingId(msg.id)
    setEditContent(msg.content)
    setError('')
    setNotice('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditContent('')
  }

  async function submitEdit(messageId: string, content = editContent) {
    if (!content.trim() || editPending) return
    setError('')
    setEditPending(true)
    try {
      const action = editAction ?? editMessage
      const result = await action(messageId, content)
      if ('error' in result) {
        setError(result.error ?? '')
      } else {
        setEditingId(null)
        onEditSuccess?.(messageId, content)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edit.')
    } finally {
      setEditPending(false)
    }
  }

  function handleDelete(messageId: string) {
    if (!confirm('Delete this message?')) return
    setError('')
    setNotice('')
    startTransition(async () => {
      try {
        const action = deleteAction ?? deleteMessage
        const result = await action(messageId)
        if (!result || 'error' in result) {
          setError(result?.error ?? 'Failed to delete message.')
        } else {
          onDeleteSuccess?.(messageId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete message.')
      }
    })
  }

  function handleModalDelete(messageId: string) {
    setError('')
    setNotice('')
    startTransition(async () => {
      try {
        const action = deleteAction ?? deleteMessage
        const result = await action(messageId)
        if (!result || 'error' in result) {
          setError(result?.error ?? 'Failed to delete message.')
        } else {
          onDeleteSuccess?.(messageId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete message.')
      }
    })
  }

  function handlePin(messageId: string) {
    if (!pinAction) return
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await pinAction(messageId)
      if ('error' in result) setError(result.error)
    })
  }

  function handleReport(messageId: string) {
    if (reportedMessageIds.has(messageId)) return
    const target = messages.find(m => m.id === messageId)
    if (!target || target.user_id === currentUserId) return
    setError('')
    setNotice('')
    setReportTarget(target)
  }

  function handleMarkUnread(msg: MessageWithProfile) {
    setError('')
    setNotice('')
    startTransition(async () => {
      try {
        await markChannelUnreadFromMessage(msg.channel_id, currentUserId, msg.created_at)
        setLocalLastReadAt(getUnreadFromMessageLastReadAt(msg.created_at))
        setNotice('Marked unread from this message.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to mark message unread.')
      }
    })
  }

  function submitReport(category: string, reason: string) {
    if (!reportTarget) return
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = reportAction
        ? await reportAction(reportTarget.id, reason)
        : await reportMessage(reportTarget.id, reason, category)
      if ('error' in result) {
        setError(result.error)
      } else {
        setReportedMessageIds(prev => new Set(prev).add(reportTarget.id))
        setReportTarget(null)
        setNotice('Report submitted for review.')
      }
    })
  }

  const canDeleteAny = userRole ? PERMISSIONS.canDeleteAnyMessage(userRole) : false
  const canPin = userRole ? PERMISSIONS.canPinMessages(userRole) : false
  const messageActions = useMemo<MessageActions>(() => ({
    startEdit: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) startEdit(msg)
    },
    cancelEdit,
    changeEditContent: setEditContent,
    submitEdit,
    delete: async (messageId: string) => handleModalDelete(messageId),
    react: async (messageId: string, emoji: string) => {
      setPickerOpenFor(null)
      onReact(messageId, emoji)
    },
    reply: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) onReply(msg)
    },
    openThread,
    jumpToMessage: handleJumpToReply,
    pin: async (messageId: string) => handlePin(messageId),
    toggleSaved: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) toggleSaved(msg)
    },
    openProfile: (userId: string, anchor: HTMLElement) => setProfileCard({ userId, anchor }),
    openActions: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) setModalMsg(msg)
    },
    openContextMenu: (messageId: string, event: React.MouseEvent) => {
      const msg = findMessageById(messageId)
      if (!msg) return
      const vw = window.innerWidth
      const menuWidth = 220
      const x = event.clientX + menuWidth > vw ? vw - menuWidth - 8 : event.clientX
      const vh = window.innerHeight
      const menuHeight = 320
      const y = event.clientY + menuHeight > vh ? vh - menuHeight - 8 : event.clientY
      setContextMenu({ msg, x, y })
    },
    togglePicker: (messageId: string | null) => setPickerOpenFor(current => current === messageId ? null : messageId),
    closePicker: () => setPickerOpenFor(null),
    markUnread: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) handleMarkUnread(msg)
    },
    report: handleReport,
    muteUser: (messageId: string) => {
      const msg = findMessageById(messageId)
      if (msg) muteUser(msg)
    },
  }), [
    editContent,
    editPending,
    messages,
    onReact,
    onReply,
    pinAction,
    deleteAction,
    editAction,
    onEditSuccess,
    onDeleteSuccess,
    currentUserId,
    reportedMessageIds,
  ])
  const searchCountLabel = hasSearchFilters
    ? (
        groupSearchPending
          ? 'Searching'
          : activeSearchResults.length > 0 && activeSearchIndex >= 0
            ? `${activeSearchIndex + 1}/${activeSearchResults.length}`
            : `${activeSearchResults.length} ${activeSearchResults.length === 1 ? 'result' : 'results'}`
      )
    : ''
  const visibleOpenThreadRoot = openThreadRootId ? findMessageById(openThreadRootId) : null
  const openThreadRoot = openThreadRootId
    ? visibleOpenThreadRoot ?? (loadedThreadRoot?.id === openThreadRootId ? loadedThreadRoot : null)
    : null
  return (
    <ChannelMessageActionsProvider value={messageActions}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--bg-chat)' }}>
      <div
        style={{
          flexShrink: 0,
          zIndex: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: isSearchExpanded ? '8px 16px 10px' : '8px 16px',
          background: 'var(--bg-chat)',
          borderBottom: isSearchExpanded ? '1px solid var(--border-soft)' : 'none',
          boxShadow: isSearchExpanded ? '0 8px 18px rgba(0, 0, 0, 0.24)' : 'none',
        }}
      >
        {!isSearchExpanded ? (
          <button
            type="button"
            data-testid="message-search-expand"
            onClick={() => setIsSearchExpanded(true)}
            style={{
              height: 30,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-soft)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0 10px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Search
          </button>
        ) : (
          <>
            {groupId && (
              <select
                data-testid="message-search-scope"
                value={searchScope}
                onChange={e => setSearchScope(e.target.value as SearchScope)}
                style={{
                  height: 32,
                  padding: '0 8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value="channel">Channel</option>
                <option value="group">Group</option>
              </select>
            )}
            <input
              ref={searchInputRef}
              data-testid="message-search-input"
              type="search"
              placeholder={searchScope === 'group' ? 'Search group messages...' : 'Search loaded messages...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 10px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <input
              data-testid="message-search-author"
              type="search"
              placeholder="Author"
              value={searchAuthor}
              onChange={e => setSearchAuthor(e.target.value)}
              style={{
                width: 120,
                padding: '7px 10px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <input
              data-testid="message-search-channel"
              type="search"
              placeholder="Channel"
              value={searchChannel}
              onChange={e => setSearchChannel(e.target.value)}
              style={{
                width: 120,
                padding: '7px 10px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <input
              data-testid="message-search-date"
              type="date"
              value={searchDate}
              onChange={e => setSearchDate(e.target.value)}
              style={{
                width: 136,
                padding: '6px 8px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              type="button"
              data-testid="message-search-saved"
              aria-pressed={showSavedOnly}
              onClick={() => setShowSavedOnly(value => !value)}
              style={{
                height: 30,
                borderRadius: 'var(--radius-sm)',
                border: showSavedOnly ? '1px solid var(--accent)' : '1px solid var(--border-soft)',
                background: showSavedOnly ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                color: showSavedOnly ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                padding: '0 9px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Saved
            </button>
            <span
              data-testid="message-search-count"
              style={{ width: 72, textAlign: 'right', fontSize: 12, color: 'var(--text-faint)' }}
            >
              {searchCountLabel}
            </span>
            {hasSearchFilters && (
              <button
                type="button"
                data-testid="message-search-clear"
                aria-label="Clear message search"
                onClick={clearSearch}
                style={searchNavBtn(false)}
              >
                ×
              </button>
            )}
            <button
              type="button"
              data-testid="message-search-prev"
              aria-label="Previous search result"
              disabled={activeSearchResults.length === 0}
              onClick={goToPrevSearchResult}
              style={searchNavBtn(activeSearchResults.length === 0)}
            >
              ↑
            </button>
            <button
              type="button"
              data-testid="message-search-next"
              aria-label="Next search result"
              disabled={activeSearchResults.length === 0}
              onClick={goToNextSearchResult}
              style={searchNavBtn(activeSearchResults.length === 0)}
            >
              ↓
            </button>
            <button
              type="button"
              data-testid="message-search-collapse"
              aria-label="Collapse message search"
              onClick={collapseSearch}
              style={searchNavBtn(false)}
            >
              ˄
            </button>
          </>
        )}
        {unreadMessageId && (
          <button
            type="button"
            data-testid="jump-first-unread"
            onClick={() => jumpToMessage(unreadMessageId)}
            title="Jump to first unread"
            style={{
              height: 28,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: 'pointer',
              padding: '0 9px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Unread
          </button>
        )}
      </div>

      {searchScope === 'group' && hasSearchFilters && (
        <div
          data-testid="group-search-results"
          className="mx-4 mb-2 rounded border border-[var(--border-soft)] bg-[var(--bg-secondary)]"
          style={{ flexShrink: 0, overflow: 'hidden' }}
        >
          {groupSearchPending ? (
            <p className="px-3 py-2 text-xs text-[var(--text-faint)]">Searching group messages...</p>
          ) : groupSearchResults.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-faint)]">No group messages match these filters.</p>
          ) : (
            groupSearchResults.slice(0, 8).map((result, index) => (
              <button
                key={result.id}
                type="button"
                data-testid={`group-search-result-${result.id}`}
                onClick={() => jumpToSearchResult(index)}
                className="block w-full border-b border-[var(--border-soft)] px-3 py-2 text-left last:border-b-0 hover:bg-white/5"
              >
                <span className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">
                    #{result.channels?.name ?? 'channel'} · @{result.profiles?.username ?? 'unknown'}
                  </span>
                  <span className="text-[var(--text-faint)]">{formatShortDate(result.created_at)}</span>
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">
                  {result.content || attachmentResultLabel(result)}
                </span>
              </button>
            ))
          )}
          {groupSearchResults.length > 8 && (
            <p className="border-t border-[var(--border-soft)] px-3 py-1.5 text-[10px] text-[var(--text-faint)]">
              Showing first 8 of {groupSearchResults.length} results. Use filters to narrow.
            </p>
          )}
        </div>
      )}

      <div
        data-testid="message-scroll-container"
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch' as any,
          overscrollBehavior: 'contain',
          padding: '12px 0',
        }}
      >
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50 disabled:cursor-default px-3 py-1 rounded hover:bg-[var(--accent)]/10 transition-colors"
            >
              {loadingMore ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}

        {error && (
          <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-1.5 mx-4 mb-2">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-xs text-[var(--success)] bg-[var(--success)]/10 border border-[var(--success)]/20 rounded px-3 py-1.5 mx-4 mb-2">
            {notice}
          </p>
        )}
        {notificationFallbackNotice && (
          <p
            data-testid="notification-fallback-notice"
            role="status"
            className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-3 py-1.5 mx-4 mb-2"
          >
            {notificationFallbackNotice}
          </p>
        )}

        {mutedCount > 0 && (
          <div className="mx-4 mb-2 flex items-center justify-between rounded border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-muted)]">
            <span>{mutedCount} muted {mutedCount === 1 ? 'message is' : 'messages are'} hidden on this device.</span>
            <button type="button" onClick={clearMutedUsers} className="font-semibold text-[var(--accent)]">Show all</button>
          </div>
        )}

        {visibleMessages.map((msg, idx) => {
          const prev = idx > 0 ? visibleMessages[idx - 1] : null
          const compact = isCompact(msg, prev)
          const showDateSep = !prev || !isSameDay(msg.created_at, prev.created_at)
          const isOwn = msg.user_id === currentUserId
          const uniqueEmojiCount = new Set((msg.reactions ?? []).map(r => r.emoji)).size
          const atReactionLimit = uniqueEmojiCount >= 20
          const showUnreadDivider = msg.id === unreadMessageId

          const isNewMsg = newIdsRef.current.has(msg.id)
          const shouldStagger = !isNewMsg && (initialStaggerIdsRef.current?.has(msg.id) ?? false)
          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              className={isNewMsg ? 'message-new' : shouldStagger ? 'message-stagger-in' : undefined}
              style={shouldStagger ? { animationDelay: `${Math.min(idx, 12) * 14}ms` } : undefined}
            >
              {showUnreadDivider && (
                <div data-testid="unread-divider" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '10px 16px 14px' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--accent)' }} />
                  <span style={{
                    fontSize: 11,
                    color: 'var(--accent)',
                    background: 'var(--bg-chat)',
                    padding: '0 12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0,
                  }}>
                    {unreadDividerLabel}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--accent)' }} />
                </div>
              )}

              {showDateSep && !msg.is_system && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 16px' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-faint)',
                    background: 'var(--bg-chat)',
                    padding: '0 12px',
                    fontWeight: 500,
                  }}>
                    {formatDateSeparator(msg.created_at)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                </div>
              )}

              {msg.is_system ? (
                <SystemMessage msg={msg} onOpenPinnedPanel={onOpenPinnedPanel ?? (() => {})} />
              ) : (
                <Message
                  msg={msg}
                  isCompact={compact}
                  isOwn={isOwn}
                  currentUserId={currentUserId}
                  canDeleteAny={canDeleteAny}
                  canPin={canPin}
                  editingId={editingId}
                  editContent={editContent}
                  pickerOpenFor={pickerOpenFor}
                  isSaved={savedMessageIds.has(msg.id)}
                  allowReactions={allowReactions}
                  allowReplies={allowReplies}
                  isPending={editPending || isPending}
                  atReactionLimit={atReactionLimit}
                />
              )}
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button
          data-testid="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            minWidth: 40,
            height: 40,
            borderRadius: 20,
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: pendingNewCount > 0 ? '0 12px' : 0,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 10,
            fontSize: 12,
            fontWeight: 700,
          }}
          title={pendingNewCount > 0 ? `${pendingNewCount} new ${pendingNewCount === 1 ? 'message' : 'messages'}` : 'Scroll to bottom'}
        >
          {pendingNewCount > 0 && (
            <span data-testid="scroll-new-count">
              {pendingNewCount} new
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      )}

      {profileCard && (
        <ProfileCard
          userId={profileCard.userId}
          currentUserId={currentUserId}
          anchorEl={profileCard.anchor}
          onClose={() => setProfileCard(null)}
        />
      )}

      <MessageModal
        open={modalMsg !== null}
        msg={modalMsg}
        isOwn={modalMsg?.user_id === currentUserId}
        canDeleteAny={canDeleteAny}
        canPin={canPin}
        allowReactions={allowReactions}
        allowReplies={allowReplies}
        canMarkUnread={allowMarkUnread}
        canReport={allowReports && modalMsg !== null && modalMsg.user_id !== currentUserId && !reportedMessageIds.has(modalMsg.id)}
        closeModal={() => setModalMsg(null)}
        messageLinkBasePath={messageLinkBasePath}
      />

      {contextMenu && (
        <MessageContextMenu
          message={contextMenu.msg}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          isOwn={contextMenu.msg.user_id === currentUserId}
          canDeleteAny={canDeleteAny}
          canPin={canPin}
          allowReactions={allowReactions}
          allowReplies={allowReplies}
          canMarkUnread={allowMarkUnread}
          canReport={allowReports && contextMenu.msg.user_id !== currentUserId && !reportedMessageIds.has(contextMenu.msg.id)}
          canMuteUser={contextMenu.msg.user_id !== currentUserId}
          closeMenu={() => setContextMenu(null)}
          messageLinkBasePath={messageLinkBasePath}
        />
      )}

      {!suppressThreadPanel && !onOpenThreadRootIdChange && profile && (
        <ThreadPanel
          open={Boolean(openThreadRootId)}
          rootMessage={openThreadRoot}
          channelName={channelName ?? 'channel'}
          profile={profile}
          currentUserId={currentUserId}
          groupId={groupId}
          canPin={canPin}
          onClose={closeThread}
        />
      )}

      <ReportMessageDialog
        open={reportTarget !== null}
        message={reportTarget}
        pending={isPending}
        onClose={() => setReportTarget(null)}
        onSubmit={submitReport}
      />
      </div>
    </ChannelMessageActionsProvider>
  )
}

function searchNavBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    fontSize: 13,
  }
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function attachmentResultLabel(message: MessageSearchResult) {
  const first = message.attachments?.[0]
  if (!first) return 'Attachment'
  if (first.type === 'gif') return 'GIF'
  if (first.type === 'video') return 'Video'
  return 'Image'
}

function savedMessagesKey(userId: string) {
  return `sidebar:saved-messages:${userId}`
}

function readSavedMessages(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(savedMessagesKey(userId))
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSavedMessages(userId: string, ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(savedMessagesKey(userId), JSON.stringify(Array.from(ids)))
  } catch {
    // Ignore unavailable storage; saving is a convenience feature.
  }
}

function mutedUsersKey(userId: string) {
  return `sidebar:muted-users:${userId}`
}

function readMutedUsers(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(mutedUsersKey(userId))
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeMutedUsers(userId: string, ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(mutedUsersKey(userId), JSON.stringify(Array.from(ids)))
  } catch {
    // Ignore unavailable storage; muting is a local convenience feature.
  }
}
