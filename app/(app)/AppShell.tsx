'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import GroupsSidebar from '@/components/sidebar/GroupsSidebar'
import ChannelsSidebar from '@/components/sidebar/ChannelsSidebar'
import CreateGroupModal from '@/components/modals/CreateGroupModal'
import JoinGroupModal from '@/components/modals/JoinGroupModal'
import GroupSettingsModal from '@/components/modals/GroupSettingsModal'
import CreateChannelModal from '@/components/modals/CreateChannelModal'
import NotificationTray from '@/components/notifications/NotificationTray'
import { MobileSidebarContext } from '@/lib/context/MobileSidebarContext'
import InstallBanner from '@/components/ui/InstallBanner'
import NetworkStatusBanner from '@/components/ui/NetworkStatusBanner'
import MotionSurface from '@/components/ui/MotionSurface'
import { useGroups } from '@/lib/hooks/useGroups'
import { useChannels } from '@/lib/hooks/useChannels'
import { useUnreadChannels } from '@/lib/hooks/useUnreadChannels'
import { markChannelRead, markChannelUnread } from '@/lib/channelReadState'
import { createClient } from '@/lib/supabase/client'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import type { Profile } from '@/lib/types'

interface AppShellProps {
  profile: Profile
  children: React.ReactNode
}

export default function AppShell({ profile, children }: AppShellProps) {
  const { groups, loading: groupsLoading, refetch } = useGroups()
  const pathname = usePathname()

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<Role | null>(null)

  const [showCreate,     setShowCreate]     = useState(false)
  const [showJoin,       setShowJoin]       = useState(false)
  const [showSettings,   setShowSettings]   = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [promptedFirstGroup, setPromptedFirstGroup] = useState(false)

  // Auto-open the sidebar on mobile whenever no channel is selected
  // so users aren't stuck on the blank empty state with no navigation.
  useEffect(() => {
    const onEmptyState = pathname === '/channels' || pathname === '/'
    if (onEmptyState && window.innerWidth < 768) {
      const t = setTimeout(() => setMobileSidebarOpen(true), 300)
      return () => clearTimeout(t)
    }
  }, [pathname])

  // Resolve active group from URL
  useEffect(() => {
    const groupMatch = pathname.match(/^\/groups\/([^/]+)/)
    if (groupMatch) { setActiveGroupId(groupMatch[1]); return }

    const channelMatch = pathname.match(/^\/channels\/([^/]+)$/)
    if (channelMatch) {
      createClient()
        .from('channels').select('group_id').eq('id', channelMatch[1]).single()
        .then(({ data }) => { if (data) setActiveGroupId(data.group_id) })
    }
  }, [pathname])

  // Default to first group on load — but not when viewing DMs
  useEffect(() => {
    if (!groupsLoading && groups.length > 0 && !activeGroupId && !pathname.startsWith('/dm')) {
      setActiveGroupId(groups[0].id)
    }
  }, [groupsLoading, groups, activeGroupId, pathname])

  useEffect(() => {
    if (!groupsLoading && groups.length === 0 && !promptedFirstGroup) {
      setPromptedFirstGroup(true)
      setShowCreate(true)
    }
  }, [groupsLoading, groups.length, promptedFirstGroup])

  // Fetch current user's role in the active group (filter by user_id to avoid multi-row error)
  useEffect(() => {
    if (!activeGroupId) { setUserRole(null); return }
    createClient()
      .from('group_members')
      .select('role')
      .eq('group_id', activeGroupId)
      .eq('user_id', profile.id)
      .single()
      .then(({ data }) => { setUserRole((data?.role as Role) ?? null) })
  }, [activeGroupId, profile.id])

  // Re-fetch role when group_members changes (e.g., admin promotes you live)
  useEffect(() => {
    if (!activeGroupId) return
    const supabase = createClient()
    const sub = supabase
      .channel(`my-role-${activeGroupId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'group_members',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.new?.group_id === activeGroupId) {
            setUserRole(payload.new.role as Role)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(sub) }
  }, [activeGroupId, profile.id])

  const { channels } = useChannels(activeGroupId)
  const activeGroup  = groups.find((g) => g.id === activeGroupId) ?? null

  // Derive active channel ID from URL for unread hook
  const activeChannelId = (() => {
    const m = pathname.match(/^\/channels\/([^/]+)$/)
    return m ? m[1] : null
  })()

  const { unreadChannelIds, unreadGroupIds, unreadCountsByChannelId } = useUnreadChannels(profile.id, activeChannelId)

  async function handleMarkChannelRead(channelId: string) {
    await markChannelRead(channelId, profile.id)
  }

  async function handleMarkChannelUnread(channelId: string) {
    await markChannelUnread(channelId, profile.id)
  }

  return (
    <MobileSidebarContext.Provider value={{ open: () => setMobileSidebarOpen(true) }}>
      <div className="flex overflow-hidden" style={{ height: '100dvh' }}>
        {/* Mobile sidebar overlay backdrop */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/60 md:hidden modal-backdrop-enter"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Sidebars: always visible on md+; slide-in overlay on mobile */}
        <div
          className={`
            fixed inset-y-0 left-0 z-30 flex
            transform transition-transform ease-[var(--ease-pep-spring)] duration-[var(--motion-panel)]
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            md:relative md:translate-x-0 md:z-auto md:flex
          `}
        >
          <GroupsSidebar
            groups={groups}
            currentUserId={profile.id}
            unreadGroupIds={unreadGroupIds}
            isDMActive={pathname.startsWith('/dm')}
            onCreateGroup={() => setShowCreate(true)}
            onJoinGroup={() => setShowJoin(true)}
            onDMsHome={() => setActiveGroupId(null)}
          />

          <ChannelsSidebar
            group={activeGroup}
            channels={channels}
            profile={profile}
            userRole={userRole}
            unreadChannelIds={unreadChannelIds}
            unreadCountsByChannelId={unreadCountsByChannelId}
            onMarkChannelRead={handleMarkChannelRead}
            onMarkChannelUnread={handleMarkChannelUnread}
            onCreateChannel={() => setShowNewChannel(true)}
            onGroupSettings={() => setShowSettings(true)}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        </div>

        <main
          className="flex flex-col flex-1 min-w-0 overflow-hidden"
        >
          <InstallBanner />
          <NetworkStatusBanner />
          <NotificationTray />
          <MotionSurface motionKey={pathname} direction={pathname.startsWith('/settings') || pathname.startsWith('/admin') || pathname.startsWith('/help') ? 'none' : 'forward'} className="flex flex-1 min-h-0 overflow-hidden">
            {children}
          </MotionSurface>
          <nav className="mobile-bottom-nav" aria-label="Mobile app navigation">
            <button type="button" onClick={() => setMobileSidebarOpen(true)} aria-current={!pathname.startsWith('/dm') ? 'page' : undefined}>
              Channels
            </button>
            {userRole === 'admin' ? <a href="/admin/reports">Reports</a> : <a href="/settings/profile">Profile</a>}
          </nav>
        </main>
      </div>

      <CreateGroupModal open={showCreate} onClose={() => setShowCreate(false)} onSuccess={refetch} />
      <JoinGroupModal   open={showJoin}   onClose={() => setShowJoin(false)}   onSuccess={refetch} />

      {activeGroup && (
        <GroupSettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
          group={activeGroup}
          isOwner={PERMISSIONS.canManageGroup(userRole ?? 'noob')}
          onIconChange={refetch}
        />
      )}

      {activeGroupId && (
        <CreateChannelModal
          open={showNewChannel}
          onClose={() => setShowNewChannel(false)}
          groupId={activeGroupId}
        />
      )}
    </MobileSidebarContext.Provider>
  )
}
