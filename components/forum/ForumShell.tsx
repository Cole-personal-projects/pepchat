'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import { createForumPost } from '@/app/(app)/forums/actions'
import { MESSAGE_SELECT } from '@/lib/queries'
import Avatar from '@/components/ui/Avatar'
import Modal from '@/components/ui/Modal'
import ThreadPanel from '@/components/chat/ThreadPanel'
import type { Role } from '@/lib/permissions'
import type { ForumTag, MessageWithProfile, Profile } from '@/lib/types'

interface ForumShellProps {
  channelId: string
  groupId?: string
  channelName: string
  channelTopic?: string | null
  profile: Profile
  userRole?: Role | null
  userId?: string
  initialPosts: MessageWithProfile[]
  tags: ForumTag[]
  initialPostTags: Array<{ tag_id: string; root_message_id: string }>
}

function lastActivity(post: MessageWithProfile): string {
  return post.thread_last_reply_at ?? post.created_at
}

function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Forum channel surface: a post grid instead of a message list. Each post is
 * a thread root with a title; opening one reuses the threads-v1 ThreadPanel.
 */
export default function ForumShell({
  channelId,
  groupId,
  channelName,
  channelTopic,
  profile,
  userRole,
  userId,
  initialPosts,
  tags,
  initialPostTags,
}: ForumShellProps) {
  const [posts, setPosts] = useState<MessageWithProfile[]>(initialPosts)
  const [postTags, setPostTags] = useState(initialPostTags)
  const [openPost, setOpenPost] = useState<MessageWithProfile | null>(null)
  const [showComposer, setShowComposer] = useState(false)
  const [filterTagId, setFilterTagId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const refetchPosts = useCallback(async () => {
    const supabase = createClient()
    const [postsResult, tagsResult] = await Promise.all([
      supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('channel_id', channelId)
        .is('thread_root_id', null)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('forum_post_tags')
        .select('tag_id, root_message_id'),
    ])
    if (postsResult.data) setPosts(postsResult.data as unknown as MessageWithProfile[])
    if (tagsResult.data) setPostTags(tagsResult.data as Array<{ tag_id: string; root_message_id: string }>)
  }, [channelId])

  useRealtimeChannel({
    topic: `forum-${channelId}`,
    enabled: true,
    deps: [channelId, refetchPosts],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        handler: refetchPosts,
      },
    ],
  })

  const tagsByPostId = useMemo(() => {
    const map = new Map<string, ForumTag[]>()
    const tagById = new Map(tags.map(tag => [tag.id, tag]))
    for (const link of postTags) {
      const tag = tagById.get(link.tag_id)
      if (!tag) continue
      const list = map.get(link.root_message_id) ?? []
      list.push(tag)
      map.set(link.root_message_id, list)
    }
    return map
  }, [postTags, tags])

  const visiblePosts = useMemo(() => {
    const sorted = [...posts].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
    if (!filterTagId) return sorted
    return sorted.filter(post => tagsByPostId.get(post.id)?.some(tag => tag.id === filterTagId))
  }, [posts, filterTagId, tagsByPostId])

  function handleCreatePost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('channel_id', channelId)
    startTransition(async () => {
      const result = await createForumPost(formData)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setShowComposer(false)
      await refetchPosts()
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-[var(--text-primary)]">
            <span className="opacity-50">#</span> {channelName}
          </h2>
          {channelTopic && (
            <p className="truncate text-xs text-[var(--text-muted)]">{channelTopic}</p>
          )}
        </div>
        <button
          type="button"
          data-testid="new-forum-post-btn"
          onClick={() => {
            setError('')
            setShowComposer(true)
          }}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          New Post
        </button>
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-soft)] px-4 py-2">
          {tags.map(tag => (
            <button
              key={tag.id}
              type="button"
              data-testid={`forum-tag-filter-${tag.id}`}
              onClick={() => setFilterTagId(current => (current === tag.id ? null : tag.id))}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                filterTagId === tag.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'
              }`}
            >
              {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Post grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {visiblePosts.length === 0 ? (
          <div className="mt-10 text-center">
            <p className="text-sm font-semibold text-[var(--text-primary)]">No posts yet</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Start the first discussion with New Post.</p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {visiblePosts.map(post => {
              const postTagList = tagsByPostId.get(post.id) ?? []
              const title = post.thread_title ?? post.content.slice(0, 80)
              return (
                <li key={post.id}>
                  <button
                    type="button"
                    data-testid={`forum-post-${post.id}`}
                    onClick={() => setOpenPost(post)}
                    className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-[var(--accent)]/40 hover:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[var(--text-primary)]">{title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{post.content}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
                      <span className="flex items-center gap-1.5">
                        <Avatar
                          user={{
                            avatar_url: post.profiles?.avatar_url ?? null,
                            username: post.profiles?.username ?? '?',
                            display_name: post.profiles?.display_name ?? null,
                          }}
                          size={16}
                        />
                        {post.profiles?.display_name ?? post.profiles?.username}
                      </span>
                      <span>·</span>
                      <span>{post.thread_reply_count ?? 0} {post.thread_reply_count === 1 ? 'reply' : 'replies'}</span>
                      <span>·</span>
                      <span>{formatRelative(lastActivity(post))}</span>
                      {postTagList.map(tag => (
                        <span key={tag.id} className="rounded-full bg-white/5 px-2 py-0.5 font-semibold text-[var(--text-muted)]">
                          {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Post thread */}
      <ThreadPanel
        open={Boolean(openPost)}
        rootMessage={openPost}
        channelName={channelName}
        profile={profile}
        currentUserId={userId ?? profile.id}
        groupId={groupId}
        userRole={userRole}
        onClose={() => setOpenPost(null)}
      />

      {/* Composer */}
      <Modal
        open={showComposer}
        onClose={() => {
          if (isPending) return
          setShowComposer(false)
        }}
        title="New Forum Post"
      >
        <form onSubmit={handleCreatePost} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="forum-post-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Title
            </label>
            <input
              id="forum-post-title"
              name="title"
              type="text"
              required
              maxLength={100}
              autoComplete="off"
              placeholder="What is this post about?"
              className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="forum-post-content" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Message
            </label>
            <textarea
              id="forum-post-content"
              name="content"
              required
              rows={5}
              placeholder="Start the discussion..."
              className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {tags.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tags</legend>
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <label key={tag.id} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--text-primary)]">
                    <input type="checkbox" name="tag_ids" value={tag.id} className="h-3 w-3 accent-[var(--accent)]" />
                    {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {error && (
            <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                if (isPending) return
                setShowComposer(false)
              }}
              disabled={isPending}
              className="rounded px-4 py-2 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-forum-post"
              disabled={isPending}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? 'Posting…' : 'Create Post'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
