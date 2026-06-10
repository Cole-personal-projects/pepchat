import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260610110000_rls_cutover.sql'),
  'utf8',
)

describe('RLS cutover migration', () => {
  it('maintains @everyone VIEW overwrites for noob-visible channels', () => {
    expect(migration).toContain('create or replace function public.sync_channel_everyone_view_overwrite()')
    expect(migration).toContain('trg_channels_everyone_view')
    expect(migration).toContain("after insert or update of noob_access, name on public.channels")
    expect(migration).toContain("coalesce(new.noob_access, false) or new.name = 'welcome'")
    // One-time backfill for existing channels.
    expect(migration).toContain("where coalesce(c.noob_access, false) or c.name = 'welcome'")
  })

  it('gates channel visibility and management with permission bits', () => {
    expect(migration).toContain('public.has_permission(group_id, id, (1::bigint << 7))')
    expect(migration).toContain('public.has_permission(group_id, null, (1::bigint << 3))')
    expect(migration).not.toContain("get_user_role_in_group(group_id) != 'noob'")
  })

  it('requires VIEW + SEND to post and VIEW + ADD_REACTIONS to react', () => {
    expect(migration).toContain('((1::bigint << 7) | (1::bigint << 8))')
    expect(migration).toContain('((1::bigint << 7) | (1::bigint << 10))')
    expect(migration).toContain('user_id = auth.uid()')
  })

  it('adds MANAGE_MESSAGES moderation deletes', () => {
    expect(migration).toContain('create policy "Message managers can delete messages"')
    expect(migration).toContain('(1::bigint << 6)')
  })

  it('moves kicks to KICK_MEMBERS while protecting admins and owners', () => {
    expect(migration).toContain('(1::bigint << 4)')
    expect(migration).toContain("role <> 'admin'")
    expect(migration).toContain('g.owner_id = group_members.user_id')
  })

  it('moves invites to CREATE_INVITES', () => {
    expect(migration).toContain('create policy "Invite managers can create group invites"')
    expect(migration).toContain('(1::bigint << 5)')
    expect(migration).not.toContain('public.is_group_admin(group_id)')
  })

  it('keeps group updates available to the owner alongside MANAGE_GROUP', () => {
    expect(migration).toContain('owner_id = auth.uid()')
    expect(migration).toContain('public.has_permission(id, null, (1::bigint << 1))')
  })

  it('replaces enum joins with the CONNECT bit for voice rooms', () => {
    expect(migration).toContain('(1::bigint << 14)')
    expect(migration).toContain("c.kind = 'voice'")
    expect(migration).not.toContain("gm.role in ('admin', 'moderator', 'user')")
  })

  it('drops every legacy policy it replaces', () => {
    for (const policy of [
      'Members can view channels in their groups',
      'Admins and moderators can create channels',
      'Admins and moderators can update channels',
      'Admins and moderators can delete channels',
      'Members can read messages in their channels',
      'Members can insert messages as themselves',
      'Members can view reactions in their channels',
      'Members can insert reactions as themselves',
      'Owners can update their group',
      'Users can leave groups',
      'Admins can read group invites',
      'Admins can create group invites',
      'Admins can update group invites',
      'Members can open sessions for accessible voice channels',
      'Members can update lifecycle for accessible voice rooms',
    ]) {
      expect(migration).toContain(`drop policy if exists "${policy}"`)
    }
  })
})
