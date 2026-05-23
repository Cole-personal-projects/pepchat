'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js'

export type RealtimeStatus = 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'SUBSCRIBED' | string

export type RealtimeBinding = {
  type: 'broadcast' | 'presence' | 'postgres_changes'
  filter: Record<string, unknown>
  handler: (payload: any) => void
}

export type UseRealtimeChannelConfig = {
  topic: string
  enabled?: boolean
  options?: RealtimeChannelOptions
  bindings: RealtimeBinding[]
  onStatus?: (status: RealtimeStatus, channel: RealtimeChannel) => void | Promise<void>
  deps: React.DependencyList
}

export type UseRealtimeChannelResult = {
  channelRef: React.MutableRefObject<RealtimeChannel | null>
  status: RealtimeStatus | null
}

function withRealtimeAuthorization(options: RealtimeChannelOptions | undefined, usesBroadcast: boolean): RealtimeChannelOptions | undefined {
  if (options?.config?.private !== undefined) return options
  if (!usesBroadcast) return options

  return {
    ...options,
    config: {
      ...options?.config,
      private: true,
    },
  }
}

export function useRealtimeChannel(config: UseRealtimeChannelConfig): UseRealtimeChannelResult {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const [status, setStatus] = useState<RealtimeStatus | null>(null)

  useEffect(() => {
    if (config.enabled === false) {
      channelRef.current = null
      setStatus(null)
      return
    }

    const supabase = createClient()
    const channelOptions = withRealtimeAuthorization(
      config.options,
      config.bindings.some(binding => binding.type === 'broadcast'),
    )
    const channel = channelOptions
      ? supabase.channel(config.topic, channelOptions)
      : supabase.channel(config.topic)

    let boundChannel = channel
    for (const binding of config.bindings) {
      boundChannel = (boundChannel.on as any)(binding.type, binding.filter, binding.handler)
    }

    channelRef.current = channel
    boundChannel.subscribe((nextStatus) => {
      setStatus(nextStatus)
      void config.onStatus?.(nextStatus, channel)
    })

    return () => {
      if (channelRef.current === channel) {
        channelRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  // deps is the explicit lifecycle contract for this seam; callers own stability.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, config.deps)

  return { channelRef, status }
}
