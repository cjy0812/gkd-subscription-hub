<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useMessage, type DataTableColumns } from 'naive-ui'
import {
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSelect,
  NStatistic,
  NTag,
  NText,
} from 'naive-ui'
import { ApiError, api } from '../api'
import { runSequentialBatch } from '../batch'
import { toggleSelection, updateScopedSelection, updateVisibleSelection } from '../selection'
import { clearAdminToken, getAdminToken } from '../auth'
import type { Project, ProjectsResponse, ProjectResponse } from '../types'
import AppIcon from '../components/AppIcon.vue'

const message = useMessage()
const token = ref(getAdminToken())
const projects = ref<Project[]>([])
function providerLabel(provider: string | undefined) {
  switch (provider) {
    case 'github': return 'GH'
    case 'gitlab': return 'GL'
    case 'gitea': return 'GT'
    default: return 'Git'
  }
}

const repositoryUrl = ref('')
const branchName = ref<string | null>(null)
const branchOptions = ref<Array<{ label: string; value: string }>>([])
const branchLoading = ref(false)
const branchesLoaded = ref(false)
const branchesTruncated = ref(false)
const branchError = ref('')
const searchQuery = ref('')
const statusFilter = ref<'all' | 'normal' | 'error' | 'unknown'>('all')
const refreshingIds = ref(new Set<number>())
const selectedIds = ref<number[]>([])
const batchRefreshing = ref(false)
const batchDeleting = ref(false)
const batchProgress = ref({ completed: 0, total: 0 })
const batchBusy = computed(() => batchRefreshing.value || batchDeleting.value)
const groupName = ref('默认分组')
const groupOptions = computed(() => {
  const names = new Set(projects.value.map((project) => project.group?.trim()).filter((name): name is string => Boolean(name)))
  names.add('默认分组')
  return [...names].sort((a, b) => a === '默认分组' ? -1 : b === '默认分组' ? 1 : a.localeCompare(b, 'zh-CN')).map((name) => ({ label: name, value: name }))
})
watch(repositoryUrl, () => {
  branchName.value = null
  branchOptions.value = []
  branchesLoaded.value = false
  branchesTruncated.value = false
  branchError.value = ''
})
const subscriptionDomain = ref('')
const projectStatus = (project: Project) => {
  if (project.lastError) return 'error'
  return project.lastCheckedAt ? 'normal' : 'unknown'
}
const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return projects.value.filter((project) => {
    const searchable = `${project.id} ${project.owner}/${project.repo} ${project.branch} ${project.group || ''}`
    const matchesQuery = !query || searchable.toLowerCase().includes(query)
    return matchesQuery && (statusFilter.value === 'all' || projectStatus(project) === statusFilter.value)
  })
})
const groupedProjects = computed(() => {
  const groups = new Map<string, Project[]>()
  for (const project of filteredProjects.value) {
    const name = project.group || '默认分组'
    groups.set(name, [...(groups.get(name) || []), project])
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
const selectedProjects = computed(() =>
  projects.value.filter((project) => selectedIds.value.includes(project.id)),
)
const allFilteredSelected = computed(
  () =>
    filteredProjects.value.length > 0 &&
    filteredProjects.value.every((project) => selectedIds.value.includes(project.id)),
)
const someFilteredSelected = computed(
  () =>
    filteredProjects.value.some((project) => selectedIds.value.includes(project.id)) &&
    !allFilteredSelected.value,
)
const selectedOutsideFilterCount = computed(() => {
  const visibleIds = new Set(filteredProjects.value.map((project) => project.id))
  return selectedProjects.value.filter((project) => !visibleIds.has(project.id)).length
})
const expandedGroups = ref<string[]>([])
watch(
  groupedProjects,
  (groups, previousGroups) => {
    const expanded = new Set(expandedGroups.value)
    const previous = new Set((previousGroups || []).map((group) => group.name))
    expandedGroups.value = groups
      .filter((group) => expanded.has(group.name) || !previous.has(group.name))
      .map((group) => group.name)
  },
  { immediate: true },
)

const loading = ref(false)
const submitting = ref(false)
const showAdd = ref(false)
const totalFiles = computed(() =>
  projects.value.reduce((sum, item) => sum + item.distFiles.length, 0),
)
const errorCount = computed(
  () => projects.value.filter((project) => projectStatus(project) === 'error').length,
)
function updateFilteredSelection(checked: boolean) {
  selectedIds.value = updateVisibleSelection(
    selectedIds.value,
    filteredProjects.value.map((project) => project.id),
    checked,
  )
}

function toggleProjectSelection(id: number, checked: boolean) {
  selectedIds.value = toggleSelection(selectedIds.value, id, checked)
}

function updateGroupSelection(group: Project[], keys: Array<string | number>) {
  selectedIds.value = updateScopedSelection(
    selectedIds.value,
    group.map((project) => project.id),
    keys,
  )
}

function clearSelection() {
  if (!batchBusy.value) selectedIds.value = []
}

function reportBatchResult(
  label: string,
  result: { succeeded: unknown[]; failed: { item: Project; error: unknown }[]; skipped: Project[] },
) {
  const summary = `${label}完成：成功 ${result.succeeded.length} 项，失败 ${result.failed.length} 项，未执行 ${result.skipped.length} 项。`
  if (result.failed.length || result.skipped.length) {
    const details = result.failed
      .slice(0, 3)
      .map(
        ({ item, error }) =>
          `ID ${item.id}：${error instanceof Error ? error.message : '未知错误'}`,
      )
      .join('；')
    message.warning(details ? `${summary} ${details}` : summary)
  } else {
    message.success(summary)
  }
}

async function batchRefresh() {
  const targets = selectedProjects.value.slice()
  if (!targets.length || batchBusy.value || refreshingIds.value.size > 0) return
  batchRefreshing.value = true
  batchProgress.value = { completed: 0, total: targets.length }
  try {
    const result = await runSequentialBatch(
      targets,
      async (project) => {
        refreshingIds.value = new Set(refreshingIds.value).add(project.id)
        try {
          const response = await api<ProjectResponse>(
            `/api/projects/${project.id}/refresh`,
            token.value,
            { method: 'POST' },
          )
          return response.project
        } finally {
          const next = new Set(refreshingIds.value)
          next.delete(project.id)
          refreshingIds.value = next
        }
      },
      {
        onProgress: (completed, total) => {
          batchProgress.value = { completed, total }
        },
        shouldStop: (error) => error instanceof ApiError && error.status === 401,
      },
    )
    const refreshed = new Map(
      result.succeeded.map(({ item, value }) => [item.id, value] as const),
    )
    const failed = new Map<number, string>()
    for (const { item, error } of result.failed) {
      // Only HTTP 502 is persisted by the refresh route as the project's lastError.
      if (error instanceof ApiError && error.status === 502) failed.set(item.id, error.message)
    }
    projects.value = projects.value.map((project) => {
      const updated = refreshed.get(project.id)
      if (updated) return updated
      const error = failed.get(project.id)
      return error ? { ...project, lastError: error } : project
    })
    selectedIds.value = selectedIds.value.filter((id) => !refreshed.has(id))
    reportBatchResult('批量刷新', result)
  } finally {
    batchRefreshing.value = false
    batchProgress.value = { completed: 0, total: 0 }
  }
}

async function batchDelete() {
  const targets = selectedProjects.value.slice()
  if (!targets.length || batchBusy.value) return
  const confirmed = window.confirm(
    `确定删除选中的 ${targets.length} 个订阅源元数据吗？只会删除本系统中的项目索引，不会删除上游 GitHub 仓库或文件。`,
  )
  if (!confirmed) return
  batchDeleting.value = true
  batchProgress.value = { completed: 0, total: targets.length }
  try {
    const result = await runSequentialBatch(
      targets,
      (project) =>
        api<{ ok: boolean; deleted: number }>(`/api/projects/${project.id}`, token.value, {
          method: 'DELETE',
        }),
      {
        onProgress: (completed, total) => {
          batchProgress.value = { completed, total }
        },
        shouldStop: (error) => error instanceof ApiError && error.status === 401,
      },
    )
    const deletedIds = new Set(result.succeeded.map(({ item }) => item.id))
    projects.value = projects.value.filter((project) => !deletedIds.has(project.id))
    selectedIds.value = selectedIds.value.filter((id) => !deletedIds.has(id))
    reportBatchResult('批量删除', result)
  } finally {
    batchDeleting.value = false
    batchProgress.value = { completed: 0, total: 0 }
  }
}

function openSubscription(id: number) {
  if (!projects.value.some((item) => item.id === id) || !subscriptionDomain.value) return
  window.open(`https://${subscriptionDomain.value}/${id}/`, '_blank', 'noopener,noreferrer')
}

async function copySubscriptionUrl(id: number) {
  if (!projects.value.some((item) => item.id === id) || !subscriptionDomain.value) return
  try {
    await navigator.clipboard.writeText(`https://${subscriptionDomain.value}/${id}/gkd.json5`)
    message.success('已复制主订阅地址')
  } catch {
    message.error('复制失败，请检查浏览器剪贴板权限')
  }
}

const columns: DataTableColumns<Project> = [
  { type: 'selection' },
  {
    title: '仓库',
    key: 'repository',
    minWidth: 240,
    render: (row) =>
      h('div', { class: 'repo-cell' }, [
        h('a', { href: row.repoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'repo-title-link', title: '打开源码仓库' }, [h('span', { class: ['provider-mark', `provider-${row.provider || 'unknown'}`], 'aria-label': `托管平台：${row.provider || '未知'}` }, providerLabel(row.provider)), h('strong', `${row.owner}/${row.repo}`), h(AppIcon, { name: 'external-link', size: 10 })]),
        h(
          'small',
          `${row.provider === 'gitlab' ? 'GitLab' : row.provider === 'gitea' ? 'Gitea' : 'GitHub'} · 订阅 ID ${row.id}`,
        ),
      ]),
  },
  { title: '分支', key: 'branch', width: 120, ellipsis: { tooltip: true } },
  { title: '文件数', key: 'files', width: 90, render: (row) => row.distFiles.length },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type:
            projectStatus(row) === 'error'
              ? 'error'
              : projectStatus(row) === 'normal'
                ? 'success'
                : 'default',
        },
        {
          default: () =>
            projectStatus(row) === 'error'
              ? '检查异常'
              : projectStatus(row) === 'normal'
                ? '正常'
                : '未检查',
        },
      ),
  },
  {
    title: '最近错误',
    key: 'lastError',
    minWidth: 180,
    render: (row) =>
      row.lastError
        ? h(
            NText,
            { type: 'error', style: 'max-width: 220px; display: block' },
            { default: () => row.lastError },
          )
        : '—',
  },
  {
    title: '最近检查',
    key: 'lastCheckedAt',
    minWidth: 160,
    render: (row) =>
      row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : '尚未检查',
  },
  {
    title: '操作',
    key: 'actions',
    width: 190,
    render: (row) =>
      h(
        NSpace,
        { size: 8 },
        {
          default: () => [

            h(
              NButton,
              {
                size: 'small',
                tertiary: true,
                disabled: batchBusy.value,
                title: '打开 dist 文件目录',
                'aria-label': '打开 dist 文件目录',
                onClick: () => openSubscription(row.id),
              },
              { icon: () => h(AppIcon, { name: 'file-text' }) },
            ),
            h(
              NButton,
              { size: 'small', quaternary: true, disabled: batchBusy.value, title: '复制主订阅 JSON5 地址', 'aria-label': '复制主订阅 JSON5 地址', onClick: () => copySubscriptionUrl(row.id) },
              { icon: () => h(AppIcon, { name: 'copy' }) },
            ),
            h(
              NButton,
              {
                size: 'small',
                secondary: true,
                loading: refreshingIds.value.has(row.id),
                disabled: batchBusy.value,
                title: '刷新订阅源',
                'aria-label': '刷新订阅源',
                onClick: () => refreshProject(row.id),
              },
              { icon: () => h(AppIcon, { name: 'refresh-cw' }) },
            ),
            h(
              NButton,
              {
                size: 'small',
                tertiary: true,
                type: 'error',
                disabled: batchBusy.value,
                title: '删除订阅源',
                'aria-label': '删除订阅源',
                onClick: () => removeProject(row.id),
              },
              { icon: () => h(AppIcon, { name: 'trash-2' }) },
            ),
          ],
        },
      ),
  },
]

async function loadProjects() {
  loading.value = true
  try {
    const [result, config] = await Promise.all([
      api<ProjectsResponse>('/api/projects', token.value),
      api<{ subscriptionDomain: string }>('/api/config', token.value),
    ])
    projects.value = result.projects
    const availableIds = new Set(result.projects.map((project) => project.id))
    selectedIds.value = selectedIds.value.filter((id) => availableIds.has(id))
    subscriptionDomain.value = config.subscriptionDomain
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      token.value = ''
      clearAdminToken()
    }
    message.error(error instanceof Error ? error.message : '读取项目失败')
  } finally {
    loading.value = false
  }
}

async function loadBranches() {
  const url = repositoryUrl.value.trim()
  if (!url || branchLoading.value) return
  branchLoading.value = true
  branchError.value = ''
  try {
    const result = await api<{ defaultBranch: string; branches: string[]; truncated?: boolean }>(
      `/api/repositories/branches?url=${encodeURIComponent(url)}`,
      token.value,
    )
    branchOptions.value = result.branches.map((name) => ({ label: name, value: name }))
    branchName.value = result.defaultBranch
    branchesLoaded.value = true
    branchesTruncated.value = Boolean(result.truncated)
    if (branchesTruncated.value) {
      message.warning('已达到 1,000 个分支读取上限，后续分支未继续请求')
    } else {
      message.success(`已读取 ${result.branches.length} 个分支，默认分支为 ${result.defaultBranch}`)
    }
  } catch (error) {
    branchError.value = error instanceof Error ? error.message : '读取分支失败'
    message.error(branchError.value)
  } finally {
    branchLoading.value = false
  }
}

async function addProject() {
  if (!repositoryUrl.value.trim()) return
  submitting.value = true
  try {
    const result = await api<ProjectResponse>('/api/projects', token.value, {
      method: 'POST',
      body: JSON.stringify({
        url: repositoryUrl.value.trim(),
        branch: branchName.value || undefined,
        group: groupName.value.trim() || '默认分组',
      }),
    })
    projects.value = [...projects.value, result.project].sort((a, b) => a.id - b.id)
    repositoryUrl.value = ''
    branchName.value = null
    groupName.value = '默认分组'
    showAdd.value = false
    message.success(`已添加订阅 ID ${result.project.id}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '添加失败')
  } finally {
    submitting.value = false
  }
}

async function refreshProject(id: number) {
  if (batchBusy.value || refreshingIds.value.has(id)) return
  refreshingIds.value = new Set(refreshingIds.value).add(id)
  try {
    const result = await api<ProjectResponse>(`/api/projects/${id}/refresh`, token.value, {
      method: 'POST',
    })
    projects.value = projects.value.map((item) => (item.id === id ? result.project : item))
    message.success(`ID ${id} 已刷新`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新失败')
  } finally {
    const next = new Set(refreshingIds.value)
    next.delete(id)
    refreshingIds.value = next
  }
}

async function removeProject(id: number) {
  if (batchBusy.value) return
  if (!window.confirm(`确定删除订阅 ID ${id} 的项目元数据吗？`)) return
  try {
    await api(`/api/projects/${id}`, token.value, { method: 'DELETE' })
    projects.value = projects.value.filter((item) => item.id !== id)
    selectedIds.value = selectedIds.value.filter((selectedId) => selectedId !== id)
    message.success(`ID ${id} 已删除`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

onMounted(() => {
  if (token.value) void loadProjects()
})
</script>

<template>
  <div class="page-content">
    <header class="page-heading">
        <div>
          <p class="eyebrow">OVERVIEW</p>
          <h1>订阅源管理</h1>
          <p class="muted">支持 GitHub、GitLab.com 和 Gitea.com 公开仓库；管理已登记的订阅源与分发状态。</p>
        </div>
        <n-space>
          <n-button type="primary" @click="showAdd = true">
            <template #icon><AppIcon name="plus" /></template>
            添加订阅源
          </n-button>
        </n-space>
      </header>

      <n-grid cols="2 m:3" :x-gap="12" :y-gap="12" responsive="screen" class="stats-grid">
        <n-grid-item
          ><n-card class="stat-card" :bordered="false"
            ><n-statistic label="已注册项目" :value="projects.length" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card class="stat-card" :bordered="false"
            ><n-statistic label="已索引文件" :value="totalFiles" /></n-card
        ></n-grid-item>
        <n-grid-item
          ><n-card class="stat-card" :bordered="false"
            ><n-statistic label="检查异常" :value="errorCount" /></n-card
        ></n-grid-item>
      </n-grid>

      <n-card class="projects-card" :bordered="false">
        <div class="section-heading">
          <div>
            <h2>项目列表</h2>
            <p class="muted">每个项目对应一个 GKD 订阅 ID。</p>
          </div>
          <n-space align="center" wrap>
            <n-input
              v-model:value="searchQuery"
              clearable
              placeholder="搜索 ID、仓库、分支或分组"
              class="project-search"
            >
              <template #prefix><AppIcon name="search" /></template>
            </n-input>
            <n-checkbox
              :checked="allFilteredSelected"
              :indeterminate="someFilteredSelected"
              :disabled="batchBusy || !filteredProjects.length"
              @update:checked="updateFilteredSelection"
            >
              选择当前筛选结果（{{ filteredProjects.length }}）
            </n-checkbox>
            <n-select
              v-model:value="statusFilter"
              :options="[
                { label: '全部状态', value: 'all' },
                { label: '正常', value: 'normal' },
                { label: '检查异常', value: 'error' },
                { label: '未检查', value: 'unknown' },
              ]"
              class="status-filter"
            />
            <n-button secondary :loading="loading" :disabled="batchBusy" @click="loadProjects">
              <template #icon><AppIcon name="refresh-cw" /></template>
              刷新列表
            </n-button>
          </n-space>
        </div>
        <div v-if="selectedProjects.length" class="batch-toolbar">
          <div class="batch-summary">
            <strong>已选 {{ selectedProjects.length }} 项</strong>
            <span v-if="selectedOutsideFilterCount">
              其中 {{ selectedOutsideFilterCount }} 项不在当前筛选结果中
            </span>
            <span v-if="batchBusy">
              处理中 {{ batchProgress.completed }}/{{ batchProgress.total }}
            </span>
          </div>
          <n-space>
            <n-button
              size="small"
              secondary
              :loading="batchRefreshing"
              :disabled="batchBusy"
              @click="batchRefresh"
            >
              <template #icon><AppIcon name="refresh-cw" /></template>
              批量刷新
            </n-button>
            <n-button
              size="small"
              tertiary
              type="error"
              :loading="batchDeleting"
              :disabled="batchBusy"
              @click="batchDelete"
            >
              <template #icon><AppIcon name="trash-2" /></template>
              批量删除
            </n-button>
            <n-button size="small" quaternary :disabled="batchBusy" @click="clearSelection">
              清空选择
            </n-button>
          </n-space>
        </div>
        <n-spin :show="loading">
          <n-collapse v-model:expanded-names="expandedGroups" arrow-placement="right">
            <n-collapse-item
              v-for="group in groupedProjects"
              :key="group.name"
              :name="group.name"
            >
              <template #header>
                <div class="group-heading">
                  <h3>{{ group.name }}</h3>
                  <n-tag size="small" :bordered="false">{{ group.items.length }} 个项目</n-tag>
                </div>
              </template>
              <div class="desktop-table">
              <n-data-table
                :columns="columns"
                :data="group.items"
                :row-key="(row) => row.id"
                :checked-row-keys="selectedIds"
                @update:checked-row-keys="(keys) => updateGroupSelection(group.items, keys)"
              />
            </div>
            <div class="mobile-project-list">
              <article
                v-for="project in group.items"
                :key="project.id"
                class="mobile-project-card"
              >
                <div class="mobile-project-title">
                  <n-checkbox
                    :checked="selectedIds.includes(project.id)"
                    :aria-label="`选择项目 ${project.id}（${project.owner}/${project.repo}）`"
                    :disabled="batchBusy"
                    @update:checked="(checked) => toggleProjectSelection(project.id, checked)"
                  />
                  <strong>ID {{ project.id }}</strong>
                  <n-tag
                    size="small"
                    :bordered="false"
                    :type="projectStatus(project) === 'error' ? 'error' : projectStatus(project) === 'normal' ? 'success' : 'default'"
                  >
                    {{ projectStatus(project) === 'error' ? '检查异常' : projectStatus(project) === 'normal' ? '正常' : '未检查' }}
                  </n-tag>
                  <n-tag size="small" :bordered="false">{{ project.distFiles.length }} 个文件</n-tag>
                </div>
                <p><a :href="project.repoUrl" target="_blank" rel="noopener noreferrer" class="repo-title-link"><span class="provider-mark" :class="`provider-${project.provider || 'unknown'}`" :aria-label="`托管平台：${project.provider || '未知'}`">{{ providerLabel(project.provider) }}</span><span>{{ project.owner }}/{{ project.repo }}</span><AppIcon name="external-link" :size="10" /></a></p>
                <small>分支：{{ project.branch }}</small>
                <small
                  >最近检查：{{
                    project.lastCheckedAt
                      ? new Date(project.lastCheckedAt).toLocaleString()
                      : '尚未检查'
                  }}</small
                >
                <small v-if="project.prediction?.nextCheckAt"
                  >预计检查：{{
                    new Date(project.prediction.nextCheckAt).toLocaleString()
                  }}</small
                >
                <n-text v-if="project.lastError" type="error">{{ project.lastError }}</n-text>
                <n-space>
                  <n-button
                    size="small"
                    secondary
                    :loading="refreshingIds.has(project.id)"
                    :disabled="batchBusy"
                    title="刷新订阅源"
                    aria-label="刷新订阅源"
                    @click="refreshProject(project.id)"
                  >
                    <template #icon><AppIcon name="refresh-cw" /></template>
                  </n-button>
                  <n-button size="small" quaternary title="复制主订阅 JSON5 地址" aria-label="复制主订阅 JSON5 地址" @click="copySubscriptionUrl(project.id)">
                    <template #icon><AppIcon name="copy" /></template>
                  </n-button>
                  <n-button
                    size="small"
                    quaternary
                    :disabled="batchBusy"
                    title="打开 dist 文件目录"
                    aria-label="打开 dist 文件目录"
                    @click="openSubscription(project.id)"
                  >
                    <template #icon><AppIcon name="file-text" /></template>
                  </n-button>
                  <n-button
                    size="small"
                    tertiary
                    type="error"
                    :disabled="batchBusy"
                    title="删除订阅源"
                    aria-label="删除订阅源"
                    @click="removeProject(project.id)"
                  >
                    <template #icon><AppIcon name="trash-2" /></template>
                  </n-button>
                </n-space>
              </article>
              </div>
            </n-collapse-item>
          </n-collapse>
          <n-empty
            v-if="!projects.length && !loading"
            description="还没有订阅源，添加一个 GitHub 仓库开始使用。"
          />
          <n-empty
            v-else-if="!filteredProjects.length && !loading"
            description="没有符合当前搜索和筛选条件的项目。"
          />
        </n-spin>
      </n-card>
  </div>
  <n-modal v-model:show="showAdd" preset="card" title="添加订阅源" class="add-modal">
    <n-form @submit.prevent="addProject">
      <n-form-item label="仓库地址">
        <n-space align="center" :wrap="false" class="repo-url-row">
          <n-input
            v-model:value="repositoryUrl"
            placeholder="GitHub / GitLab / Gitea 仓库 URL"
            clearable
            @keyup.enter="loadBranches"
          />
          <n-button secondary :loading="branchLoading" :disabled="!repositoryUrl.trim()" @click="loadBranches">
            读取分支
          </n-button>
        </n-space>
      </n-form-item>
      <n-form-item label="所属分支（可选）">
        <n-select
          v-model:value="branchName"
          :options="branchOptions"
          filterable
          clearable
          :disabled="!branchesLoaded"
          placeholder="先读取仓库分支；留空使用默认分支"
        />
        <n-text v-if="branchError" type="error" class="branch-error">{{ branchError }}</n-text>
        <n-text v-else-if="branchesTruncated" type="warning" class="branch-error">
          已达到 1,000 个分支读取上限，后续分支未继续请求。
        </n-text>
      </n-form-item>
      <n-form-item label="所属分组">
        <n-select v-model:value="groupName" :options="groupOptions" filterable tag placeholder="选择已有分组，或输入新分组名称" />
      </n-form-item>
      <p class="muted form-hint">仅支持公开、未归档且包含 dist/ 的 GitHub 仓库。</p>
      <n-space justify="end">
        <n-button @click="showAdd = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="addProject">验证并添加</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>

<style scoped>
.stats-grid {
  margin-bottom: 20px;
}
.stat-card,
.projects-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-card);
}
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: -4px 0 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  background: var(--color-surface-secondary);
  padding: 10px 12px;
}
.batch-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.batch-summary span {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.section-heading h2 {
  margin: 0 0 4px;
  font-size: 17px;
}
.section-heading p {
  margin: 0;
}
.group-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 10px;
}
.group-heading h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}
.project-group + .project-group {
  margin-top: 24px;
}
.repo-cell {
  display: grid;
  gap: 3px;
}
.repo-cell small {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.provider-mark { display: inline-grid; flex: 0 0 20px; width: 20px; height: 20px; place-items: center; border-radius: 5px; background: var(--color-surface-secondary); color: var(--color-text-secondary); font-size: 9px; font-weight: 800; letter-spacing: -.04em; }
.provider-mark { display: inline-grid; flex: 0 0 20px; width: 20px; height: 20px; place-items: center; border-radius: 5px; background: var(--color-surface-secondary); color: var(--color-text-secondary); font-size: 9px; font-weight: 800; letter-spacing: -.04em; }
.repo-title-link { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--color-text); text-decoration: none; }
.repo-title-link strong,.repo-title-link > span:not(.provider-mark) { min-width: 0; overflow-wrap: anywhere; }
.repo-title-link svg { flex: 0 0 auto; }
.repo-title-link:hover { color: var(--color-accent); text-decoration: underline; }
.repo-source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-accent);
  text-decoration: none;
}
.repo-source-link:hover {
  text-decoration: underline;
}
.repo-source-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.project-search {
  width: min(320px, 100%);
}
.status-filter {
  width: 130px;
}
.repo-url-row {
  width: 100%;
}
.repo-url-row :deep(.n-input) {
  flex: 1;
  min-width: 0;
}
.branch-error {
  display: block;
  margin-top: 6px;
}
.form-hint {
  margin: -4px 0 18px;
  font-size: 12px;
}
.add-modal {
  width: min(560px, calc(100vw - 32px));
}
.mobile-project-list {
  display: none;
}
@media (max-width: 760px) {
  .desktop-table {
    display: none;
  }
  .mobile-project-list {
    display: grid;
    gap: 12px;
  }
  .mobile-project-card {
    display: grid;
    gap: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-container);
    background: var(--color-surface-secondary);
    padding: 14px;
  }
  .mobile-project-title {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  .mobile-project-title > strong { align-self: center; margin-right: auto; }
  .mobile-project-card :deep(.n-space) { display: flex; flex-wrap: wrap; gap: 8px; }
  .mobile-project-card :deep(.n-button) { min-width: 36px; }
  .mobile-project-card p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mobile-project-card small {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
}
</style>
