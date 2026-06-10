import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCategory, deleteCategory, moveCategory, renameCategory } from '@/app/(app)/categories/actions'

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }

function makeSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeOrderedSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.then = resolved.then.bind(resolved)
  return builder
}

function makeInsertBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
  return builder
}

function makeUpdateBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = resolved.then.bind(resolved)
  return builder
}

function makeDeleteBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = resolved.then.bind(resolved)
  return builder
}

function setupClient(builders: Record<string, unknown>[], options: { userId?: string | null } = {}) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
  })

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } },
        error: null,
      }),
    },
    from,
  })

  return { from }
}

function categoryForm(name: string, groupId = 'grp-1') {
  const formData = new FormData()
  formData.set('name', name)
  formData.set('group_id', groupId)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCategory', () => {
  it('requires a name', async () => {
    setupClient([])
    const result = await createCategory(categoryForm('   '))
    expect(result).toEqual({ error: 'Category name is required.' })
  })

  it('denies members without channel management permission', async () => {
    setupClient([
      makeSelectBuilder({ data: { role: 'user' } }),
    ])
    const result = await createCategory(categoryForm('Voice Rooms'))
    expect(result).toEqual({ error: 'You do not have permission to manage channels.' })
  })

  it('inserts with the next position for managers', async () => {
    const insertBuilder = makeInsertBuilder()
    setupClient([
      makeSelectBuilder({ data: { role: 'admin' } }),
      makeOrderedSelectBuilder({ data: [{ position: 2 }] }),
      insertBuilder,
    ])

    const result = await createCategory(categoryForm('  Voice   Rooms  '))

    expect(result).toEqual({ ok: true })
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      group_id: 'grp-1',
      name: 'Voice Rooms',
      position: 3,
    })
  })
})

describe('renameCategory', () => {
  it('errors when the category does not exist', async () => {
    setupClient([
      makeSelectBuilder({ data: null, error: { message: 'missing', code: 'PGRST116' } }),
    ])
    const result = await renameCategory('cat-1', 'New Name')
    expect(result).toEqual({ error: 'Category not found.' })
  })

  it('denies non-managers', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'cat-1', group_id: 'grp-1' } }),
      makeSelectBuilder({ data: { role: 'noob' } }),
    ])
    const result = await renameCategory('cat-1', 'New Name')
    expect(result).toEqual({ error: 'You do not have permission to manage channels.' })
  })

  it('updates the name for managers', async () => {
    const updateBuilder = makeUpdateBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'cat-1', group_id: 'grp-1' } }),
      makeSelectBuilder({ data: { role: 'moderator' } }),
      updateBuilder,
    ])

    const result = await renameCategory('cat-1', '  Renamed  ')

    expect(result).toEqual({ ok: true })
    expect(updateBuilder.update).toHaveBeenCalledWith({ name: 'Renamed' })
  })
})

describe('deleteCategory', () => {
  it('deletes for managers', async () => {
    const deleteBuilder = makeDeleteBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'cat-1', group_id: 'grp-1' } }),
      makeSelectBuilder({ data: { role: 'admin' } }),
      deleteBuilder,
    ])

    const result = await deleteCategory('cat-1')

    expect(result).toEqual({ ok: true })
    expect(deleteBuilder.delete).toHaveBeenCalled()
  })
})

describe('moveCategory', () => {
  it('swaps positions with the neighbor below', async () => {
    const firstUpdate = makeUpdateBuilder()
    const secondUpdate = makeUpdateBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'cat-1', group_id: 'grp-1', position: 0 } }),
      makeSelectBuilder({ data: { role: 'admin' } }),
      makeOrderedSelectBuilder({
        data: [
          { id: 'cat-1', position: 0 },
          { id: 'cat-2', position: 1 },
        ],
      }),
      firstUpdate,
      secondUpdate,
    ])

    const result = await moveCategory('cat-1', 'down')

    expect(result).toEqual({ ok: true })
    expect(firstUpdate.update).toHaveBeenCalledWith({ position: 1 })
    expect(secondUpdate.update).toHaveBeenCalledWith({ position: 0 })
  })

  it('is a no-op at the boundary', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'cat-1', group_id: 'grp-1', position: 0 } }),
      makeSelectBuilder({ data: { role: 'admin' } }),
      makeOrderedSelectBuilder({ data: [{ id: 'cat-1', position: 0 }] }),
    ])

    const result = await moveCategory('cat-1', 'up')

    expect(result).toEqual({ ok: true })
  })
})
