import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FriendsView from '@/components/friends/FriendsView'

export const runtime = 'edge'

/** Friends home: list, pending requests, and blocks. */
export default async function FriendsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <FriendsView currentUserId={user.id} />
}
