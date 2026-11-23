<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NEmpty,
  NGrid,
  NGridItem,
  NStatistic,
  NSpace,
  NSpin,
  NTag,
  NText,
} from 'naive-ui'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { getAdminToken } from '../auth'
import type { Project, ProjectsResponse } from '../types'

const router = useRouter()
const projects = ref<Project[]>([])
const loading = ref(false)
const loadError = ref('')

const totalFiles = computed(() =>
  projects.value.reduce((total, project) => total + project.distFiles.length, 0),
)
const errorProjects = computed(() => projects.value.filter((project) => project.lastError))
const uncheckedCount = computed(
  () => projects.value.filter((project) => !project.lastCheckedAt && !project.lastError).length,
)
const recentProjects = computed(() =>
  projects.value
    .filter((project) => project.lastCheckedAt)
    .sort(
      (left, right) => Date.parse(right.lastCheckedAt || '') - Date.parse(left.lastCheckedAt || ''),
    )
    .slice(0, 5),
)

function projectStatus(project: Project) {
  if (project.lastError) return 'error'
  return project.lastCheckedAt ? 'normal' : 'unknown'
}

function statusLabel(project: Project) {
  const status = projectStatus(project)
  return status === 'error' ? '检查异常' : status === 'normal' ? '正常' : '未检查'
}

function statusType(project: Project): 'error' | 'success' | 'default' {
  const status = projectStatus(project)
  return status === 'error' ? 'error' : status === 'normal' ? 'success' : 'default'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api<ProjectsResponse>('/api/projects', getAdminToken())
    projects.value = result.projects
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '读取仪表盘数据失败'
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
        <p class="eyebrow">OVERVIEW</p>
        <h1>仪表盘</h1>
        <p class="muted">查看已登记订阅源的整体情况和最近检查记录。</p>
      </div>
      <n-space>
        <n-button secondary :loading="loading" @click="load">刷新数据</n-button>
        <n-button type="primary" @click="router.push('/projects')"> 管理订阅源 </n-button>
      </n-space>
    </header>

    <n-card v-if="loadError" :bordered="false">
      <n-text type="error">{{ loadError }}</n-text>
    </n-card>

    <n-spin v-else :show="loading">
      <n-grid cols="2 m:4" :x-gap="12" :y-gap="12" responsive="screen" class="stats-grid">
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="已登记项目" :value="projects.length" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="已索引文件" :value="totalFiles" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="检查异常" :value="errorProjects.length" />
          </n-card>
        </n-grid-item>
        <n-grid-item>
          <n-card class="stat-card" :bordered="false">
            <n-statistic label="尚未检查" :value="uncheckedCount" />
          </n-card>
        </n-grid-item>
      </n-grid>

      <n-card v-if="projects.length" :bordered="false" class="dashboard-card">
        <div class="section-heading">
          <div>
            <h2>最近检查</h2>
            <p class="muted">按项目记录中的最近检查时间排序，最多显示 5 条。</p>
          </div>
        </div>
        <div v-if="recentProjects.length" class="dashboard-list">
          <article v-for="project in recentProjects" :key="project.id" class="dashboard-list-item">
            <div class="dashboard-item-main">
              <strong> ID {{ project.id }} · {{ project.owner }}/{{ project.repo }} </strong>
              <span class="muted">分支：{{ project.branch }}</span>
              <span class="muted">
                最近检查：{{ new Date(project.lastCheckedAt || '').toLocaleString() }}
              </span>
              <n-text v-if="project.lastError" type="error">
                {{ project.lastError }}
              </n-text>
            </div>
            <n-tag :bordered="false" :type="statusType(project)">
              {{ statusLabel(project) }}
            </n-tag>
          </article>
        </div>
        <n-empty v-else description="暂无检查记录" />
      </n-card>

      <n-card v-if="projects.length" :bordered="false" class="dashboard-card">
        <div class="section-heading">
          <div>
            <h2>需要关注</h2>
            <p class="muted">以下项目最近一次检查记录包含错误。</p>
          </div>
          <n-tag :bordered="false" :type="errorProjects.length ? 'error' : 'success'">
            {{ errorProjects.length }} 个项目
          </n-tag>
        </div>
        <div v-if="errorProjects.length" class="dashboard-list">
          <article v-for="project in errorProjects" :key="project.id" class="dashboard-list-item">
            <div class="dashboard-item-main">
              <strong>ID {{ project.id }} · {{ project.owner }}/{{ project.repo }}</strong>
              <span class="muted">分支：{{ project.branch }}</span>
              <n-text type="error">{{ project.lastError }}</n-text>
            </div>
            <n-button size="small" secondary @click="router.push('/projects')"> 查看项目 </n-button>
          </article>
        </div>
        <n-empty v-else description="当前没有记录为异常的项目" />
      </n-card>

      <n-empty v-if="!projects.length && !loading && !loadError" description="还没有登记订阅源">
        <template #extra>
          <n-button type="primary" @click="router.push('/projects')"> 添加第一个订阅源 </n-button>
        </template>
      </n-empty>
    </n-spin>
  </div>
</template>

<style scoped>
.stats-grid {
  margin-bottom: 20px;
}

.stat-card,
.dashboard-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-card);
}

.dashboard-card {
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

.dashboard-list {
  display: grid;
  gap: 12px;
}

.dashboard-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  background: var(--color-surface-secondary);
  padding: 14px;
}

.dashboard-item-main {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.dashboard-item-main strong {
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .dashboard-list-item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
