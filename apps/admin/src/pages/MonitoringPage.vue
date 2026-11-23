<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NGrid,
  NGridItem,
  NStatistic,
  NSpace,
  NSpin,
  NTag,
  NText,
  type DataTableColumns,
} from 'naive-ui'
import { api } from '../api'
import { getAdminToken } from '../auth'
import { buildMonitoringOverview, type MonitoringRun } from '../monitoring'
import type { ProjectsResponse } from '../types'

const projects = ref<ProjectsResponse['projects']>([])
const loading = ref(false)
const loadError = ref('')
const overview = computed(() => buildMonitoringOverview(projects.value))

const columns: DataTableColumns<MonitoringRun> = [
  {
    title: '工作流',
    key: 'workflowName',
    minWidth: 180,
    render: (row) => h('strong', row.workflowName),
  },
  {
    title: '订阅项目',
    key: 'repository',
    minWidth: 190,
    render: (row) => `ID ${row.projectId} · ${row.owner}/${row.repo}`,
  },
  {
    title: '触发方式',
    key: 'event',
    width: 120,
    render: (row) => row.event || '—',
  },
  {
    title: '状态',
    key: 'status',
    width: 150,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: runStatusType(row) },
        { default: () => runStatusLabel(row) },
      ),
  },
  {
    title: '更新时间',
    key: 'updated_at',
    minWidth: 180,
    render: (row) =>
      Number.isFinite(Date.parse(row.updated_at))
        ? new Date(row.updated_at).toLocaleString()
        : '—',
  },
  {
    title: '链接',
    key: 'link',
    width: 90,
    render: (row) =>
      h(
        'a',
        { href: row.html_url, target: '_blank', rel: 'noreferrer' },
        'GitHub',
      ),
  },
]

function runStatusLabel(run: MonitoringRun): string {
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return '已完成 · 成功'
    return run.conclusion ? `已结束 · ${run.conclusion}` : '已结束'
  }
  const labels: Record<string, string> = {
    queued: '排队中',
    in_progress: '运行中',
    requested: '请求中',
    waiting: '等待中',
    pending: '等待中',
  }
  return labels[run.status] || run.status || '未知'
}

function runStatusType(run: MonitoringRun): 'success' | 'error' | 'info' | 'warning' {
  if (run.status === 'completed') return run.conclusion === 'success' ? 'success' : 'error'
  return run.status === 'in_progress' ? 'info' : 'warning'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api<ProjectsResponse>('/api/projects', getAdminToken())
    projects.value = result.projects
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '读取运行记录失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-content">
    <header class="page-heading">
      <div>
        <p class="eyebrow">OBSERVABILITY</p>
        <h1>运行监控</h1>
        <p class="muted">查看订阅项目最近保存的 GitHub Actions 工作流运行记录。</p>
      </div>
      <n-button secondary :loading="loading" @click="load">重新读取</n-button>
    </header>

    <n-card :bordered="false" class="notice-card">
      <n-text depth="3">
        数据来自项目最近一次注册或刷新时保存的工作流记录。重新读取只查询当前管理端快照，不会触发 GitHub 扫描或刷新上游数据。
      </n-text>
    </n-card>

    <n-card v-if="loadError" :bordered="false">
      <n-space vertical>
        <n-text type="error">{{ loadError }}</n-text>
        <n-button secondary @click="load">重试</n-button>
      </n-space>
    </n-card>

    <n-spin v-else :show="loading">
      <n-grid cols="2 m:4" :x-gap="12" :y-gap="12" responsive="screen" class="stats-grid">
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="已监控项目" :value="overview.monitoredProjects" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="缓存运行记录" :value="overview.runCount" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="非成功结束" :value="overview.nonSuccessfulCount" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="尚未结束" :value="overview.inProgressCount" />
          </n-card>
        </n-grid-item>
      </n-grid>

      <n-card :bordered="false" class="content-card">
        <div class="section-heading">
          <div>
            <h2>最近工作流运行</h2>
            <p class="muted">按更新时间倒序，最多展示 30 条缓存记录。</p>
          </div>
        </div>
        <n-data-table
          v-if="overview.recentRuns.length"
          :columns="columns"
          :data="overview.recentRuns"
          :row-key="(row) => row.key"
          :pagination="{ pageSize: 15 }"
          :scroll-x="900"
        />
        <n-empty v-else description="暂无工作流运行记录">
          <template #extra>
            <n-text depth="3">请先在订阅管理中添加项目，或刷新已有项目以读取 GitHub Actions 记录。</n-text>
          </template>
        </n-empty>
      </n-card>

      <n-card :bordered="false" class="content-card">
        <div class="section-heading">
          <div>
            <h2>项目检查异常</h2>
            <p class="muted">这里显示最近一次项目索引刷新保存的错误，不代表当前仍在执行任务。</p>
          </div>
          <n-tag :bordered="false" :type="overview.projectErrors.length ? 'error' : 'success'">
            {{ overview.projectErrors.length }} 个项目
          </n-tag>
        </div>
        <div v-if="overview.projectErrors.length" class="error-list">
          <article v-for="project in overview.projectErrors" :key="project.id" class="error-item">
            <strong>ID {{ project.id }} · {{ project.owner }}/{{ project.repo }}</strong>
            <n-text type="error">{{ project.lastError }}</n-text>
          </article>
        </div>
        <n-empty v-else description="当前没有记录为异常的项目" />
      </n-card>
    </n-spin>
  </div>
</template>

<style scoped>
.stats-grid {
  margin-bottom: 20px;
}

.stat-card,
.content-card,
.notice-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-card);
}

.notice-card,
.content-card {
  margin-bottom: 16px;
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

.error-list {
  display: grid;
  gap: 12px;
}

.error-item {
  display: grid;
  min-width: 0;
  gap: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  background: var(--color-surface-secondary);
  padding: 14px;
}

.error-item strong {
  overflow-wrap: anywhere;
}
</style>
