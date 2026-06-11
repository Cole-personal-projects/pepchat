import { test, expect } from '@playwright/test'

const EMAIL = process.env.TEST_USER_EMAIL ?? 'colebienek@proton.me'
const PASSWORD = process.env.TEST_USER_PASSWORD ?? '12345678'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/channels/**', { timeout: 10000 })
  const firstChannel = page.locator('[data-testid="channel-link"]').first()
  if (await firstChannel.count() > 0) await firstChannel.click()
  await page.waitForTimeout(1500)
})

test.describe('Threads', () => {
  test('opens a thread from the mobile long-press action sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const firstRoot = page.locator('.message-row').first()
    await expect(firstRoot).toBeVisible()

    // No inline "Thread" affordance cluttering every message row.
    await expect(page.locator('[data-testid="mobile-action-reply-thread"]')).toHaveCount(0)

    // Long-press (touch) the message to open the action sheet.
    const box = await firstRoot.boundingBox()
    if (!box) throw new Error('message row has no bounding box')
    await firstRoot.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
    await page.waitForTimeout(650)
    await firstRoot.dispatchEvent('pointerup', { pointerType: 'touch' })

    await expect(page.locator('[data-testid="message-modal"]')).toBeVisible()
    await page.locator('[data-testid="modal-action-reply-thread"]').click()
    await expect(page.locator('[data-testid="thread-panel"]')).toBeVisible()
  })

  test('mirrors a thread reply into the channel and opens the source thread', async ({ page }) => {
    const firstRoot = page.locator('.message-row').first()
    await expect(firstRoot).toBeVisible()

    await firstRoot.hover()
    await page.locator('[data-testid="action-reply-thread"]').first().click()
    await expect(page.locator('[data-testid="thread-panel"]')).toBeVisible()

    const replyText = `mirror e2e ${Date.now()}`
    await page.locator('[data-testid="thread-mirror-checkbox"]').check()
    await page.locator('[data-testid="thread-panel"] [data-testid="message-input-textarea"]').fill(replyText)
    await page.locator('[data-testid="thread-panel"]').getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('[data-testid="thread-mirror-checkbox"]')).not.toBeChecked()
    await expect(page.locator('.message-row').filter({ hasText: replyText }).last()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="message-from-thread-link"]').last()).toBeVisible()

    await page.locator('[data-testid="thread-panel-close"]').click()
    await expect(page.locator('[data-testid="thread-panel"]')).not.toBeVisible()
    await page.locator('[data-testid="message-from-thread-link"]').last().click()
    await expect(page.locator('[data-testid="thread-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="thread-panel"]')).toContainText(replyText)
  })
})
