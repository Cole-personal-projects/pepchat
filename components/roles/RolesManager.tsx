'use client'

import { useMemo, useState, useTransition } from 'react'
import { createRole, deleteRole, moveRole, updateRole } from '@/app/(app)/roles/actions'
import { useGroupRoles } from '@/lib/hooks/useGroupRoles'
import { PERMISSION_METADATA, hasBits, toPermissionBits, type PermissionMetadata } from '@/lib/permissions/bits'
import type { GroupRole } from '@/lib/types'

interface RolesManagerProps {
  groupId: string
}

const DEFAULT_ROLE_COLOR = '#99aab5'

function groupedPermissions(): Map<PermissionMetadata['category'], PermissionMetadata[]> {
  const groups = new Map<PermissionMetadata['category'], PermissionMetadata[]>()
  for (const meta of PERMISSION_METADATA) {
    const list = groups.get(meta.category) ?? []
    list.push(meta)
    groups.set(meta.category, list)
  }
  return groups
}

/**
 * Discord-style role editor: ordered role list with create/reorder/delete,
 * identity settings (name, color, hoist, mentionable), and a permission
 * toggle grid backed by the bitfield engine.
 */
export default function RolesManager({ groupId }: RolesManagerProps) {
  const { roles, loading } = useGroupRoles(groupId)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [newRoleName, setNewRoleName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isPending, startTransition] = useTransition()

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId],
  )
  const selectedBits = selectedRole ? toPermissionBits(selectedRole.permissions) : 0n
  const customRoles = useMemo(() => roles.filter((role) => !role.is_default), [roles])
  const permissionGroups = useMemo(groupedPermissions, [])

  function run(action: () => Promise<{ error: string } | { ok: true } | { ok: true; roleId: string }>, successNotice = '') {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      if (successNotice) setNotice(successNotice)
    })
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = newRoleName.trim()
    if (!name) return
    const formData = new FormData()
    formData.set('group_id', groupId)
    formData.set('name', name)
    setNewRoleName('')
    run(() => createRole(formData), 'Role created.')
  }

  function handleIdentitySave(role: GroupRole, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    run(() => updateRole(role.id, {
      ...(role.is_default ? {} : { name: (formData.get('name') as string) ?? role.name }),
      color: (formData.get('use_color') === 'on' ? (formData.get('color') as string) : null),
      hoist: formData.get('hoist') === 'on',
      mentionable: formData.get('mentionable') === 'on',
    }), 'Role updated.')
  }

  function handleTogglePermission(role: GroupRole, bit: bigint) {
    const current = toPermissionBits(role.permissions)
    const next = hasBits(current, bit) ? current & ~bit : current | bit
    run(() => updateRole(role.id, { permissions: next.toString() }))
  }

  function handleDelete(role: GroupRole) {
    if (!confirm(`Delete the ${role.name} role? Members lose it immediately.`)) return
    if (selectedRoleId === role.id) setSelectedRoleId(null)
    run(() => deleteRole(role.id), 'Role deleted.')
  }

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">Loading roles…</p>
  }

  return (
    <div data-testid="roles-manager" className="flex flex-col gap-4">
      {error && (
        <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          data-testid="new-role-name"
          type="text"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          maxLength={60}
          placeholder="New role name"
          className="flex-1 rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          type="submit"
          data-testid="create-role-btn"
          disabled={isPending || !newRoleName.trim()}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create Role
        </button>
      </form>

      <div className="flex gap-4 max-md:flex-col">
        {/* Role list: vertical rail on desktop, wrapping pills on mobile so
            the editor keeps the full viewport width on small screens. */}
        <div className="md:w-40 md:flex-shrink-0 md:space-y-1 max-md:flex max-md:flex-wrap max-md:gap-1.5" data-testid="role-list">
          {roles.map((role, index) => {
            const isSelected = selectedRole?.id === role.id
            const customIndex = customRoles.findIndex((r) => r.id === role.id)
            return (
              <div key={role.id} className="group/role flex items-center gap-1 max-md:rounded-full max-md:border max-md:border-white/10 max-md:bg-[var(--bg-primary)] max-md:px-1">
                <button
                  type="button"
                  data-testid={`role-item-${role.id}`}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors max-md:rounded-full ${
                    isSelected ? 'bg-white/10 text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: role.color ?? DEFAULT_ROLE_COLOR }}
                  />
                  <span className="min-w-0 flex-1 truncate">{role.name}</span>
                </button>
                {!role.is_default && (
                  // Touch devices have no hover: keep the reorder arrows
                  // visible whenever the role is the one being edited.
                  <span className={`flex-shrink-0 items-center ${isSelected ? 'flex' : 'hidden group-hover/role:flex'}`}>
                    <button
                      type="button"
                      aria-label={`Move ${role.name} role up`}
                      disabled={isPending || customIndex <= 0}
                      onClick={() => run(() => moveRole(role.id, 'up'))}
                      className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${role.name} role down`}
                      disabled={isPending || customIndex === customRoles.length - 1}
                      onClick={() => run(() => moveRole(role.id, 'down'))}
                      className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </span>
                )}
                {index === roles.length - 1 && null}
              </div>
            )
          })}
        </div>

        {/* Editor */}
        {selectedRole && (
          <div className="min-w-0 flex-1 space-y-4" data-testid="role-editor">
            <form onSubmit={(e) => handleIdentitySave(selectedRole, e)} key={selectedRole.id} className="space-y-3">
              {!selectedRole.is_default && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="role-name" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Role Name
                  </label>
                  <input
                    id="role-name"
                    name="name"
                    type="text"
                    maxLength={60}
                    defaultValue={selectedRole.name}
                    className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    name="use_color"
                    defaultChecked={Boolean(selectedRole.color)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Color
                </label>
                <input
                  type="color"
                  name="color"
                  aria-label="Role color"
                  defaultValue={selectedRole.color ?? DEFAULT_ROLE_COLOR}
                  className="h-8 w-12 cursor-pointer rounded border border-black/20 bg-transparent"
                />
                {!selectedRole.is_default && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        name="hoist"
                        defaultChecked={selectedRole.hoist}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      Show separately
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        name="mentionable"
                        defaultChecked={selectedRole.mentionable}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      Mentionable
                    </label>
                  </>
                )}
                <button
                  type="submit"
                  data-testid="save-role-identity"
                  disabled={isPending}
                  className="ml-auto rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Permissions</h4>
              {[...permissionGroups.entries()].map(([category, metas]) => (
                <fieldset key={category} className="space-y-1.5">
                  <legend className="text-[11px] font-semibold text-[var(--text-faint)]">{category}</legend>
                  {metas.map((meta) => {
                    const enabled = hasBits(selectedBits, meta.bit)
                    return (
                      <label
                        key={meta.name}
                        className="flex items-start justify-between gap-3 rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--text-primary)]">{meta.label}</span>
                          <span className="block text-xs text-[var(--text-muted)]">{meta.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          data-testid={`perm-${meta.name}-${selectedRole.id}`}
                          checked={enabled}
                          disabled={isPending}
                          onChange={() => handleTogglePermission(selectedRole, meta.bit)}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-[var(--accent)]"
                        />
                      </label>
                    )
                  })}
                </fieldset>
              ))}
            </div>

            {!selectedRole.is_default && (
              <button
                type="button"
                data-testid={`delete-role-${selectedRole.id}`}
                onClick={() => handleDelete(selectedRole)}
                disabled={isPending}
                className="rounded border border-[var(--danger)]/40 px-3 py-1.5 text-sm font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-60"
              >
                Delete Role
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
