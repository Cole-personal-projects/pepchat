import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GroupTable from '@/components/admin/GroupTable'
import type { AdminGroup } from '@/lib/types'

vi.mock('@/app/admin/actions', () => ({
  deleteGroup: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const GROUPS: AdminGroup[] = [
  {
    id: 'g1',
    name: 'SideBar HQ',
    icon_url: null,
    owner_id: 'u1',
    owner_username: 'panicmonkey',
    member_count: 12,
    channel_count: 5,
    created_at: '2024-01-15T00:00:00Z',
  },
  {
    id: 'g2',
    name: 'Dev Corner',
    icon_url: null,
    owner_id: 'u2',
    owner_username: 'cool42',
    member_count: 3,
    channel_count: 2,
    created_at: '2024-02-20T00:00:00Z',
  },
]

const defaultProps = {
  groups: GROUPS,
  onDelete: vi.fn().mockResolvedValue(undefined),
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => vi.clearAllMocks())

describe('GroupTable — rendering', () => {
  it('renders a row for each group', () => {
    render(<GroupTable {...defaultProps} />)
    expect(document.querySelectorAll('.group-row')).toHaveLength(GROUPS.length)
  })

  it('shows group name', () => {
    render(<GroupTable {...defaultProps} />)
    expect(screen.getByText('SideBar HQ')).toBeTruthy()
    expect(screen.getByText('Dev Corner')).toBeTruthy()
  })

  it('shows owner username', () => {
    render(<GroupTable {...defaultProps} />)
    expect(screen.getByText('@panicmonkey')).toBeTruthy()
    expect(screen.getByText('@cool42')).toBeTruthy()
  })

  it('shows member count', () => {
    render(<GroupTable {...defaultProps} />)
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('shows channel count', () => {
    render(<GroupTable {...defaultProps} />)
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows empty state when no groups', () => {
    render(<GroupTable {...defaultProps} groups={[]} />)
    expect(screen.getByText(/no groups/i)).toBeTruthy()
  })

  it('labels row actions with the group name', () => {
    render(<GroupTable {...defaultProps} />)

    expect(screen.getByRole('link', { name: 'View SideBar HQ' })).toHaveAttribute('href', '/groups/g1')
    expect(screen.getByRole('button', { name: 'Delete SideBar HQ' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Dev Corner' })).toHaveAttribute('href', '/groups/g2')
    expect(screen.getByRole('button', { name: 'Delete Dev Corner' })).toBeInTheDocument()
  })
})

describe('GroupTable — search', () => {
  it('has a search input with .group-search class', () => {
    render(<GroupTable {...defaultProps} />)
    expect(document.querySelector('.group-search')).toBeTruthy()
  })

  it('filters groups by name', () => {
    render(<GroupTable {...defaultProps} />)
    const search = document.querySelector('.group-search') as HTMLInputElement

    fireEvent.change(search, { target: { value: 'dev' } })

    expect(document.querySelectorAll('.group-row')).toHaveLength(1)
    expect(screen.getByText('Dev Corner')).toBeInTheDocument()
    expect(screen.queryByText('SideBar HQ')).toBeNull()
  })

  it('filters groups by owner username', () => {
    render(<GroupTable {...defaultProps} />)
    const search = document.querySelector('.group-search') as HTMLInputElement

    fireEvent.change(search, { target: { value: 'panic' } })

    expect(document.querySelectorAll('.group-row')).toHaveLength(1)
    expect(screen.getByText('SideBar HQ')).toBeInTheDocument()
    expect(screen.queryByText('Dev Corner')).toBeNull()
  })

  it('shows a filtered empty state when no groups match', () => {
    render(<GroupTable {...defaultProps} />)
    const search = document.querySelector('.group-search') as HTMLInputElement

    fireEvent.change(search, { target: { value: 'zzznomatch' } })

    expect(document.querySelectorAll('.group-row')).toHaveLength(0)
    expect(screen.getByText(/no groups match/i)).toBeInTheDocument()
  })
})

describe('GroupTable — delete flow', () => {
  it('shows a confirmation before deleting', () => {
    render(<GroupTable {...defaultProps} />)
    const deleteBtn = screen.getAllByTitle(/delete group/i)[0]
    fireEvent.click(deleteBtn)
    expect(screen.getByText(/are you sure/i)).toBeTruthy()
    expect(defaultProps.onDelete).not.toHaveBeenCalled()
  })

  it('calls onDelete when confirmed', async () => {
    render(<GroupTable {...defaultProps} />)
    const deleteBtn = screen.getAllByTitle(/delete group/i)[0]
    fireEvent.click(deleteBtn)
    fireEvent.click(screen.getByTestId('confirm-delete-group'))
    await waitFor(() => expect(defaultProps.onDelete).toHaveBeenCalledWith('g1'))
  })

  it('disables delete confirmation while deletion is pending', async () => {
    const pendingDelete = deferred()
    render(<GroupTable {...defaultProps} onDelete={vi.fn(() => pendingDelete.promise)} />)

    fireEvent.click(screen.getAllByTitle(/delete group/i)[0])
    const confirm = screen.getByTestId('confirm-delete-group')
    fireEvent.click(confirm)

    await waitFor(() => expect(confirm).toBeDisabled())
    pendingDelete.resolve()
    await waitFor(() => expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument())
  })

  it('cancels deletion without calling onDelete', () => {
    render(<GroupTable {...defaultProps} />)
    const deleteBtn = screen.getAllByTitle(/delete group/i)[0]
    fireEvent.click(deleteBtn)
    fireEvent.click(screen.getByTestId('cancel-delete-group'))
    expect(defaultProps.onDelete).not.toHaveBeenCalled()
  })

  it('shows error feedback when custom delete handler fails', async () => {
    render(<GroupTable {...defaultProps} onDelete={vi.fn().mockRejectedValue(new Error('Delete failed'))} />)
    const deleteBtn = screen.getAllByTitle(/delete group/i)[0]
    fireEvent.click(deleteBtn)
    fireEvent.click(screen.getByTestId('confirm-delete-group'))
    await waitFor(() => expect(screen.getByText('Delete failed')).toBeInTheDocument())
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument()
  })

  it('shows error feedback when admin deleteGroup returns an error', async () => {
    const { deleteGroup } = await import('@/app/admin/actions')
    vi.mocked(deleteGroup).mockResolvedValueOnce({ error: 'Cannot delete group' })

    render(<GroupTable groups={GROUPS} />)
    const deleteBtn = screen.getAllByTitle(/delete group/i)[0]
    fireEvent.click(deleteBtn)
    fireEvent.click(screen.getByTestId('confirm-delete-group'))
    await waitFor(() => expect(screen.getByText('Cannot delete group')).toBeInTheDocument())
  })
})
