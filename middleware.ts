import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabase, getResponse } = createMiddlewareClient(request)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const currentPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const isJoinRoute = pathname.startsWith('/join')
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/setup-profile') ||
    pathname.startsWith('/check-email') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/auth/confirm') ||
    pathname.startsWith('/auth/callback')

  if (!user && !isAuthRoute && !isJoinRoute) {
    return redirectWithNext(request, '/login', currentPath)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const nextPath = safeRedirectPath(request.nextUrl.searchParams.get('next')) ?? '/channels'
    const hasProfile = await userHasProfile(supabase, user.id)
    if (!hasProfile) {
      const hasPendingClaim = await userHasPendingInviteClaim(supabase, user.id)
      if (hasPendingClaim) return redirectWithNext(request, '/setup-profile', nextPath)
      await supabase.auth.signOut()
      return redirectToPath(request, '/login?invite_required=1')
    }
    return redirectToPath(request, nextPath)
  }

  if (user) {
    const hasProfile = await userHasProfile(supabase, user.id)
    if (!hasProfile) {
      const hasPendingClaim = await userHasPendingInviteClaim(supabase, user.id)
      if (!hasPendingClaim) {
        await supabase.auth.signOut()
        return redirectToPath(request, '/login?invite_required=1')
      }
      if (pathname.startsWith('/setup-profile')) return getResponse()
      if (!isAuthRoute && !isJoinRoute) return redirectWithNext(request, '/setup-profile', currentPath)
    }
  }

  return getResponse()
}

function safeRedirectPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value
}

function redirectToPath(request: NextRequest, path: string) {
  const url = request.nextUrl.clone()
  const destination = new URL(path, request.nextUrl.origin)
  url.pathname = destination.pathname
  url.search = destination.search
  return NextResponse.redirect(url)
}

function redirectWithNext(request: NextRequest, targetPath: string, nextPath: string) {
  const url = request.nextUrl.clone()
  url.pathname = targetPath
  url.search = ''
  url.searchParams.set('next', nextPath)
  return NextResponse.redirect(url)
}

async function userHasProfile(supabase: SupabaseClient, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single()

  return Boolean(profile)
}

async function userHasPendingInviteClaim(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc('user_has_pending_account_invite_claim', {
    p_auth_user_id: userId,
  })
  if (error) return false
  return Boolean(data)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
