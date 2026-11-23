<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useMessage, type DataTableColumns } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NDrawer,
  NDrawerContent,
  NInput,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  NText,
} from 'naive-ui'
import { api } from '../api'
import { getAdminToken } from '../auth'
import type {
  ExplorerCatalogResponse,
  ExplorerEntry,
  ExplorerJobStatus,
  ExplorerQuota,
  ExplorerQuotaResponse,
  ExplorerStatusResponse,
} from '../types'

const message = useMessage()
const token = getAdminToken()
const entries = ref<ExplorerEntry[]>([])
const job = ref<ExplorerJobStatus | null>(null)
const quota = ref<ExplorerQuota | null>(null)
const loading = ref(false)
const searching = ref('')
const forkFilter = ref('all')
const archivedFilter = ref('all')
const authorFilter = ref('')
const topicFilter = ref('')
const sortBy = ref('pushed')
const selected = ref<ExplorerEntry | null>(null)

const authors = computed(() =>
  [
    ...new Set(
      entries.value
        .flatMap((entry) => entry.subscriptions.map((subscription) => subscription.author))
        .filter(Boolean) as string[],
    ),
  ].sort(),
)
const topics = computed(() =>
  [
    ...new Set(entries.value.flatMap((entry) => (entry.repository.topics || []) as string[])),
  ].sort(),
)

const filtered = computed(() => {
  const query = searching.value.trim().toLowerCase()
  const result = entries.value.filter((entry) => {
    const repository = entry.repository
    const searchableText = [
      repository.full_name,
      repository.description,
      repository.owner?.login,
      ...(repository.topics || []),
      ...entry.subscriptions.flatMap((subscription) => [
        subscription.name,
        subscription.author,
        String(subscription.id),
        subscription.version,
        JSON.stringify(subscription.customFields),
      ]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return (
      (!query || searchableText.includes(query)) &&
      (forkFilter.value === 'all' || (forkFilter.value === 'yes') === entry.fork) &&
      (archivedFilter.value === 'all' ||
        (archivedFilter.value === 'yes') === Boolean(repository.archived)) &&
      (!authorFilter.value ||
        entry.subscriptions.some((subscription) => subscription.author === authorFilter.value)) &&
      (!topicFilter.value || (repository.topics || []).includes(topicFilter.value))
    )
  })

  const sortValue = (entry: ExplorerEntry) => {
    const repository = entry.repository
    if (sortBy.value === 'stars') return Number(repository.stargazers_count || 0)
    if (sortBy.value === 'forks') return Number(repository.forks_count || 0)
    if (sortBy.value === 'rules') {
      return entry.subscriptions.reduce((total, subscription) => total + subscription.ruleCount, 0)
    }
    if (sortBy.value === 'name') return String(repository.full_name || '').toLowerCase()
    return Date.parse(String(repository.pushed_at || repository.updated_at || '')) || 0
  }

  return result.sort((left, right) => {
    const leftValue = sortValue(left)
    const rightValue = sortValue(right)
    return typeof leftValue === 'string'
      ? leftValue.localeCompare(rightValue as string)
      : Number(rightValue) - Number(leftValue)
  })
})

const columns: DataTableColumns<ExplorerEntry> = [
  {
    title: 'GitHub 仓库',
    key: 'repo',
    minWidth: 250,
    render: (row) =>
      h('div', { class: 'repo-cell' }, [
        h('strong', row.repository.full_name),
        h('span', row.repository.description || '暂无描述'),
        row.fork ? h(NTag, { size: 'small', type: 'info' }, { default: () => 'Fork' }) : null,
        row.parent ? h('small', 'Fork 自：' + row.parent) : null,
      ]),
  },
  {
    title: '订阅',
    key: 'subscription',
    minWidth: 220,
    render: (row) =>
      h(
        'div',
        row.subscriptions.map((subscription) =>
          h('div', [
            h('strong', subscription.name),
            h('span', 'ID ' + subscription.id + ' · v' + subscription.version),
            h('small', subscription.ruleCount + ' 规则 · ' + subscription.appsCount + ' 应用'),
          ]),
        ),
      ),
  },
  {
    title: 'Stars',
    key: 'stars',
    width: 90,
    sorter: (left, right) =>
      (left.repository.stargazers_count || 0) - (right.repository.stargazers_count || 0),
    render: (row) => row.repository.stargazers_count || 0,
  },
  {
    title: '最近推送',
    key: 'pushed',
    width: 170,
    render: (row) =>
      row.repository.pushed_at ? new Date(row.repository.pushed_at).toLocaleDateString() : '—',
  },
  {
    title: '操作',
    key: 'detail',
    width: 90,
    render: (row) =>
      h(
        NButton,
        { size: 'small', secondary: true, onClick: () => (selected.value = row) },
        { default: () => '详情' },
      ),
  },
]

async function load() {
  loading.value = true
  try {
    const [catalog, status] = await Promise.all([
      api<ExplorerCatalogResponse>('/api/explorer/catalog', token),
      api<ExplorerStatusResponse>('/api/explorer/status', token),
    ])
    entries.value = catalog.entries
    job.value = status.status
    try {
      const quotaResult = await api<ExplorerQuotaResponse>('/api/explorer/quota', token)
      quota.value = quotaResult.quota
    } catch {
      quota.value = null
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取 Explorer 数据失败')
  } finally {
    loading.value = false
  }
}

async function begin() {
  try {
    const result = await api<ExplorerStatusResponse>('/api/explorer/discover', token, {
      method: 'POST',
    })
    job.value = result.status
    message.success('已创建发现任务')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '启动失败')
  }
}

async function advance() {
  loading.value = true
  try {
    for (let index = 0; index < 20; index++) {
      const result = await api<ExplorerStatusResponse>('/api/explorer/discover/step', token, {
        method: 'POST',
      })
      job.value = result.status
      if (['complete', 'paused', 'error', 'idle'].includes(result.status.status)) break
    }
    await load()
    if (job.value?.status === 'complete') {
      message.success('发现任务完成')
    } else if (job.value?.status === 'paused' || job.value?.status === 'error') {
      message.warning(job.value.error || '任务暂停')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '推进扫描失败')
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  searching.value = ''
  forkFilter.value = 'all'
  archivedFilter.value = 'all'
  authorFilter.value = ''
  topicFilter.value = ''
}

function resetTime(timestamp: number) {
  return timestamp ? new Date(timestamp * 1000).toLocaleTimeString() : '—'
}

const jobPercent = computed(() => {
  if (!job.value) return 0
  if (job.value.status === 'complete') return 100
  return Math.min(95, Math.round((job.value.queryIndex / 6) * 100))
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-content">
    <header class="page-heading">
      <div>
        <p class="eyebrow">DISCOVERY</p>
        <h1>GKD Rules Explorer</h1>
        <p class="muted">发现并筛选公开 GitHub 上的完整 GKD 订阅仓库。</p>
      </div>
      <n-space>
        <n-button secondary :loading="loading" @click="load">刷新目录</n-button>
        <n-button
          type="primary"
          :disabled="['searching', 'verifying'].includes(job?.status || '')"
          @click="begin"
        >
          开始 / 重置扫描
        </n-button>
        <n-button
          type="success"
          :disabled="!['searching', 'verifying', 'paused', 'error'].includes(job?.status || '')"
          :loading="loading"
          @click="advance"
        >
          继续扫描
        </n-button>
      </n-space>
    </header>

    <n-card :bordered="false" class="stat-card">
      <n-space justify="space-between" align="center">
        <div>
          <strong>扫描状态：{{ job?.status || '未知' }}</strong>
          <p class="muted">
            已验证 {{ job?.verifiedCount || 0 }} 个仓库 · 候选 {{ job?.seenCount || 0 }} 个 · 搜索页
            {{ job?.scannedPages || 0 }} 页
          </p>
        </div>
        <n-tag v-if="job?.incomplete" type="warning">搜索结果可能不完整</n-tag>
      </n-space>
      <n-progress type="line" :percentage="jobPercent" :show-indicator="true" />
      <n-alert v-if="job?.error" type="warning" :bordered="false" class="mt-3">
        {{ job.error }}
      </n-alert>
      <n-text depth="3">
        上次任务更新：{{ job?.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—' }}
      </n-text>
      <n-space v-if="quota" wrap>
        <n-tag type="success">
          Core {{ quota.core.remaining }} / {{ quota.core.limit }} · 重置
          {{ resetTime(quota.core.reset) }}
        </n-tag>
        <n-tag type="info">
          Search {{ quota.search.remaining }} / {{ quota.search.limit }} · 重置
          {{ resetTime(quota.search.reset) }}
        </n-tag>
        <n-tag type="warning">
          Code Search {{ quota.code_search.remaining }} / {{ quota.code_search.limit }} · 重置
          {{ resetTime(quota.code_search.reset) }}
        </n-tag>
      </n-space>
    </n-card>

    <n-card :bordered="false" class="stat-card">
      <n-space vertical>
        <n-input
          v-model:value="searching"
          clearable
          placeholder="搜索仓库、订阅名、作者、ID、Topic 或自定义字段"
        />
        <n-space wrap>
          <n-select
            v-model:value="forkFilter"
            :options="[
              { label: '全部 Fork 状态', value: 'all' },
              { label: '包含 Fork', value: 'yes' },
              { label: '非 Fork', value: 'no' },
            ]"
            style="width: 160px"
          />
          <n-select
            v-model:value="archivedFilter"
            :options="[
              { label: '全部维护状态', value: 'all' },
              { label: '已归档', value: 'yes' },
              { label: '未归档', value: 'no' },
            ]"
            style="width: 160px"
          />
          <n-select
            v-model:value="authorFilter"
            clearable
            placeholder="订阅作者"
            :options="authors.map((value) => ({ label: value, value }))"
            style="width: 180px"
          />
          <n-select
            v-model:value="topicFilter"
            clearable
            placeholder="GitHub Topic"
            :options="topics.map((value) => ({ label: value, value }))"
            style="width: 180px"
          />
          <n-select
            v-model:value="sortBy"
            :options="[
              { label: '最近推送', value: 'pushed' },
              { label: 'Stars', value: 'stars' },
              { label: 'Fork 数', value: 'forks' },
              { label: '规则数', value: 'rules' },
              { label: '仓库名称', value: 'name' },
            ]"
            style="width: 150px"
          />
          <n-button quaternary @click="clearFilters">清空筛选</n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-card :bordered="false" class="stat-card">
      <n-space justify="space-between">
        <strong>订阅仓库目录</strong>
        <n-text depth="3">{{ filtered.length }} / {{ entries.length }} 个仓库</n-text>
      </n-space>
      <n-data-table
        :columns="columns"
        :data="filtered"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :row-key="(row) => String(row.repository.id)"
        :scroll-x="900"
      />
    </n-card>

    <n-drawer
      :show="Boolean(selected)"
      width="min(640px, 92vw)"
      placement="right"
      @update:show="
        (value) => {
          if (!value) selected = null
        }
      "
    >
      <n-drawer-content v-if="selected" :title="selected.repository.full_name" closable>
        <n-space vertical>
          <n-space>
            <n-tag v-if="selected.fork" type="info">Fork</n-tag>
            <n-tag v-if="selected.repository.archived" type="warning">Archived</n-tag>
            <n-tag v-for="topic in selected.repository.topics || []" :key="topic">
              {{ topic }}
            </n-tag>
          </n-space>
          <p>{{ selected.repository.description }}</p>
          <n-descriptions bordered :column="1" size="small">
            <n-descriptions-item label="仓库地址">
              <a :href="selected.repository.html_url" target="_blank" rel="noreferrer">
                {{ selected.repository.html_url }}
              </a>
            </n-descriptions-item>
            <n-descriptions-item label="Fork 来源">
              {{ selected.parent || '—' }}
            </n-descriptions-item>
            <n-descriptions-item label="默认分支">
              {{ selected.repository.default_branch }}
            </n-descriptions-item>
            <n-descriptions-item label="Stars / Forks">
              {{ selected.repository.stargazers_count }} / {{ selected.repository.forks_count }}
            </n-descriptions-item>
            <n-descriptions-item label="语言 / 许可证">
              {{ selected.repository.language }} / {{ selected.repository.license?.spdx_id || '—' }}
            </n-descriptions-item>
            <n-descriptions-item label="主页">
              {{ selected.repository.homepage || '—' }}
            </n-descriptions-item>
            <n-descriptions-item label="创建时间">
              {{ selected.repository.created_at }}
            </n-descriptions-item>
            <n-descriptions-item label="更新时间">
              {{ selected.repository.updated_at }}
            </n-descriptions-item>
            <n-descriptions-item label="最近推送">
              {{ selected.repository.pushed_at }}
            </n-descriptions-item>
            <n-descriptions-item label="仓库规模 / Issues">
              {{ selected.repository.size }} KB / {{ selected.repository.open_issues_count }}
            </n-descriptions-item>
            <n-descriptions-item label="自定义仓库属性">
              <pre>{{ JSON.stringify(selected.repository.custom_properties || {}, null, 2) }}</pre>
            </n-descriptions-item>
          </n-descriptions>

          <div v-for="subscription in selected.subscriptions" :key="subscription.artifactPath">
            <h3>
              {{ subscription.name }} <n-tag>ID {{ subscription.id }}</n-tag>
            </h3>
            <n-descriptions bordered :column="1" size="small">
              <n-descriptions-item label="版本">{{ subscription.version }}</n-descriptions-item>
              <n-descriptions-item label="作者">{{
                subscription.author || '—'
              }}</n-descriptions-item>
              <n-descriptions-item label="订阅文件">
                {{ subscription.artifactPath }}
              </n-descriptions-item>
              <n-descriptions-item label="更新地址">
                {{ subscription.updateUrl || '—' }}
              </n-descriptions-item>
              <n-descriptions-item label="检查更新地址">
                {{ subscription.checkUpdateUrl || '—' }}
              </n-descriptions-item>
              <n-descriptions-item label="规则统计">
                {{ subscription.ruleCount }} 条规则 / {{ subscription.appsCount }} 应用 /
                {{ subscription.globalGroupsCount }} 全局组 /
                {{ subscription.categoriesCount }} 分类
              </n-descriptions-item>
            </n-descriptions>
            <h4>自定义字段</h4>
            <pre>{{ JSON.stringify(subscription.customFields, null, 2) }}</pre>
          </div>
        </n-space>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>
