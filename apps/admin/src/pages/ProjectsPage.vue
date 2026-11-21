<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useMessage, type DataTableColumns } from 'naive-ui'
import {
  NButton,
  NCard,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NModal,
  NSpace,
  NSpin,
  NStatistic,
  NTag,
  NText,
} from 'naive-ui'
import { api } from '../api'
import type { Project, ProjectsResponse, ProjectResponse } from '../types'

const message = useMessage()
const token = ref(sessionStorage.getItem('gkdtoken') || '')
const password = ref('')
const projects = ref<Project[]>([])
const repositoryUrl = ref('')
const groupName = ref('默认分组')
const subscriptionDomain = ref('')
const groupedProjects = computed(() => {
  const groups = new Map<string, Project[]>()
  for (const project of projects.value) {
    const name = project.group || '默认分组'
    groups.set(name, [...(groups.get(name) || []), project])
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
const loading = ref(false)
const submitting = ref(false)
const authenticated = ref(false)
const showAdd = ref(false)
const showMobileNav = ref(false)
const menuOptions = [{ label: '订阅源管理', key: 'projects' }]
const totalFiles = computed(() =>
  projects.value.reduce((sum, item) => sum + item.distFiles.length, 0),
)
function openSubscription(id: number) {
  if (subscriptionDomain.value)
    window.open('https://' + id + '.' + subscriptionDomain.value, '_blank', 'noopener,noreferrer')
}

const columns: DataTableColumns<Project> = [
  {
    title: '订阅源',
    key: 'repository',
    minWidth: 240,
    render: (row) =>
      h('div', { class: 'repo-cell' }, [
        h('strong', `ID ${row.id}`),
        h('span', `${row.owner}/${row.repo}`),
      ]),
  },
  { title: '分支', key: 'branch', width: 100 },
  { title: '文件数', key: 'files', width: 90, render: (row) => row.distFiles.length },
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
    width: 180,
    render: (row) =>
      h(
        NSpace,
        { size: 8 },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', secondary: true, onClick: () => refreshProject(row.id) },
              { default: () => '刷新' },
            ),
            h(
              NButton,
              {
                size: 'small',
                tertiary: true,
                type: 'error',
                onClick: () => removeProject(row.id),
              },
              { default: () => '删除' },
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
    subscriptionDomain.value = config.subscriptionDomain
    authenticated.value = true
    sessionStorage.setItem('gkdtoken', token.value)
  } catch (error) {
    authenticated.value = false
    token.value = ''
    sessionStorage.removeItem('gkdtoken')
    message.error(error instanceof Error ? error.message : '读取项目失败')
  } finally {
    loading.value = false
  }
}

async function login() {
  if (!password.value) {
    message.warning('请输入管理员密码')
    return
  }
  token.value = password.value
  await loadProjects()
  if (authenticated.value) message.success('登录成功')
}

function logout() {
  token.value = ''
  password.value = ''
  authenticated.value = false
  projects.value = []
  sessionStorage.removeItem('gkdtoken')
}

async function addProject() {
  if (!repositoryUrl.value.trim()) return
  submitting.value = true
  try {
    const result = await api<ProjectResponse>('/api/projects', token.value, {
      method: 'POST',
      body: JSON.stringify({
        url: repositoryUrl.value.trim(),
        group: groupName.value.trim() || '默认分组',
      }),
    })
    projects.value = [...projects.value, result.project].sort((a, b) => a.id - b.id)
    repositoryUrl.value = ''
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
  try {
    const result = await api<ProjectResponse>(`/api/projects/${id}/refresh`, token.value, {
      method: 'POST',
    })
    projects.value = projects.value.map((item) => (item.id === id ? result.project : item))
    message.success(`ID ${id} 已刷新`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新失败')
  }
}

async function removeProject(id: number) {
  if (!window.confirm(`确定删除订阅 ID ${id} 的项目元数据吗？`)) return
  try {
    await api(`/api/projects/${id}`, token.value, { method: 'DELETE' })
    projects.value = projects.value.filter((item) => item.id !== id)
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
  <main v-if="!authenticated" class="login-page">
    <n-card class="login-card" :bordered="false">
      <div class="brand-mark">GKD</div>
      <p class="eyebrow">SUBSCRIPTION HUB</p>
      <h1>管理中心</h1>
      <p class="muted">登录后管理订阅源、检查上游更新。</p>
      <n-form @submit.prevent="login">
        <n-form-item label="管理员密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="输入 ADMIN_PASSWORD"
            @keyup.enter="login"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" @click="login">登录</n-button>
      </n-form>
    </n-card>
  </main>

  <n-layout v-else class="app-layout">
    <n-layout-header class="topbar">
      <div class="brand">
        <div class="brand-mark small">G</div>
        <div><strong>GKD Hub</strong><span>Subscription Manager</span></div>
      </div>
      <div class="topbar-actions">
        <n-tag :bordered="false" type="success">Worker 在线管理</n-tag>
        <n-button quaternary size="small" @click="logout">退出</n-button>
      </div>
      <div class="mobile-actions">
        <n-button quaternary size="small" @click="showMobileNav = true">菜单</n-button
        ><n-button quaternary size="small" @click="logout">退出</n-button>
      </div>
    </n-layout-header>

    <n-layout has-sider class="workspace">
      <n-layout-sider class="desktop-sidebar" bordered :width="224" :native-scrollbar="false">
        <div class="sidebar-caption">工作区</div>
        <n-menu :options="menuOptions" :value="'projects'" />
        <div class="sidebar-foot">GKD Subscription Hub</div>
      </n-layout-sider>
      <n-layout-content class="main-content">
        <div class="page-content">
          <header class="page-heading">
            <div>
              <p class="eyebrow">OVERVIEW</p>
              <h1>订阅源管理</h1>
              <p class="muted">管理 GitHub 仓库索引，并查看订阅源分发状态。</p>
            </div>
            <n-button type="primary" @click="showAdd = true">添加订阅源</n-button>
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
                ><n-statistic label="自动检查周期" :value="6" suffix="小时" /></n-card
            ></n-grid-item>
          </n-grid>

          <n-card class="projects-card" :bordered="false">
            <div class="section-heading">
              <div>
                <h2>项目列表</h2>
                <p class="muted">每个项目对应一个 GKD 订阅 ID。</p>
              </div>
              <n-button secondary :loading="loading" @click="loadProjects">刷新列表</n-button>
            </div>
            <n-spin :show="loading">
              <section v-for="group in groupedProjects" :key="group.name" class="project-group">
                <div class="group-heading">
                  <h3>{{ group.name }}</h3>
                  <n-tag size="small" :bordered="false">{{ group.items.length }} 个项目</n-tag>
                </div>
                <div class="desktop-table">
                  <n-data-table :columns="columns" :data="group.items" :row-key="(row) => row.id" />
                </div>
                <div class="mobile-project-list">
                  <article
                    v-for="project in group.items"
                    :key="project.id"
                    class="mobile-project-card"
                  >
                    <div class="mobile-project-title">
                      <strong>ID {{ project.id }}</strong>
                      <n-tag size="small" :bordered="false" type="success"
                        >{{ project.distFiles.length }} 个文件</n-tag
                      >
                    </div>
                    <p>{{ project.owner }}/{{ project.repo }}</p>
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
                      <n-button size="small" secondary @click="refreshProject(project.id)"
                        >立即刷新</n-button
                      >
                      <n-button size="small" @click="openSubscription(project.id)"
                        >打开订阅</n-button
                      >
                      <n-button
                        size="small"
                        tertiary
                        type="error"
                        @click="removeProject(project.id)"
                        >删除</n-button
                      >
                    </n-space>
                  </article>
                </div>
              </section>
              <n-empty
                v-if="!projects.length && !loading"
                description="还没有订阅源，添加一个 GitHub 仓库开始使用。"
              />
            </n-spin>
          </n-card>
        </div>
      </n-layout-content>
    </n-layout>

    <n-drawer v-model:show="showMobileNav" placement="left" :width="260">
      <n-drawer-content title="GKD Hub">
        <n-menu :options="menuOptions" :value="'projects'" @update:value="showMobileNav = false" />
      </n-drawer-content>
    </n-drawer>

    <n-modal v-model:show="showAdd" preset="card" title="添加订阅源" class="add-modal">
      <n-form @submit.prevent="addProject">
        <n-form-item label="GitHub 仓库地址">
          <n-input
            v-model:value="repositoryUrl"
            placeholder="https://github.com/owner/repo"
            clearable
            @keyup.enter="addProject"
          />
        </n-form-item>
        <n-form-item label="所属分组">
          <n-input
            v-model:value="groupName"
            placeholder="例如：常用订阅、测试订阅"
            maxlength="40"
          />
        </n-form-item>
        <p class="muted form-hint">仅支持公开、未归档且包含 dist/ 的 GitHub 仓库。</p>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="submitting" @click="addProject">验证并添加</n-button>
        </n-space>
      </n-form>
    </n-modal>
  </n-layout>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: var(--color-canvas);
}
.topbar {
  display: flex;
  height: 64px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  padding: 0 24px;
}
.brand,
.topbar-actions,
.page-heading,
.section-heading,
.mobile-project-title {
  display: flex;
  align-items: center;
}
.brand {
  gap: 12px;
}
.brand > div:last-child {
  display: grid;
  gap: 1px;
}
.brand strong {
  font-size: 15px;
}
.brand span,
.muted,
.sidebar-caption,
.sidebar-foot,
.mobile-project-card small {
  color: var(--color-text-secondary);
}
.brand span,
.sidebar-caption,
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
}
.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: var(--radius-container);
  background: var(--color-accent);
  color: white;
  font-size: 17px;
  font-weight: 700;
}
.brand-mark.small {
  width: 34px;
  height: 34px;
  font-size: 14px;
}
.topbar-actions {
  gap: 16px;
}
.workspace {
  min-height: calc(100vh - 64px);
}
.desktop-sidebar {
  position: relative;
  min-height: calc(100vh - 64px);
  background: var(--color-sidebar);
  padding: 20px 12px;
}
.sidebar-caption {
  padding: 4px 12px 12px;
  text-transform: uppercase;
}
.sidebar-foot {
  position: absolute;
  right: 12px;
  bottom: 18px;
  left: 24px;
  font-size: 11px;
}
.main-content {
  min-width: 0;
}
.page-heading {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}
.page-heading h1,
.login-card h1 {
  margin: 4px 0 6px;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.eyebrow {
  margin: 0;
  color: var(--color-accent);
  font-weight: 700;
}
.stats-grid {
  margin-bottom: 20px;
}
.stat-card,
.projects-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-card);
}
.section-heading {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.section-heading h2 {
  margin: 0 0 4px;
  font-size: 17px;
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
.section-heading p {
  margin: 0;
}
.repo-cell {
  display: grid;
  gap: 3px;
}
.repo-cell span {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mobile-project-list,
.mobile-actions {
  display: none;
}
.add-modal {
  width: min(560px, calc(100vw - 32px));
}
.form-hint {
  margin: -4px 0 18px;
  font-size: 12px;
}
.login-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(ellipse at 15% 15%, rgb(37 99 235 / 9%), transparent 42%), var(--color-canvas);
}
.login-card {
  width: min(420px, 100%);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-large);
  box-shadow: var(--shadow-overlay);
}
.login-card .brand-mark {
  margin-bottom: 18px;
}
.login-card .muted {
  margin: 0 0 24px;
}
@media (max-width: 960px) {
  .desktop-sidebar {
    width: 190px !important;
  }
  .page-content {
    padding: 20px;
  }
}
@media (max-width: 760px) {
  .topbar {
    height: 58px;
    padding: 0 16px;
  }
  .topbar-actions,
  .desktop-sidebar {
    display: none;
  }
  .mobile-actions {
    display: flex;
    gap: 4px;
  }
  .workspace {
    min-height: calc(100vh - 58px);
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .page-heading h1 {
    font-size: 23px;
  }
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
    justify-content: space-between;
  }
  .mobile-project-card p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mobile-project-card small {
    font-size: 12px;
  }
}
</style>
