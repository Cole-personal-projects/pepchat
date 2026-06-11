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
  async function openHermesRoleSheet(page: Page) {
    await openMembersSheet(page)
    // Member rows are clean (Discord-style): tap the name → profile card.
    await page.locator('[data-testid="members-sheet"] [data-testid="member-name-22222222-2222-4222-8222-222222222222"]').click()
    const manageButton = page.locator('[data-testid="profile-manage-roles"]')
    await expect(manageButton).toBeVisible()
    await manageButton.click()
    await expect(page.locator('[data-testid="action-sheet"]')).toBeVisible()
  }

  test('admin assigns roles from the profile card; member rows stay clean', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)
    await openMembersSheet(page)

    // No inline selects or role buttons on member rows anymore.
    const sheet = page.locator('[data-testid="members-sheet"]')
    await expect(sheet.locator('select')).toHaveCount(0)
    await expect(sheet.locator('[data-testid^="member-roles-btn-"]')).toHaveCount(0)

    // Profile card → Manage Roles.
    await page.locator('[data-testid="members-sheet"] [data-testid="member-name-22222222-2222-4222-8222-222222222222"]').click()
    await expect(page.locator('[data-testid="profile-manage-roles"]')).toBeVisible()
    await page.locator('[data-testid="profile-manage-roles"]').click()

    const roleSheet = page.locator('[data-testid="action-sheet"]')
    await expect(roleSheet).toBeVisible()

    // Toggle "group-buy" on — optimistic checkmark flips immediately.
    const groupBuyToggle = roleSheet.locator('button', { hasText: 'group-buy' })
    await expect(groupBuyToggle).toHaveAttribute('aria-pressed', 'false')
    await groupBuyToggle.click()
    await expect(groupBuyToggle).toHaveAttribute('aria-pressed', 'true')

    // Discord-style membership level picker replaces the old <select>:
    // promote hermes from Member to Moderator.
    await expect(page.locator('[data-testid="legacy-role-picker"]')).toBeVisible()
    await expect(page.locator('[data-testid="legacy-role-user"]')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-testid="legacy-role-moderator"]').click()
    await expect(page.locator('[data-testid="legacy-role-moderator"]')).toHaveAttribute('aria-pressed', 'true')

    await page.screenshot({ path: 'test-results/mobile-role-assign.png' })
    // Closing the sheet keeps the profile card up, now showing the chip.
    await page.locator('[data-testid="member-roles-done"]').click()
    await expect(page.locator('[data-testid="profile-manage-roles"]')).toBeVisible()

    // Persisted server-side: survives a full reload.
    await page.waitForTimeout(500)
    await page.reload()
    await openGeneralChannel(page)
    await openHermesRoleSheet(page)
    await expect(
      page.locator('[data-testid="action-sheet"] button', { hasText: 'group-buy' }),
    ).toHaveAttribute('aria-pressed', 'true')
    // The legacy promotion also persisted.
    await expect(page.locator('[data-testid="legacy-role-moderator"]')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-testid="member-roles-done"]').click()

    // The profile card displays the assigned role as a chip.
    await expect(page.locator('[data-testid="profile-role-chips"]')).toContainText('group-buy')
    await page.screenshot({ path: 'test-results/mobile-profile-roles.png' })
  })
})

test.describe('link embeds', () => {
  test('a YouTube link renders an inline player card', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)

    const composer = page.locator('[data-testid="message-input-textarea"]').first()
    await composer.click()
    await composer.fill('watch this https://youtu.be/dQw4w9WgXcQ')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(composer).toHaveValue('')

    // The embed appears immediately on the sender's optimistic echo —
    // no reload, no waiting for the server round-trip.
    const card = page.locator('[data-testid="link-embed-youtube"]').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    // Clicking the poster swaps in the player iframe.
    await page.locator('[data-testid="link-embed-play"]').first().click()
    await expect(page.locator('[data-testid="link-embed-iframe"]').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-link-embed.png' })
  })
})

test.describe('instant messaging', () => {
  test('sent message appears optimistically and settles', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)

    const composer = page.locator('[data-testid="message-input-textarea"]').first()
    const body = `optimistic ${Date.now()}`
    await composer.click()
    await composer.fill(body)
    await page.getByRole('button', { name: 'Send' }).click()

    // The echo renders immediately — composer clears without waiting on the server.
    await expect(composer).toHaveValue('')
    const sent = page.locator('.message-row', { hasText: body })
    await expect(sent).toBeVisible()
    // No failure banner: the send succeeded against the mock backend.
    await expect(page.locator('[data-testid^="send-failed-"]')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/mobile-optimistic-send.png' })
  })
})

test.describe('events', () => {
  test('Events modal opens centered above the closing drawer', async ({ page }) => {
    await login(page)
    await openSidebar(page)

    await page.locator('[data-testid="events-chip"]').click()

    // The modal portals to <body>, so it stays on-screen while the drawer
    // (a transformed container) slides away beneath it.
    const heading = page.getByRole('heading', { name: 'Scheduled Events' })
    await expect(heading).toBeVisible()
    const box = await heading.boundingBox()
    if (!box) throw new Error('events modal heading has no bounding box')
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(391)
    await page.screenshot({ path: 'test-results/mobile-events-modal.png' })
  })
})

test.describe('@role mentions', () => {
  test('admin pings @group-buy: autocomplete, pill render, and fan-out to role holders', async ({ page }) => {
    await login(page)
    await openGeneralChannel(page)

    // Typing "@gro" surfaces the role in the mention autocomplete.
    const composer = page.locator('[data-testid="message-input-textarea"]').first()
    await composer.click()
    await composer.fill('heads up @gro')
    const suggestions = page.locator('[data-testid="mention-suggestions"]')
    await expect(suggestions).toBeVisible()
    await expect(suggestions.getByText('@group-buy')).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-role-mention-autocomplete.png' })
    await suggestions.getByText('@group-buy').click()
    await expect(composer).toHaveValue('heads up @group-buy ')

    // Send, then reload to render the persisted message (no realtime in the
    // mock backend) and confirm the mention pill.
    await page.getByRole('button', { name: 'Send' }).click()
    await page.waitForTimeout(800)
    await page.reload()
    await expect(page.locator('.message-row').first()).toBeVisible({ timeout: 10000 })
    const sent = page.locator('.message-row', { hasText: 'heads up' }).last()
    await expect(sent).toBeVisible()
    await expect(sent.locator('.mention-token')).toHaveText('@group-buy')
    await page.screenshot({ path: 'test-results/mobile-role-mention-sent.png' })

    // Server fan-out: hermes holds group-buy (assigned in the earlier spec),
    // so a mention notification row lands for them in the mock DB.
    await expect
      .poll(async () => {
        const res = await page.request.get('http://127.0.0.1:54321/rest/v1/notification_events')
        const rows = (await res.json()) as Array<{ user_id: string; type: string; title: string }>
        return rows.some(
          row =>
            row.user_id === '22222222-2222-4222-8222-222222222222' &&
            row.type === 'mention' &&
            row.title.includes('mentioned @group-buy'),
        )
      }, { timeout: 5000 })
      .toBe(true)
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

test.describe('ownership', () => {
  test('owner transfers the server; crown moves and old owner stays admin', async ({ page }) => {
    await login(page)
    await openSidebar(page)

    // Settings → Danger Zone → Transfer Ownership (owner only).
    await page.locator('[data-testid="group-settings-btn"]').click()
    await page.locator('[data-testid="nav-danger"]').click()
    const transferBlock = page.locator('[data-testid="transfer-ownership"]')
    await expect(transferBlock).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-transfer-ownership.png' })

    await page.locator('[data-testid="transfer-target-select"]').selectOption('22222222-2222-4222-8222-222222222222')
    // Two-tap confirmation guards the irreversible action.
    await page.locator('[data-testid="transfer-ownership-btn"]').click()
    await expect(page.locator('[data-testid="transfer-ownership-btn"]')).toContainText('confirm')
    await page.locator('[data-testid="transfer-ownership-btn"]').click()
    await expect(page.locator('[data-testid="transfer-notice"]')).toContainText('Ownership transferred')

    // After reload, hermes wears the crown and the old owner is an admin.
    await page.reload()
    await openGeneralChannel(page)
    await openMembersSheet(page)
    const sheet = page.locator('[data-testid="members-sheet"]')
    const hermesRow = sheet.locator('li', { hasText: 'hermes' }).first()
    await expect(hermesRow.locator('[data-testid="role-pill"]')).toContainText('owner')
    const oldOwnerRow = sheet.locator('li', { hasText: 'panicmonkeyxx' }).first()
    await expect(oldOwnerRow.locator('[data-testid="role-pill"]')).toContainText('admin')
  })
})
