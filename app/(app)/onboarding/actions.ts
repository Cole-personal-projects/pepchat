'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { withAuth } from '@/lib/actions/withAuth'
import { gateGroupPermission } from '@/lib/permissions/gate'
import { PermissionBits } from '@/lib/permissions/bits'

const ONBOARDING_DENIED = 'You do not have permission to manage onboarding.'
const MAX_RULES_LENGTH = 4000
const MAX_QUESTION_LENGTH = 200
const MAX_OPTION_LENGTH = 100

type OnboardingActionResult = { error: string } | { ok: true }

async function gateOnboardingManager(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<OnboardingActionResult> {
  const manage = await gateGroupPermission(supabase, {
    groupId,
    userId,
    bit: PermissionBits.MANAGE_ONBOARDING,
    deniedMessage: ONBOARDING_DENIED,
  })
  if (!('error' in manage)) return { ok: true }

  const manageGroup = await gateGroupPermission(supabase, {
    groupId,
    userId,
    bit: PermissionBits.MANAGE_GROUP,
    deniedMessage: ONBOARDING_DENIED,
  })
  return manageGroup
}

/** Saves the onboarding toggle + rules text for a group. */
export const saveOnboardingConfig = withAuth(
  async function saveOnboardingConfigBody(
    { supabase, user },
    groupId: string,
    input: { enabled: boolean; rulesText: string },
  ): Promise<OnboardingActionResult> {
    if (!groupId) return { error: 'Missing group.' }
    const rulesText = (input.rulesText ?? '').trim()
    if (rulesText.length > MAX_RULES_LENGTH) {
      return { error: `Rules must be ${MAX_RULES_LENGTH} characters or fewer.` }
    }
    if (input.enabled && !rulesText) {
      return { error: 'Add rules text before enabling onboarding.' }
    }

    const gate = await gateOnboardingManager(supabase, groupId, user.id)
    if ('error' in gate) return gate

    const { error } = await supabase
      .from('group_onboarding')
      .upsert(
        {
          group_id: groupId,
          enabled: Boolean(input.enabled),
          rules_text: rulesText || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'group_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Adds a question with options; each option may grant roles. */
export const addOnboardingQuestion = withAuth(
  async function addOnboardingQuestionBody(
    { supabase, user },
    groupId: string,
    input: {
      question: string
      multiSelect?: boolean
      options: Array<{ label: string; emoji?: string | null; roleIds?: string[] }>
    },
  ): Promise<OnboardingActionResult> {
    if (!groupId) return { error: 'Missing group.' }
    const question = (input.question ?? '').trim()
    if (!question) return { error: 'Question text is required.' }
    if (question.length > MAX_QUESTION_LENGTH) {
      return { error: `Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.` }
    }
    const options = (input.options ?? [])
      .map(option => ({ ...option, label: (option.label ?? '').trim() }))
      .filter(option => option.label)
    if (options.length < 2) return { error: 'Add at least two answer options.' }
    if (options.some(option => option.label.length > MAX_OPTION_LENGTH)) {
      return { error: `Options must be ${MAX_OPTION_LENGTH} characters or fewer.` }
    }

    const gate = await gateOnboardingManager(supabase, groupId, user.id)
    if ('error' in gate) return gate

    const { data: positions } = await supabase
      .from('onboarding_questions')
      .select('position')
      .eq('group_id', groupId)
      .order('position', { ascending: false })
      .limit(1)

    const nextPosition = positions && positions.length > 0 ? positions[0].position + 1 : 0

    const { data: created, error: questionError } = await supabase
      .from('onboarding_questions')
      .insert({
        group_id: groupId,
        question,
        multi_select: Boolean(input.multiSelect),
        position: nextPosition,
      })
      .select('id')
      .single()

    if (questionError || !created) return { error: questionError?.message ?? 'Failed to add question.' }
    const questionId = (created as { id: string }).id

    for (const [index, option] of options.entries()) {
      const { data: createdOption, error: optionError } = await supabase
        .from('onboarding_options')
        .insert({
          question_id: questionId,
          label: option.label,
          emoji: option.emoji?.trim() || null,
          position: index,
        })
        .select('id')
        .single()

      if (optionError || !createdOption) return { error: optionError?.message ?? 'Failed to add option.' }

      const roleIds = (option.roleIds ?? []).filter(Boolean)
      if (roleIds.length > 0) {
        const { error: grantError } = await supabase
          .from('onboarding_option_roles')
          .insert(roleIds.map(roleId => ({ option_id: (createdOption as { id: string }).id, role_id: roleId })))
        if (grantError) return { error: grantError.message }
      }
    }

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Deletes a question (options + grants cascade). */
export const deleteOnboardingQuestion = withAuth(
  async function deleteOnboardingQuestionBody(
    { supabase, user },
    questionId: string,
  ): Promise<OnboardingActionResult> {
    if (!questionId) return { error: 'Missing question.' }

    const { data: question, error: lookupError } = await supabase
      .from('onboarding_questions')
      .select('id, group_id')
      .eq('id', questionId)
      .single()

    if (lookupError && lookupError.code !== 'PGRST116') return { error: lookupError.message }
    if (!question) return { error: 'Question not found.' }

    const gate = await gateOnboardingManager(supabase, (question as { group_id: string }).group_id, user.id)
    if ('error' in gate) return gate

    const { error } = await supabase.from('onboarding_questions').delete().eq('id', questionId)
    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Member completion: accepts rules, records answers, and grants the roles
 * attached to the chosen options via the service-role client (role grants
 * are MANAGE_ROLES-gated under RLS, but onboarding is a sanctioned path).
 */
export const completeOnboarding = withAuth(
  async function completeOnboardingBody(
    { supabase, user },
    groupId: string,
    selectedOptionIds: string[],
  ): Promise<OnboardingActionResult> {
    if (!groupId) return { error: 'Missing group.' }

    const { data: config, error: configError } = await supabase
      .from('group_onboarding')
      .select('group_id, enabled')
      .eq('group_id', groupId)
      .maybeSingle()

    if (configError && configError.code !== 'PGRST116') return { error: configError.message }
    if (!config || !(config as { enabled: boolean }).enabled) {
      return { error: 'Onboarding is not enabled for this server.' }
    }

    // Validate that selected options belong to this group's questions.
    const optionIds = [...new Set((selectedOptionIds ?? []).filter(Boolean))]
    let grantedRoleIds: string[] = []
    if (optionIds.length > 0) {
      const { data: options, error: optionsError } = await supabase
        .from('onboarding_options')
        .select('id, question_id, onboarding_questions!inner(group_id)')
        .in('id', optionIds)

      if (optionsError) return { error: optionsError.message }
      const valid = (options ?? []).filter(option =>
        (option as unknown as { onboarding_questions: { group_id: string } }).onboarding_questions.group_id === groupId,
      )
      if (valid.length !== optionIds.length) return { error: 'Invalid onboarding answers.' }

      const { data: grants, error: grantsError } = await supabase
        .from('onboarding_option_roles')
        .select('role_id')
        .in('option_id', optionIds)

      if (grantsError) return { error: grantsError.message }
      grantedRoleIds = [...new Set((grants ?? []).map(grant => (grant as { role_id: string }).role_id))]
    }

    const now = new Date().toISOString()
    const { error: progressError } = await supabase
      .from('member_onboarding')
      .upsert(
        {
          group_id: groupId,
          user_id: user.id,
          rules_accepted_at: now,
          completed_at: now,
        },
        { onConflict: 'group_id,user_id' },
      )

    if (progressError) return { error: progressError.message }

    if (optionIds.length > 0) {
      const { error: responsesError } = await supabase
        .from('member_onboarding_responses')
        .upsert(
          optionIds.map(optionId => ({ group_id: groupId, user_id: user.id, option_id: optionId })),
          { onConflict: 'user_id,option_id' },
        )
      if (responsesError) return { error: responsesError.message }
    }

    if (grantedRoleIds.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const admin = createAdminClient()
      const { error: roleError } = await admin
        .from('member_roles')
        .upsert(
          grantedRoleIds.map(roleId => ({ group_id: groupId, user_id: user.id, role_id: roleId })),
          { onConflict: 'role_id,user_id', ignoreDuplicates: true },
        )
      // Role grants are best-effort; onboarding completion stands.
      if (roleError) return { ok: true }
    }

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
