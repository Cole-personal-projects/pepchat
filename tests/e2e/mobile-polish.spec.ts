import { test, expect, type Page } from '@playwright/test'

/**
 * Mobile UX checks for the PR1 polish pass, written to run against the
 * mock Supabase backend (scripts/mock-supabase/server.mjs):
 *
 *   node scripts/mock-supabase/server.mjs &
 *   npm run dev &
 *   npx playwright test tests/e2e/mobile-polish.spec.ts
 */

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@pepchat.test'
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'test-password-1'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/channels**', { timeout: 15000 })
}

async function openSidebar(page: Page) {
  const channelLink = page.locator('a.channel-row').first()
  // The closed drawer is translated offscreen, which Playwright still
  // treats as "visible" — check actual viewport position instead.
  const inViewport = await channelLink
    .evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.x >= 0 && rect.x < window.innerWidth
    })
    .catch(() => false)
  if (!inViewport) {
    await page.locator('.mobile-bottom-nav button', { hasText: 'Channels' }).click()
    // Let the slide-in transition settle before interacting.
    await page.waitForTimeout(300)
  }
  await expect(channelLink).toBeVisible()
}

async function openGeneralChannel(page: Page) {
  await openSidebar(page)
  await page.locator('a.channel-row', { hasText: 'general' }).first().click()
  await expect(page.locator('.message-row').first()).toBeVisible({ timeout: 10000 })
}

async function openMembersSheet(page: Page) {
  // Let the drawer's closing transition finish so its backdrop cannot
  // swallow the header tap.
  await page.waitForTimeout(350)
  await page.locator('[data-testid="members-header-btn"]').click()
  await expect(page.locator('[data-testid="members-sheet"]')).toHaveAttribute('aria-hidden', 'false')
  await page.waitForTimeout(300)
}

test.describe('mobile chat polish', () => {
  test('no inline Thread buttons; threads start from the long-press sheet', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)

    // The old always-on "Thread" affordance is gone from every row…
    await expect(page.locator('[data-testid="mobile-action-reply-thread"]')).toHaveCount(0)
    // …while messages that actually have replies still show their chip.
    // (exclude the chip's nested thread-chip-unread-* dot)
    await expect(page.locator('[data-testid^="thread-chip-"]:not([data-testid^="thread-chip-unread-"])')).toHaveCount(1)

    // Long-press opens the action sheet with the thread entry point.
    const row = page.locator('.message-row').last()
    const box = await row.boundingBox()
    if (!box) throw new Error('message row has no bounding box')
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 40, clientY: box.y + 10 })
    await page.waitForTimeout(650)
    await row.dispatchEvent('pointerup', { pointerType: 'touch' })

    await expect(page.locator('[data-testid="message-modal"]')).toBeVisible()
    await expect(page.locator('[data-testid="modal-action-reply-thread"]')).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-longpress-sheet.png' })
  })
})

test.describe('voice room cleanup', () => {
  test('reaper removes stale ephemeral rooms; admins can force-close live ones', async ({ page }) => {
    await login(page)

    // Opening the sidebar mounts VoiceChannelsSection, which triggers the
    // sweep. The stale room (dead heartbeat) is deleted server-side.
    await openSidebar(page)
    await expect(page.getByText('Voice Channels')).toBeVisible()
    await page.waitForTimeout(1200)

    // No realtime in the mock: reload to observe the swept state.
    await page.reload()
    await openSidebar(page)
    await expect(page.getByLabel(/PanicMonkeyxx's Room voice$/)).toHaveCount(1)

    // The surviving room still has a (ghost) participant — force-close it.
    page.on('dialog', (dialog) => dialog.accept())
    const closeButton = page.locator('[data-testid^="close-voice-channel-"]').last()
    await expect(closeButton).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-voice-close.png' })
    await closeButton.click()
    await page.waitForTimeout(800)

    await page.reload()
    await openSidebar(page)
    await expect(page.getByLabel(/PanicMonkeyxx's Room voice$/)).toHaveCount(0)
    // Persistent voice channels stay.
    await expect(page.getByLabel(/Lounge voice$/)).toHaveCount(1)
  })
})

test.describe('discord-style mobile navigation', () => {
  test('drawer holds channels only; members live in the right-hand sheet', async ({ page }) => {
    await login(page)
    await openSidebar(page)

    // The drawer no longer shows the members management block on mobile
    // (the desktop panel stays in the DOM behind a md: visibility class).
    await expect(page.locator('[data-testid="member-search-input"]')).not.toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-drawer-slim.png' })

    // Members open from the chat header as a right-side sheet.
    await openGeneralChannel(page)
    await openMembersSheet(page)

    const sheet = page.locator('[data-testid="members-sheet"]')
    await expect(sheet.getByText('Members')).toBeVisible()
    await expect(sheet.getByTestId('member-search-input')).toBeVisible()
    // Fully on-screen once the slide-in transition settles.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox()
        return box ? box.x + box.width : Number.POSITIVE_INFINITY
      })
      .toBeLessThanOrEqual(391)
    const box = await sheet.boundingBox()
    if (!box) throw new Error('members sheet has no bounding box')
    expect(box.width).toBeLessThanOrEqual(320)
    await page.screenshot({ path: 'test-results/mobile-members-sheet.png' })

    await page.locator('[data-testid="members-sheet-close"]').click()
    await expect(sheet).toHaveAttribute('aria-hidden', 'true')
  })

  test('channel admin actions live behind long-press, not inline buttons', async ({ page }) => {
    await login(page)
    await openSidebar(page)

    const row = page.locator('a.channel-row', { hasText: 'welcome' }).first()
    await expect(row).toBeVisible()

    // No inline gear/trash cluttering the drawer on mobile.
    await expect(page.locator('[aria-label="Delete #welcome"]')).toBeHidden()
    await expect(page.locator('[aria-label="Edit #welcome settings"]')).toBeHidden()

    // Long-press opens the channel action sheet.
    const box = await row.boundingBox()
    if (!box) throw new Error('channel row has no bounding box')
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 40, clientY: box.y + 10 })
    await page.waitForTimeout(650)
    await row.dispatchEvent('pointerup', { pointerType: 'touch' })

    await expect(page.locator('[data-testid="action-sheet"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-sheet-title"]')).toHaveText('#welcome')
    await expect(page.locator('[data-testid="channel-sheet-settings"]')).toBeVisible()
    await expect(page.locator('[data-testid="channel-sheet-delete"]')).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-channel-sheet.png' })

    // Long-press must not have navigated away from the drawer.
    await page.locator('[data-testid="action-sheet-backdrop"]').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('[data-testid="action-sheet"]')).toHaveCount(0)
  })
})

test.describe('custom role assignment', () => {
  test('admin assigns the Group Buy role from the members sheet', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)
    await openMembersSheet(page)

    const sheet = page.locator('[data-testid="members-sheet"]')

    // Open the role sheet for the other member (hermes).
    const rolesBtn = sheet.locator('[data-testid^="member-roles-btn-2222"]')
    await expect(rolesBtn).toBeVisible()
    await rolesBtn.click()

    const roleSheet = page.locator('[data-testid="action-sheet"]')
    await expect(roleSheet).toBeVisible()
    await expect(page.locator('[data-testid="action-sheet-title"]')).toContainText('Roles')

    // Toggle "Group Buy" on — optimistic checkmark flips immediately.
    const groupBuyToggle = roleSheet.locator('button', { hasText: 'Group Buy' })
    await expect(groupBuyToggle).toHaveAttribute('aria-pressed', 'false')
    await groupBuyToggle.click()
    await expect(groupBuyToggle).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'test-results/mobile-role-assign.png' })
    await page.locator('[data-testid="member-roles-done"]').click()

    // Persisted server-side: survives a full reload.
    await page.waitForTimeout(500)
    await page.reload()
    await openGeneralChannel(page)
    await openMembersSheet(page)
    await page.locator('[data-testid="members-sheet"] [data-testid^="member-roles-btn-2222"]').click()
    await expect(
      page.locator('[data-testid="action-sheet"] button', { hasText: 'Group Buy' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('roles settings on mobile', () => {
  test('roles editor is fully usable at 390px', async ({ page }) => {
    await login(page)
    await openSidebar(page)

    await page.locator('[data-testid="group-settings-btn"]').click()
    await page.locator('[data-testid="nav-roles"]').click()
    await expect(page.locator('[data-testid="roles-manager"]')).toBeVisible()

    // Select a role and confirm the editor renders inside the viewport.
    await page.locator('[data-testid="role-list"] button', { hasText: 'Admin' }).first().click()
    const editor = page.locator('[data-testid="role-editor"]')
    await expect(editor).toBeVisible()

    const editorBox = await editor.boundingBox()
    if (!editorBox) throw new Error('role editor has no bounding box')
    expect(editorBox.x).toBeGreaterThanOrEqual(0)
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(391)
    // The editor must keep a readable width, not a 190px sliver.
    expect(editorBox.width).toBeGreaterThan(300)

    // Identity controls and permission toggles are reachable.
    await expect(page.locator('#role-name')).toBeVisible()
    await expect(page.locator('[data-testid="save-role-identity"]')).toBeVisible()
    const firstPermission = page.locator('[data-testid^="perm-"]').first()
    await firstPermission.scrollIntoViewIfNeeded()
    await expect(firstPermission).toBeVisible()

    // No horizontal page overflow.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(391)

    await page.screenshot({ path: 'test-results/mobile-roles-editor.png', fullPage: false })
  })
})
