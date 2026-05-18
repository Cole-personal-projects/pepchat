import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChannelShell from '@/components/chat/ChannelShell'
import { MESSAGE_SELECT } from '@/lib/queries'
import type { MessageWithProfile, Profile } from '@/lib/types'
import type { Role } from '@/lib/permissions'

export default async function ChannelPage({
  params,
}: {
  params: { channelId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch channel details
  const { data: channel } = await supabase
    .from('channels')
    .select('*')
    .eq('id', params.channelId)
    .single()

  if (!channel) redirect('/')

  // Fetch current user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Fetch current user's role in the group that owns this channel
  const { data: membership } = await supabase
    .from('group_members')
    .select('role')
    .eq('group_id', channel.group_id)
    .eq('user_id', user.id)
    .single()
  const userRole = (membership?.role ?? null) as Role | null

  const { data: readState } = await supabase
    .from('channel_read_state')
    .select('last_read_at')
    .eq('channel_id', params.channelId)
    .eq('user_id', user.id)
    .maybeSingle()

  // Fetch last 50 messages (descending, then reverse for chronological display)
  const { data: messages } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('channel_id', params.channelId)
    .order('created_at', { ascending: false })
    .limit(50)

  const initialMessages = ((messages ?? []).reverse()) as MessageWithProfile[]

  return (
    <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
      <ChannelShell
        channelId={params.channelId}
        groupId={channel.group_id}
        channelName={channel.name}
        channelTopic={channel.description}
        initialMessages={initialMessages}
        profile={profile as Profile}
        userRole={userRole}
        userId={user.id}
        initialLastReadAt={readState?.last_read_at ?? null}
      />
    </div>
  )
}
