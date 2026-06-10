'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Avatar from '@/components/ui/Avatar'
import { acceptFriendRequest, blockUser, removeFriendship, sendFriendRequest } from '@/app/(app)/friends/actions'
import { useFriends, type FriendshipWithProfile } from '@/lib/hooks/useFriends'
import type { PresenceMode } from '@/lib/types'

type Tab = 'all' | 'pending' | 'blocked'

const AVATAR_STATUS: Record<PresenceMode, 'online' | 'away' | 'dnd' | 'offline'> = {
  online: 'online',
  idle: 'away',
  dnd: 'dnd',
  invisible: 'offline',
}

interface FriendsViewProps {
  currentUserId: string
}

export default function FriendsView({ currentUserId }: FriendsViewProps) {
  const { grouped, loading, refetch } = useFriends(currentUserId)
  const [tab, setTab] = useState<Tab>('all')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function run(action: () => Promise<{ error: string } | { ok: true }>, successNotice = '') {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      if (successNotice) setNotice(successNotice)
      await refetch()
    })
  }

  function handleSendRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = username.trim()
    if (!value) return
    setUsername('')
    run(() => sendFriendRequest(value), 'Friend request sent.')
  }

  async function handleMessage(userId: string) {
    const supabase = createClient()
    const { data: convId } = await supabase.rpc('get_or_create_dm', { other_user_id: userId })
    if (convId) router.push(`/dm/${convId}`)
  }

  function renderRow(friendship: FriendshipWithProfile, kind: 'friend' | 'incoming' | 'outgoing' | 'blocked') {
    const name = friendship.other?.display_name ?? friendship.other?.username ?? 'Unknown user'
    const presence = friendship.otherStatus?.presence ?? 'invisible'
    const custom = [friendship.otherStatus?.status_emoji, friendship.otherStatus?.status_text].filter(Boolean).join(' ')

    return (
      <li
        key={friendship.id}
        data-testid={`friend-row-${friendship.id}`}
        className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5"
      >
        <Avatar
          user={{
            avatar_url: friendship.other?.avatar_url ?? null,
            username: friendship.other?.username ?? '?',
            display_name: friendship.other?.display_name ?? null,
          }}
          size={36}
          showStatus={kind === 'friend'}
          status={AVATAR_STATUS[presence]}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {kind === 'incoming' && 'Incoming friend request'}
            {kind === 'outgoing' && 'Outgoing friend request'}
            {kind === 'blocked' && 'Blocked'}
            {kind === 'friend' && (custom || presence)}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {kind === 'friend' && (
            <>
              <button
                type="button"
                onClick={() => handleMessage(friendship.other?.id ?? '')}
                disabled={isPending || !friendship.other}
                className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-50"
              >
                Message
              </button>
              <button
                type="button"
                aria-label={`Remove ${name} as a friend`}
                onClick={() => {
                  if (confirm(`Remove ${name} from your friends?`)) run(() => removeFriendship(friendship.id))
                }}
                disabled={isPending}
                className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
              >
                Remove
              </button>
            </>
          )}
          {kind === 'incoming' && (
            <>
              <button
                type="button"
                data-testid={`accept-${friendship.id}`}
                onClick={() => run(() => acceptFriendRequest(friendship.id), 'Friend request accepted.')}
                disabled={isPending}
                className="rounded bg-[var(--accent)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                data-testid={`decline-${friendship.id}`}
                onClick={() => run(() => removeFriendship(friendship.id))}
                disabled={isPending}
                className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-white/10 disabled:opacity-50"
              >
                Decline
              </button>
            </>
          )}
          {kind === 'outgoing' && (
            <button
              type="button"
              onClick={() => run(() => removeFriendship(friendship.id))}
              disabled={isPending}
              className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {kind === 'blocked' && (
            <button
              type="button"
              onClick={() => run(() => removeFriendship(friendship.id), 'User unblocked.')}
              disabled={isPending}
              className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-white/10 disabled:opacity-50"
            >
              Unblock
            </button>
          )}
          {kind !== 'blocked' && friendship.other && (
            <button
              type="button"
              aria-label={`Block ${name}`}
              onClick={() => {
                if (confirm(`Block ${name}? They will no longer be able to friend you.`)) {
                  run(() => blockUser(friendship.other!.id), 'User blocked.')
                }
              }}
              disabled={isPending}
              className="rounded bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
            >
              Block
            </button>
          )}
        </div>
      </li>
    )
  }

  const pendingCount = grouped.incoming.length + grouped.outgoing.length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Friends</h1>

        <form onSubmit={handleSendRequest} className="mt-4 flex items-center gap-2">
          <input
            data-testid="add-friend-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Add a friend by username"
            className="flex-1 rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            type="submit"
            data-testid="send-friend-request-btn"
            disabled={isPending || !username.trim()}
            className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send Request
          </button>
        </form>

        {error && (
          <p className="mt-3 rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <div className="mt-5 flex items-center gap-1 border-b border-white/10 pb-2">
          {([
            { id: 'all', label: `All — ${grouped.accepted.length}` },
            { id: 'pending', label: `Pending — ${pendingCount}` },
            { id: 'blocked', label: `Blocked — ${grouped.blocked.length}` },
          ] as Array<{ id: Tab; label: string }>).map(item => (
            <button
              key={item.id}
              type="button"
              data-testid={`friends-tab-${item.id}`}
              onClick={() => setTab(item.id)}
              className={`rounded px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === item.id
                  ? 'bg-white/10 text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {tab === 'all' && (
              grouped.accepted.length > 0
                ? grouped.accepted.map(f => renderRow(f, 'friend'))
                : <p className="text-sm text-[var(--text-muted)]">No friends yet — send a request above.</p>
            )}
            {tab === 'pending' && (
              pendingCount > 0
                ? [
                    ...grouped.incoming.map(f => renderRow(f, 'incoming')),
                    ...grouped.outgoing.map(f => renderRow(f, 'outgoing')),
                  ]
                : <p className="text-sm text-[var(--text-muted)]">No pending requests.</p>
            )}
            {tab === 'blocked' && (
              grouped.blocked.length > 0
                ? grouped.blocked.map(f => renderRow(f, 'blocked'))
                : <p className="text-sm text-[var(--text-muted)]">You have not blocked anyone.</p>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
