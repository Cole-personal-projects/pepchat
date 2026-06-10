'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { EventRsvp, ScheduledEvent } from '@/lib/types'

export type ScheduledEventWithRsvps = ScheduledEvent & {
  goingCount: number
  interestedCount: number
  ownRsvp: EventRsvp['status'] | null
}

/** Upcoming + active events for a group with RSVP rollups, live-updating. */
export function useScheduledEvents(groupId: string | null, currentUserId: string | null) {
  const [events, setEvents] = useState<ScheduledEvent[]>([])
  const [rsvps, setRsvps] = useState<EventRsvp[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEvents = useCallback(async () => {
    if (!groupId) {
      setEvents([])
      setRsvps([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: eventRows } = await supabase
      .from('scheduled_events')
      .select('*')
      .eq('group_id', groupId)
      .in('status', ['scheduled', 'active'])
      .order('start_at', { ascending: true })

    const eventList = (eventRows ?? []) as ScheduledEvent[]
    setEvents(eventList)

    if (eventList.length > 0) {
      const { data: rsvpRows } = await supabase
        .from('event_rsvps')
        .select('*')
        .in('event_id', eventList.map(event => event.id))
      setRsvps((rsvpRows ?? []) as EventRsvp[])
    } else {
      setRsvps([])
    }
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    setLoading(true)
    fetchEvents()
  }, [fetchEvents])

  useRealtimeChannel({
    topic: `events-${groupId}`,
    enabled: Boolean(groupId),
    deps: [groupId, fetchEvents],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'scheduled_events', filter: `group_id=eq.${groupId}` },
        handler: fetchEvents,
      },
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'event_rsvps' },
        handler: fetchEvents,
      },
    ],
  })

  const eventsWithRsvps = useMemo<ScheduledEventWithRsvps[]>(() => {
    return events.map(event => {
      const eventRsvps = rsvps.filter(rsvp => rsvp.event_id === event.id)
      return {
        ...event,
        goingCount: eventRsvps.filter(rsvp => rsvp.status === 'going').length,
        interestedCount: eventRsvps.filter(rsvp => rsvp.status === 'interested').length,
        ownRsvp: eventRsvps.find(rsvp => rsvp.user_id === currentUserId)?.status ?? null,
      }
    })
  }, [events, rsvps, currentUserId])

  return { events: eventsWithRsvps, loading, refetch: fetchEvents }
}
