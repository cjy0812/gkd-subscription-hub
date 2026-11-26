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
    await publicPage.getByRole('heading', { name: '发现、浏览与订阅 GKD 规则' }).waitFor()
    assert.equal(
      await publicPage.getByRole('link', { name: '浏览文件目录' }).getAttribute('href'),
      '/233/',
      'public directory links must use the canonical URL',
    )
    await publicPage.getByText(/最近运行/).click()
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
    ['/233/dist/gkd.json5', '/233/dist/gkd.json5'],
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

  for (const width of [320, 768, 1024, 1440]) {
    const projectsPage = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width <= 760,
      deviceScaleFactor: 1,
    })
    await projectsPage.addInitScript(() =>
      sessionStorage.setItem('gkdtoken', 'browser-acceptance-token'),
    )
    await projectsPage.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.pathname.endsWith('/admin/api/projects')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            projects: [
              project,
              { ...project, id: 234, provider: 'gitlab', owner: 'gitlab-owner', repo: 'gitlab-repo' },
              { ...project, id: 235, provider: 'gitea', owner: 'gitea-owner', repo: 'gitea-repo' },
            ],
          }),
        })
      }
      if (requestUrl.pathname.endsWith('/admin/api/config')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, subscriptionDomain: 'example.test' }),
        })
      }
      return route.continue()
    })
    await projectsPage.goto('http://127.0.0.1:4173/admin/projects', { waitUntil: 'networkidle' })
    if (width <= 760) {
      await projectsPage.getByText('ID 233', { exact: true }).waitFor()
    } else {
      await projectsPage.getByText(/订阅 ID 233/).waitFor()
    }
    const desktopTable = projectsPage.locator('.desktop-table')
    const mobileCards = projectsPage.locator('.mobile-project-list')
    assert.equal(
      await desktopTable.isVisible(),
      width > 760,
      `desktop project table mismatch at ${width}px`,
    )
    assert.equal(
      await mobileCards.isVisible(),
      width <= 760,
      `mobile project cards mismatch at ${width}px`,
    )
    if (width > 760) {
      assert.equal(await projectsPage.locator('.mobile-menu').isVisible(), false)
      assert.equal(await projectsPage.locator('.desktop-sidebar').isVisible(), true)
      const providerLogo = projectsPage.locator('.desktop-table .provider-logo')
      await providerLogo.waitFor({ state: 'visible' })
      assert.equal(await providerLogo.getAttribute('alt'), 'GitHub')
      assert.ok((await providerLogo.evaluate((image) => image.naturalWidth)) > 0)
    }
    if (width <= 760) {
      const projectCheckbox = projectsPage.getByRole('checkbox', { name: /选择项目 233/ })
      await projectCheckbox.waitFor({ state: 'visible' })
      assert.ok((await projectCheckbox.getAttribute('aria-label'))?.includes(`${owner}/${repo}`))
      const repoLink = projectsPage.locator('.mobile-project-card .repo-title-link')
      await repoLink.waitFor({ state: 'visible' })
      const providerLogo = repoLink.locator('.provider-logo')
      assert.equal(await providerLogo.getAttribute('alt'), 'GitHub')
      assert.ok((await providerLogo.evaluate((image) => image.naturalWidth)) > 0)
      for (const label of ['刷新', '复制', '目录', '删除']) {
        await projectsPage.getByText(label, { exact: true }).waitFor({ state: 'visible' })
      }
    }
    for (const provider of ['GitHub', 'GitLab', 'Gitea']) {
      const logo = projectsPage.locator(`.provider-logo[alt="${provider}"]`).first()
      await logo.waitFor({ state: 'visible' })
      assert.ok(
        (await logo.evaluate((image) => image.naturalWidth)) > 0,
        `${provider} logo failed to load at ${width}px`,
      )
    }
    const pageWidth = await projectsPage.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(
      pageWidth <= width + 1,
      `projects page horizontal overflow at ${width}px: ${pageWidth}px`,
    )
    await projectsPage.screenshot({
      path: `artifacts/browser-acceptance/projects-${width}.png`,
      fullPage: true,
    })
    console.log(
      `PASS ProjectsPage viewport ${width}px (responsive layout, provider fallback, no horizontal overflow)`,
    )

    if (width === 320) {
      // A real scrollable region beginning at the viewport edge must retain its
      // horizontal gesture instead of opening the navigation drawer.
      await projectsPage.evaluate(() => {
        const scroller = document.createElement('div')
        scroller.id = 'gesture-scroll-fixture'
        scroller.style.cssText =
          'position:fixed;left:0;top:120px;width:220px;height:48px;overflow-x:auto;z-index:9999;background:#ddd'
        const content = document.createElement('div')
        content.style.cssText = 'width:900px;height:40px'
        scroller.append(content)
        document.body.append(scroller)
      })
      await projectsPage.evaluate(() => {
        const target = document.elementFromPoint(10, 130)
        if (!target) {
          throw new Error('missing horizontal scroll fixture')
        }
        const start = new Touch({ identifier: 1, target, clientX: 10, clientY: 130 })
        target.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            changedTouches: [start],
            touches: [start],
          }),
        )
        const end = new Touch({ identifier: 1, target, clientX: 110, clientY: 130 })
        target.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, changedTouches: [end], touches: [] }),
        )
      })
      assert.equal(
        await projectsPage
          .locator('.n-drawer')
          .first()
          .isVisible()
          .catch(() => false),
        false,
        'horizontal scroller gesture must not open the drawer',
      )
      // The same rightward swipe from the ordinary screen edge should open it.
      await projectsPage.evaluate(() => {
        const target = document.body
        const start = new Touch({ identifier: 2, target, clientX: 8, clientY: 400 })
        target.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            changedTouches: [start],
            touches: [start],
          }),
        )
        const end = new Touch({ identifier: 2, target, clientX: 112, clientY: 400 })
        target.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, changedTouches: [end], touches: [] }),
        )
      })
      const drawer = projectsPage.locator('.n-drawer').first()
      await drawer.waitFor({ state: 'visible' })
      await projectsPage.waitForFunction(() => {
        const element = document.querySelector('.n-drawer')
        return element && Math.abs(element.getBoundingClientRect().left) <= 1
      })
      const drawerLeft = await drawer.evaluate((element) => element.getBoundingClientRect().left)
      assert.ok(
        Math.abs(drawerLeft) <= 1,
        `mobile drawer must open from the left edge, got ${drawerLeft}px`,
      )
      console.log(
        'PASS AdminLayout left-edge swipe opens left drawer; horizontal scroller swipe does not',
      )
    }
    await projectsPage.close()
  }

  for (const width of [320, 768, 1024, 1440]) {
    const previewPage = await browser.newPage({ viewport: { width, height: 900 } })
    const rawSource =
      '{id:233, name:"Browser Acceptance Fixture", version:1, apps:[]}\n' +
      'x'.repeat(24000) +
      '\n// multiline scroll fixture\n'.repeat(12000)
    await previewPage.route('**/233/**', (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.searchParams.get('raw') === '1') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json5',
          body: rawSource,
        })
      }
      return route.continue()
    })
    await previewPage.goto('http://127.0.0.1:4173/233/?view=source', { waitUntil: 'networkidle' })
    const rawTextarea = previewPage.getByRole('textbox', { name: '原始 JSON5 内容' })
    await rawTextarea.waitFor({ state: 'visible' })
    const previewCard = previewPage.locator('.preview-content')
    const tabsPaneWrapper = previewCard.locator('.n-tabs-pane-wrapper')
    assert.equal(
      await tabsPaneWrapper.evaluate((element) => getComputedStyle(element).overflowY),
      'visible',
      `tab pane wrapper must not trap nested scroll chaining at ${width}px`,
    )
    const pageWidth = await previewPage.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(
      pageWidth <= width + 1,
      `preview page horizontal overflow at ${width}px: ${pageWidth}px`,
    )
    await previewPage.screenshot({
      path: `artifacts/browser-acceptance/subscription-preview-${width}.png`,
      fullPage: true,
    })
    assert.ok(await rawTextarea.inputValue().then((value) => value.length > 20000))
    await rawTextarea.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    assert.ok(
      await rawTextarea.evaluate((element) => element.scrollLeft > 0),
      `raw JSON5 horizontal scrolling unavailable at ${width}px`,
    )
    await previewPage.evaluate(() => {
      const card = document.querySelector('.preview-content')
      if (!card?.parentElement) throw new Error('missing preview card fixture')
      const scrollHost = document.createElement('div')
      scrollHost.dataset.testid = 'preview-scroll-host'
      scrollHost.style.position = 'fixed'
      scrollHost.style.inset = '0 auto auto 0'
      scrollHost.style.height = '900px'
      scrollHost.style.width = '100vw'
      scrollHost.style.zIndex = '9999'
      scrollHost.style.background = 'white'
      scrollHost.style.overflowY = 'auto'
      scrollHost.style.overflowX = 'hidden'
      scrollHost.style.minHeight = '0'
      document.body.append(scrollHost)
      scrollHost.append(card)

      const filler = document.createElement('div')
      filler.style.height = '1200px'
      filler.textContent = 'browser acceptance vertical scroll fixture'
      card.append(filler)

      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      spacer.textContent = 'outer scroll-chain fixture'
      scrollHost.append(spacer)
    })
    const scrollHost = previewPage.getByTestId('preview-scroll-host')
    assert.equal(
      await previewCard.evaluate((element) => getComputedStyle(element).overflowY),
      'auto',
    )
    const cardOverflows = await previewCard.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    )
    assert.ok(cardOverflows, `preview card must overflow vertically at ${width}px`)
    await previewCard.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const cardScrollTop = await previewCard.evaluate((element) => element.scrollTop)
    const maxCardScroll = await previewCard.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )
    assert.ok(cardScrollTop > 0, `preview card must scroll internally at ${width}px`)
    assert.ok(
      cardScrollTop >= maxCardScroll - 1,
      `preview card must reach its scroll edge at ${width}px`,
    )
    assert.equal(
      await previewCard.evaluate((element) => getComputedStyle(element).overscrollBehaviorY),
      'auto',
    )
    await rawTextarea.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const rawTextareaScrollTop = await rawTextarea.evaluate((element) => element.scrollTop)
    const rawTextareaMaxScroll = await rawTextarea.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )
    assert.ok(
      rawTextareaMaxScroll > 0,
      `raw JSON5 textarea must have vertical overflow at ${width}px`,
    )
    assert.ok(
      rawTextareaScrollTop >= rawTextareaMaxScroll - 1,
      `raw JSON5 textarea must reach its vertical edge at ${width}px`,
    )
    await previewCard.evaluate((element) => {
      element.scrollTop = 0
    })
    await scrollHost.evaluate((element) => {
      element.scrollTop = 0
    })
    const textareaBounds = await rawTextarea.boundingBox()
    assert.ok(textareaBounds, 'raw JSON5 textarea must remain measurable')
    const textareaWheelX = textareaBounds.x + textareaBounds.width / 2
    const textareaWheelY = textareaBounds.y + textareaBounds.height / 2
    const textareaWheelTarget = await previewPage.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        return {
          tagName: target?.tagName,
          isTextarea: target instanceof HTMLTextAreaElement,
        }
      },
      { x: textareaWheelX, y: textareaWheelY },
    )
    assert.ok(
      textareaWheelTarget.isTextarea,
      `wheel event must originate over raw JSON5 textarea, got ${JSON.stringify(textareaWheelTarget)}`,
    )
    await rawTextarea.focus()
    await previewPage.mouse.move(textareaWheelX, textareaWheelY)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await previewPage.mouse.wheel(0, 700)
      await previewPage.waitForTimeout(80)
    }
    const textareaAfterWheel = await rawTextarea.evaluate((element) => ({
      scrollTop: element.scrollTop,
      maxScroll: element.scrollHeight - element.clientHeight,
      overscrollBehaviorY: getComputedStyle(element).overscrollBehaviorY,
    }))
    const cardAfterTextareaWheel = await previewCard.evaluate((element) => ({
      scrollTop: element.scrollTop,
      maxScroll: element.scrollHeight - element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      overscrollBehaviorY: getComputedStyle(element).overscrollBehaviorY,
    }))
    const textareaAncestorScroll = await rawTextarea.evaluate((element) => {
      const ancestors = []
      for (let node = element.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (node.scrollHeight > node.clientHeight || style.overflowY !== 'visible') {
          ancestors.push({
            tag: node.tagName,
            className: typeof node.className === 'string' ? node.className : '',
            scrollTop: node.scrollTop,
            maxScroll: node.scrollHeight - node.clientHeight,
            overflowY: style.overflowY,
            overscrollBehaviorY: style.overscrollBehaviorY,
          })
        }
      }
      return ancestors
    })
    assert.ok(
      cardAfterTextareaWheel.scrollTop > 0,
      `card must continue scrolling when textarea reaches its vertical edge at ${width}px: textarea=${JSON.stringify(textareaAfterWheel)}, card=${JSON.stringify(cardAfterTextareaWheel)}, ancestors=${JSON.stringify(textareaAncestorScroll)}`,
    )

    await previewCard.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await scrollHost.evaluate((element) => {
      element.scrollTop = 0
    })
    const beforeOuterScroll = await scrollHost.evaluate((element) => element.scrollTop)
    const cardBounds = await previewCard.boundingBox()
    assert.ok(cardBounds, 'preview card must remain measurable after internal scrolling')
    const wheelX = cardBounds.x + Math.min(12, cardBounds.width / 2)
    const wheelY = Math.max(2, Math.min(cardBounds.y + 2, 898))
    const wheelTarget = await previewPage.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        return {
          targetClass: target?.className,
          cardClass: target?.closest('.preview-content')?.className,
        }
      },
      { x: wheelX, y: wheelY },
    )
    assert.ok(
      String(wheelTarget.cardClass).includes('preview-content'),
      `wheel event must target preview card, got ${JSON.stringify(wheelTarget)}`,
    )
    await previewPage.mouse.move(wheelX, wheelY)
    await previewPage.mouse.wheel(0, 700)
    await previewPage.waitForTimeout(150)
    const afterOuterScroll = await scrollHost.evaluate((element) => element.scrollTop)
    const outerDiagnostics = await scrollHost.evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      bounds: element.getBoundingClientRect().toJSON(),
      parentDisplay: getComputedStyle(element.parentElement).display,
      parentClass: element.parentElement.className,
    }))
    assert.ok(
      afterOuterScroll > beforeOuterScroll,
      `outer scroll host must continue scrolling after nested content reaches its edge at ${width}px: before=${beforeOuterScroll}, after=${afterOuterScroll}, rawTextarea=${rawTextareaScrollTop}/${rawTextareaMaxScroll}, target=${JSON.stringify(wheelTarget)}, outer=${JSON.stringify(outerDiagnostics)}`,
    )
    console.log(
      `PASS SubscriptionPreviewPage viewport ${width}px (raw content, internal scroll, no horizontal page overflow)`,
    )
    await previewPage.close()
  }
} finally {
  await browser.close()
}
