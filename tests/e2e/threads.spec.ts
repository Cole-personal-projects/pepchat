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
  test('exposes a visible mobile thread entry point for root messages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const firstRoot = page.locator('.message-row').first()
    await expect(firstRoot).toBeVisible()
    await expect(page.locator('[data-testid="mobile-action-reply-thread"]').first()).toBeVisible()

    await page.locator('[data-testid="mobile-action-reply-thread"]').first().click()
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
