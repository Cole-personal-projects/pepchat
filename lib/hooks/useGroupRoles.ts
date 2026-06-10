'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { GroupRole, MemberRoleAssignment } from '@/lib/types'

/**
 * Fetches a group's custom roles and member assignments with live updates.
 * Roles come back sorted top-first (highest position), @everyone last.
 */
export function useGroupRoles(groupId: string | null) {
  const [roles, setRoles] = useState<GroupRole[]>([])
  const [memberRoles, setMemberRoles] = useState<MemberRoleAssignment[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRoles = useCallback(async () => {
    if (!groupId) {
      setRoles([])
      setMemberRoles([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const [rolesResult, memberRolesResult] = await Promise.all([
      supabase
        .from('roles')
        .select('*')
        .eq('group_id', groupId)
        .order('position', { ascending: false }),
      supabase
        .from('member_roles')
        .select('*')
        .eq('group_id', groupId),
    ])

    if (rolesResult.data) setRoles(rolesResult.data as GroupRole[])
    if (memberRolesResult.data) setMemberRoles(memberRolesResult.data as MemberRoleAssignment[])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    setLoading(true)
    fetchRoles()
  }, [fetchRoles])

  useRealtimeChannel({
    topic: `group-roles-${groupId}`,
    enabled: Boolean(groupId),
    deps: [groupId, fetchRoles],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'roles', filter: `group_id=eq.${groupId}` },
        handler: fetchRoles,
      },
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'member_roles', filter: `group_id=eq.${groupId}` },
        handler: fetchRoles,
      },
    ],
  })

  /** role ids per member for quick lookups. */
  const roleIdsByUserId = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const assignment of memberRoles) {
      const existing = map.get(assignment.user_id) ?? new Set<string>()
      existing.add(assignment.role_id)
      map.set(assignment.user_id, existing)
    }
    return map
  }, [memberRoles])

  return { roles, memberRoles, roleIdsByUserId, loading, refetch: fetchRoles }
}
