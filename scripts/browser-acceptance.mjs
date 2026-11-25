import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = process.env.PLAYWRIGHT_PACKAGE_DIR
if (!packageDirectory) throw new Error('PLAYWRIGHT_PACKAGE_DIR is required')
const { chromium } = await import(pathToFileURL(join(packageDirectory, 'index.mjs')).href)

const owner = 'a-very-long-owner-name-that-must-wrap-without-overflowing-the-mobile-layout-' + 'x'.repeat(28)
const repo = 'a-very-long-subscription-repository-name-that-must-wrap-cleanly-' + 'y'.repeat(24)
const workflowName = 'Build and publish the subscription distribution artifacts for multiple runtime targets'
const workflowPath = '.github/workflows/' + 'subscription-distribution-validation-and-release-'.repeat(2) + 'workflow.yml'
const longError = 'Upstream repository scan failed: ' + 'network timeout while resolving the provider API response; '.repeat(5)
const runUrl = 'https://github.com/owner/repo/actions/runs/123456789'
const project = {
  id: 233,
  owner,
  repo,
  branch: 'main',
  repoUrl: `https://github.com/${owner}/${repo}`,
  distFiles: [],
  distHash: 'fixture',
  workflows: [
    { id: 101, name: workflowName, path: workflowPath, cron: [], relevant: true },
    { id: 102, name: 'A workflow with no recent runs', path: '.github/workflows/idle.yml', cron: [], relevant: true },
  ],
  registeredAt: '2026-01-01T00:00:00.000Z',
  lastCheckedAt: '2026-11-25T00:00:00.000Z',
  lastDistHash: 'fixture',
  lastDistChangedAt: '2026-11-25T00:00:00.000Z',
  lastRuns: [
    {
      workflowId: 101,
      workflowName,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-11-25T00:00:00.000Z',
      updated_at: '2026-11-25T00:01:00.000Z',
      html_url: runUrl,
      head_sha: 'a'.repeat(40),
    },
  ],
  prediction: { intervalHours: 6, predictedAt: null, nextCheckAt: '2026-11-25T06:00:00.000Z', successfulRuns: 3 },
  lastError: longError,
}
const widths = [320, 640, 641, 768, 1024, 1440]
mkdirSync('artifacts/browser-acceptance', { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    await page.addInitScript(() => sessionStorage.setItem('gkdtoken', 'browser-acceptance-token'))
    await page.route('**/admin/api/projects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, projects: [project] }),
      }),
    )
    await page.goto('http://127.0.0.1:4173/admin/monitoring', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '运行监控' }).waitFor()
    await page.getByText(longError, { exact: true }).waitFor()
    await page.locator('.content-card .n-collapse-item__header').first().click()
    await page.locator('.content-card .n-collapse-item__header').nth(1).click()

    const desktopRuns = await page.locator('.desktop-runs').isVisible()
    const mobileRuns = await page.locator('.mobile-runs').isVisible()
    assert.equal(desktopRuns, width > 640, `desktop table breakpoint mismatch at ${width}px`)
    assert.equal(mobileRuns, width <= 640, `mobile card breakpoint mismatch at ${width}px`)

    const runLink = page.getByRole('link', { name: '查看 Run' }).first()
    await runLink.waitFor({ state: 'visible' })
    assert.equal(await runLink.getAttribute('href'), runUrl)
    assert.equal(await runLink.getAttribute('target'), '_blank')
    assert.match(await runLink.getAttribute('rel') || '', /noopener/)

    const refreshButton = page.getByRole('button', { name: '重新读取' })
    await refreshButton.focus()
    await page.keyboard.press('Tab')
    const focusVisible = await page.evaluate(() =>
      document.activeElement?.matches(':focus-visible') ?? false,
    )
    assert.equal(focusVisible, true, `keyboard focus indicator missing at ${width}px`)

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(documentWidth <= width + 1, `horizontal page overflow at ${width}px: ${documentWidth}px`)
    await page.screenshot({ path: `artifacts/browser-acceptance/monitoring-${width}.png`, fullPage: true })
    console.log(`PASS MonitoringPage viewport ${width}px (desktop=${desktopRuns}, mobile=${mobileRuns}, no horizontal overflow, keyboard focus, Run link)`)
    await page.close()
  }
} finally {
  await browser.close()
}
