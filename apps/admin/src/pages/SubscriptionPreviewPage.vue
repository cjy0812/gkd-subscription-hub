<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NGrid,
  NGridItem,
  NInput,
  NPagination,
  NSpace,
  NSpin,
  NStatistic,
  NTabPane,
  NTabs,
  NTag,
} from 'naive-ui'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import {
  PreviewFileTooLargeError,
  SubscriptionPreviewWorkerClient,
} from '../subscription/preview-worker-client'
import type {
  AppPreviewSummary,
  CategoryPreviewSummary,
  GroupPreviewSummary,
  PageResult,
  PreviewScope,
  RulePreviewSummary,
  SubscriptionMeta,
  SubscriptionStats,
} from '../subscription/preview-model'

const route = useRoute()
const PAGE_SIZE = 50

const client = ref<SubscriptionPreviewWorkerClient>()
const abortController = ref<AbortController>()
const rawAbortController = ref<AbortController>()
const rawSource = ref<string | null>(null)
const rawLoading = ref(false)
const meta = ref<SubscriptionMeta>()
const stats = ref<SubscriptionStats>()
const sourceOnlyMode = ref(false)
const loading = ref(false)
const actionLoading = ref(false)
let pendingActionRequests = 0
let appsRequestId = 0
let groupsRequestId = 0
let rulesRequestId = 0
let detailRequestId = 0
let categoriesRequestId = 0

function beginActionRequest() {
  pendingActionRequests += 1
  actionLoading.value = true
}

function endActionRequest() {
  pendingActionRequests = Math.max(0, pendingActionRequests - 1)
  actionLoading.value = pendingActionRequests > 0
}
const error = ref('')
const largeFileBytes = ref<number | null>(null)
const activeTab = ref('apps')

const apps = ref<PageResult<AppPreviewSummary>>()
const appPage = ref(1)
const appQuery = ref('')
const selectedApp = ref<AppPreviewSummary>()
const groups = ref<PageResult<GroupPreviewSummary>>()
const groupPage = ref(1)
const groupQuery = ref('')
const selectedGroup = ref<GroupPreviewSummary>()
const groupScope = ref<PreviewScope>('app')
const rules = ref<PageResult<RulePreviewSummary>>()
const rulePage = ref(1)
const ruleQuery = ref('')
const selectedRule = ref<RulePreviewSummary>()
const ruleDetail = ref<unknown>()
const categories = ref<PageResult<CategoryPreviewSummary>>()
const categoryPage = ref(1)
const categoryQuery = ref('')

const subscriptionId = computed(() => Number(route.params.id))
const routeFilePath = computed(() => {
  const value = route.params.pathMatch
  return Array.isArray(value) ? value.join('/') : typeof value === 'string' ? value : ''
})
const historyPathVersion = computed(() => routeFilePath.value.match(/^v([1-9]\d*)\/gkd\.json5$/i)?.[1])
const isLegacyPreviewRoute = computed(() => route.name === 'subscription-preview-legacy')
const version = computed(() => {
  const value = isLegacyPreviewRoute.value ? route.query.version : historyPathVersion.value
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const filePath = computed(() => {
  const queryFile = isLegacyPreviewRoute.value ? route.query.file : undefined
  if (typeof queryFile === 'string' && queryFile.trim()) return queryFile
  const path = routeFilePath.value
  if (path && !historyPathVersion.value) return path.replace(/^dist\//, '')
  return 'gkd.json5'
})
const invalidFilePath = computed(() => {
  const value = (isLegacyPreviewRoute.value ? route.query.file : undefined) ?? (routeFilePath.value && !historyPathVersion.value ? routeFilePath.value : undefined)
  if (value == null) return false
  if (typeof value !== 'string' || !value.trim()) return true
  return value.startsWith('/') || value.includes(String.fromCharCode(92)) || value.includes(String.fromCharCode(0)) || value.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
})
const invalidVersion = computed(() => ((isLegacyPreviewRoute.value && route.query.version != null) || historyPathVersion.value != null) && version.value === null)
const pageTitle = computed(() => meta.value?.name || 'GKD 订阅预览')
const sourceUrl = computed(() => {
  if (version.value) return `/${subscriptionId.value}/v${version.value}/gkd.json5?raw=1`
  const path = filePath.value.split('/').map(encodeURIComponent).join('/')
  return `/${subscriptionId.value}/${path}?raw=1`
})
const metadataLinkBase = computed(() => sourceUrl.value)
const safeUpdateUrl = computed(() => safeHttpUrl(meta.value?.updateUrl, metadataLinkBase.value))
const safeSupportUrl = computed(() => safeHttpUrl(meta.value?.supportUri, metadataLinkBase.value))
const safeCheckUrl = computed(() =>
  safeHttpUrl(
    meta.value?.checkUpdateUrl,
    safeHttpUrl(meta.value?.updateUrl, metadataLinkBase.value) || metadataLinkBase.value,
  ),
)
const isVersionMismatch = computed(() => Boolean(meta.value && meta.value.id !== subscriptionId.value))

function safeHttpUrl(value?: string, baseUrl = sourceUrl.value): string | undefined {
  if (!value) return undefined
  try {
    const base = new URL(baseUrl, window.location.href)
    const url = new URL(value, base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function resetDetailState() {
  apps.value = undefined
  appPage.value = 1
  selectedApp.value = undefined
  groups.value = undefined
  groupPage.value = 1
  selectedGroup.value = undefined
  rules.value = undefined
  rulePage.value = 1
  selectedRule.value = undefined
  ruleDetail.value = undefined
  categories.value = undefined
}

async function loadApps(page = appPage.value) {
  const instance = client.value
  if (!instance) return
  const requestId = ++appsRequestId
  beginActionRequest()
  error.value = ''
  try {
    const result = await instance.request<PageResult<AppPreviewSummary>>({
      type: 'apps-page',
      page,
      pageSize: PAGE_SIZE,
      query: appQuery.value,
    })
    if (requestId !== appsRequestId || client.value !== instance) return
    apps.value = result
    appPage.value = result.page
  } catch (cause) {
    if (requestId === appsRequestId && client.value === instance) {
      error.value = cause instanceof Error ? cause.message : '读取应用列表失败'
    }
  } finally {
    endActionRequest()
  }
}

async function loadGroups(
  scope: PreviewScope,
  appIndex?: number,
  page = groupPage.value,
) {
  const instance = client.value
  if (!instance) return
  const requestId = ++groupsRequestId
  beginActionRequest()
  error.value = ''
  try {
    const result = await instance.request<PageResult<GroupPreviewSummary>>({
      type: 'groups-page',
      scope,
      appIndex,
      page,
      pageSize: PAGE_SIZE,
      query: groupQuery.value,
    })
    const stillSelected =
      requestId === groupsRequestId &&
      client.value === instance &&
      groupScope.value === scope &&
      (scope === 'global' || selectedApp.value?.index === appIndex)
    if (!stillSelected) return
    groups.value = result
    groupPage.value = result.page
  } catch (cause) {
    if (requestId === groupsRequestId && client.value === instance) {
      error.value = cause instanceof Error ? cause.message : '读取规则组失败'
    }
  } finally {
    endActionRequest()
  }
}

async function loadRules(page = rulePage.value) {
  const instance = client.value
  const group = selectedGroup.value
  if (!instance || !group) return
  const requestId = ++rulesRequestId
  const selectedAppIndex = groupScope.value === 'app' ? selectedApp.value?.index : undefined
  const selectedScope = groupScope.value
  beginActionRequest()
  error.value = ''
  try {
    const result = await instance.request<PageResult<RulePreviewSummary>>({
      type: 'rules-page',
      scope: groupScope.value,
      appIndex: selectedAppIndex,
      groupIndex: group.index,
      page,
      pageSize: PAGE_SIZE,
      query: ruleQuery.value,
    })
    const stillSelected =
      requestId === rulesRequestId &&
      client.value === instance &&
      selectedGroup.value?.index === group.index &&
      groupScope.value === selectedScope &&
      (selectedScope === 'global' || selectedApp.value?.index === selectedAppIndex)
    if (!stillSelected) return
    rules.value = result
    rulePage.value = result.page
  } catch (cause) {
    if (requestId === rulesRequestId && client.value === instance) {
      error.value = cause instanceof Error ? cause.message : '读取规则列表失败'
    }
  } finally {
    endActionRequest()
  }
}

async function selectApp(app: AppPreviewSummary) {
  selectedApp.value = app
  selectedGroup.value = undefined
  selectedRule.value = undefined
  ruleDetail.value = undefined
  rules.value = undefined
  groups.value = undefined
  rulesRequestId += 1
  detailRequestId += 1
  groupScope.value = 'app'
  groupPage.value = 1
  groupQuery.value = ''
  await loadGroups('app', app.index, 1)
}

async function selectGlobalGroups() {
  selectedApp.value = undefined
  selectedGroup.value = undefined
  selectedRule.value = undefined
  ruleDetail.value = undefined
  rules.value = undefined
  groups.value = undefined
  rulesRequestId += 1
  detailRequestId += 1
  groupScope.value = 'global'
  groupPage.value = 1
  groupQuery.value = ''
  await loadGroups('global', undefined, 1)
}

async function selectGroup(group: GroupPreviewSummary) {
  selectedGroup.value = group
  selectedRule.value = undefined
  ruleDetail.value = undefined
  rules.value = undefined
  rulesRequestId += 1
  detailRequestId += 1
  rulePage.value = 1
  ruleQuery.value = ''
  await loadRules(1)
}

async function selectRule(rule: RulePreviewSummary) {
  selectedRule.value = rule
  ruleDetail.value = undefined
  const instance = client.value
  const group = selectedGroup.value
  if (!instance || !group) return
  const requestId = ++detailRequestId
  const selectedScope = groupScope.value
  const selectedAppIndex = selectedScope === 'app' ? selectedApp.value?.index : undefined
  beginActionRequest()
  try {
    const result = await instance.request<unknown>({
      type: 'rule-detail',
      scope: selectedScope,
      appIndex: selectedAppIndex,
      groupIndex: group.index,
      ruleIndex: rule.index,
    })
    if (
      requestId === detailRequestId &&
      client.value === instance &&
      selectedGroup.value?.index === group.index &&
      selectedRule.value?.index === rule.index &&
      groupScope.value === selectedScope
    ) {
      ruleDetail.value = result
    }
  } catch (cause) {
    if (requestId === detailRequestId && client.value === instance) {
      error.value = cause instanceof Error ? cause.message : '读取规则详情失败'
    }
  } finally {
    endActionRequest()
  }
}

async function loadCategories(page = categoryPage.value) {
  const instance = client.value
  if (!instance) return
  const requestId = ++categoriesRequestId
  beginActionRequest()
  error.value = ''
  try {
    const result = await instance.request<PageResult<CategoryPreviewSummary>>({
      type: 'categories-page',
      page,
      pageSize: PAGE_SIZE,
      query: categoryQuery.value,
    })
    if (requestId !== categoriesRequestId || client.value !== instance) return
    categories.value = result
    categoryPage.value = result.page
  } catch (cause) {
    if (requestId === categoriesRequestId && client.value === instance) {
      error.value = cause instanceof Error ? cause.message : '读取分类失败'
    }
  } finally {
    endActionRequest()
  }
}

async function loadSubscription(allowLarge = false) {
  abortController.value?.abort()
  rawAbortController.value?.abort()
  rawAbortController.value = undefined
  client.value?.dispose()
  client.value = undefined

  // Clear all route-owned state before validation, so invalid navigation
  // cannot leave the previous subscription visible under the new URL.
  resetDetailState()
  appsRequestId += 1
  groupsRequestId += 1
  rulesRequestId += 1
  detailRequestId += 1
  categoriesRequestId += 1
  sourceOnlyMode.value = route.query.view === 'source'
  activeTab.value = sourceOnlyMode.value ? 'raw' : 'apps'
  groupScope.value = 'app'
  appQuery.value = ''
  groupQuery.value = ''
  ruleQuery.value = ''
  categoryQuery.value = ''
  rawSource.value = null
  rawLoading.value = false
  largeFileBytes.value = null
  meta.value = undefined
  stats.value = undefined
  error.value = ''
  loading.value = false

  const id = subscriptionId.value
  if (!Number.isSafeInteger(id) || id <= 0) {
    error.value = '订阅 ID 无效'
    return
  }
  if (invalidVersion.value) {
    error.value = '历史版本号无效，未请求当前最新版'
    return
  }
  if (invalidFilePath.value) {
    error.value = '订阅文件路径无效'
    return
  }

  loading.value = true
  const controller = new AbortController()
  abortController.value = controller
  const instance = new SubscriptionPreviewWorkerClient()
  client.value = instance

  try {
    if (sourceOnlyMode.value) {
      loading.value = false
      await loadRawSource()
      return
    }
    const bytes = await instance.loadSourceBytes(sourceUrl.value, controller.signal, allowLarge)
    if (controller.signal.aborted) return
    const parsed = await instance.request<{
      meta: SubscriptionMeta
      stats: SubscriptionStats
      idMatches: boolean
    }>(
      {
        type: 'parse',
        source: bytes,
        expectedId: id,
      },
      [bytes],
    )
    if (controller.signal.aborted) return
    meta.value = parsed.meta
    stats.value = parsed.stats
    await loadApps(1)
  } catch (cause) {
    if (!controller.signal.aborted) {
      if (cause instanceof PreviewFileTooLargeError) {
        largeFileBytes.value = cause.byteLength
        error.value = cause.message + '。可以选择继续结构化解析（最高 50 MB），也可以查看原始文件。'
      } else {
        error.value = cause instanceof Error ? cause.message : '加载订阅失败'
      }
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

async function loadRawSource() {
  const instance = client.value
  if (!instance || rawLoading.value || rawSource.value !== null) return
  rawAbortController.value?.abort()
  const controller = new AbortController()
  rawAbortController.value = controller
  rawLoading.value = true
  error.value = ''
  try {
    const raw = await instance.loadRawSource(sourceUrl.value, controller.signal)
    if (!controller.signal.aborted && activeTab.value === 'raw') rawSource.value = raw
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '读取原始 JSON5 失败'
    }
  } finally {
    if (rawAbortController.value === controller) rawAbortController.value = undefined
    if (!controller.signal.aborted) rawLoading.value = false
  }
}

function backToDirectory() {
  window.location.assign(`/${subscriptionId.value}/dist/`)
}

function openRawFile() {
  window.open(sourceUrl.value, '_blank', 'noopener,noreferrer')
}

watch(
  () => [route.params.id, route.params.pathMatch, route.query.file, route.query.version, route.query.view],
  () => {
    void loadSubscription()
  },
  { immediate: true },
)

watch(appQuery, () => {
  appPage.value = 1
  void loadApps(1)
})
watch(groupQuery, () => {
  groupPage.value = 1
  if (groupScope.value === 'global') void loadGroups('global', undefined, 1)
  else if (selectedApp.value) void loadGroups('app', selectedApp.value.index, 1)
})
watch(ruleQuery, () => {
  rulePage.value = 1
  if (selectedGroup.value) void loadRules(1)
})
watch(categoryQuery, () => {
  categoryPage.value = 1
  if (activeTab.value === 'categories') void loadCategories(1)
})
watch(activeTab, (tab) => {
  if (tab === 'global' && groupScope.value !== 'global') void selectGlobalGroups()
  if (tab === 'categories' && !categories.value) void loadCategories(1)
  if (tab === 'raw') void loadRawSource()
  else {
    rawAbortController.value?.abort()
    rawAbortController.value = undefined
    rawSource.value = null
    rawLoading.value = false
  }
})

onBeforeUnmount(() => {
  abortController.value?.abort()
  rawAbortController.value?.abort()
  client.value?.dispose()
})
</script>

<template>
  <main class="preview-page">
    <header class="preview-header">
      <div class="preview-brand">
        <button class="back-link" type="button" title="返回订阅文件目录" @click="backToDirectory">
          <AppIcon name="chevron-left" :size="18" />
          <span>文件目录</span>
        </button>
        <div class="preview-title">
          <span>GKD SUBSCRIPTION</span>
          <h1>{{ pageTitle }}</h1>
          <p>ID {{ subscriptionId }} <template v-if="version">· 历史版本 v{{ version }}</template><template v-else>· {{ filePath }}</template></p>
        </div>
      </div>
      <n-space>
        <n-button secondary @click="openRawFile">
          <template #icon><AppIcon name="file-text" /></template>
          原始文件
        </n-button>
      </n-space>
    </header>

      <n-alert v-if="error" :type="largeFileBytes ? 'warning' : 'error'" :show-icon="true" class="preview-alert">
      <div class="error-content">
        <span>{{ error }}</span>
        <n-space>
          <n-button v-if="largeFileBytes" size="small" type="warning" secondary @click="loadSubscription(true)">
            继续结构化解析（最高 50 MB）
          </n-button>
          <n-button size="small" quaternary @click="loadSubscription()">重新加载</n-button>
          <n-button v-if="largeFileBytes" size="small" quaternary @click="openRawFile">查看原始文件</n-button>
        </n-space>
      </div>
    </n-alert>

    <n-spin :show="loading" :description="sourceOnlyMode ? '正在读取原始文件…' : '在独立 Worker 中解析 GKD 订阅…'">
      <template v-if="(meta && stats) || sourceOnlyMode">
        <n-alert v-if="meta && !sourceOnlyMode && isVersionMismatch" type="warning" :show-icon="true" class="preview-alert">
          订阅 ID 不匹配：URL 中的 ID 是 {{ subscriptionId }}，文件内部 ID 是 {{ meta.id }}。请检查订阅来源。
        </n-alert>

        <section v-if="meta && stats" class="subscription-overview">
          <n-card :bordered="false" class="meta-card">
            <div class="meta-topline">
              <n-tag :bordered="false" type="success">GKD 订阅</n-tag>
              <span>v{{ meta.version }}</span>
            </div>
            <h2>{{ meta.name }}</h2>
            <p v-if="meta.author" class="meta-author">作者：{{ meta.author }}</p>
            <div class="meta-links">
              <a v-if="safeUpdateUrl" :href="safeUpdateUrl" target="_blank" rel="noopener noreferrer">更新地址 <icon name="external-link" /></a>
              <a v-if="safeCheckUrl" :href="safeCheckUrl" target="_blank" rel="noopener noreferrer">版本检查 <icon name="external-link" /></a>
              <a v-if="safeSupportUrl" :href="safeSupportUrl" target="_blank" rel="noopener noreferrer">反馈地址 <icon name="external-link" /></a>
            </div>
          </n-card>
          <n-grid cols="2 s:3 l:6" :x-gap="12" :y-gap="12" responsive="screen" class="stats-grid">
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="应用" :value="stats.apps" /></n-card></n-grid-item>
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="应用规则组" :value="stats.appGroups" /></n-card></n-grid-item>
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="应用规则" :value="stats.appRules" /></n-card></n-grid-item>
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="全局规则组" :value="stats.globalGroups" /></n-card></n-grid-item>
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="全局规则" :value="stats.globalRules" /></n-card></n-grid-item>
            <n-grid-item><n-card :bordered="false" class="stat-card"><n-statistic label="分类" :value="stats.categories" /></n-card></n-grid-item>
          </n-grid>
        </section>

        <n-card :bordered="false" class="preview-content">
          <n-tabs v-model:value="activeTab" type="line" animated>
            <n-tab-pane v-if="!sourceOnlyMode" name="apps" tab="应用规则">
              <div class="tab-toolbar">
                <div><h2>应用列表</h2><p>按应用分页浏览，每页 50 项；选择应用后才加载它的规则组。</p></div>
                <div class="search-field"><span id="app-search-label">应用搜索</span><n-input v-model:value="appQuery" clearable size="small" aria-labelledby="app-search-label" placeholder="输入包名或应用名称" class="search-input" /></div>
              </div>
              <n-spin :show="actionLoading">
                <n-empty v-if="apps && apps.items.length === 0" description="没有匹配的应用" />
                <div v-else class="app-list">
                  <button
                    v-for="app in apps?.items || []"
                    :key="app.index"
                    class="app-row"
                    :class="{ selected: selectedApp?.index === app.index }"
                    type="button"
                    @click="selectApp(app)"
                  >
                    <span class="app-index">{{ app.index + 1 }}</span>
                    <span class="app-info"><strong>{{ app.name }}</strong><small>{{ app.id }}</small></span>
                    <span class="app-counts">{{ app.groupCount }} 组 · {{ app.ruleCount }} 条规则</span>
                    <AppIcon name="chevron-right" :size="17" />
                  </button>
                </div>
                <div v-if="apps && apps.pageCount > 1" class="pager">
                  <span>共 {{ apps.total }} 个应用</span>
                  <n-pagination v-model:page="appPage" :page-size="PAGE_SIZE" :item-count="apps.total" size="small" @update:page="loadApps" />
                </div>
              </n-spin>

              <section v-if="selectedApp" class="detail-section">
                <div class="detail-heading">
                  <div><h3>{{ selectedApp.name }}</h3><p>{{ selectedApp.id }}</p></div>
                  <n-button size="small" quaternary @click="selectedApp = undefined; groups = undefined; selectedGroup = undefined; rules = undefined">收起</n-button>
                </div>
                <div class="tab-toolbar compact-toolbar">
                  <span>规则组 · {{ groups?.total ?? selectedApp.groupCount }}</span>
                  <div class="search-field"><span id="group-search-label">规则组搜索</span><n-input v-model:value="groupQuery" clearable size="small" aria-labelledby="group-search-label" placeholder="输入规则组名称" class="search-input" /></div>
                </div>
                <n-empty v-if="groups && !groups.items.length" description="没有匹配的规则组" />
                <div class="group-list">
                  <article v-for="group in groups?.items || []" :key="group.index" class="group-row">
                    <button class="group-summary" type="button" @click="selectGroup(group)">
                      <span
                        class="group-state"
                        :class="{ disabled: group.enabled === false }"
                      >{{ group.enabled === null ? '默认启用' : group.enabled ? '启用' : '禁用' }}</span>
                      <span class="group-title"><strong>{{ group.name }}</strong><small>#{{ group.key }} · {{ group.ruleCount }} 条规则</small></span>
                      <AppIcon name="chevron-right" :size="17" />
                    </button>
                    <p v-if="group.desc" class="group-description">{{ group.desc }}</p>
                    <div v-if="group.attributes.length" class="group-attributes">
                      <span v-for="attribute in group.attributes" :key="attribute.key" class="attribute-item">
                        <strong>{{ attribute.key }}</strong><code>{{ attribute.value }}</code>
                      </span>
                    </div>
                    <div v-if="selectedGroup?.index === group.index && groupScope === 'app'" class="rule-panel">
                      <div class="tab-toolbar compact-toolbar">
                        <span>规则列表</span>
                        <div class="search-field"><span id="rule-search-label">规则搜索</span><n-input v-model:value="ruleQuery" clearable size="small" aria-labelledby="rule-search-label" placeholder="输入规则名、选择器或动作" class="search-input" /></div>
                      </div>
                      <n-empty v-if="rules && !rules.items.length" description="该规则组没有匹配的规则" />
                      <div v-for="rule in rules?.items || []" :key="rule.index" class="rule-row">
                        <button class="rule-summary" type="button" @click="selectRule(rule)">
                          <span class="rule-key">{{ rule.key ?? rule.index + 1 }}</span>
                          <span class="rule-title"><strong>{{ rule.name }}</strong><small>{{ rule.action || '默认动作' }} · {{ rule.preview || '未设置 matches' }}</small></span>
                          <AppIcon name="chevron-down" :size="16" />
                        </button>
                        <pre v-if="selectedRule?.index === rule.index && ruleDetail" class="rule-detail"><code>{{ JSON.stringify(ruleDetail, null, 2) }}</code></pre>
                      </div>
                      <div v-if="rules && rules.pageCount > 1" class="pager">
                        <span>共 {{ rules.total }} 条规则</span>
                        <n-pagination v-model:page="rulePage" :page-size="PAGE_SIZE" :item-count="rules.total" size="small" @update:page="loadRules" />
                      </div>
                    </div>
                  </article>
                </div>
                <div v-if="groups && groups.pageCount > 1" class="pager">
                  <span>共 {{ groups.total }} 个规则组</span>
                  <n-pagination v-model:page="groupPage" :page-size="PAGE_SIZE" :item-count="groups.total" size="small" @update:page="loadGroups('app', selectedApp?.index)" />
                </div>
              </section>
            </n-tab-pane>

            <n-tab-pane v-if="!sourceOnlyMode" name="global" tab="全局规则">
              <div class="tab-toolbar">
                <div><h2>全局规则组</h2><p>只在打开此标签时加载全局规则组；规则详情按需读取。</p></div>
                <div class="search-field"><span id="global-group-search-label">全局规则组搜索</span><n-input v-model:value="groupQuery" clearable size="small" aria-labelledby="global-group-search-label" placeholder="输入规则组名称" class="search-input" /></div>
              </div>
              <n-empty v-if="groups && !groups.items.length" description="没有全局规则组" />
              <div class="group-list">
                <article v-for="group in groups?.items || []" :key="group.index" class="group-row">
                  <button class="group-summary" type="button" @click="selectGroup(group)">
                    <span
                      class="group-state"
                      :class="{ disabled: group.enabled === false }"
                    >{{ group.enabled === null ? '默认启用' : group.enabled ? '启用' : '禁用' }}</span>
                    <span class="group-title"><strong>{{ group.name }}</strong><small>#{{ group.key }} · {{ group.ruleCount }} 条规则</small></span>
                    <AppIcon name="chevron-right" :size="17" />
                  </button>
                  <p v-if="group.desc" class="group-description">{{ group.desc }}</p>
                  <div v-if="group.attributes.length" class="group-attributes">
                    <span v-for="attribute in group.attributes" :key="attribute.key" class="attribute-item">
                      <strong>{{ attribute.key }}</strong><code>{{ attribute.value }}</code>
                    </span>
                  </div>
                  <div v-if="selectedGroup?.index === group.index && groupScope === 'global'" class="rule-panel">
                    <div class="tab-toolbar compact-toolbar">
                      <span>规则列表</span>
                      <div class="search-field"><span id="global-rule-search-label">全局规则搜索</span><n-input v-model:value="ruleQuery" clearable size="small" aria-labelledby="global-rule-search-label" placeholder="输入规则名、选择器或动作" class="search-input" /></div>
                    </div>
                    <div v-for="rule in rules?.items || []" :key="rule.index" class="rule-row">
                      <button class="rule-summary" type="button" @click="selectRule(rule)">
                        <span class="rule-key">{{ rule.key ?? rule.index + 1 }}</span>
                        <span class="rule-title"><strong>{{ rule.name }}</strong><small>{{ rule.action || '默认动作' }} · {{ rule.preview || '未设置 matches' }}</small></span>
                        <AppIcon name="chevron-down" :size="16" />
                      </button>
                      <pre v-if="selectedRule?.index === rule.index && ruleDetail" class="rule-detail"><code>{{ JSON.stringify(ruleDetail, null, 2) }}</code></pre>
                    </div>
                    <div v-if="rules && rules.pageCount > 1" class="pager">
                      <span>共 {{ rules.total }} 条规则</span>
                      <n-pagination v-model:page="rulePage" :page-size="PAGE_SIZE" :item-count="rules.total" size="small" @update:page="loadRules" />
                    </div>
                  </div>
                </article>
              </div>
              <div v-if="groups && groups.pageCount > 1" class="pager">
                <span>共 {{ groups.total }} 个规则组</span>
                <n-pagination v-model:page="groupPage" :page-size="PAGE_SIZE" :item-count="groups.total" size="small" @update:page="loadGroups('global')" />
              </div>
            </n-tab-pane>

            <n-tab-pane v-if="!sourceOnlyMode" name="categories" tab="分类">
              <div class="tab-toolbar">
                <div><h2>订阅分类</h2><p>分类默认状态决定捕获的应用规则组是否启用。</p></div>
                <div class="search-field"><span id="category-search-label">分类搜索</span><n-input v-model:value="categoryQuery" clearable size="small" aria-labelledby="category-search-label" placeholder="输入分类名称或 Key" class="search-input" /></div>
              </div>
              <n-empty v-if="categories && !categories.items.length" description="没有分类" />
              <div v-for="category in categories?.items || []" :key="category.key" class="category-row">
                <span class="rule-key">#{{ category.key }}</span>
                <strong>{{ category.name }}</strong>
                <n-tag size="small" :bordered="false" :type="category.enable === false ? 'warning' : 'success'">
                  {{ category.enable === null ? '跟随规则组' : category.enable ? '默认启用' : '默认禁用' }}
                </n-tag>
              </div>
              <div v-if="categories && categories.pageCount > 1" class="pager">
                <span>共 {{ categories.total }} 个分类</span>
                <n-pagination v-model:page="categoryPage" :page-size="PAGE_SIZE" :item-count="categories.total" size="small" @update:page="loadCategories" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="raw" tab="原始 JSON5">
              <div class="tab-toolbar"><div><h2>原始 JSON5</h2><p>该区域仅在主动打开此标签时下载并渲染全文，文件最大读取量为 50 MB。</p></div></div>
              <n-spin :show="rawLoading" description="按需读取原始 JSON5…">
                <textarea
                  v-if="rawSource !== null"
                  class="raw-source"
                  aria-label="原始 JSON5 内容"
                  :value="rawSource"
                  readonly
                  spellcheck="false"
                />
                <n-empty v-else-if="!rawLoading" description="选择原始 JSON5 标签后读取文件内容" />
              </n-spin>
            </n-tab-pane>
          </n-tabs>
        </n-card>
      </template>
    </n-spin>
  </main>
</template>

<style scoped>
.preview-page{max-width:1320px;min-height:100vh;margin:0 auto;padding:24px 28px 52px;color:var(--color-text)}
.preview-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:26px}
.preview-brand{display:flex;align-items:flex-start;gap:20px;min-width:0}
.back-link{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--color-text-secondary);padding:9px 0;cursor:pointer}
.back-link:hover{color:var(--color-accent)}
.preview-title>span{font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--color-accent)}
.preview-title h1{margin:4px 0;font-size:clamp(24px,4vw,34px);line-height:1.2;overflow-wrap:anywhere}
.preview-title p{margin:0;color:var(--color-text-secondary);font-size:13px}
.preview-alert{margin-bottom:16px}
.error-content{display:flex;align-items:center;justify-content:space-between;gap:12px}
.subscription-overview{display:grid;grid-template-columns:minmax(230px,1.1fr) minmax(0,2fr);gap:12px;margin-bottom:18px}
.meta-card,.stat-card,.preview-content{border:1px solid var(--color-border);border-radius:var(--radius-container);box-shadow:var(--shadow-card)}
.meta-topline{display:flex;align-items:center;justify-content:space-between;color:var(--color-text-secondary);font-size:12px}
.meta-card h2{font-size:22px;line-height:1.3;overflow-wrap:anywhere;margin:18px 0 6px}
.meta-author{font-size:13px;color:var(--color-text-secondary);margin:0}
.meta-links{display:flex;flex-wrap:wrap;gap:14px;margin-top:18px}
.meta-links a{display:inline-flex;align-items:center;gap:4px;color:var(--color-accent);font-size:12px;text-decoration:none}
.stats-grid{align-content:stretch}
.stat-card{height:100%}
.tab-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:4px 0 16px}
.tab-toolbar h2{font-size:18px;margin:0 0 4px}
.tab-toolbar p{font-size:12px;color:var(--color-text-secondary);margin:0}
.search-input{width:100%}
.search-field{display:grid;gap:5px;width:min(280px,45%);font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.app-list,.group-list{display:grid;gap:8px}
.app-row,.group-summary,.rule-summary{width:100%;display:flex;align-items:center;gap:12px;text-align:left;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);padding:12px 14px;color:var(--color-text);cursor:pointer;min-width:0}
.app-row:hover,.app-row.selected,.group-summary:hover,.rule-summary:hover{border-color:var(--color-accent);background:var(--color-surface-secondary)}
.app-index,.rule-key{display:grid;min-width:34px;min-height:34px;place-items:center;border-radius:8px;background:var(--color-surface-secondary);font-size:12px;font-weight:700;color:var(--color-text-secondary)}
.app-info,.group-title,.rule-title{display:grid;gap:4px;min-width:0;flex:1}
.app-info strong,.group-title strong,.rule-title strong{font-size:13px;overflow-wrap:anywhere}
.app-info small,.group-title small,.rule-title small{font-size:11px;color:var(--color-text-secondary);overflow-wrap:anywhere}
.app-counts{font-size:11px;color:var(--color-text-secondary);white-space:nowrap}
.detail-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--color-border)}
.detail-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.detail-heading h3{font-size:18px;margin:0}.detail-heading p{font-size:12px;color:var(--color-text-secondary);margin:4px 0 0}
.compact-toolbar{margin:16px 0 10px}
.group-row{border:1px solid var(--color-border);border-radius:10px;padding:8px}
.group-summary{border:0;padding:8px;background:transparent}
.group-state{font-size:10px;color:var(--color-success);background:var(--color-surface-secondary);padding:4px 7px;border-radius:5px;white-space:nowrap}
.group-state.disabled{color:var(--color-warning)}
.group-description{font-size:12px;color:var(--color-text-secondary);margin:4px 12px 8px;white-space:pre-wrap}
.group-attributes{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 8px}
.attribute-item{display:flex;flex-wrap:wrap;gap:5px;align-items:center;border-radius:6px;background:var(--color-surface-secondary);padding:5px 7px;font-size:10px;max-width:100%}
.attribute-item code{overflow-wrap:anywhere;color:var(--color-text-secondary)}
.rule-panel{margin:12px 4px 4px;padding-top:12px;border-top:1px solid var(--color-border)}
.rule-row{border:1px solid var(--color-border);border-radius:8px;margin-top:8px;overflow:hidden}
.rule-summary{border:0;border-radius:0;padding:10px 12px;background:var(--color-surface-secondary)}
.rule-title small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rule-detail{max-height:520px;overflow:auto;margin:0;padding:14px;background:var(--color-surface-secondary);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.category-row{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--color-border)}
.category-row strong{flex:1;font-size:13px;overflow-wrap:anywhere}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;color:var(--color-text-secondary);font-size:12px}
.raw-source{display:block;width:100%;height:min(70vh,900px);padding:14px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface-secondary);color:var(--color-text);font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical;white-space:pre;tab-size:2}
@media(max-width:880px){.subscription-overview{grid-template-columns:1fr}.preview-page{padding:18px 18px 36px}}
@media(max-width:600px){.preview-page{padding:14px 12px 28px}.preview-header{gap:10px}.preview-brand{gap:10px}.back-link span{display:none}.preview-title h1{font-size:22px}.preview-header :deep(.n-button){padding-inline:8px}.tab-toolbar{align-items:flex-start;flex-direction:column}.search-input{width:100%}.search-field{width:100%}.app-counts{display:none}.app-row{gap:8px;padding:10px}.pager{align-items:flex-start;flex-direction:column}.category-row{gap:8px}}
</style>
