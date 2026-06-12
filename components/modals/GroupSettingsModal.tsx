'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import dynamic from 'next/dynamic'
import ModalShell from '@/components/ui/ModalShell'
import GroupIcon from '@/components/ui/GroupIcon'
import { leaveGroup, deleteGroup, transferOwnership, uploadGroupIcon, removeGroupIcon, updateGroupDetails, updateStarboardSettings, regenerateGroupInvite, listGroupInvites, revokeGroupInvite } from '@/app/(app)/groups/actions'
import { useMembersList } from '@/lib/hooks/useMembersList'
import { useChannels } from '@/lib/hooks/useChannels'
import type { Group } from '@/lib/types'

const AvatarCropModal = dynamic(() => import('@/components/profile/AvatarCropModal'), { ssr: false })
const RolesManager = dynamic(() => import('@/components/roles/RolesManager'), { ssr: false })
const OnboardingConfig = dynamic(() => import('@/components/onboarding/OnboardingConfig'), { ssr: false })

type NavItem = 'overview' | 'roles' | 'onboarding' | 'invite' | 'moderation' | 'danger'

type ManagedInvite = {
  id: string
  code: string
  created_at: string
  expires_at: string | null
  max_uses: number | null
  uses_count: number
  revoked_at: string | null
  profiles?: { username: string | null } | null
}

type InviteUse = {
  id: string
  used_at: string
  group_invites?: { code: string } | null
  profiles?: { username: string | null } | null
}

interface GroupSettingsModalProps {
  open: boolean
  onClose: () => void
  group: Group
  isOwner: boolean
  /** Used to gate the true-ownership controls (transfer) to groups.owner_id. */
  currentUserId?: string | null
  onIconChange?: () => void
}

export default function GroupSettingsModal({ open, onClose, group, isOwner, currentUserId = null, onIconChange }: GroupSettingsModalProps) {
  const [nav, setNav] = useState<NavItem>('overview')
  const [error, setError] = useState('')
  const [detailsNotice, setDetailsNotice] = useState('')
  const [inviteNotice, setInviteNotice] = useState('')
  const [managedInvites, setManagedInvites] = useState<ManagedInvite[]>([])
  const [inviteUses, setInviteUses] = useState<InviteUse[]>([])
  const [inviteMaxUses, setInviteMaxUses] = useState('')
  const [inviteExpiresAt, setInviteExpiresAt] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [confirmTransfer, setConfirmTransfer] = useState(false)
  const [transferNotice, setTransferNotice] = useState('')
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')

  // Icon upload state
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [pendingIcon, setPendingIcon] = useState<{ dataUrl: string; ext: string } | null>(null)
  const [localIconUrl, setLocalIconUrl] = useState<string | null>(group.icon_url)
  const [iconError, setIconError] = useState('')
  const [iconSaving, setIconSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Starboard config (overview pane, owner-editable)
  const { channels: groupChannels } = useChannels(open ? group.id : null)
  const starboardChannelOptions = groupChannels.filter(channel => (channel.kind ?? 'text') !== 'voice')
  const [starboardChannelId, setStarboardChannelId] = useState(group.starboard_channel_id ?? '')
  const [starboardThreshold, setStarboardThreshold] = useState(group.starboard_threshold ?? 3)
  const [starboardNotice, setStarboardNotice] = useState('')
  const [starboardSaving, setStarboardSaving] = useState(false)

  useEffect(() => {
    setStarboardChannelId(group.starboard_channel_id ?? '')
    setStarboardThreshold(group.starboard_threshold ?? 3)
  }, [group.starboard_channel_id, group.starboard_threshold])

  async function handleSaveStarboard() {
    setError('')
    setStarboardNotice('')
    setStarboardSaving(true)
    const result = await updateStarboardSettings(group.id, starboardChannelId || null, starboardThreshold)
    if (result && 'error' in result) setError(result.error)
    else setStarboardNotice(starboardChannelId ? 'Starboard saved.' : 'Starboard turned off.')
    setStarboardSaving(false)
  }

  const [inviteCode, setInviteCode] = useState(group.invite_code)
  const [inviteOrigin, setInviteOrigin] = useState('')
  const inviteLink = `${inviteOrigin}/join/${inviteCode}`
  useEffect(() => {
    setInviteOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    setInviteCode(group.invite_code)
  }, [group.invite_code])

  useEffect(() => {
    if (!open || nav !== 'invite' || !isOwner) return
    refreshInvites()
  }, [open, nav, isOwner, group.id])

  useEffect(() => {
    setName(group.name)
    setDescription(group.description ?? '')
  }, [group.name, group.description])

  // Sync localIconUrl if the prop updates (e.g. via Realtime)
  useEffect(() => {
    if (!pendingIcon) setLocalIconUrl(group.icon_url)
  }, [group.icon_url, pendingIcon])

  function handleIconFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIconError('')
    if (file.size > 4 * 1024 * 1024) { setIconError('Photo must be under 4MB.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setIconError('Please use JPEG, PNG, WebP, or GIF.'); return
    }
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function handleCropApply(dataUrl: string, ext: string) {
    setCropSrc(null)
    setPendingIcon({ dataUrl, ext })
    setLocalIconUrl(dataUrl)
  }

  function handleSaveIcon() {
    if (!pendingIcon) return
    setIconError('')
    setIconSaving(true)
    startTransition(async () => {
      const result = await uploadGroupIcon(group.id, pendingIcon)
      setIconSaving(false)
      if ('error' in result) {
        setIconError(result.error)
      } else {
        setPendingIcon(null)
        setLocalIconUrl(result.icon_url)
        onIconChange?.()
      }
    })
  }

  function handleRemoveIcon() {
    setIconError('')
    startTransition(async () => {
      const result = await removeGroupIcon(group.id)
      if ('error' in result) {
        setIconError(result.error)
      } else {
        setPendingIcon(null)
        setLocalIconUrl(null)
        onIconChange?.()
      }
    })
  }

  function handleSaveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setDetailsNotice('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateGroupDetails(group.id, formData)
      if ('error' in result) {
        setError(result.error)
      } else {
        setDetailsNotice('Group details saved.')
        onIconChange?.()
      }
    })
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleRegenerateInvite() {
    setError('')
    setInviteNotice('')
    setCopied(false)
    const formData = new FormData()
    if (inviteMaxUses) formData.set('max_uses', inviteMaxUses)
    if (inviteExpiresAt) formData.set('expires_at', inviteExpiresAt)
    startTransition(async () => {
      const result = await regenerateGroupInvite(group.id, formData)
      if ('error' in result) {
        setError(result.error)
      } else {
        setInviteCode(result.invite_code)
        setInviteNotice('Invite link regenerated.')
        setInviteMaxUses('')
        setInviteExpiresAt('')
        await refreshInvites()
        onIconChange?.()
      }
    })
  }

  async function refreshInvites() {
    const result = await listGroupInvites(group.id)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setManagedInvites(result.invites)
    setInviteUses(result.uses)
  }

  function handleRevokeInvite(inviteId: string) {
    setError('')
    setInviteNotice('')
    startTransition(async () => {
      const result = await revokeGroupInvite(inviteId, group.id)
      if ('error' in result) {
        setError(result.error)
      } else {
        setInviteNotice('Invite revoked.')
        await refreshInvites()
      }
    })
  }

  const isTrueOwner = currentUserId !== null && currentUserId === group.owner_id
  // Members are only needed for the transfer picker — fetch when relevant.
  const { members } = useMembersList(open && nav === 'danger' && isTrueOwner ? group.id : '')
  const transferCandidates = members.filter(member => member.user_id !== currentUserId)

  function handleTransferOwnership() {
    if (!transferTargetId) return
    if (!confirmTransfer) {
      setConfirmTransfer(true)
      return
    }
    setError('')
    setTransferNotice('')
    startTransition(async () => {
      const result = await transferOwnership(group.id, transferTargetId)
      if (result && 'error' in result) {
        setError(result.error)
      } else {
        setTransferNotice('Ownership transferred. You are now an admin.')
        onIconChange?.()
      }
      setConfirmTransfer(false)
      setTransferTargetId('')
    })
  }

  function handleLeave() {
    setError('')
    startTransition(async () => {
      const result = await leaveGroup(group.id)
      if (result?.error) setError(result.error)
    })
  }

  function handleDelete() {
    setError('')
    startTransition(async () => {
      const result = await deleteGroup(group.id)
      if (result?.error) setError(result.error)
    })
  }

  const navItems: { id: NavItem; label: string; testId: string }[] = [
    { id: 'overview', label: 'Overview',   testId: 'nav-overview' },
    { id: 'roles',    label: 'Roles',      testId: 'nav-roles' },
    { id: 'onboarding', label: 'Onboarding', testId: 'nav-onboarding' },
    { id: 'invite',   label: 'Invite Link', testId: 'nav-invite' },
    { id: 'moderation', label: 'Moderation', testId: 'nav-moderation' },
    { id: 'danger',   label: 'Danger Zone', testId: 'nav-danger' },
  ]

  return (
    <>
      <ModalShell open={open} onClose={onClose} title={group.name} size="lg">
        <div className="flex max-md:flex-col gap-0 -mx-6 -mt-4 min-h-[280px]">
          {/* Section nav: left rail on desktop, horizontal tab bar on mobile */}
          <nav className="md:w-44 md:flex-shrink-0 md:border-r border-white/10 py-2 px-2 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:px-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                data-testid={item.testId}
                onClick={() => setNav(item.id)}
                className={`md:w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors max-md:flex-shrink-0 max-md:whitespace-nowrap ${
                  nav === item.id
                    ? 'bg-white/10 text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 px-6 max-md:px-4 py-4 overflow-y-auto">
            {error && (
              <p className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-lg px-3 py-2 mb-4">
                {error}
              </p>
            )}

            {nav === 'roles' && (
              <div data-testid="roles-pane">
                <RolesManager groupId={group.id} />
              </div>
            )}

            {nav === 'onboarding' && (
              <div data-testid="onboarding-pane">
                <OnboardingConfig groupId={group.id} />
              </div>
            )}

            {nav === 'overview' && (
              <div data-testid="overview-pane" className="flex flex-col gap-4">
                <form onSubmit={handleSaveDetails} className="flex flex-col gap-3">
                  <div>
                    <label htmlFor="group-name" className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                      Group Name
                    </label>
                    <input
                      id="group-name"
                      name="name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      disabled={!isOwner || isPending}
                      maxLength={100}
                      className="w-full rounded-lg border border-white/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label htmlFor="group-description" className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                      Description
                    </label>
                    <textarea
                      id="group-description"
                      name="description"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      disabled={!isOwner || isPending}
                      maxLength={180}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-white/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
                      placeholder="What is this group for?"
                    />
                    <p className="mt-1 text-[10px] text-[var(--text-faint)]">{description.length}/180</p>
                  </div>
                  {isOwner && (
                    <button
                      type="submit"
                      disabled={isPending}
                      className="self-start px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-60"
                    >
                      {isPending ? 'Saving...' : 'Save details'}
                    </button>
                  )}
                  {detailsNotice && <p className="text-xs text-[var(--success)]">{detailsNotice}</p>}
                </form>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">
                    Group Photo
                  </p>
                  <div className="flex items-center gap-4">
                    <GroupIcon
                      group={{ ...group, icon_url: localIconUrl }}
                      size={72}
                    />
                    {isOwner && (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/15 text-[var(--text-primary)] transition-colors"
                          >
                            Upload photo
                          </button>
                          {localIconUrl && (
                            <button
                              type="button"
                              onClick={handleRemoveIcon}
                              disabled={isPending}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--danger)] border border-[var(--danger)]/20 hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-60"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {pendingIcon && (
                          <button
                            type="button"
                            onClick={handleSaveIcon}
                            disabled={iconSaving}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-60"
                          >
                            {iconSaving ? 'Saving…' : 'Save changes'}
                          </button>
                        )}
                        <p className="text-[10px] text-[var(--text-faint)]">
                          JPEG, PNG, WebP, GIF · Max 4MB
                        </p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleIconFileSelect}
                  />
                  {iconError && (
                    <p className="text-xs text-[var(--danger)] mt-2">{iconError}</p>
                  )}
                </div>

                <div data-testid="starboard-settings">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">
                    Starboard
                  </p>
                  <p className="text-xs text-[var(--text-faint)] mb-3">
                    Messages that collect enough ⭐ reactions get reposted to a highlights channel.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="starboard-channel" className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">
                        Highlights channel
                      </label>
                      <select
                        id="starboard-channel"
                        data-testid="starboard-channel-select"
                        value={starboardChannelId}
                        onChange={e => setStarboardChannelId(e.target.value)}
                        disabled={!isOwner || starboardSaving}
                        className="rounded-lg border border-white/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
                      >
                        <option value="">Off</option>
                        {starboardChannelOptions.map(channel => (
                          <option key={channel.id} value={channel.id}>#{channel.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="starboard-threshold" className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">
                        Stars needed
                      </label>
                      <input
                        id="starboard-threshold"
                        data-testid="starboard-threshold-input"
                        type="number"
                        min={1}
                        max={50}
                        value={starboardThreshold}
                        onChange={e => setStarboardThreshold(Number(e.target.value))}
                        disabled={!isOwner || starboardSaving}
                        className="w-20 rounded-lg border border-white/10 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
                      />
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        data-testid="starboard-save"
                        onClick={handleSaveStarboard}
                        disabled={starboardSaving}
                        className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-60"
                      >
                        {starboardSaving ? 'Saving...' : 'Save starboard'}
                      </button>
                    )}
                  </div>
                  {starboardNotice && <p className="mt-2 text-xs text-[var(--success)]" data-testid="starboard-notice">{starboardNotice}</p>}
                </div>
              </div>
            )}

            {nav === 'invite' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                    Invite Link
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={inviteLink}
                      className="flex-1 bg-[var(--bg-primary)] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-muted)] select-all"
                    />
                    <button
                      onClick={handleCopy}
                      className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors whitespace-nowrap"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Share this link so others can join with the code{' '}
                    <code className="font-mono bg-black/20 px-1 rounded">{inviteCode}</code>
                  </p>
                  {isOwner && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/10 bg-[var(--bg-primary)] p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-[var(--text-muted)]">
                          Max uses
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={inviteMaxUses}
                            onChange={e => setInviteMaxUses(e.target.value)}
                            placeholder="Unlimited"
                            className="mt-1 w-full rounded border border-white/10 bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none"
                          />
                        </label>
                        <label className="text-xs text-[var(--text-muted)]">
                          Expires
                          <input
                            type="datetime-local"
                            value={inviteExpiresAt}
                            onChange={e => setInviteExpiresAt(e.target.value)}
                            className="mt-1 w-full rounded border border-white/10 bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleRegenerateInvite}
                        disabled={isPending}
                        className="self-start px-3 py-2 text-xs font-semibold rounded-lg text-[var(--danger)] border border-[var(--danger)]/20 hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-60"
                      >
                        {isPending ? 'Creating...' : 'Create new invite link'}
                      </button>
                    </div>
                  )}
                  {inviteNotice && <p className="text-xs text-[var(--success)] mt-2">{inviteNotice}</p>}
                </div>

                {isOwner && managedInvites.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Invite History
                    </p>
                    {managedInvites.map(invite => (
                      <div key={invite.id} className="rounded-lg border border-white/10 bg-[var(--bg-primary)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs text-[var(--text-primary)]">{invite.code}</p>
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              Created by @{invite.profiles?.username ?? 'unknown'} on {formatDate(invite.created_at)}
                            </p>
                            <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                              {invite.uses_count}{invite.max_uses ? `/${invite.max_uses}` : ''} uses
                              {invite.expires_at ? ` · expires ${formatDate(invite.expires_at)}` : ' · no expiration'}
                              {invite.revoked_at ? ' · revoked' : ''}
                            </p>
                          </div>
                          {!invite.revoked_at && (
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(invite.id)}
                              disabled={isPending}
                              className="flex-shrink-0 rounded border border-[var(--danger)]/20 px-2 py-1 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-60"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isOwner && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Recent Uses
                    </p>
                    {inviteUses.length === 0 ? (
                      <p className="text-xs text-[var(--text-faint)]">No invite usage yet.</p>
                    ) : inviteUses.map(use => (
                      <p key={use.id} className="text-xs text-[var(--text-muted)]">
                        @{use.profiles?.username ?? 'unknown'} used {use.group_invites?.code ?? 'an invite'} on {formatDate(use.used_at)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {nav === 'moderation' && (
              <div className="flex flex-col gap-3" data-testid="moderation-pane">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Admin Visibility
                </p>
                <div className="rounded-lg border border-white/10 bg-[var(--bg-primary)] p-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Reports and audit history</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                    Use the admin dashboard to review reported messages, check moderation actions, and recover context before deleting content.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href="/admin/reports"
                      className="rounded bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                    >
                      Open reports
                    </a>
                    <a
                      href="/admin/audit"
                      className="rounded border border-white/10 px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-white/10"
                    >
                      View audit log
                    </a>
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[var(--bg-primary)] p-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Recommended cadence</p>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>Review pending reports before promoting new members.</li>
                    <li>Keep #welcome open to noobs and move detailed discussion into regular channels.</li>
                    <li>Use limited invites when sharing outside trusted circles.</li>
                  </ul>
                </div>
              </div>
            )}

            {nav === 'danger' && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  Danger Zone
                </p>

                {transferNotice && (
                  <p data-testid="transfer-notice" className="text-xs text-[var(--success)]">{transferNotice}</p>
                )}

                {isTrueOwner && (
                  <div data-testid="transfer-ownership" className="flex flex-col gap-2 rounded-lg border border-white/10 bg-[var(--bg-primary)] p-3">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">♛ Transfer Ownership</p>
                    <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                      Hand this server to another member. They become the owner with full control;
                      you stay on as an admin. This cannot be undone from the app.
                    </p>
                    <select
                      data-testid="transfer-target-select"
                      value={transferTargetId}
                      onChange={e => { setTransferTargetId(e.target.value); setConfirmTransfer(false) }}
                      disabled={isPending}
                      className="w-full rounded border border-white/10 bg-[var(--bg-secondary)] px-2 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
                    >
                      <option value="">Choose the new owner…</option>
                      {transferCandidates.map(member => (
                        <option key={member.user_id} value={member.user_id}>
                          {(member.profiles as any)?.display_name ?? member.profiles?.username ?? member.user_id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="transfer-ownership-btn"
                      onClick={handleTransferOwnership}
                      disabled={isPending || !transferTargetId}
                      className={`self-start px-3 py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                        confirmTransfer
                          ? 'bg-[var(--danger)] text-white'
                          : 'text-[var(--danger)] border border-[var(--danger)]/20 hover:bg-[var(--danger)]/10'
                      }`}
                    >
                      {isPending
                        ? 'Transferring…'
                        : confirmTransfer
                          ? 'Tap again to confirm — this is permanent'
                          : 'Transfer Ownership'}
                    </button>
                  </div>
                )}

                {!isOwner && (
                  <button
                    onClick={handleLeave}
                    disabled={isPending}
                    className="w-full text-left px-3 py-2 text-sm font-semibold rounded-lg text-[var(--danger)] border border-[var(--danger)]/20 hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-60"
                  >
                    Leave Group
                  </button>
                )}

                {isOwner && !confirmDelete && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full text-left px-3 py-2 text-sm font-semibold rounded-lg text-[var(--danger)] border border-[var(--danger)]/20 hover:bg-[var(--danger)]/10 transition-colors"
                  >
                    Delete Group
                  </button>
                )}

                {isOwner && confirmDelete && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-[var(--text-muted)]">
                      This will permanently delete <strong className="text-[var(--text-primary)]">{group.name}</strong> and all its channels and messages.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        disabled={isPending}
                        className="flex-1 px-3 py-2 text-sm font-semibold rounded-lg text-[var(--text-muted)] border border-white/10 hover:bg-white/10 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={isPending}
                        className="flex-1 px-3 py-2 text-sm font-semibold rounded-lg bg-[var(--danger)] hover:bg-[var(--danger)]/80 text-white transition-colors disabled:opacity-60"
                      >
                        {isPending ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ModalShell>

      {cropSrc && (
        <AvatarCropModal
          src={cropSrc}
          shape="square"
          onApply={handleCropApply}
          onClose={() => setCropSrc(null)}
        />
      )}
    </>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
