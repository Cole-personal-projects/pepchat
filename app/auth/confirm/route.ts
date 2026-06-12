import { type EmailOtpType } from '@supabase/supabase-js'
import { userHasPendingAccountInviteClaim } from '@/lib/invites/accountClaims'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/channels'
  return value
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeRedirectPath(searchParams.get('next'))

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return NextResponse.redirect(`${origin}/login?error=invalid_link`)

      // Recovery links exist to change the password — never dump the user
      // into the app silently with their old password still in place.
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single()

      if (profile) return NextResponse.redirect(`${origin}${next}`)

      const hasPendingClaim = await userHasPendingAccountInviteClaim(supabase, user.id)
      if (hasPendingClaim) {
        return NextResponse.redirect(`${origin}/setup-profile?next=${encodeURIComponent(next)}`)
      }

      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/login?invite_required=1`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_link`)
}
