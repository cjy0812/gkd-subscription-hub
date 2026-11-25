<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton, NCard, NCollapse, NCollapseItem, NDataTable, NDrawer, NDrawerContent, NEmpty, NGrid, NGridItem,
  NStatistic, NSpace, NSpin, NTag, NText, NTooltip, type DataTableColumns,
} from 'naive-ui'
import { api } from '../api'
import { getAdminToken } from '../auth'
import { buildMonitoringOverview, runEventLabel, type MonitoringRun } from '../monitoring'
import type { ProjectsResponse, WorkflowJob } from '../types'

const projects = ref<ProjectsResponse['projects']>([])
const loading = ref(false)
const loadError = ref('')
const overview = computed(() => buildMonitoringOverview(projects.value))
const showRunDrawer = ref(false)
const selectedRun = ref<MonitoringRun>()
const selectedJobs = ref<WorkflowJob[]>([])
const jobsLoading = ref(false)
const jobsError = ref('')
const jobLogs = ref<Record<string, string>>({})
const logLoading = ref(new Set<string>())
const columns: DataTableColumns<MonitoringRun> = [
  { title: '触发方式', key: 'event', width: 120, render: (row) => h(NTooltip, {}, { trigger: () => h('span', { tabindex: 0 }, runEventLabel(row.event)), default: () => `原始事件：${row.event || '未知'}` }) },
  {
    title: '状态',
    key: 'status',
    width: 150,
    render: (row) => h(NTag, { size: 'small', bordered: false, type: runStatusType(row) }, { default: () => runStatusLabel(row) }),
  },
  {
    title: '触发时间',
    key: 'created_at',
    minWidth: 180,
    render: (row) => Number.isFinite(Date.parse(row.created_at)) ? new Date(row.created_at).toLocaleString() : '—',
  },
  {
    title: '任务', key: 'jobs', width: 100,
    render: (row) => h(NButton, { size: 'small', quaternary: true, disabled: !row.runId, onClick: () => void openRun(row) }, { default: () => '展开任务' }),
  },
  {
    title: '运行记录',
    key: 'link',
    width: 100,
    render: (row) => h('a', { href: row.html_url, target: '_blank', rel: 'noopener noreferrer' }, '查看 Run'),
  },
]
async function openRun(run: MonitoringRun) {
  selectedRun.value = run
  selectedJobs.value = []
  jobsError.value = ''
  jobLogs.value = {}
  showRunDrawer.value = true
  if (!run.runId) return
  jobsLoading.value = true
  try {
    const result = await api<{ jobs: WorkflowJob[] }>(`/api/projects/${run.projectId}/runs/${run.runId}/jobs`, getAdminToken())
    if (selectedRun.value?.key === run.key) selectedJobs.value = result.jobs
  } catch (cause) {
    jobsError.value = cause instanceof Error ? cause.message : '读取 Job 列表失败'
  } finally {
    jobsLoading.value = false
  }
}
async function loadJobLog(job: WorkflowJob, stepNumber?: number) {
  const run = selectedRun.value
  if (!run) return
  const key = `${job.id}:${stepNumber ?? 'all'}`
  if (jobLogs.value[key] !== undefined || logLoading.value.has(key)) return
  logLoading.value = new Set(logLoading.value).add(key)
  try {
    const suffix = stepNumber == null ? '' : `?step=${stepNumber}`
    const result = await api<{ log: string }>(`/api/projects/${run.projectId}/runs/${run.runId}/jobs/${job.id}/logs${suffix}`, getAdminToken())
    jobLogs.value = { ...jobLogs.value, [key]: result.log }
  } catch (cause) {
    jobLogs.value = { ...jobLogs.value, [key]: cause instanceof Error ? `日志读取失败：${cause.message}` : '日志读取失败' }
  } finally {
    const next = new Set(logLoading.value)
    next.delete(key)
    logLoading.value = next
  }
}
function runStatusLabel(run: MonitoringRun): string {
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return '已完成 · 成功'
    return run.conclusion ? `已结束 · ${run.conclusion}` : '已结束'
  }
  const labels: Record<string, string> = {
    queued: '排队中', in_progress: '运行中', requested: '请求中', waiting: '等待中', pending: '等待中',
  }
  return labels[run.status] || run.status || '未知'
}
function runStatusType(run: MonitoringRun): 'success' | 'error' | 'info' | 'warning' {
  if (run.status === 'completed') return run.conclusion === 'success' ? 'success' : 'error'
  return run.status === 'in_progress' ? 'info' : 'warning'
}
function formatRunTime(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—'
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
onMounted(() => { void load() })
</script>

<template>
  <div class="page-content">
    <header class="page-heading">
      <div>
        <p class="eyebrow">OBSERVABILITY</p>
        <h1>运行监控</h1>
        <p class="muted">按订阅项目和 Workflow YAML 文件查看缓存的运行记录。</p>
      </div>
      <n-button secondary :loading="loading" @click="load">重新读取</n-button>
    </header>
    <n-card :bordered="false" class="notice-card">
      <n-text depth="3">数据来自项目最近一次注册或刷新时保存的工作流记录。重新读取只查询当前管理端快照，不会触发上游扫描或刷新。</n-text>
    </n-card>
    <n-card v-if="loadError" :bordered="false">
      <n-space vertical><n-text type="error">{{ loadError }}</n-text><n-button secondary @click="load">重试</n-button></n-space>
    </n-card>
    <n-spin v-else :show="loading">
      <n-grid cols="2 m:4" :x-gap="12" :y-gap="12" responsive="screen" class="stats-grid">
        <n-grid-item><n-card class="stat-card" :bordered="false"><n-statistic label="已监控项目" :value="overview.monitoredProjects" /></n-card></n-grid-item>
        <n-grid-item><n-card class="stat-card" :bordered="false"><n-statistic label="缓存运行记录" :value="overview.runCount" /></n-card></n-grid-item>
        <n-grid-item><n-card class="stat-card" :bordered="false"><n-statistic label="非成功结束" :value="overview.nonSuccessfulCount" /></n-card></n-grid-item>
        <n-grid-item><n-card class="stat-card" :bordered="false"><n-statistic label="尚未结束" :value="overview.inProgressCount" /></n-card></n-grid-item>
      </n-grid>
      <n-card :bordered="false" class="content-card">
        <div class="section-heading">
          <div><h2>项目与工作流</h2><p class="muted">先选择项目，再展开具体 YAML 工作流查看 Run；Job/Step 留在单次运行详情中。</p></div>
          <n-tag :bordered="false">{{ overview.projectWorkflows.length }} 个项目</n-tag>
        </div>
        <n-empty v-if="!overview.projectWorkflows.length" description="暂无工作流运行记录" />
        <n-collapse v-else accordion>
          <n-collapse-item v-for="project in overview.projectWorkflows" :key="project.id" :name="String(project.id)">
            <template #header>
              <div class="collapse-heading">
                <strong>ID {{ project.id }} · {{ project.owner }}/{{ project.repo }}</strong>
                <span>{{ project.workflows.length }} 个 Workflow · {{ project.workflows.reduce((sum, workflow) => sum + workflow.runs.length, 0) }} 次运行</span>
              </div>
            </template>
            <n-space v-if="project.lastError" vertical class="project-error"><n-text type="error">{{ project.lastError }}</n-text></n-space>
            <n-collapse>
              <n-collapse-item v-for="workflow in project.workflows" :key="workflow.key" :name="workflow.key">
                <template #header>
                  <div class="collapse-heading">
                    <strong>{{ workflow.name }}</strong>
                    <span><code>{{ workflow.path }}</code> · {{ workflow.runs.length }} 次运行</span>
                  </div>
                </template>
                <n-data-table
                  v-if="workflow.runs.length"
                  class="desktop-runs"
                  :columns="columns"
                  :data="workflow.runs"
                  :row-key="(row) => row.key"
                  :pagination="{ pageSize: 10 }"
                  :scroll-x="620"
                />
                <div v-if="workflow.runs.length" class="mobile-runs">
                  <article v-for="run in workflow.runs" :key="run.key" class="mobile-run-card">
                    <div class="mobile-run-heading">
                      <n-tooltip><template #trigger><span>{{ runEventLabel(run.event) }}</span></template>原始事件：{{ run.event || '未知' }}</n-tooltip>
                      <n-tag size="small" :bordered="false" :type="runStatusType(run)">
                        {{ runStatusLabel(run) }}
                      </n-tag>
                    </div>
                    <time>{{ formatRunTime(run.created_at) }}</time>
                    <n-space><n-button size="tiny" quaternary :disabled="!run.runId" @click="openRun(run)">展开任务</n-button><a :href="run.html_url" target="_blank" rel="noopener noreferrer">查看 Run</a></n-space>
                  </article>
                </div>
                <n-empty v-else description="该 Workflow 暂无缓存运行记录" />
              </n-collapse-item>
            </n-collapse>
          </n-collapse-item>
        </n-collapse>
      </n-card>
      <n-card :bordered="false" class="content-card">
        <div class="section-heading">
          <div><h2>项目检查异常</h2><p class="muted">这里只展示最近一次项目索引刷新保存的错误。</p></div>
          <n-tag :bordered="false" :type="overview.projectErrors.length ? 'error' : 'success'">{{ overview.projectErrors.length }} 个项目</n-tag>
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

    <n-drawer v-model:show="showRunDrawer" width="min(720px, 94vw)">
      <n-drawer-content :title="selectedRun ? `Run · ${selectedRun.workflowName}` : 'Run 详情'" closable>
        <n-spin :show="jobsLoading">
          <n-text v-if="jobsError" type="error">{{ jobsError }}</n-text>
          <n-empty v-else-if="!jobsLoading && !selectedJobs.length" description="暂无 Job 详情，或此 Provider 暂不支持读取" />
          <n-collapse v-else accordion>
            <n-collapse-item v-for="job in selectedJobs" :key="job.id" :name="String(job.id)">
              <template #header>
                <div class="collapse-heading"><strong>{{ job.name }}</strong><span>{{ job.status }} · {{ job.conclusion || '未结束' }}</span></div>
              </template>
              <n-collapse v-if="job.steps.length" accordion>
                <n-collapse-item v-for="step in job.steps" :key="step.number" :name="String(step.number)">
                  <template #header><div class="collapse-heading"><strong>{{ step.number ? `Step ${step.number} · ` : '' }}{{ step.name }}</strong><span>{{ step.status }} · {{ step.conclusion || '—' }}</span></div></template>
                  <n-button size="small" secondary :loading="logLoading.has(`${job.id}:${step.number}`)" @click="loadJobLog(job, step.number)">加载日志</n-button>
                  <pre v-if="jobLogs[`${job.id}:${step.number}`] !== undefined" class="job-log">{{ jobLogs[`${job.id}:${step.number}`] }}</pre>
                </n-collapse-item>
              </n-collapse>
              <template v-else>
                <n-button size="small" secondary :loading="logLoading.has(`${job.id}:all`)" @click="loadJobLog(job)">加载 Job 日志</n-button>
                <pre v-if="jobLogs[`${job.id}:all`] !== undefined" class="job-log">{{ jobLogs[`${job.id}:all`] }}</pre>
              </template>
            </n-collapse-item>
          </n-collapse>
        </n-spin>
      </n-drawer-content>
    </n-drawer>
</template>

<style scoped>
.stats-grid{margin-bottom:20px}
.stat-card,.content-card,.notice-card{border:1px solid var(--color-border);border-radius:var(--radius-container);box-shadow:var(--shadow-card)}
.notice-card,.content-card{margin-bottom:16px}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
.section-heading h2{margin:0 0 4px;font-size:17px}.section-heading p{margin:0}
.collapse-heading{display:grid;min-width:0;gap:4px}.collapse-heading strong,.collapse-heading span{overflow-wrap:anywhere}
.collapse-heading span{font-size:12px;color:var(--color-text-secondary)}.collapse-heading code{font-size:11px}
.project-error{margin-bottom:12px}.error-list{display:grid;gap:12px}
.mobile-runs{display:none}
.job-log{max-height:55vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:8px;background:var(--color-surface-secondary);font:12px/1.5 ui-monospace,monospace}
.mobile-run-card{display:grid;min-width:0;gap:10px;border:1px solid var(--color-border);border-radius:var(--radius-container);background:var(--color-surface-secondary);padding:12px}
.mobile-run-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.mobile-run-heading>span,.mobile-run-card time{overflow-wrap:anywhere;font-size:12px;color:var(--color-text-secondary)}
.mobile-run-card a{justify-self:start;color:var(--color-accent);font-size:13px;text-decoration:none}
.mobile-run-card a:hover{text-decoration:underline}
@media(max-width:640px){.desktop-runs{display:none}.mobile-runs{display:grid;gap:8px}}
.error-item{display:grid;min-width:0;gap:6px;border:1px solid var(--color-border);border-radius:var(--radius-container);background:var(--color-surface-secondary);padding:14px}
.error-item strong{overflow-wrap:anywhere}
</style>
