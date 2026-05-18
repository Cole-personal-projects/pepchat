import Link from 'next/link'
import SignupForm from './SignupForm'
import { inviteCodeFromNextPath, normalizeInviteCode, resolveInvite } from '@/lib/invites'
import { inviteLookupClient } from '@/lib/invites/lookupClient'
import { createClient } from '@/lib/supabase/server'

function ClosedSignup({ message }: { message: string }) {
  return (
    <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl text-center">
      <h1 className="text-2xl font-bold mb-2">SideBar is invite-only</h1>
      <p className="text-[var(--text-muted)] text-sm mb-6">{message}</p>
      <Link href="/login" className="text-[var(--accent)] hover:underline text-sm">
        Log in with an existing account
      </Link>
    </div>
  )
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: { invite?: string; next?: string }
}) {
  const supabase = await createClient()
  const invite = normalizeInviteCode(searchParams?.invite ?? inviteCodeFromNextPath(searchParams?.next) ?? '')
  const nextPath = searchParams?.next?.startsWith('/') && !searchParams.next.startsWith('//') && !searchParams.next.includes('\\')
    ? searchParams.next
    : invite
      ? `/join/${invite}`
      : ''

  if (!invite) {
    return <ClosedSignup message="Ask a group admin for a fresh invite link before creating an account." />
  }

  const resolved = await resolveInvite(supabase, invite, {
    authoritativeSupabase: inviteLookupClient(supabase),
    mode: 'account_signup',
  })

  if (!resolved.ok || resolved.invite.kind !== 'managed') {
    return <ClosedSignup message={resolved.ok ? 'Ask a group admin for a fresh invite link.' : resolved.message} />
  }

  return <SignupForm invite={invite} nextPath={nextPath} />
}
