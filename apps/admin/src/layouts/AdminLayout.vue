<script setup lang="ts">
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NTag,
} from 'naive-ui'
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearAdminToken } from '../auth'

const route = useRoute()
const router = useRouter()
const showMobileNav = ref(false)
const menuOptions = [
  { label: '仪表盘', key: '/dashboard' },
  { label: '订阅源管理', key: '/projects' },
  { label: '规则发现', key: '/explorer' },
]

function navigate(path: string) {
  showMobileNav.value = false
  if (path !== route.path) void router.push(path)
}

function logout() {
  clearAdminToken()
  void router.replace({ name: 'login' })
}
</script>

<template>
  <n-layout class="app-layout">
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
        <n-button quaternary size="small" @click="showMobileNav = true">菜单</n-button>
        <n-button quaternary size="small" @click="logout">退出</n-button>
      </div>
    </n-layout-header>
    <n-layout has-sider class="workspace">
      <n-layout-sider class="desktop-sidebar" bordered :width="224" :native-scrollbar="false">
        <div class="sidebar-caption">工作区</div>
        <n-menu :options="menuOptions" :value="route.path" @update:value="navigate" />
        <div class="sidebar-foot">GKD Subscription Hub</div>
      </n-layout-sider>
      <n-layout-content class="main-content">
        <router-view />
      </n-layout-content>
    </n-layout>
    <n-drawer v-model:show="showMobileNav" placement="left" :width="260">
      <n-drawer-content title="GKD Hub">
        <n-menu :options="menuOptions" :value="route.path" @update:value="navigate" />
      </n-drawer-content>
    </n-drawer>
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
.topbar-actions {
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
.sidebar-caption,
.sidebar-foot {
  color: var(--color-text-secondary);
}

.brand span,
.sidebar-caption {
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

.mobile-actions {
  display: none;
}

@media (max-width: 960px) {
  .desktop-sidebar {
    width: 190px !important;
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
}
</style>
