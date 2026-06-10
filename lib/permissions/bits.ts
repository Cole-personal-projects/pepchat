/**
 * Discord-style permission bitfield — TypeScript mirror of the SQL engine in
 * supabase/migrations/20260610091000_roles_engine.sql.
 *
 * The bit table below MUST stay in sync with the `PERMISSION_BIT` comment
 * block in that migration; tests/db/discord-foundations-migration.test.ts
 * parses the migration and asserts equality.
 *
 * Bits are BigInt so the field can grow past 31 bits without hitting JS
 * 32-bit bitwise-operator truncation. Postgres bigint values arrive from
 * PostgREST as JSON numbers — convert with toPermissionBits().
 */

export const PermissionBits = {
  ADMINISTRATOR: 1n << 0n,
  MANAGE_GROUP: 1n << 1n,
  MANAGE_ROLES: 1n << 2n,
  MANAGE_CHANNELS: 1n << 3n,
  KICK_MEMBERS: 1n << 4n,
  CREATE_INVITES: 1n << 5n,
  MANAGE_MESSAGES: 1n << 6n,
  VIEW_CHANNELS: 1n << 7n,
  SEND_MESSAGES: 1n << 8n,
  ATTACH_FILES: 1n << 9n,
  ADD_REACTIONS: 1n << 10n,
  MENTION_EVERYONE: 1n << 11n,
  PIN_MESSAGES: 1n << 12n,
  MANAGE_THREADS: 1n << 13n,
  CONNECT: 1n << 14n,
  SPEAK: 1n << 15n,
  MUTE_MEMBERS: 1n << 16n,
  DEAFEN_MEMBERS: 1n << 17n,
  MOVE_MEMBERS: 1n << 18n,
  CREATE_VOICE_ROOMS: 1n << 19n,
  MANAGE_EVENTS: 1n << 20n,
  CREATE_EVENTS: 1n << 21n,
  MANAGE_ONBOARDING: 1n << 22n,
} as const

export type PermissionBitName = keyof typeof PermissionBits

/** All bits set — what an Administrator resolves to. */
export const ALL_PERMISSIONS = Object.values(PermissionBits).reduce((acc, bit) => acc | bit, 0n)

/** Normalizes a bigint column value (number | string | bigint) to bigint. */
export function toPermissionBits(value: number | string | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  return BigInt(value)
}

export interface RoleLike {
  id: string
  permissions: number | string | bigint
  is_default: boolean
}

export interface OverwriteLike {
  role_id: string | null
  user_id: string | null
  allow: number | string | bigint
  deny: number | string | bigint
}

export interface GroupPermissionContext {
  isOwner: boolean
  /** Every role in the group (or at least @everyone + the member's roles). */
  roles: RoleLike[]
  /** Role ids assigned to the member via member_roles. */
  memberRoleIds: ReadonlySet<string> | string[]
}

function toIdSet(ids: ReadonlySet<string> | string[]): ReadonlySet<string> {
  return Array.isArray(ids) ? new Set(ids) : ids
}

/**
 * Base group-level bits: OR of @everyone + assigned roles.
 * Owners resolve to ADMINISTRATOR. Mirrors resolve_group_permissions().
 */
export function resolveGroupPermissions(context: GroupPermissionContext): bigint {
  if (context.isOwner) return PermissionBits.ADMINISTRATOR

  const memberRoleIds = toIdSet(context.memberRoleIds)
  return context.roles.reduce((acc, role) => {
    if (role.is_default || memberRoleIds.has(role.id)) {
      return acc | toPermissionBits(role.permissions)
    }
    return acc
  }, 0n)
}

export interface ChannelPermissionContext extends GroupPermissionContext {
  userId: string
  /** Overwrites for the channel being resolved. */
  overwrites: OverwriteLike[]
  /** Role ids that are the group's @everyone role. */
  defaultRoleIds: ReadonlySet<string> | string[]
}

/**
 * Effective channel bits after overwrites, mirroring
 * resolve_channel_permissions(): @everyone overwrite → member-role
 * overwrites (deny OR'd then allow OR'd) → member-specific overwrite.
 * Administrator short-circuits to all bits.
 */
export function resolveChannelPermissions(context: ChannelPermissionContext): bigint {
  let permissions = resolveGroupPermissions(context)
  if ((permissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) {
    return ALL_PERMISSIONS
  }

  const memberRoleIds = toIdSet(context.memberRoleIds)
  const defaultRoleIds = toIdSet(context.defaultRoleIds)

  const everyoneOverwrites = context.overwrites.filter(
    (o) => o.role_id !== null && defaultRoleIds.has(o.role_id),
  )
  const roleOverwrites = context.overwrites.filter(
    (o) => o.role_id !== null && !defaultRoleIds.has(o.role_id) && memberRoleIds.has(o.role_id),
  )
  const memberOverwrites = context.overwrites.filter((o) => o.user_id === context.userId)

  for (const tier of [everyoneOverwrites, roleOverwrites, memberOverwrites]) {
    const deny = tier.reduce((acc, o) => acc | toPermissionBits(o.deny), 0n)
    const allow = tier.reduce((acc, o) => acc | toPermissionBits(o.allow), 0n)
    permissions = (permissions & ~deny) | allow
  }

  return permissions
}

/** True when every bit in `bit` is present in `permissions`. */
export function hasBits(permissions: bigint, bit: bigint): boolean {
  return (permissions & bit) === bit
}

export interface PermissionMetadata {
  bit: bigint
  name: PermissionBitName
  label: string
  description: string
  category: 'General' | 'Membership' | 'Text' | 'Voice' | 'Events'
}

/** Display metadata for the role editor permission grid. */
export const PERMISSION_METADATA: PermissionMetadata[] = [
  { bit: PermissionBits.ADMINISTRATOR, name: 'ADMINISTRATOR', label: 'Administrator', description: 'Every permission and bypasses channel overwrites. Dangerous.', category: 'General' },
  { bit: PermissionBits.MANAGE_GROUP, name: 'MANAGE_GROUP', label: 'Manage Server', description: 'Change the server name, icon, and settings.', category: 'General' },
  { bit: PermissionBits.MANAGE_ROLES, name: 'MANAGE_ROLES', label: 'Manage Roles', description: 'Create, edit, and assign roles below their own.', category: 'General' },
  { bit: PermissionBits.MANAGE_CHANNELS, name: 'MANAGE_CHANNELS', label: 'Manage Channels', description: 'Create, edit, reorder, and delete channels and categories.', category: 'General' },
  { bit: PermissionBits.MANAGE_ONBOARDING, name: 'MANAGE_ONBOARDING', label: 'Manage Onboarding', description: 'Configure rules screening and onboarding questions.', category: 'General' },
  { bit: PermissionBits.KICK_MEMBERS, name: 'KICK_MEMBERS', label: 'Kick Members', description: 'Remove members from the server.', category: 'Membership' },
  { bit: PermissionBits.CREATE_INVITES, name: 'CREATE_INVITES', label: 'Create Invites', description: 'Generate and revoke invite links.', category: 'Membership' },
  { bit: PermissionBits.VIEW_CHANNELS, name: 'VIEW_CHANNELS', label: 'View Channels', description: 'See channels (unless denied per channel).', category: 'Text' },
  { bit: PermissionBits.SEND_MESSAGES, name: 'SEND_MESSAGES', label: 'Send Messages', description: 'Post messages in text channels.', category: 'Text' },
  { bit: PermissionBits.ATTACH_FILES, name: 'ATTACH_FILES', label: 'Attach Files', description: 'Upload images, GIFs, and files.', category: 'Text' },
  { bit: PermissionBits.ADD_REACTIONS, name: 'ADD_REACTIONS', label: 'Add Reactions', description: 'React to messages with emoji.', category: 'Text' },
  { bit: PermissionBits.MENTION_EVERYONE, name: 'MENTION_EVERYONE', label: 'Mention Everyone', description: 'Use @everyone and role mentions.', category: 'Text' },
  { bit: PermissionBits.MANAGE_MESSAGES, name: 'MANAGE_MESSAGES', label: 'Manage Messages', description: 'Delete or moderate other members’ messages.', category: 'Text' },
  { bit: PermissionBits.PIN_MESSAGES, name: 'PIN_MESSAGES', label: 'Pin Messages', description: 'Pin and unpin messages.', category: 'Text' },
  { bit: PermissionBits.MANAGE_THREADS, name: 'MANAGE_THREADS', label: 'Manage Threads', description: 'Promote, archive, and moderate threads.', category: 'Text' },
  { bit: PermissionBits.CONNECT, name: 'CONNECT', label: 'Connect', description: 'Join voice channels.', category: 'Voice' },
  { bit: PermissionBits.SPEAK, name: 'SPEAK', label: 'Speak', description: 'Transmit audio in voice channels.', category: 'Voice' },
  { bit: PermissionBits.CREATE_VOICE_ROOMS, name: 'CREATE_VOICE_ROOMS', label: 'Create Voice Rooms', description: 'Spawn temporary join-to-create rooms.', category: 'Voice' },
  { bit: PermissionBits.MUTE_MEMBERS, name: 'MUTE_MEMBERS', label: 'Mute Members', description: 'Server-mute others in voice.', category: 'Voice' },
  { bit: PermissionBits.DEAFEN_MEMBERS, name: 'DEAFEN_MEMBERS', label: 'Deafen Members', description: 'Server-deafen others in voice.', category: 'Voice' },
  { bit: PermissionBits.MOVE_MEMBERS, name: 'MOVE_MEMBERS', label: 'Move Members', description: 'Move members between voice channels.', category: 'Voice' },
  { bit: PermissionBits.CREATE_EVENTS, name: 'CREATE_EVENTS', label: 'Create Events', description: 'Schedule server events.', category: 'Events' },
  { bit: PermissionBits.MANAGE_EVENTS, name: 'MANAGE_EVENTS', label: 'Manage Events', description: 'Edit and cancel any event.', category: 'Events' },
]

/** Group-scoped check mirroring has_permission(group, null, bit). */
export function hasGroupPermission(context: GroupPermissionContext, bit: bigint): boolean {
  const permissions = resolveGroupPermissions(context)
  if (hasBits(permissions, PermissionBits.ADMINISTRATOR)) return true
  return hasBits(permissions, bit)
}

/** Channel-scoped check mirroring has_permission(group, channel, bit). */
export function hasChannelPermission(context: ChannelPermissionContext, bit: bigint): boolean {
  return hasBits(resolveChannelPermissions(context), bit)
}
