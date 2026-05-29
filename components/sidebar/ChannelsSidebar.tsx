'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import Avatar from '@/components/ui/Avatar'
import MembersPanel from '@/components/sidebar/MembersPanel'
import VoiceChannelsSection from '@/components/sidebar/VoiceChannelsSection'
import Modal from '@/components/ui/Modal'
import { logout } from '@/app/(auth)/actions'
import { deleteChannel, moveChannel, updateChannelSettings } from '@/app/(app)/channels/actions'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import type { Channel, Group, Profile } from '@/lib/types'

const DMSection = dynamic(() => import('@/components/dm/DMSection'), { ssr: false })

interface ChannelsSidebarProps {
  group: Group | null
  channels: Channel[]
  profile: Profile
  userRole: Role | null
  unreadChannelIds?: Set<string>
  unreadCountsByChannelId?: Map<string, number>
  onMarkChannelRead?: (channelId: string) => void | Promise<void>
  onMarkChannelUnread?: (channelId: string) => void | Promise<void>
  onCreateChannel?: () => void
  onGroupSettings?: () => void
  onMobileClose?: () => void
}

export default function ChannelsSidebar({
  group,
  channels,
  profile,
  userRole,
  unreadChannelIds = new Set(),
  unreadCountsByChannelId = new Map(),
  onMarkChannelRead,
  onMarkChannelUnread,
  onCreateChannel,
  onGroupSettings,
  onMobileClose,
}: ChannelsSidebarProps) {
  const params = useParams()
  const activeChannelId = params?.channelId as string | undefined
  const [channelSearch, setChannelSearch] = useState('')
  const [channelActionError, setChannelActionError] = useState('')
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const [isPending, startTransition] = useTransition()

  const canManage    = userRole ? PERMISSIONS.canManageChannels(userRole) : false
  const canManageGrp = userRole ? PERMISSIONS.canManageGroup(userRole) : false

  const visibleChannels = userRole === 'noob'
    ? channels.filter((c) => c.noob_access || c.name === 'welcome')
    : channels
  const textChannels = visibleChannels.filter(channel => (channel.kind ?? 'text') !== 'voice')
  const voiceChannels = visibleChannels.filter(channel => channel.kind === 'voice')
  const normalizedChannelSearch = channelSearch.trim().toLowerCase()
  const filteredChannels = useMemo(() => {
    if (!normalizedChannelSearch) return textChannels

    return textChannels.filter(channel => {
      const values = [channel.name, channel.description ?? ''].map(value => value.toLowerCase())
      return values.some(value => value.includes(normalizedChannelSearch))
    })
  }, [normalizedChannelSearch, textChannels])

  function handleDelete(channelId: string) {
    if (!group) return
    if (!confirm('Delete this channel? All messages will be lost.')) return
    setChannelActionError('')
    startTransition(async () => {
      const result = await deleteChannel(channelId, group.id)
      if (result && 'error' in result) setChannelActionError(result.error)
    })
  }

  function handleMove(channelId: string, direction: 'up' | 'down') {
    setChannelActionError('')
    startTransition(async () => {
      const result = await moveChannel(channelId, direction)
      if (result && 'error' in result) setChannelActionError(result.error)
    })
  }

  function handleSettingsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!settingsChannel) return
    setSettingsError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateChannelSettings(settingsChannel.id, formData)
      if ('error' in result) {
        setSettingsError(result.error)
        return
      }
      setSettingsChannel(null)
    })
  }

  const displayName = profile.display_name ?? profile.username

  return (
    <div
      style={{
        width: 236,
        flexShrink: 0,
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border-soft)',
      }}
    >
      {/* Group header */}
      {group && (
        <div style={{
          height: 56,
          flexShrink: 0,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-soft)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              data-testid="group-header-name"
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--text-primary)',
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {group.name}
            </div>
            {group.description && (
              <div
                data-testid="group-header-desc"
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  marginTop: 1,
                  fontStyle: 'italic',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.description}
              </div>
            )}
          </div>
          {canManageGrp && (
            <button
              data-testid="group-settings-btn"
              onClick={onGroupSettings}
              title="Group settings"
              className="icon-btn"
              style={{ marginLeft: 8, flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Scrollable body: channel list + DM section */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 6px' }}>
        {group ? (
          <>
            {/* Section label */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 10px 6px',
            }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}>
                Channels
              </span>
              {canManage && (
                <button
                  data-testid="create-channel-btn"
                  onClick={onCreateChannel}
                  className="icon-btn"
                  title="Create channel"
                  style={{ padding: 2 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>

            {userRole === 'noob' && visibleChannels.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px 8px', lineHeight: 1.5 }}>
                You don&apos;t have access to any channels yet. Ask an admin to promote your role.
              </p>
            )}

            {textChannels.length > 0 && (
              <div className="px-2 pb-2">
                <div className="relative">
                  <input
                    data-testid="channel-search-input"
                    className="w-full rounded border border-[var(--border-soft)] bg-[var(--bg-tertiary)] px-2 py-1.5 pr-7 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
                    type="search"
                    placeholder="Search channels..."
                    value={channelSearch}
                    onChange={e => setChannelSearch(e.target.value)}
                  />
                  {normalizedChannelSearch && (
                    <button
                      type="button"
                      data-testid="channel-search-clear"
                      aria-label="Clear channel search"
                      className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-sm leading-none text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
                      onClick={() => setChannelSearch('')}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            )}

            {textChannels.length > 0 && filteredChannels.length === 0 && (
              <p className="px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
                No channels match your search.
              </p>
            )}

            {channelActionError && (
              <p
                data-testid="channel-action-error"
                className="mx-2 mb-2 rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-2 py-1 text-xs text-[var(--danger)]"
              >
                {channelActionError}
              </p>
            )}

            {/* Channel rows */}
            {filteredChannels.map((channel) => {
              const isActive  = channel.id === activeChannelId
              const isUnread  = !isActive && unreadChannelIds.has(channel.id)
              const unreadCount = unreadCountsByChannelId.get(channel.id) ?? 0
              const allIdx    = textChannels.findIndex((c) => c.id === channel.id)
              const channelLabel = [
                `#${channel.name}`,
                isActive ? 'current channel' : null,
                isUnread
                  ? unreadCount > 0
                    ? `${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`
                    : 'unread'
                  : null,
              ].filter(Boolean).join(', ')

              return (
                <div
                  key={channel.id}
                  className="group/ch"
                  style={{ display: 'flex', alignItems: 'center', margin: '1px 0' }}
                >
                  <Link
                    href={`/channels/${channel.id}`}
                    aria-label={channelLabel}
                    onClick={onMobileClose}
                    className={`channel-row${isUnread ? ' font-medium' : ''}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '6px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      background: isActive ? 'var(--channel-active-bg)' : 'transparent',
                      textDecoration: 'none',
                      color: isActive || isUnread ? 'var(--text-primary)' : 'var(--text-muted)',
                      transition: 'background 120ms ease',
                      touchAction: 'manipulation',
                    }}
                  >
                    {/* Dot indicator */}
                    {isUnread ? (
                      <span
                        data-testid={`unread-dot-${channel.id}`}
                        style={{
                          width: 6, height: 6,
                          borderRadius: '50%',
                          background: 'var(--text-primary)',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <span style={{ width: 6, height: 6, flexShrink: 0 }} />
                    )}

                    {/* Channel name */}
                    <span style={{
                      fontSize: 14,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      <span style={{ opacity: 0.5 }}>#</span>{channel.name}
                    </span>

                    {isUnread && unreadCount > 0 && (
                      <span
                        data-testid={`unread-count-${channel.id}`}
                        style={{
                          minWidth: 18,
                          height: 18,
                          borderRadius: 9,
                          padding: '0 6px',
                          background: 'var(--accent)',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </Link>

                  {(onMarkChannelRead || onMarkChannelUnread || canManage) && (
                    <div className="flex md:hidden group-hover/ch:flex items-center gap-0.5 pr-1 flex-shrink-0">
                      {isUnread && onMarkChannelRead && (
                        <button
                          data-testid={`mark-read-${channel.id}`}
                          aria-label={`Mark #${channel.name} read`}
                          onClick={() => onMarkChannelRead(channel.id)}
                          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                          title="Mark channel read"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      )}
                      {!isActive && !isUnread && onMarkChannelUnread && (
                        <button
                          data-testid={`mark-unread-${channel.id}`}
                          aria-label={`Mark #${channel.name} unread`}
                          onClick={() => onMarkChannelUnread(channel.id)}
                          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                          title="Mark channel unread"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="7" />
                          </svg>
                        </button>
                      )}
                      {canManage && (
                        <>
                      <button
                        onClick={() => {
                          setSettingsError('')
                          setSettingsChannel(channel)
                        }}
                        disabled={isPending}
                        aria-label={`Edit #${channel.name} settings`}
                        className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                        title="Channel settings"
                      >
                        <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.757.427 1.757 2.925 0 3.352a1.724 1.724 0 00-1.066 2.572c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.757-2.924 1.757-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.757-.427-1.757-2.925 0-3.352a1.724 1.724 0 001.066-2.572c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                      <button
                        disabled={allIdx === 0 || isPending}
                        aria-label={`Move #${channel.name} up`}
                        onClick={() => handleMove(channel.id, 'up')}
                        className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                        title="Move up"
                      >
                        <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        disabled={allIdx === textChannels.length - 1 || isPending}
                        aria-label={`Move #${channel.name} down`}
                        onClick={() => handleMove(channel.id, 'down')}
                        className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                        title="Move down"
                      >
                        <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(channel.id)}
                        disabled={isPending}
                        aria-label={`Delete #${channel.name}`}
                        className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                        title="Delete channel"
                      >
                        <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Voice channel rows */}
            <VoiceChannelsSection channels={voiceChannels} onMobileClose={onMobileClose} />

            {/* Members panel (admin / moderator only) */}
            {(userRole === 'admin' || userRole === 'moderator') && (
              <MembersPanel
                groupId={group.id}
                currentUserId={profile.id}
                currentUserRole={userRole}
              />
            )}
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px' }}>
            Select a group to see its channels.
          </p>
        )}

        {/* DM section — always visible below channel list */}
        <DMSection currentUserId={profile.id} />
      </div>

      <Modal
        open={Boolean(settingsChannel)}
        onClose={() => {
          if (isPending) return
          setSettingsError('')
          setSettingsChannel(null)
        }}
        title={settingsChannel ? `#${settingsChannel.name} Settings` : 'Channel Settings'}
      >
        {settingsChannel && (
          <form onSubmit={handleSettingsSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="channel-settings-name"
                className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
              >
                Channel Name
              </label>
              <div className="flex items-center rounded border border-black/20 bg-[var(--bg-primary)] focus-within:ring-2 focus-within:ring-[var(--accent)]">
                <span className="pl-3 text-base text-[var(--text-muted)] select-none">#</span>
                <input
                  id="channel-settings-name"
                  name="name"
                  type="text"
                  required
                  maxLength={80}
                  defaultValue={settingsChannel.name}
                  className="flex-1 bg-transparent px-2 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="channel-settings-topic"
                className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
              >
                Topic
              </label>
              <textarea
                id="channel-settings-topic"
                name="description"
                rows={3}
                maxLength={180}
                defaultValue={settingsChannel.description ?? ''}
                className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder="What belongs in this channel?"
              />
            </div>

            <label className="flex items-start gap-3 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                name="noob_access"
                defaultChecked={Boolean(settingsChannel.noob_access || settingsChannel.name === 'welcome')}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-semibold">Visible to new members</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  Noob members can read and post in this channel before promotion.
                </span>
              </span>
            </label>

            {settingsError && (
              <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {settingsError}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPending) return
                  setSettingsError('')
                  setSettingsChannel(null)
                }}
                disabled={isPending}
                className="rounded px-4 py-2 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* User footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderTop: '1px solid var(--border-soft)',
          background: 'var(--bg-deepest)',
        }}
      >
        <Link
          href="/settings/profile"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          <Avatar user={profile} size={34} showStatus status="online" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              data-testid="user-footer-name"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </div>
            <div
              data-testid="user-footer-status"
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6aa08a', flexShrink: 0 }} />
              online
            </div>
          </div>
        </Link>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {userRole === 'admin' && (
            <a
              href="/admin"
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Admin
            </a>
          )}
          <Link
            href="/help"
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Help
          </Link>
          <form action={logout}>
            <button
              type="submit"
              title="Log out"
              className="icon-btn"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
