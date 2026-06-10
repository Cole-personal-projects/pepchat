'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import Avatar from '@/components/ui/Avatar'
import MembersPanel from '@/components/sidebar/MembersPanel'
import ChannelRow from '@/components/sidebar/ChannelRow'
import CategorySection from '@/components/sidebar/CategorySection'
import VoiceChannelsSection from '@/components/sidebar/VoiceChannelsSection'
import UserStatusMenu from '@/components/status/UserStatusMenu'
import EventsPanel from '@/components/events/EventsPanel'
import Modal from '@/components/ui/Modal'
import { logout } from '@/app/(auth)/actions'
import { deleteChannel, moveChannel, updateChannelSettings } from '@/app/(app)/channels/actions'
import { createCategory, deleteCategory, moveCategory, renameCategory } from '@/app/(app)/categories/actions'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import type { Channel, ChannelCategory, Group, Profile } from '@/lib/types'

const DMSection = dynamic(() => import('@/components/dm/DMSection'), { ssr: false })

interface ChannelsSidebarProps {
  group: Group | null
  channels: Channel[]
  categories?: ChannelCategory[]
  profile: Profile
  userRole: Role | null
  unreadChannelIds?: Set<string>
  unreadCountsByChannelId?: Map<string, number>
  onMarkChannelRead?: (channelId: string) => void | Promise<void>
  onMarkChannelUnread?: (channelId: string) => void | Promise<void>
  onCreateChannel?: (categoryId?: string) => void
  onGroupSettings?: () => void
  onMobileClose?: () => void
}

type CategoryModalState =
  | { mode: 'create' }
  | { mode: 'rename'; categoryId: string; currentName: string }
  | null

function collapsedStorageKey(groupId: string) {
  return `sidebar-collapsed-categories-${groupId}`
}

function readCollapsedCategories(groupId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(collapsedStorageKey(groupId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

export default function ChannelsSidebar({
  group,
  channels,
  categories = [],
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
  const [categoryModal, setCategoryModal] = useState<CategoryModalState>(null)
  const [categoryError, setCategoryError] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  const canManage    = userRole ? PERMISSIONS.canManageChannels(userRole) : false
  const canManageGrp = userRole ? PERMISSIONS.canManageGroup(userRole) : false

  useEffect(() => {
    if (group) setCollapsedCategories(readCollapsedCategories(group.id))
  }, [group?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = useCallback((categoryId: string) => {
    if (!group) return
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      try {
        window.localStorage.setItem(collapsedStorageKey(group.id), JSON.stringify([...next]))
      } catch {
        // Persistence is best-effort; collapse still works in-memory.
      }
      return next
    })
  }, [group])

  const visibleChannels = useMemo(() => (
    userRole === 'noob'
      ? channels.filter((c) => c.noob_access || c.name === 'welcome')
      : channels
  ), [channels, userRole])
  const textChannels = useMemo(
    () => visibleChannels.filter(channel => (channel.kind ?? 'text') !== 'voice'),
    [visibleChannels],
  )
  const voiceChannels = useMemo(
    () => visibleChannels.filter(channel => channel.kind === 'voice'),
    [visibleChannels],
  )
  const normalizedChannelSearch = channelSearch.trim().toLowerCase()
  const filteredChannels = useMemo(() => {
    if (!normalizedChannelSearch) return textChannels

    return textChannels.filter(channel => {
      const values = [channel.name, channel.description ?? ''].map(value => value.toLowerCase())
      return values.some(value => value.includes(normalizedChannelSearch))
    })
  }, [normalizedChannelSearch, textChannels])

  /** Channels grouped into the uncategorized bucket + ordered category sections. */
  const sections = useMemo(() => {
    const knownCategoryIds = new Set(categories.map(c => c.id))
    const uncategorized = filteredChannels.filter(
      c => !c.category_id || !knownCategoryIds.has(c.category_id),
    )
    const byCategory = categories.map(category => ({
      category,
      channels: filteredChannels.filter(c => c.category_id === category.id),
    }))
    return { uncategorized, byCategory }
  }, [filteredChannels, categories])

  /** Move bounds are evaluated within the channel's own section. */
  const sectionPeers = useCallback((channel: Channel) => {
    const knownCategoryIds = new Set(categories.map(c => c.id))
    const channelCategoryId =
      channel.category_id && knownCategoryIds.has(channel.category_id) ? channel.category_id : null
    return channels.filter(c => {
      const cCategoryId = c.category_id && knownCategoryIds.has(c.category_id) ? c.category_id : null
      return cCategoryId === channelCategoryId
    })
  }, [channels, categories])

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

  function handleCategoryMove(categoryId: string, direction: 'up' | 'down') {
    setChannelActionError('')
    startTransition(async () => {
      const result = await moveCategory(categoryId, direction)
      if (result && 'error' in result) setChannelActionError(result.error)
    })
  }

  function handleCategoryDelete(categoryId: string) {
    if (!confirm('Delete this category? Its channels move out of the category.')) return
    setChannelActionError('')
    startTransition(async () => {
      const result = await deleteCategory(categoryId)
      if (result && 'error' in result) setChannelActionError(result.error)
    })
  }

  function handleCategorySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!categoryModal || !group) return
    setCategoryError('')
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string | null) ?? ''
    startTransition(async () => {
      const result =
        categoryModal.mode === 'create'
          ? await (async () => {
              formData.set('group_id', group.id)
              return createCategory(formData)
            })()
          : await renameCategory(categoryModal.categoryId, name)
      if (result && 'error' in result) {
        setCategoryError(result.error)
        return
      }
      setCategoryModal(null)
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

  function renderChannelRow(channel: Channel) {
    const isActive  = channel.id === activeChannelId
    const isUnread  = !isActive && unreadChannelIds.has(channel.id)
    const peers     = sectionPeers(channel)
    const peerIdx   = peers.findIndex(c => c.id === channel.id)

    return (
      <ChannelRow
        key={channel.id}
        channel={channel}
        isActive={isActive}
        isUnread={isUnread}
        unreadCount={unreadCountsByChannelId.get(channel.id) ?? 0}
        canManage={canManage}
        isPending={isPending}
        canMoveUp={peerIdx > 0}
        canMoveDown={peerIdx !== -1 && peerIdx < peers.length - 1}
        onMobileClose={onMobileClose}
        onMarkChannelRead={onMarkChannelRead}
        onMarkChannelUnread={onMarkChannelUnread}
        onEditSettings={(ch) => {
          setSettingsError('')
          setSettingsChannel(ch)
        }}
        onMove={handleMove}
        onDelete={handleDelete}
      />
    )
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
            {/* Scheduled events */}
            <EventsPanel
              groupId={group.id}
              currentUserId={profile.id}
              voiceChannels={voiceChannels}
              canCreate={Boolean(userRole && userRole !== 'noob')}
              onMobileClose={onMobileClose}
            />

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
                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    data-testid="create-category-btn"
                    onClick={() => {
                      setCategoryError('')
                      setCategoryModal({ mode: 'create' })
                    }}
                    className="icon-btn"
                    title="Create category"
                    style={{ padding: 2 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <path d="M12 11v6M9 14h6" />
                    </svg>
                  </button>
                  <button
                    data-testid="create-channel-btn"
                    onClick={() => onCreateChannel?.()}
                    className="icon-btn"
                    title="Create channel"
                    style={{ padding: 2 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </span>
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

            {/* Uncategorized channels */}
            {sections.uncategorized.map(renderChannelRow)}

            {/* Category sections */}
            {sections.byCategory.map(({ category, channels: sectionChannels }, index) => {
              const isCollapsed = collapsedCategories.has(category.id) && !normalizedChannelSearch
              // Discord behavior: collapsed categories still surface unread + active channels.
              const rows = isCollapsed
                ? sectionChannels.filter(c => c.id === activeChannelId || unreadChannelIds.has(c.id))
                : sectionChannels
              if (normalizedChannelSearch && sectionChannels.length === 0) return null

              return (
                <CategorySection
                  key={category.id}
                  categoryId={category.id}
                  name={category.name}
                  collapsed={isCollapsed}
                  canManage={canManage}
                  isPending={isPending}
                  canMoveUp={index > 0}
                  canMoveDown={index < sections.byCategory.length - 1}
                  onToggle={toggleCategory}
                  onCreateChannel={onCreateChannel ? (categoryId) => onCreateChannel(categoryId) : undefined}
                  onRename={(categoryId, currentName) => {
                    setCategoryError('')
                    setCategoryModal({ mode: 'rename', categoryId, currentName })
                  }}
                  onMove={handleCategoryMove}
                  onDelete={handleCategoryDelete}
                >
                  {rows.map(renderChannelRow)}
                </CategorySection>
              )
            })}

            {/* Voice channel rows */}
            <VoiceChannelsSection
              channels={voiceChannels}
              groupId={group.id}
              canCreateRoom={Boolean(userRole && PERMISSIONS.canCreateTempVoiceChannel(userRole))}
              onMobileClose={onMobileClose}
            />

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

        {/* Friends entry */}
        <Link
          href="/friends"
          data-testid="friends-link"
          onClick={onMobileClose}
          className="channel-row"
          style={{
            margin: '10px 0 0',
            padding: '6px 10px',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Friends
        </Link>

        {/* DM section — always visible below channel list */}
        <DMSection currentUserId={profile.id} />
      </div>

      {/* Category create/rename modal */}
      <Modal
        open={Boolean(categoryModal)}
        onClose={() => {
          if (isPending) return
          setCategoryError('')
          setCategoryModal(null)
        }}
        title={categoryModal?.mode === 'rename' ? 'Rename Category' : 'Create Category'}
      >
        {categoryModal && (
          <form onSubmit={handleCategorySubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="category-name"
                className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
              >
                Category Name
              </label>
              <input
                id="category-name"
                name="name"
                type="text"
                required
                maxLength={60}
                autoComplete="off"
                defaultValue={categoryModal.mode === 'rename' ? categoryModal.currentName : ''}
                className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder="Voice Rooms"
              />
            </div>

            {categoryError && (
              <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {categoryError}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPending) return
                  setCategoryError('')
                  setCategoryModal(null)
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
                {isPending
                  ? 'Saving...'
                  : categoryModal.mode === 'rename'
                    ? 'Save Changes'
                    : 'Create Category'}
              </button>
            </div>
          </form>
        )}
      </Modal>

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

            {categories.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="channel-settings-category"
                  className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                >
                  Category
                </label>
                <select
                  id="channel-settings-category"
                  name="category_id"
                  defaultValue={settingsChannel.category_id ?? ''}
                  className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">No category</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            )}

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Link href="/settings/profile" style={{ flexShrink: 0, display: 'flex', textDecoration: 'none' }}>
            <Avatar user={profile} size={34} showStatus status="online" />
          </Link>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Link
              href="/settings/profile"
              data-testid="user-footer-name"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: 'none',
              }}
            >
              {displayName}
            </Link>
            <div data-testid="user-footer-status">
              <UserStatusMenu userId={profile.id} />
            </div>
          </div>
        </div>
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
