import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = process.env.PLAYWRIGHT_PACKAGE_DIR
if (!packageDirectory) throw new Error('PLAYWRIGHT_PACKAGE_DIR is required')
const { chromium } = await import(pathToFileURL(join(packageDirectory, 'index.mjs')).href)

const owner =
  'a-very-long-owner-name-that-must-wrap-without-overflowing-the-mobile-layout-' + 'x'.repeat(28)
const repo = 'a-very-long-subscription-repository-name-that-must-wrap-cleanly-' + 'y'.repeat(24)
const workflowName =
  'Build and publish the subscription distribution artifacts for multiple runtime targets'
const workflowPath =
  '.github/workflows/' +
  'subscription-distribution-validation-and-release-'.repeat(2) +
  'workflow.yml'
const longError =
  'Upstream repository scan failed: ' +
  'network timeout while resolving the provider API response; '.repeat(5)
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
    {
      id: 102,
      name: 'A workflow with no recent runs',
      path: '.github/workflows/idle.yml',
      cron: [],
      relevant: true,
    },
  ],
  registeredAt: '2026-01-01T00:00:00.000Z',
  lastCheckedAt: '2026-11-25T00:00:00.000Z',
  lastDistHash: 'fixture',
  lastDistChangedAt: '2026-11-25T00:00:00.000Z',
  lastRuns: [
    {
      workflowId: 101,
      runId: 123,
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
  prediction: {
    intervalHours: 6,
    predictedAt: null,
    nextCheckAt: '2026-11-25T06:00:00.000Z',
    successfulRuns: 3,
  },
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
    await page.route('**/api/projects/233/runs/123/jobs', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          jobs: [
            {
              id: 7,
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
              steps: [{ number: 1, name: 'Run tests', status: 'completed', conclusion: 'success' }],
            },
          ],
        }),
      }),
    )
    await page.route('**/api/projects/233/runs/123/jobs/7/logs*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, log: 'admin step log output' }),
      }),
    )
    await page.goto('http://127.0.0.1:4173/admin/monitoring', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '运行监控' }).waitFor()
    await page.getByText(longError, { exact: true }).waitFor()
    const workflowCard = page.locator('.content-card').first()
    await workflowCard.locator('.n-collapse-item__header').first().click()
    await page.getByText(workflowName, { exact: true }).click()
    await page.getByText(workflowName, { exact: true }).waitFor({ state: 'visible' })

    const desktopRuns = await page.locator('.desktop-runs').isVisible()
    const mobileRuns = await page.locator('.mobile-runs').isVisible()
    assert.equal(desktopRuns, width > 640, `desktop table breakpoint mismatch at ${width}px`)
    assert.equal(mobileRuns, width <= 640, `mobile card breakpoint mismatch at ${width}px`)

    const runLink = page.getByRole('link', { name: '查看 Run' }).first()
    await runLink.waitFor({ state: 'visible' })
    assert.equal(await runLink.getAttribute('href'), runUrl)
    assert.equal(await runLink.getAttribute('target'), '_blank')
    assert.match((await runLink.getAttribute('rel')) || '', /noopener/)

    const refreshButton = page.getByRole('button', { name: '重新读取' })
    await refreshButton.focus()
    await page.keyboard.press('Tab')
    const focusVisible = await page.evaluate(
      () => document.activeElement?.matches(':focus-visible') ?? false,
    )
    assert.equal(focusVisible, true, `keyboard focus indicator missing at ${width}px`)

    await page.getByRole('button', { name: '展开任务' }).first().click()
    await page.getByText('Build', { exact: true }).click()
    await page.getByText(/Run tests/).click()
    await page.getByRole('button', { name: '加载日志' }).click()
    await page.getByText('admin step log output', { exact: true }).waitFor()

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(
      documentWidth <= width + 1,
      `horizontal page overflow at ${width}px: ${documentWidth}px`,
    )
    await page.screenshot({
      path: `artifacts/browser-acceptance/monitoring-${width}.png`,
      fullPage: true,
    })
    console.log(
      `PASS MonitoringPage viewport ${width}px (desktop=${desktopRuns}, mobile=${mobileRuns}, no horizontal overflow, keyboard focus, Run link)`,
    )
    await page.close()

    const publicPage = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    })
    let logAttempts = 0
    const publicSubscription = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      group: '默认分组',
      repoUrl: 'https://github.com/owner/repo',
      registeredAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: '2026-11-25T00:00:00.000Z',
      fileCount: 1,
      hasSubscription: true,
      subscriptionPath: 'gkd.json5',
      lastRuns: [
        {
          runId: 123,
          workflowName: 'CI',
          event: 'push',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-11-25T00:00:00.000Z',
          html_url: runUrl,
        },
      ],
    }
    await publicPage.route('**/api/public/subscriptions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, subscriptions: [publicSubscription] }),
      }),
    )
    await publicPage.route('**/api/public/explorer', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, entries: [] }),
      }),
    )
    await publicPage.route('**/api/public/subscriptions/233/runs/123/jobs', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          jobs: [
            {
              id: 7,
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
              steps: [{ number: 1, name: 'Run tests', status: 'completed', conclusion: 'success' }],
            },
          ],
        }),
      }),
    )
    await publicPage.route('**/api/public/subscriptions/233/runs/123/jobs/7/logs*', (route) => {
      logAttempts += 1
      return route.fulfill({
        status: logAttempts === 1 ? 502 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          logAttempts === 1
            ? { ok: false, error: '临时服务错误' }
            : { ok: true, log: 'step log output' },
        ),
      })
    })
    await publicPage.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
    await publicPage.getByRole('heading', { name: '托管订阅源' }).waitFor()
    await publicPage.getByRole('button', { name: '任务与日志' }).click()
    await publicPage.getByText('Build', { exact: true }).waitFor()
    const logButton = publicPage.getByRole('button', { name: '查看日志' })
    await logButton.click()
    await publicPage.getByText('日志读取失败：临时服务错误').waitFor()
    await logButton.click()
    await publicPage.getByText('step log output', { exact: true }).waitFor()
    assert.equal(logAttempts, 2, 'failed public log requests must be retryable')
    const publicWidth = await publicPage.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(
      publicWidth <= width + 1,
      `public portal horizontal overflow at ${width}px: ${publicWidth}px`,
    )
    await publicPage.screenshot({
      path: `artifacts/browser-acceptance/public-portal-${width}.png`,
      fullPage: true,
    })
    console.log(
      `PASS PublicPortal viewport ${width}px (Run → Job → Step → Log, retry, no horizontal overflow)`,
    )
    await publicPage.close()
  }

  const previewCases = [
    ['/233/v1/gkd.json5?version=2', '/233/v1/gkd.json5'],
    ['/233/a.json5?file=b.json5', '/233/a.json5'],
  ]
  for (const [routePath, expectedPath] of previewCases) {
    const previewPage = await browser.newPage({ viewport: { width: 1024, height: 900 } })
    let requestedPath = ''
    await previewPage.route('**/233/**', (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.searchParams.get('raw') === '1') {
        requestedPath = requestUrl.pathname
        return route.fulfill({
          status: 200,
          contentType: 'application/json5',
          body: '{id:233,version:1}',
        })
      }
      return route.continue()
    })
    const sourceResponse = previewPage.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('raw') === '1',
    )
    await previewPage.goto('http://127.0.0.1:4173' + routePath, { waitUntil: 'domcontentloaded' })
    await sourceResponse
    assert.equal(requestedPath, expectedPath, `canonical preview source mismatch for ${routePath}`)
    console.log(`PASS canonical preview selector ${routePath} → ${requestedPath}`)
    await previewPage.close()
  }

  const projectsPage = await browser.newPage({ viewport: { width: 320, height: 900 } })
  await projectsPage.addInitScript(() =>
    sessionStorage.setItem('gkdtoken', 'browser-acceptance-token'),
  )
  await projectsPage.route('**/admin/api/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, projects: [project] }),
    }),
  )
  await projectsPage.goto('http://127.0.0.1:4173/admin/projects', { waitUntil: 'networkidle' })
  await projectsPage.getByText('ID 233', { exact: true }).waitFor()
  const projectCheckbox = projectsPage.getByRole('checkbox', { name: /选择项目 233/ })
  await projectCheckbox.waitFor({ state: 'visible' })
  assert.ok((await projectCheckbox.getAttribute('aria-label'))?.includes('owner/'))
  console.log('PASS mobile project checkbox has an accessible project-specific name')
  await projectsPage.screenshot({
    path: 'artifacts/browser-acceptance/projects-320.png',
    fullPage: true,
  })
  await projectsPage.close()
} finally {
  await browser.close()
}
