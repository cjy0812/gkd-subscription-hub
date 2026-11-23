<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NText,
  type DataTableColumns,
} from 'naive-ui'
import { api } from '../api'
import { getAdminToken } from '../auth'
import AppIcon from '../components/AppIcon.vue'
import { buildProjectFileUrl, type ProjectFileRow } from '../project-files'
import type { ProjectsResponse } from '../types'

const projects = ref<ProjectsResponse['projects']>([])
const selectedProjectId = ref<number | null>(null)
const subscriptionDomain = ref('')
const searchQuery = ref('')
const loading = ref(false)
const loadError = ref('')

const selectedProject = computed(
  () => projects.value.find((project) => project.id === selectedProjectId.value) || null,
)
const files = computed<ProjectFileRow[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return (selectedProject.value?.distFiles || [])
    .filter((file) => !query || file.path.toLowerCase().includes(query))
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
})
const totalBytes = computed(() =>
  (selectedProject.value?.distFiles || []).reduce((total, file) => total + file.size, 0),
)
const projectOptions = computed(() =>
  projects.value.map((project) => ({
    label: `ID ${project.id} · ${project.owner}/${project.repo}`,
    value: project.id,
  })),
)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fileKind(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (!extension || extension === path.toLowerCase()) return '文件'
  return extension.toUpperCase()
}

function fileUrl(row: ProjectFileRow, mode: 'raw' | 'view'): string | null {
  if (!selectedProject.value) return null
  return buildProjectFileUrl(
    subscriptionDomain.value,
    selectedProject.value.id,
    row.path,
    mode,
  )
}

const columns: DataTableColumns<ProjectFileRow> = [
  {
    title: '文件路径',
    key: 'path',
    minWidth: 280,
    render: (row) => h('span', { class: 'file-path' }, row.path),
  },
  {
    title: '类型',
    key: 'kind',
    width: 100,
    render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => fileKind(row.path) }),
  },
  {
    title: '大小',
    key: 'size',
    width: 120,
    render: (row) => formatBytes(row.size),
  },
  {
    title: 'SHA',
    key: 'sha',
    width: 150,
    render: (row) => h('code', row.sha.slice(0, 12)),
  },
  {
    title: '操作',
    key: 'actions',
    width: 190,
    render: (row) => {
      const rawUrl = fileUrl(row, 'raw')
      const canPreview = /\.(md|json5)$/i.test(row.path)
      const previewUrl = canPreview ? fileUrl(row, 'view') : null
      return h(NSpace, { size: 8 }, {
        default: () => [
          previewUrl
            ? h('a', { href: previewUrl, target: '_blank', rel: 'noreferrer', class: 'file-action-link' }, [h(AppIcon, { name: 'file-text', size: 14 }), h('span', '浏览器预览')])
            : null,
          rawUrl
            ? h('a', { href: rawUrl, target: '_blank', rel: 'noreferrer', class: 'file-action-link' }, [h(AppIcon, { name: 'external-link', size: 14 }), h('span', '原始文件')])
            : h(NText, { depth: 3 }, { default: () => '路径暂不支持链接' }),
        ],
      })
    },
  },
]

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [result, config] = await Promise.all([
      api<ProjectsResponse>('/api/projects', getAdminToken()),
      api<{ subscriptionDomain: string }>('/api/config', getAdminToken()),
    ])
    projects.value = result.projects
    subscriptionDomain.value = config.subscriptionDomain
    if (!projects.value.some((project) => project.id === selectedProjectId.value)) {
      selectedProjectId.value = projects.value[0]?.id ?? null
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '读取文件索引失败'
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
        <p class="eyebrow">FILE CATALOG</p>
        <h1>文件管理</h1>
        <p class="muted">浏览已登记订阅源的 dist 文件索引与元信息。</p>
      </div>
      <n-button secondary :loading="loading" @click="load">
        <template #icon><AppIcon name="refresh-cw" /></template>
        重新读取
      </n-button>
    </header>

    <n-card :bordered="false" class="notice-card">
      <n-text depth="3">
        此页面只读取 KV 中已保存的文件索引，不会扫描 GitHub 或修改上游文件。JSON5/Markdown 可打开浏览器预览；原始文件链接由现有订阅分发路由提供。
      </n-text>
    </n-card>

    <n-card v-if="loadError" :bordered="false">
      <n-space vertical>
        <n-text type="error">{{ loadError }}</n-text>
        <n-button secondary @click="load">重试</n-button>
      </n-space>
    </n-card>

    <n-spin v-else :show="loading">
      <n-card :bordered="false" class="files-card">
        <n-space align="center" wrap>
          <n-select
            v-model:value="selectedProjectId"
            :options="projectOptions"
            placeholder="选择订阅项目"
            filterable
            clearable
            class="project-select"
          />
          <n-text depth="3" v-if="selectedProject">
            {{ selectedProject.distFiles.length }} 个文件 · {{ formatBytes(totalBytes) }}
          </n-text>
        </n-space>

        <template v-if="selectedProject">
          <div class="project-meta">
            <strong>{{ selectedProject.owner }}/{{ selectedProject.repo }}</strong>
            <span class="muted">分支：{{ selectedProject.branch }}</span>
            <span class="muted">索引 Commit：{{ selectedProject.commitSha || '未记录' }}</span>
          </div>
          <n-input
            v-model:value="searchQuery"
            clearable
            placeholder="按文件路径搜索"
            class="file-search"
          >
            <template #prefix><AppIcon name="search" /></template>
          </n-input>
          <n-data-table
            v-if="files.length"
            :columns="columns"
            :data="files"
            :row-key="(row) => row.path"
            :pagination="{ pageSize: 20 }"
            :scroll-x="850"
          />
          <n-empty v-else description="没有匹配的文件" />
        </template>
        <n-empty v-else-if="!projects.length" description="还没有登记订阅源" />
        <n-empty v-else description="请选择一个订阅项目" />
      </n-card>
    </n-spin>
  </div>
</template>

<style scoped>
.notice-card,
.files-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-card);
}

.notice-card {
  margin-bottom: 16px;
}

.project-select {
  width: min(440px, 100%);
}

.project-meta {
  display: grid;
  gap: 4px;
  margin: 18px 0;
  overflow-wrap: anywhere;
}

.file-search {
  max-width: 440px;
  margin-bottom: 16px;
}

.file-action-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  color: var(--color-accent);\n}\n\n.file-path {
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .project-select,
  .file-search {
    width: 100%;
    max-width: none;
  }
}
</style>
