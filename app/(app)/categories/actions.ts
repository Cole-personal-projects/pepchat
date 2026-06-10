'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { CHANNEL_MANAGE_DENIED } from '@/lib/channels/createChannelInternal'
import { gateGroupRole } from '@/lib/permissions/gate'
import { PERMISSIONS } from '@/lib/permissions'

const MAX_CATEGORY_NAME_LENGTH = 60

function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

type CategoryActionResult = { error: string } | { ok: true }

/** Creates a channel category inside a group. Channel manager only. */
export const createCategory = withAuth(
  async function createCategoryBody(
    { supabase, user },
    formData: FormData,
  ): Promise<CategoryActionResult> {
    const name = normalizeCategoryName((formData.get('name') as string | null) ?? '')
    const groupId = formData.get('group_id') as string

    if (!name) return { error: 'Category name is required.' }
    if (name.length > MAX_CATEGORY_NAME_LENGTH) {
      return { error: `Category name must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.` }
    }
    if (!groupId) return { error: 'Missing group.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { data: existingPositions } = await supabase
      .from('channel_categories')
      .select('position')
      .eq('group_id', groupId)
      .order('position', { ascending: false })
      .limit(1)

    const nextPosition =
      existingPositions && existingPositions.length > 0 ? existingPositions[0].position + 1 : 0

    const { error } = await supabase.from('channel_categories').insert({
      group_id: groupId,
      name,
      position: nextPosition,
    })

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Renames a channel category. Channel manager only. */
export const renameCategory = withAuth(
  async function renameCategoryBody(
    { supabase, user },
    categoryId: string,
    name: string,
  ): Promise<CategoryActionResult> {
    const normalized = normalizeCategoryName(name ?? '')
    if (!categoryId) return { error: 'Missing category.' }
    if (!normalized) return { error: 'Category name is required.' }
    if (normalized.length > MAX_CATEGORY_NAME_LENGTH) {
      return { error: `Category name must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.` }
    }

    const { data: category, error: categoryError } = await supabase
      .from('channel_categories')
      .select('id, group_id')
      .eq('id', categoryId)
      .single()

    if (categoryError && categoryError.code !== 'PGRST116') return { error: categoryError.message }
    if (!category) return { error: 'Category not found.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId: category.group_id,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { error } = await supabase
      .from('channel_categories')
      .update({ name: normalized })
      .eq('id', categoryId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Deletes a category. Its channels become uncategorized (FK sets null). */
export const deleteCategory = withAuth(
  async function deleteCategoryBody(
    { supabase, user },
    categoryId: string,
  ): Promise<CategoryActionResult> {
    if (!categoryId) return { error: 'Missing category.' }

    const { data: category, error: categoryError } = await supabase
      .from('channel_categories')
      .select('id, group_id')
      .eq('id', categoryId)
      .single()

    if (categoryError && categoryError.code !== 'PGRST116') return { error: categoryError.message }
    if (!category) return { error: 'Category not found.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId: category.group_id,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { error } = await supabase.from('channel_categories').delete().eq('id', categoryId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Swaps a category's position with its neighbor above or below. */
export const moveCategory = withAuth(
  async function moveCategoryBody(
    { supabase, user },
    categoryId: string,
    direction: 'up' | 'down',
  ): Promise<CategoryActionResult> {
    if (!categoryId) return { error: 'Missing category.' }

    const { data: category, error: categoryError } = await supabase
      .from('channel_categories')
      .select('id, group_id, position')
      .eq('id', categoryId)
      .single()

    if (categoryError && categoryError.code !== 'PGRST116') return { error: categoryError.message }
    if (!category) return { error: 'Category not found.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId: category.group_id,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { data: siblings, error: siblingsError } = await supabase
      .from('channel_categories')
      .select('id, position')
      .eq('group_id', category.group_id)
      .order('position', { ascending: true })

    if (siblingsError) return { error: siblingsError.message }

    const index = (siblings ?? []).findIndex((c) => c.id === categoryId)
    const neighborIndex = direction === 'up' ? index - 1 : index + 1
    const neighbor = siblings?.[neighborIndex]
    if (index === -1 || !neighbor) return { ok: true } // already at boundary

    const { error: firstError } = await supabase
      .from('channel_categories')
      .update({ position: neighbor.position })
      .eq('id', category.id)
    if (firstError) return { error: firstError.message }

    const { error: secondError } = await supabase
      .from('channel_categories')
      .update({ position: category.position })
      .eq('id', neighbor.id)
    if (secondError) return { error: secondError.message }

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
