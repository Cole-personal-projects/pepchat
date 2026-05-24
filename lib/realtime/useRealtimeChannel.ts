'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js'

let realtimeChannelInstanceId = 0

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

function shouldUseIsolatedPostgresTopic(bindings: RealtimeBinding[]): boolean {
  return bindings.length > 0 && bindings.every(binding => binding.type === 'postgres_changes')
}

export function useRealtimeChannel(config: UseRealtimeChannelConfig): UseRealtimeChannelResult {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const isolatedTopicIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState<RealtimeStatus | null>(null)

  if (isolatedTopicIdRef.current === null) {
    realtimeChannelInstanceId += 1
    isolatedTopicIdRef.current = `instance-${realtimeChannelInstanceId}`
  }

  useEffect(() => {
    if (config.enabled === false) {
      channelRef.current = null
      setStatus(null)
      return
    }

    const supabase = createClient()
    const usesBroadcast = config.bindings.some(binding => binding.type === 'broadcast')
    const channelOptions = withRealtimeAuthorization(
      config.options,
      usesBroadcast,
    )
    const channelTopic = shouldUseIsolatedPostgresTopic(config.bindings)
      ? `${config.topic}:${isolatedTopicIdRef.current}`
      : config.topic
    const channel = channelOptions
      ? supabase.channel(channelTopic, channelOptions)
      : supabase.channel(channelTopic)

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
