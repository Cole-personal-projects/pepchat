import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  PermissionBits,
  hasChannelPermission,
  hasGroupPermission,
  resolveChannelPermissions,
  resolveGroupPermissions,
  toPermissionBits,
} from '@/lib/permissions/bits'

const EVERYONE_ID = 'role-everyone'
const MEMBER_ID = 'role-member'
const MOD_ID = 'role-mod'
const ADMIN_ID = 'role-admin'
const USER_ID = 'user-1'

const everyonePermissions =
  PermissionBits.SEND_MESSAGES |
  PermissionBits.ATTACH_FILES |
  PermissionBits.ADD_REACTIONS |
  PermissionBits.CONNECT |
  PermissionBits.SPEAK

const memberPermissions =
  everyonePermissions |
  PermissionBits.VIEW_CHANNELS |
  PermissionBits.CREATE_VOICE_ROOMS |
  PermissionBits.CREATE_EVENTS

const roles = [
  { id: EVERYONE_ID, permissions: everyonePermissions, is_default: true },
  { id: MEMBER_ID, permissions: memberPermissions, is_default: false },
  { id: MOD_ID, permissions: memberPermissions | PermissionBits.MANAGE_MESSAGES, is_default: false },
  { id: ADMIN_ID, permissions: PermissionBits.ADMINISTRATOR, is_default: false },
]

function channelContext(overrides: {
  memberRoleIds?: string[]
  overwrites?: Array<{ role_id: string | null; user_id: string | null; allow: bigint; deny: bigint }>
  isOwner?: boolean
}) {
  return {
    isOwner: overrides.isOwner ?? false,
    roles,
    memberRoleIds: overrides.memberRoleIds ?? [MEMBER_ID],
    userId: USER_ID,
    overwrites: overrides.overwrites ?? [],
    defaultRoleIds: [EVERYONE_ID],
  }
}

describe('toPermissionBits', () => {
  it('normalizes numbers, strings, bigints, and null', () => {
    expect(toPermissionBits(5)).toBe(5n)
    expect(toPermissionBits('1024')).toBe(1024n)
    expect(toPermissionBits(64n)).toBe(64n)
    expect(toPermissionBits(null)).toBe(0n)
    expect(toPermissionBits(undefined)).toBe(0n)
  })
})

describe('resolveGroupPermissions', () => {
  it('ORs @everyone with assigned roles', () => {
    const result = resolveGroupPermissions({ isOwner: false, roles, memberRoleIds: [MEMBER_ID] })
    expect(result).toBe(memberPermissions)
  })

  it('includes @everyone bits even with no assigned roles (noob-equivalent)', () => {
    const result = resolveGroupPermissions({ isOwner: false, roles, memberRoleIds: [] })
    expect(result).toBe(everyonePermissions)
  })

  it('stacks multiple roles', () => {
    const result = resolveGroupPermissions({ isOwner: false, roles, memberRoleIds: [MEMBER_ID, MOD_ID] })
    expect(result).toBe(memberPermissions | PermissionBits.MANAGE_MESSAGES)
  })

  it('group owner resolves to ADMINISTRATOR', () => {
    const result = resolveGroupPermissions({ isOwner: true, roles: [], memberRoleIds: [] })
    expect(result).toBe(PermissionBits.ADMINISTRATOR)
  })
})

describe('hasGroupPermission', () => {
  it('ADMINISTRATOR bypasses any specific bit', () => {
    const context = { isOwner: false, roles, memberRoleIds: [ADMIN_ID] }
    expect(hasGroupPermission(context, PermissionBits.MANAGE_ONBOARDING)).toBe(true)
    expect(hasGroupPermission(context, PermissionBits.MOVE_MEMBERS)).toBe(true)
  })

  it('denies bits the member does not hold', () => {
    const context = { isOwner: false, roles, memberRoleIds: [MEMBER_ID] }
    expect(hasGroupPermission(context, PermissionBits.MANAGE_CHANNELS)).toBe(false)
    expect(hasGroupPermission(context, PermissionBits.SEND_MESSAGES)).toBe(true)
  })
})

describe('resolveChannelPermissions', () => {
  it('administrator short-circuits to all permissions, ignoring deny overwrites', () => {
    const result = resolveChannelPermissions(
      channelContext({
        memberRoleIds: [ADMIN_ID],
        overwrites: [
          { role_id: EVERYONE_ID, user_id: null, allow: 0n, deny: ALL_PERMISSIONS },
          { role_id: null, user_id: USER_ID, allow: 0n, deny: ALL_PERMISSIONS },
        ],
      }),
    )
    expect(result).toBe(ALL_PERMISSIONS)
  })

  it('@everyone deny hides the channel', () => {
    const result = resolveChannelPermissions(
      channelContext({
        overwrites: [
          { role_id: EVERYONE_ID, user_id: null, allow: 0n, deny: PermissionBits.VIEW_CHANNELS },
        ],
      }),
    )
    expect(result & PermissionBits.VIEW_CHANNELS).toBe(0n)
  })

  it('role allow overrides @everyone deny', () => {
    const result = resolveChannelPermissions(
      channelContext({
        overwrites: [
          { role_id: EVERYONE_ID, user_id: null, allow: 0n, deny: PermissionBits.VIEW_CHANNELS },
          { role_id: MEMBER_ID, user_id: null, allow: PermissionBits.VIEW_CHANNELS, deny: 0n },
        ],
      }),
    )
    expect(result & PermissionBits.VIEW_CHANNELS).toBe(PermissionBits.VIEW_CHANNELS)
  })

  it('within the role tier, allow wins over deny across different roles', () => {
    const result = resolveChannelPermissions(
      channelContext({
        memberRoleIds: [MEMBER_ID, MOD_ID],
        overwrites: [
          { role_id: MEMBER_ID, user_id: null, allow: 0n, deny: PermissionBits.SEND_MESSAGES },
          { role_id: MOD_ID, user_id: null, allow: PermissionBits.SEND_MESSAGES, deny: 0n },
        ],
      }),
    )
    expect(result & PermissionBits.SEND_MESSAGES).toBe(PermissionBits.SEND_MESSAGES)
  })

  it('member-specific overwrite beats role overwrites', () => {
    const result = resolveChannelPermissions(
      channelContext({
        overwrites: [
          { role_id: MEMBER_ID, user_id: null, allow: PermissionBits.SEND_MESSAGES, deny: 0n },
          { role_id: null, user_id: USER_ID, allow: 0n, deny: PermissionBits.SEND_MESSAGES },
        ],
      }),
    )
    expect(result & PermissionBits.SEND_MESSAGES).toBe(0n)
  })

  it('ignores overwrites for roles the member does not have', () => {
    const result = resolveChannelPermissions(
      channelContext({
        memberRoleIds: [MEMBER_ID],
        overwrites: [
          { role_id: MOD_ID, user_id: null, allow: 0n, deny: PermissionBits.SEND_MESSAGES },
        ],
      }),
    )
    expect(result & PermissionBits.SEND_MESSAGES).toBe(PermissionBits.SEND_MESSAGES)
  })

  it('ignores member overwrites for other users', () => {
    const result = resolveChannelPermissions(
      channelContext({
        overwrites: [
          { role_id: null, user_id: 'someone-else', allow: 0n, deny: PermissionBits.SEND_MESSAGES },
        ],
      }),
    )
    expect(result & PermissionBits.SEND_MESSAGES).toBe(PermissionBits.SEND_MESSAGES)
  })

  it('owner resolves to all permissions in channels', () => {
    const result = resolveChannelPermissions(
      channelContext({
        isOwner: true,
        overwrites: [
          { role_id: EVERYONE_ID, user_id: null, allow: 0n, deny: ALL_PERMISSIONS },
        ],
      }),
    )
    expect(result).toBe(ALL_PERMISSIONS)
  })
})

describe('hasChannelPermission', () => {
  it('checks compound bits — all must be present', () => {
    const context = channelContext({})
    expect(hasChannelPermission(context, PermissionBits.CONNECT | PermissionBits.SPEAK)).toBe(true)
    expect(
      hasChannelPermission(context, PermissionBits.CONNECT | PermissionBits.MUTE_MEMBERS),
    ).toBe(false)
  })
})
