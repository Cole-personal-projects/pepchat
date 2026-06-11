'use client'

import { useEffect, useState, useTransition } from 'react'
import ActionSheet from '@/components/ui/ActionSheet'
import { assignRole } from '@/app/(app)/members/actions'
import { assignMemberRole, removeMemberRole } from '@/app/(app)/roles/actions'
import { createClient } from '@/lib/supabase/client'
import { useGroupRoles } from '@/lib/hooks/useGroupRoles'
import { PERMISSIONS, type Role } from '@/lib/permissions'

/** Legacy membership levels an admin can hand out (admin stays unique). */
const LEGACY_ROLE_OPTIONS: Array<{ value: Role; label: string; description: string }> = [
  { value: 'moderator', label: 'Moderator', description: 'Manages channels, kicks members, reviews reports' },
  { value: 'user', label: 'Member', description: 'Full access to the server' },
  { value: 'noob', label: 'Noob', description: 'Limited to welcome channels until promoted' },
]

interface MemberRolesSheetProps {
  open: boolean
  onClose: () => void
  groupId: string
  /** The member being managed. */
  userId: string
  memberName: string
  /** Viewer context — gates which sections render. */
  currentUserId: string
  viewerRole: Role
}

/**
 * Discord-style role management sheet for one member: a single-select
 * membership level (the legacy enum) and multi-select custom roles, both
 * with optimistic toggles. Shared by MembersPanel and ProfileCard.
 */
export default function MemberRolesSheet({
  open,
  onClose,
  groupId,
  userId,
  memberName,
  currentUserId,
  viewerRole,
}: MemberRolesSheetProps) {
  const { roles, roleIdsByUserId } = useGroupRoles(open ? groupId : null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [legacyRole, setLegacyRole] = useState<Role | null>(null)
  const [roleOverrides, setRoleOverrides] = useState<Record<string, boolean>>({})

  const customRoles = roles.filter(role => !role.is_default)
  const canManage = PERMISSIONS.canAssignRoles(viewerRole)
  const canChangeLegacy = canManage && userId !== currentUserId && legacyRole !== null && legacyRole !== 'admin'

  // The sheet is self-sufficient: fetch the member's current legacy role so
  // callers (like ProfileCard) don't need the membership row in hand.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError('')
    setRoleOverrides({})
    setLegacyRole(null)
    createClient()
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setLegacyRole((data?.role as Role) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [open, groupId, userId])

  function handleLegacySelect(nextRole: Role) {
    if (!legacyRole || nextRole === legacyRole) return
    const previous = legacyRole
    setError('')
    setLegacyRole(nextRole)
    startTransition(async () => {
      const result = await assignRole(groupId, userId, nextRole)
      if (result && 'error' in result) {
        setLegacyRole(previous)
        setError(result.error)
      }
    })
  }

  function memberHasRole(roleId: string): boolean {
    const override = roleOverrides[roleId]
    if (override !== undefined) return override
    return roleIdsByUserId.get(userId)?.has(roleId) ?? false
  }

  function handleToggleRole(roleId: string, hasRole: boolean) {
    setError('')
    setRoleOverrides(current => ({ ...current, [roleId]: !hasRole }))
    startTransition(async () => {
      const result = hasRole
        ? await removeMemberRole(groupId, userId, roleId)
        : await assignMemberRole(groupId, userId, roleId)
      if (result && 'error' in result) {
        setRoleOverrides(current => {
          const next = { ...current }
          delete next[roleId]
          return next
        })
        setError(result.error)
      }
    })
  }

  if (!canManage) return null

  return (
    <ActionSheet open={open} onClose={onClose} title={`${memberName} — Roles`}>
      {error && (
        <p
          role="alert"
          style={{ margin: '0 20px 8px', fontSize: 12, color: 'var(--danger)' }}
        >
          {error}
        </p>
      )}

      {/* Membership level (legacy enum) — single select */}
      {canChangeLegacy && (
        <div data-testid="legacy-role-picker" style={{ display: 'flex', flexDirection: 'column' }}>
          <p style={sectionHeaderStyle}>Membership Level</p>
          {LEGACY_ROLE_OPTIONS.map(option => {
            const selected = legacyRole === option.value
            return (
              <button
                key={option.value}
                type="button"
                className="sheet-action-row"
                data-testid={`legacy-role-${option.value}`}
                aria-pressed={selected}
                disabled={isPending}
                onClick={() => handleLegacySelect(option.value)}
                style={rowStyle(isPending)}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{option.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                    {option.description}
                  </span>
                </span>
                <span aria-hidden="true" style={radioStyle(selected)}>
                  {selected && <span style={radioDotStyle} />}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Custom roles — multi select */}
      {customRoles.length > 0 && (
        <div data-testid={`member-roles-menu-${userId}`} style={{ display: 'flex', flexDirection: 'column' }}>
          <p style={sectionHeaderStyle}>Roles</p>
          {customRoles.map(role => {
            const hasRole = memberHasRole(role.id)
            return (
              <button
                key={role.id}
                type="button"
                className="sheet-action-row"
                data-testid={`toggle-role-${role.id}-${userId}`}
                aria-pressed={hasRole}
                disabled={isPending}
                onClick={() => handleToggleRole(role.id, hasRole)}
                style={rowStyle(isPending)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: role.color ?? '#99aab5',
                  }}
                />
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {role.name}
                </span>
                <span aria-hidden="true" style={checkboxStyle(hasRole)}>
                  {hasRole ? '✓' : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!canChangeLegacy && customRoles.length === 0 && (
        <p style={{ margin: '4px 20px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
          No assignable roles yet. Create roles in Group Settings → Roles.
        </p>
      )}

      <button
        type="button"
        data-testid="member-roles-done"
        onClick={onClose}
        style={{
          margin: '12px 20px 0',
          padding: '10px 16px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-soft)',
          borderRadius: 8,
          color: 'var(--text-primary)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Done
      </button>
    </ActionSheet>
  )
}

const sectionHeaderStyle: React.CSSProperties = {
  margin: '6px 20px 4px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-faint)',
}

function rowStyle(pending: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 20px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border-soft)',
    color: 'var(--text-primary)',
    fontSize: 15,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    opacity: pending ? 0.6 : 1,
  }
}

function radioStyle(selected: boolean): React.CSSProperties {
  return {
    width: 20,
    height: 20,
    flexShrink: 0,
    borderRadius: '50%',
    border: selected ? '2px solid var(--accent)' : '1.5px solid var(--border-strong)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}

const radioDotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: 'var(--accent)',
}

function checkboxStyle(checked: boolean): React.CSSProperties {
  return {
    width: 20,
    height: 20,
    flexShrink: 0,
    borderRadius: 6,
    border: checked ? 'none' : '1.5px solid var(--border-strong)',
    background: checked ? 'var(--accent)' : 'transparent',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}
