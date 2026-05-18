import { ChatSurfaceSkeleton } from '@/components/ui/Skeleton'

export default function ChannelLoading() {
  return (
    <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
      <ChatSurfaceSkeleton />
    </div>
  )
}
