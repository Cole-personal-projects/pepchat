'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/ui/Avatar'
import MemberRolesSheet from '@/components/roles/MemberRolesSheet'
import { createClient } from '@/lib/supabase/client'
import { getProfile } from '@/app/(app)/profile/actions'
import { useGroupRoles } from '@/lib/hooks/useGroupRoles'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import type { Profile } from '@/lib/types'

interface ProfileCardProps {
  userId: string
  currentUserId: string
  anchorEl: HTMLElement
  onClose: () => void
  /** Group context — enables role management for admins when provided. */
  groupId?: string | null
  viewerRole?: Role | null
}

function formatMemberSince(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

export default function ProfileCard({ userId, currentUserId, anchorEl, onClose, groupId = null, viewerRole = null }: ProfileCardProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingDM, setOpeningDM] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const isOwn = userId === currentUserId
  const canManageRoles = Boolean(groupId && viewerRole && PERMISSIONS.canAssignRoles(viewerRole) && !isOwn)

  // Group role chips (Discord-style): visible to everyone with group context.
  const { roles, roleIdsByUserId } = useGroupRoles(groupId ?? null)
  const memberRoleChips = (() => {
    if (!groupId) return []
    const ids = roleIdsByUserId.get(userId)
    if (!ids) return []
    return roles
      .filter(role => !role.is_default && ids.has(role.id))
      .sort((a, b) => b.position - a.position)
  })()

  async function handleSendMessage() {
    setOpeningDM(true)
    try {
      const supabase = createClient()
      const { data: convId, error } = await supabase.rpc('get_or_create_dm', { other_user_id: userId })
      if (error || !convId) { setOpeningDM(false); return }
      onClose()
      router.push(`/dm/${convId}`)
    } catch {
      setOpeningDM(false)
    }
  }

  useEffect(() => {
    if (isOwn) { onClose(); router.push('/settings/profile'); return }
    getProfile(userId).then(p => { setProfile(p); setLoading(false) })
  }, [userId, isOwn, onClose, router])

  // Position card near anchor, flip if near edge
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const rect = anchorEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = rect.right + 8
    let top = rect.top
    if (left + 300 > vw) left = rect.left - 308
    if (top + 420 > vh) top = vh - 428
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [anchorEl, loading])

  // Close on outside click / Escape — suspended while the roles sheet is
  // open, since the sheet portals outside the card's DOM subtree.
  const rolesOpenRef = useRef(rolesOpen)
  rolesOpenRef.current = rolesOpen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !rolesOpenRef.current) onClose()
    }
    function onPointer(e: MouseEvent) {
      if (rolesOpenRef.current) return
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  if (isOwn || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 w-[300px] rounded-xl border border-white/10 shadow-2xl overflow-hidden"
      style={{
        background: 'var(--bg-secondary)',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
      }}
    >
      {loading ? (
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-16 rounded-lg" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="h-3 w-2/3 rounded" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="h-3 w-1/2 rounded" style={{ background: 'var(--bg-tertiary)' }} />
        </div>
      ) : !profile ? (
        <div className="p-6 text-sm text-[var(--text-muted)] text-center">Profile not found</div>
      ) : (
        <>
          {/* Banner */}
          <div className="relative" style={{ background: profile.banner_color, height: 72 }}>
            <div className="absolute left-4" style={{ bottom: -36 }}>
              <Avatar user={profile} size={72}
                className="ring-4 ring-[var(--bg-secondary)] rounded-full" />
            </div>
          </div>

          {/* Body */}
          <div className="pt-12 px-4 pb-4 space-y-3">
            {/* Name row */}
            <div>
              <p className="font-bold text-base leading-tight" style={{ color: profile.username_color }}>
                {profile.display_name ?? profile.username}
              </p>
              {profile.display_name && (
                <p className="text-xs text-[var(--text-muted)]">@{profile.username}</p>
              )}
              {(profile.pronouns || profile.badge) && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {[profile.pronouns, profile.badge].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            <div className="h-px bg-white/10" />

            {/* Bio */}
            {profile.bio && (
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {profile.bio}
              </p>
            )}

            {/* Details */}
            <div className="space-y-1 text-xs text-[var(--text-muted)]">
              {profile.location && <p>📍 {profile.location}</p>}
              {profile.website && (
                <p>
                  🔗{' '}
                  <a href={profile.website} target="_blank" rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                    onClick={e => e.stopPropagation()}>
                    {profile.website.replace(/^https?:\/\//, '')}
                  </a>
                </p>
              )}
              <p>Member since {formatMemberSince(profile.member_since)}</p>
            </div>

            {/* Group role chips */}
            {memberRoleChips.length > 0 && (
              <div data-testid="profile-role-chips">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)] mb-1.5">
                  Roles
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {memberRoleChips.map(role => (
                    <span
                      key={role.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ background: role.color ?? '#99aab5' }}
                      />
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="h-px bg-white/10" />

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                className="flex-1 py-1.5 rounded-lg text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent)]/90 transition-colors disabled:opacity-50"
                onClick={handleSendMessage}
                disabled={openingDM}
              >
                {openingDM ? 'Opening…' : 'Send Message'}
              </button>
              <button
                className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-muted)] border border-white/10 hover:bg-white/5 transition-colors"
                onClick={onClose}
                aria-label="Close profile card"
                title="Close"
              >
                ✕
              </button>
            </div>

            {canManageRoles && (
              <button
                data-testid="profile-manage-roles"
                className="w-full py-1.5 rounded-lg text-sm font-medium text-[var(--text-primary)] border border-white/10 hover:bg-white/5 transition-colors"
                onClick={() => setRolesOpen(true)}
              >
                Manage Roles
              </button>
            )}
          </div>

          {canManageRoles && groupId && viewerRole && (
            <MemberRolesSheet
              open={rolesOpen}
              onClose={() => setRolesOpen(false)}
              groupId={groupId}
              userId={userId}
              memberName={profile.display_name ?? profile.username}
              currentUserId={currentUserId}
              viewerRole={viewerRole}
            />
          )}
        </>
      )}
    </div>,
    document.body
  )
}
