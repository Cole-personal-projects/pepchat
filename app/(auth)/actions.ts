'use server'

import { createClient } from '@/lib/supabase/server'
import {
  createOrReplaceAccountInviteClaim,
  completeAccountInviteProfile,
  userHasPendingAccountInviteClaim,
} from '@/lib/invites/accountClaims'
import { inviteCodeFromNextPath, normalizeInviteCode, resolveInvite } from '@/lib/invites'
import { inviteLookupClient } from '@/lib/invites/lookupClient'
import { redirect } from 'next/navigation'

function safeRedirectPath(value: FormDataEntryValue | string | null): string {
  if (typeof value !== 'string') return '/channels'
  if (!value.startsWith('/') || value.startsWith('//')) return '/channels'
  if (value.includes('\\')) return '/channels'
  return value
}

function inviteCodeFromForm(formData: FormData): string {
  const invite = formData.get('invite')
  if (typeof invite === 'string' && invite.trim()) return normalizeInviteCode(invite)
  return inviteCodeFromNextPath(formData.get('next')?.toString())
}

/**
 * Signs the user in with email + password.
 * Returns an error string on failure; redirects on success.
 */
export async function login(
  formData: FormData
): Promise<{ error: string } | never> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const next = safeRedirectPath(formData.get('next'))

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      const hasPendingClaim = await userHasPendingAccountInviteClaim(supabase, user.id)
      if (!hasPendingClaim) {
        await supabase.auth.signOut()
        return { error: 'An invite is required to finish account setup.' }
      }
      redirect(`/setup-profile?next=${encodeURIComponent(next)}`)
    }
  }

  redirect(next)
}

/**
 * Creates a new account with email + password.
 * Returns an error string on failure; redirects on success.
 */
export async function signup(
  formData: FormData
): Promise<{ error: string } | { email: string }> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const inviteCode = inviteCodeFromForm(formData)

  if (!inviteCode) return { error: 'A valid invite is required to create an account.' }

  const resolved = await resolveInvite(supabase, inviteCode, {
    authoritativeSupabase: inviteLookupClient(supabase),
    mode: 'account_signup',
  })
  if (!resolved.ok || resolved.invite.kind !== 'managed') {
    return { error: resolved.ok ? 'A valid invite is required to create an account.' : resolved.message }
  }

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: error.message }

  // Supabase returns a fake-success with an identities array when the email is
  // already registered. Surface this as a user-facing error instead of silently
  // sending them to the check-email screen. Do not create invite claims here.
  if (data.user && data.user.identities?.length === 0) {
    return { error: 'An account with that email already exists.' }
  }

  if (data.user) {
    const claim = await createOrReplaceAccountInviteClaim({
      inviteCode,
      authUserId: data.user.id,
      email,
    })
    if ('error' in claim) return { error: claim.error }
  }

  return { email }
}

/**
 * Creates the public profile row with the chosen username.
 * Returns an error string on failure; redirects on success.
 */
export async function setupProfile(
  formData: FormData
): Promise<{ error: string } | never> {
  const supabase = await createClient()
  const username = (formData.get('username') as string).trim()
  const next = safeRedirectPath(formData.get('next'))

  if (!username || username.length < 2) {
    return { error: 'Username must be at least 2 characters.' }
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return { error: 'Username may only contain letters, numbers, _, . and -' }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const hasPendingClaim = await userHasPendingAccountInviteClaim(supabase, user.id)
  if (!hasPendingClaim) return { error: 'An invite is required to finish account setup.' }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single()

  if (existing) return { error: 'That username is already taken.' }

  const completed = await completeAccountInviteProfile(supabase, username)
  if ('error' in completed) return { error: completed.error }

  const destination = next === '/channels' ? `/groups/${completed.groupId}` : next
  redirect(destination)
}

/**
 * Signs the user out and redirects to the login page.
 */
export async function logout(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/**
 * Sends a password-recovery email. The reply is intentionally identical
 * whether or not the address has an account — no email enumeration.
 */
export async function requestPasswordReset(
  formData: FormData
): Promise<{ ok: true } | { error: string }> {
  const email = (formData.get('email') as string | null)?.trim() ?? ''
  if (!email || !email.includes('@')) return { error: 'Enter the email you signed up with.' }

  const { headers } = await import('next/headers')
  const origin = (await headers()).get('origin') ?? ''

  const supabase = await createClient()
  // redirectTo covers {{ .RedirectTo }}-style email templates; token_hash
  // templates land on /auth/confirm, which routes recovery to /reset-password.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent('/reset-password')}`,
  })

  // Errors (rate limits aside) are not surfaced: same response either way.
  return { ok: true }
}

/**
 * Sets a new password for the recovery-authenticated user, then sends
 * them into the app.
 */
export async function updatePassword(
  formData: FormData
): Promise<{ error: string } | never> {
  const password = (formData.get('password') as string | null) ?? ''
  const confirm = (formData.get('confirm') as string | null) ?? ''

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'This reset link has expired. Request a new one from the login page.' }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  redirect('/channels')
}
