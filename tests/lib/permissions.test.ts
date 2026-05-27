import { describe, it, expect } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import type { Role } from '@/lib/permissions'

const ALL_ROLES: Role[] = ['admin', 'moderator', 'user', 'noob']

describe('PERMISSIONS.canManageChannels', () => {
  it.each([
    ['admin',     true],
    ['moderator', true],
    ['user',      false],
    ['noob',      false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canManageChannels(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canGenerateInvite', () => {
  it.each([
    ['admin',     true],
    ['moderator', true],
    ['user',      false],
    ['noob',      false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canGenerateInvite(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canDeleteAnyMessage', () => {
  it.each([
    ['admin',     true],
    ['moderator', true],
    ['user',      false],
    ['noob',      false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canDeleteAnyMessage(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canDeleteOwnMessage', () => {
  it.each([
    ['admin',     true],
    ['moderator', true],
    ['user',      true],
    ['noob',      false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canDeleteOwnMessage(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canAssignRoles', () => {
  it('allows admin', () => expect(PERMISSIONS.canAssignRoles('admin')).toBe(true))
  it('denies moderator', () => expect(PERMISSIONS.canAssignRoles('moderator')).toBe(false))
  it('denies user', () => expect(PERMISSIONS.canAssignRoles('user')).toBe(false))
  it('denies noob', () => expect(PERMISSIONS.canAssignRoles('noob')).toBe(false))
})

describe('PERMISSIONS.canKickMembers', () => {
  it.each([
    ['admin',     true],
    ['moderator', true],
    ['user',      false],
    ['noob',      false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canKickMembers(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canAccessChannel', () => {
  it('noob can access the welcome channel', () => {
    expect(PERMISSIONS.canAccessChannel('noob', 'welcome')).toBe(true)
  })

  it('noob cannot access any other channel', () => {
    expect(PERMISSIONS.canAccessChannel('noob', 'general')).toBe(false)
    expect(PERMISSIONS.canAccessChannel('noob', 'announcements')).toBe(false)
    expect(PERMISSIONS.canAccessChannel('noob', '')).toBe(false)
  })

  it('noob can access any channel explicitly opened to new members', () => {
    expect(PERMISSIONS.canAccessChannel('noob', 'rules', true)).toBe(true)
  })

  it.each(['admin', 'moderator', 'user'] as Role[])(
    '%s can access any channel',
    (role: Role) => {
      expect(PERMISSIONS.canAccessChannel(role, 'general')).toBe(true)
      expect(PERMISSIONS.canAccessChannel(role, 'welcome')).toBe(true)
      expect(PERMISSIONS.canAccessChannel(role, 'private-room')).toBe(true)
    }
  )

  it('channel name matching is case-sensitive (noob + Welcome ≠ welcome)', () => {
    expect(PERMISSIONS.canAccessChannel('noob', 'Welcome')).toBe(false)
  })
})

describe('PERMISSIONS.canStartVoiceRoom', () => {
  it.each([
    ['admin', true],
    ['moderator', true],
    ['user', false],
    ['noob', false],
  ] as [Role, boolean][])('%s → %s', (role: Role, expected: boolean) => {
    expect(PERMISSIONS.canStartVoiceRoom(role)).toBe(expected)
  })
})

describe('PERMISSIONS.canJoinVoiceRoom', () => {
  it.each(['admin', 'moderator', 'user'] as Role[])('%s can join any accessible channel', (role: Role) => {
    expect(PERMISSIONS.canJoinVoiceRoom(role, 'general')).toBe(true)
    expect(PERMISSIONS.canJoinVoiceRoom(role, 'welcome')).toBe(true)
  })

  it('applies noob channel-access semantics', () => {
    expect(PERMISSIONS.canJoinVoiceRoom('noob', 'welcome')).toBe(true)
    expect(PERMISSIONS.canJoinVoiceRoom('noob', 'rules', true)).toBe(true)
    expect(PERMISSIONS.canJoinVoiceRoom('noob', 'general')).toBe(false)
  })
})

describe('PERMISSIONS.canManageGroup', () => {
  it('allows admin', () => expect(PERMISSIONS.canManageGroup('admin')).toBe(true))
  it.each(['moderator', 'user', 'noob'] as Role[])(
    'denies %s', (role: Role) => expect(PERMISSIONS.canManageGroup(role)).toBe(false)
  )
})

describe('PERMISSIONS.canReact', () => {
  it.each(ALL_ROLES)('allows all roles (%s)', (role: Role) => {
    expect(PERMISSIONS.canReact(role)).toBe(true)
  })
})

describe('PERMISSIONS.canSendImages', () => {
  it.each(ALL_ROLES)('allows all roles (%s)', (role: Role) => {
    expect(PERMISSIONS.canSendImages(role)).toBe(true)
  })
})

describe('PERMISSIONS.canSendGifs', () => {
  it.each(ALL_ROLES)('allows all roles (%s)', (role: Role) => {
    expect(PERMISSIONS.canSendGifs(role)).toBe(true)
  })
})

describe('PERMISSIONS.canSendDMs', () => {
  it.each(ALL_ROLES)('allows all roles (%s)', (role: Role) => {
    expect(PERMISSIONS.canSendDMs(role)).toBe(true)
  })
})
