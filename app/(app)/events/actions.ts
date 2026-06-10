'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { gateGroupPermission } from '@/lib/permissions/gate'
import { PermissionBits } from '@/lib/permissions/bits'

const EVENTS_DENIED = 'You do not have permission to manage events.'
const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 1000
const RSVP_STATUSES = ['interested', 'going', 'declined'] as const

type EventActionResult = { error: string } | { ok: true }
type CreateEventResult = { error: string } | { ok: true; eventId: string }

/** Creates a scheduled event, optionally bound to a voice channel. */
export const createEvent = withAuth(
  async function createEventBody({ supabase, user }, formData: FormData): Promise<CreateEventResult> {
    const groupId = formData.get('group_id') as string
    const name = ((formData.get('name') as string | null) ?? '').trim()
    const description = ((formData.get('description') as string | null) ?? '').trim()
    const location = ((formData.get('location') as string | null) ?? '').trim()
    const channelId = (formData.get('channel_id') as string | null) || null
    const startAtRaw = formData.get('start_at') as string
    const endAtRaw = (formData.get('end_at') as string | null) || null

    if (!groupId) return { error: 'Missing group.' }
    if (!name) return { error: 'Event name is required.' }
    if (name.length > MAX_NAME_LENGTH) return { error: `Event name must be ${MAX_NAME_LENGTH} characters or fewer.` }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` }
    }

    const startAt = new Date(startAtRaw ?? '')
    if (Number.isNaN(startAt.getTime())) return { error: 'A valid start time is required.' }
    if (startAt.getTime() <= Date.now()) return { error: 'Events must start in the future.' }

    let endAt: Date | null = null
    if (endAtRaw) {
      endAt = new Date(endAtRaw)
      if (Number.isNaN(endAt.getTime())) return { error: 'End time is invalid.' }
      if (endAt.getTime() <= startAt.getTime()) return { error: 'End time must be after the start time.' }
    }

    const gate = await gateGroupPermission(supabase, {
      groupId,
      userId: user.id,
      bit: PermissionBits.CREATE_EVENTS,
      deniedMessage: EVENTS_DENIED,
    })
    if ('error' in gate) return gate

    if (channelId) {
      const { data: channel, error: channelError } = await supabase
        .from('channels')
        .select('id, group_id')
        .eq('id', channelId)
        .single()

      if (channelError && channelError.code !== 'PGRST116') return { error: channelError.message }
      if (!channel || (channel as { group_id: string }).group_id !== groupId) {
        return { error: 'Channel not found in this group.' }
      }
    }

    const { data: event, error } = await supabase
      .from('scheduled_events')
      .insert({
        group_id: groupId,
        channel_id: channelId,
        name,
        description: description || null,
        location: location || null,
        start_at: startAt.toISOString(),
        end_at: endAt ? endAt.toISOString() : null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (error || !event) return { error: error?.message ?? 'Failed to create event.' }
    return { ok: true, eventId: (event as { id: string }).id }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Cancels an event. Creators or MANAGE_EVENTS holders. */
export const cancelEvent = withAuth(
  async function cancelEventBody({ supabase, user }, eventId: string): Promise<EventActionResult> {
    if (!eventId) return { error: 'Missing event.' }

    const { data: event, error: lookupError } = await supabase
      .from('scheduled_events')
      .select('id, group_id, created_by, status')
      .eq('id', eventId)
      .single()

    if (lookupError && lookupError.code !== 'PGRST116') return { error: lookupError.message }
    if (!event) return { error: 'Event not found.' }

    if ((event as { created_by: string | null }).created_by !== user.id) {
      const gate = await gateGroupPermission(supabase, {
        groupId: (event as { group_id: string }).group_id,
        userId: user.id,
        bit: PermissionBits.MANAGE_EVENTS,
        deniedMessage: EVENTS_DENIED,
      })
      if ('error' in gate) return gate
    }

    const { error } = await supabase
      .from('scheduled_events')
      .update({ status: 'canceled' })
      .eq('id', eventId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Sets or clears the caller's RSVP. Pass null to clear. */
export const rsvpEvent = withAuth(
  async function rsvpEventBody(
    { supabase, user },
    eventId: string,
    status: (typeof RSVP_STATUSES)[number] | null,
  ): Promise<EventActionResult> {
    if (!eventId) return { error: 'Missing event.' }

    if (status === null) {
      const { error } = await supabase
        .from('event_rsvps')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', user.id)
      if (error) return { error: error.message }
      return { ok: true }
    }

    if (!RSVP_STATUSES.includes(status)) return { error: 'Invalid RSVP.' }

    const { error } = await supabase
      .from('event_rsvps')
      .upsert(
        { event_id: eventId, user_id: user.id, status },
        { onConflict: 'event_id,user_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
