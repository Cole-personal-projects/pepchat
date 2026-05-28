export type Role = 'admin' | 'moderator' | 'user' | 'noob'
export type RolePredicate = (role: Role) => boolean

export function canPromoteThread(role: Role, isRootAuthor: boolean): boolean {
  return (['admin', 'moderator'] as Role[]).includes(role) || isRootAuthor
}

/**
 * Central permissions helper.
 * All role-gating in the UI goes through this object so rules
 * stay in one place and never diverge from the DB RLS policies.
 */
export const PERMISSIONS = {
  /** Can create, edit, and delete channels. */
  canManageChannels: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),

  /** Can promote a thread into a channel. Root authors get a one-off channel-create elevation. */
  canPromoteThread,

  /** Can generate or revoke invite codes. */
  canGenerateInvite: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),

  /** Can delete any message in the group (not just their own). */
  canDeleteAnyMessage: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),

  /** Can delete their own messages. */
  canDeleteOwnMessage: (role: Role) =>
    (['admin', 'moderator', 'user'] as Role[]).includes(role),

  /** Can assign roles to other members. Admin only. */
  canAssignRoles: (role: Role) => role === 'admin',

  /** Can remove (kick) other members from the group. */
  canKickMembers: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),

  /** Can access a given channel. Noobs are restricted to explicitly allowed channels. */
  canAccessChannel: (role: Role, channelName: string, noobAccess = false) => {
    if (role === 'noob') return noobAccess || channelName === 'welcome'
    return true
  },

  /** Can start a channel voice room. Voice room creation is limited to group managers. */
  canStartVoiceRoom: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),

  /** Can join a channel voice room under the same access rules as channel reads. */
  canJoinVoiceRoom: (role: Role, channelName: string, noobAccess = false) =>
    PERMISSIONS.canAccessChannel(role, channelName, noobAccess),

  /** Can delete the group, update group settings. Admin only. */
  canManageGroup: (role: Role) => role === 'admin',

  /** Can react to messages. All roles including noob (noob restricted to welcome channel by RLS). */
  canReact: (role: Role) => (['admin', 'moderator', 'user', 'noob'] as Role[]).includes(role),

  /** Can send images. All roles (noob restricted to welcome channel by RLS). */
  canSendImages: (role: Role) => (['admin', 'moderator', 'user', 'noob'] as Role[]).includes(role),

  /** Can send GIFs. All roles (noob restricted to welcome channel by RLS). */
  canSendGifs: (role: Role) => (['admin', 'moderator', 'user', 'noob'] as Role[]).includes(role),

  /** Can send direct messages. All roles. */
  canSendDMs: (_role: Role) => true,

  /** Can pin/unpin messages in a channel. */
  canPinMessages: (role: Role) =>
    (['admin', 'moderator'] as Role[]).includes(role),
} as const
