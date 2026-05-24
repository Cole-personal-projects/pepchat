import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gateGroupRole } from '@/lib/permissions/gate'
import { PERMISSIONS } from '@/lib/permissions'

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }

function setupSupabase(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })

  const supabase = {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => builder),
  }

  return { supabase, builder }
}

describe('canPromoteThread', () => {
  it('allows channel managers and root authors only', () => {
    expect(PERMISSIONS.canPromoteThread('admin', false)).toBe(true)
    expect(PERMISSIONS.canPromoteThread('moderator', false)).toBe(true)
    expect(PERMISSIONS.canPromoteThread('user', true)).toBe(true)
    expect(PERMISSIONS.canPromoteThread('noob', true)).toBe(true)
    expect(PERMISSIONS.canPromoteThread('user', false)).toBe(false)
    expect(PERMISSIONS.canPromoteThread('noob', false)).toBe(false)
  })
})

describe('gateGroupRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows when the predicate passes', async () => {
    const { supabase, builder } = setupSupabase({ data: { role: 'admin' } })

    await expect(gateGroupRole(supabase as unknown as SupabaseClient, {
      groupId: 'group-1',
      userId: 'user-1',
      predicate: PERMISSIONS.canAssignRoles,
      deniedMessage: 'Only admins can assign roles.',
    })).resolves.toEqual({ ok: true, membership: { role: 'admin' } })

    expect(supabase.from).toHaveBeenCalledWith('group_members')
    expect(builder.select).toHaveBeenCalledWith('role')
    expect(builder.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('denies missing membership with the caller-provided message', async () => {
    const { supabase } = setupSupabase({
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    })

    await expect(gateGroupRole(supabase as unknown as SupabaseClient, {
      groupId: 'group-1',
      userId: 'user-1',
      predicate: PERMISSIONS.canAssignRoles,
      deniedMessage: 'Only admins can assign roles.',
    })).resolves.toEqual({ error: 'Only admins can assign roles.' })
  })

  it('denies failed predicates with the caller-provided message', async () => {
    const { supabase } = setupSupabase({ data: { role: 'user' } })

    await expect(gateGroupRole(supabase as unknown as SupabaseClient, {
      groupId: 'group-1',
      userId: 'user-1',
      predicate: PERMISSIONS.canKickMembers,
      deniedMessage: 'You do not have permission to kick members.',
    })).resolves.toEqual({ error: 'You do not have permission to kick members.' })
  })

  it('propagates lookup error messages', async () => {
    const { supabase } = setupSupabase({ error: { message: 'Membership lookup failed' } })

    await expect(gateGroupRole(supabase as unknown as SupabaseClient, {
      groupId: 'group-1',
      userId: 'user-1',
      predicate: PERMISSIONS.canAssignRoles,
      deniedMessage: 'Only admins can assign roles.',
    })).resolves.toEqual({ error: 'Membership lookup failed' })
  })

  it('does not call auth.getUser()', async () => {
    const { supabase } = setupSupabase({ data: { role: 'moderator' } })

    await gateGroupRole(supabase as unknown as SupabaseClient, {
      groupId: 'group-1',
      userId: 'user-1',
      predicate: PERMISSIONS.canKickMembers,
      deniedMessage: 'You do not have permission to kick members.',
    })

    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })
})
