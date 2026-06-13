-- Restore the canonical channels INSERT policy.
--
-- During debugging of the channel-creation failure the production policy
-- was hand-edited (dropped/recreated, then swapped to an inline owner/admin
-- check). Channel creation now goes through the create_channel SECURITY
-- DEFINER function, so this policy is no longer load-bearing for the app —
-- but it should still match the repo and provide a sane RLS guard for any
-- direct insert. This re-establishes the cutover-era definition verbatim.

drop policy if exists "Channel managers can create channels" on public.channels;
create policy "Channel managers can create channels"
  on public.channels for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 3))); -- MANAGE_CHANNELS
