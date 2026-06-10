import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PermissionBits } from '@/lib/permissions/bits'

const kindsMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260610090000_channel_kinds_and_categories.sql'),
  'utf8',
)
const rolesMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260610091000_roles_engine.sql'),
  'utf8',
)
const socialMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260610092000_social_foundations.sql'),
  'utf8',
)
const eventsMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260610093000_events_forums_onboarding.sql'),
  'utf8',
)

describe('channel kinds and categories migration', () => {
  it('extends channel kind to include forum and keeps existing kinds', () => {
    expect(kindsMigration).toContain("check (kind in ('text', 'voice', 'forum'))")
    expect(kindsMigration).toContain('drop constraint if exists channels_kind_check')
  })

  it('creates channel_categories with RLS and group-scoped policies', () => {
    expect(kindsMigration).toContain('create table if not exists public.channel_categories')
    expect(kindsMigration).toContain('alter table public.channel_categories enable row level security')
    expect(kindsMigration).toContain('add column if not exists category_id uuid references public.channel_categories(id) on delete set null')
    expect(kindsMigration).toContain('public.can_manage_channels(group_id)')
  })
})

describe('roles engine migration', () => {
  it('declares the same permission bits as the TypeScript mirror', () => {
    const declared = new Map<string, bigint>()
    for (const match of rolesMigration.matchAll(/-- PERMISSION_BIT (\w+) = 1 << (\d+)/g)) {
      declared.set(match[1], 1n << BigInt(match[2]))
    }

    expect(declared.size).toBeGreaterThan(0)
    expect(Object.keys(PermissionBits).sort()).toEqual([...declared.keys()].sort())
    for (const [name, bit] of declared) {
      expect(PermissionBits[name as keyof typeof PermissionBits]).toBe(bit)
    }
  })

  it('creates the roles, member_roles, and channel_overwrites tables with RLS', () => {
    expect(rolesMigration).toContain('create table if not exists public.roles')
    expect(rolesMigration).toContain('create table if not exists public.member_roles')
    expect(rolesMigration).toContain('create table if not exists public.channel_overwrites')
    expect(rolesMigration).toContain('alter table public.roles              enable row level security')
    expect(rolesMigration).toContain('alter table public.member_roles       enable row level security')
    expect(rolesMigration).toContain('alter table public.channel_overwrites enable row level security')
  })

  it('enforces one default role per group and one overwrite per target', () => {
    expect(rolesMigration).toContain('roles_one_default_per_group')
    expect(rolesMigration).toContain('where is_default')
    expect(rolesMigration).toContain('channel_overwrites_role_unique')
    expect(rolesMigration).toContain('channel_overwrites_user_unique')
    expect(rolesMigration).toContain('channel_overwrites_single_target')
  })

  it('cascades member role assignments when the member leaves', () => {
    expect(rolesMigration).toContain(
      'foreign key (group_id, user_id) references public.group_members(group_id, user_id) on delete cascade',
    )
  })

  it('defines security definer resolution functions and a has_permission entry point', () => {
    expect(rolesMigration).toContain('create or replace function public.resolve_group_permissions')
    expect(rolesMigration).toContain('create or replace function public.resolve_channel_permissions')
    expect(rolesMigration).toContain('create or replace function public.has_permission')
    expect(rolesMigration.match(/security definer stable/g)?.length).toBeGreaterThanOrEqual(3)
    expect(rolesMigration).toContain('grant execute on function public.has_permission(uuid, uuid, bigint, uuid) to authenticated')
  })

  it('treats group owners and administrators as full-permission', () => {
    expect(rolesMigration).toContain('if v_owner = p_user_id then return 1; end if;')
    expect(rolesMigration).toContain("if (v_perms & 1) = 1 then return -1; end if;")
  })

  it('seeds default roles for new and existing groups and syncs the legacy enum', () => {
    expect(rolesMigration).toContain('create or replace function public.seed_default_roles')
    expect(rolesMigration).toContain('trg_groups_seed_default_roles')
    expect(rolesMigration).toContain('trg_group_members_sync_roles')
    expect(rolesMigration).toContain("after insert or update of role on public.group_members")
    expect(rolesMigration).toContain('for g in select id from public.groups loop')
    expect(rolesMigration).toContain('on conflict (role_id, user_id) do nothing')
  })

  it('gates role management behind MANAGE_ROLES and protects the default role from deletion', () => {
    expect(rolesMigration).toContain('public.has_permission(group_id, null, (1::bigint << 2))')
    expect(rolesMigration).toContain('not is_default')
  })
})

describe('social foundations migration', () => {
  it('creates friendships with a direction-agnostic unique pair', () => {
    expect(socialMigration).toContain('create table if not exists public.friendships')
    expect(socialMigration).toContain('least(requester_id, addressee_id), greatest(requester_id, addressee_id)')
    expect(socialMigration).toContain('friendships_no_self')
  })

  it('scopes friendship rows to the two participants', () => {
    expect(socialMigration).toContain('requester_id = auth.uid() or addressee_id = auth.uid()')
    expect(socialMigration).toContain('requester_id = auth.uid()')
  })

  it('creates user_status visible to self, group-mates, and friends', () => {
    expect(socialMigration).toContain('create table if not exists public.user_status')
    expect(socialMigration).toContain("check (presence in ('online', 'idle', 'dnd', 'invisible'))")
    expect(socialMigration).toContain('public.users_share_group(user_id)')
    expect(socialMigration).toContain('public.users_are_friends(user_id)')
  })

  it('extends profile visibility to friends', () => {
    expect(socialMigration).toContain('drop policy if exists "Profiled users can read visible profiles" on public.profiles')
    expect(socialMigration).toContain('or public.users_are_friends(id)')
  })
})

describe('events, forums, onboarding migration', () => {
  it('creates scheduled events gated by CREATE_EVENTS and MANAGE_EVENTS bits', () => {
    expect(eventsMigration).toContain('create table if not exists public.scheduled_events')
    expect(eventsMigration).toContain('create table if not exists public.event_rsvps')
    expect(eventsMigration).toContain('(1::bigint << 21)) -- CREATE_EVENTS')
    expect(eventsMigration).toContain('(1::bigint << 20)) -- MANAGE_EVENTS')
  })

  it('creates forum tags gated by MANAGE_CHANNELS with author tagging', () => {
    expect(eventsMigration).toContain('create table if not exists public.forum_tags')
    expect(eventsMigration).toContain('create table if not exists public.forum_post_tags')
    expect(eventsMigration).toContain('unique(channel_id, name)')
    expect(eventsMigration).toContain('m.user_id = auth.uid()')
  })

  it('creates onboarding tables with manager-gated config and self-scoped progress', () => {
    expect(eventsMigration).toContain('create table if not exists public.group_onboarding')
    expect(eventsMigration).toContain('create table if not exists public.onboarding_questions')
    expect(eventsMigration).toContain('create table if not exists public.onboarding_options')
    expect(eventsMigration).toContain('create table if not exists public.onboarding_option_roles')
    expect(eventsMigration).toContain('create table if not exists public.member_onboarding')
    expect(eventsMigration).toContain('create table if not exists public.member_onboarding_responses')
    expect(eventsMigration).toContain('(1::bigint << 22)')
    expect(eventsMigration).toContain('user_id = auth.uid()')
  })

  it('enables RLS on every new table', () => {
    for (const table of [
      'scheduled_events',
      'event_rsvps',
      'forum_tags',
      'forum_post_tags',
      'group_onboarding',
      'onboarding_questions',
      'onboarding_options',
      'onboarding_option_roles',
      'member_onboarding',
      'member_onboarding_responses',
    ]) {
      expect(eventsMigration).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      )
    }
  })
})
