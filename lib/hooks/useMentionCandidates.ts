'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'

/**
 * Fetches mention autocomplete candidates for a group.
 * Candidates are profiles of group members (excluding the current user),
 * sorted alphabetically by username.
 *
 * Extracted from components/chat/MessageInput.tsx (Finding 4).
 * This replaces the inline Supabase query in MessageInput with a reusable hook.
 */
export function useMentionCandidates(groupId: string | undefined, currentUserId: string): {
	candidates: MentionCandidate[]
	loading: boolean
} {
	const [candidates, setCandidates] = useState<MentionCandidate[]>([])
	const [loading, setLoading] = useState(true)

	const fetchCandidates = useCallback(async (ignore?: () => boolean) => {
		if (!groupId) {
			setCandidates([])
			setLoading(false)
			return
		}

		const supabase = createClient()
		const { data } = await supabase
			.from('group_members')
			.select('user_id, profiles(id, username, display_name)')
			.eq('group_id', groupId)
			.limit(50)

		if (ignore?.()) return
		const users = ((data ?? []) as any[])
			.map((row: any) => row.profiles)
			.filter(Boolean)
			.filter((user: any) => user.id !== currentUserId)
			.sort((a: any, b: any) => a.username.localeCompare(b.username))
		setCandidates(users as MentionCandidate[])
		setLoading(false)
	}, [groupId, currentUserId])

	useEffect(() => {
		let ignore = false
		fetchCandidates(() => ignore)
		return () => { ignore = true }
	}, [fetchCandidates])

	// Live updates when members join/leave
	useRealtimeChannel({
		topic: `mention-candidates-${groupId}`,
		enabled: Boolean(groupId),
		deps: [groupId, fetchCandidates],
		bindings: [
			{
				type: 'postgres_changes',
				filter: {
					event: '*',
					schema: 'public',
					table: 'group_members',
					filter: `group_id=eq.${groupId}`,
				},
				handler: () => { void fetchCandidates() },
			},
		],
	})

	return { candidates, loading }
}

export interface MentionCandidate {
	id: string
	username: string
	display_name?: string | null
}
