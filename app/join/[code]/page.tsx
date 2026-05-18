export const runtime = 'edge'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consumeInvite, resolveInvite } from '@/lib/invites'
import { createOrReplaceAccountInviteClaim } from '@/lib/invites/accountClaims'
import { inviteLookupClient } from '@/lib/invites/lookupClient'
import { createClient } from '@/lib/supabase/server'

function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6" style={{ background: 'var(--bg-chat)' }}>
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-5 text-center">
        <h1 className="text-lg font-bold text-[var(--text-primary)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      </div>
    </div>
  )
}

function InviteAuthChoice({ code }: { code: string }) {
  const next = `/join/${code}`
  return (
    <div className="flex h-full items-center justify-center px-6" style={{ background: 'var(--bg-chat)' }}>
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-5 text-center">
        <h1 className="text-lg font-bold text-[var(--text-primary)]">You have been invited to SideBar</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Create an account with this invite or log in to join with an existing account.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Link
            href={`/signup?invite=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            Create account
          </Link>
          <Link
            href={`/login?invite=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Log in instead
          </Link>
        </div>
      </div>
    </div>
  )
}

function closedInviteMessage(reason: string) {
  const isLegacy = reason === 'legacy_not_allowed'
  const isUnusable = reason === 'unusable'
  return {
    title: isLegacy ? 'Fresh invite needed' : isUnusable ? 'Invite expired' : 'Invite not found',
    body: isLegacy
      ? 'This invite link is no longer accepted for new accounts. Ask an admin for a fresh invite.'
      : 'This invite is no longer valid. Ask an admin for a fresh link.',
  }
}

export default async function JoinPage({
  params,
}: {
  params: { code: string }
}) {
  const supabase = await createClient()
  const authoritativeSupabase = inviteLookupClient(supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (profile) {
      const groupJoinResolved = await resolveInvite(supabase, params.code, {
        authoritativeSupabase,
        mode: 'group_join',
      })

      if (!groupJoinResolved.ok) {
        return <InviteMessage title="Invite not found" body={groupJoinResolved.message} />
      }

      const consumed = await consumeInvite(supabase, groupJoinResolved.invite, user.id)
      if (!consumed.ok) {
        return <InviteMessage title="Could not join group" body={consumed.message} />
      }

      redirect(`/groups/${consumed.groupId}`)
    }
  }

  const accountResolved = await resolveInvite(supabase, params.code, {
    authoritativeSupabase,
    mode: 'account_signup',
  })

  if (!accountResolved.ok) {
    const message = closedInviteMessage(accountResolved.reason)
    return <InviteMessage title={message.title} body={message.body} />
  }

  if (!user) return <InviteAuthChoice code={params.code} />

  const claimed = await createOrReplaceAccountInviteClaim({
    inviteCode: params.code,
    authUserId: user.id,
    email: user.email ?? '',
  })

  if ('error' in claimed) {
    return <InviteMessage title="Invite expired" body="This invite is no longer valid. Ask an admin for a fresh link." />
  }

  redirect(`/setup-profile?next=${encodeURIComponent(`/join/${params.code}`)}`)
}
