<script setup lang="ts">
import { h, ref } from 'vue'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NIcon,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NTag,
} from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { clearAdminToken } from '../auth'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const showMobileNav = ref(false)

const menuIcon = (name: string) => () =>
  h(NIcon, { size: 20 }, { default: () => h(AppIcon, { name, size: 20 }) })

const menuOptions = [
  { label: '仪表盘', key: '/dashboard', icon: menuIcon('layout-dashboard') },
  { label: '订阅源管理', key: '/projects', icon: menuIcon('folder') },
  { label: '文件管理', key: '/files', icon: menuIcon('file-text') },
  { label: '运行监控', key: '/monitoring', icon: menuIcon('activity') },
  { label: '规则发现', key: '/explorer', icon: menuIcon('search') },
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
  <n-layout class="app-layout" dir="ltr">
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
    <n-layout has-sider class="workspace" dir="ltr">
      <n-layout-sider
        class="desktop-sidebar"
        bordered
        :width="72"
        :native-scrollbar="false"
      >
        <n-menu
          :options="menuOptions"
          :value="route.path"
          :collapsed="true"
          :collapsed-width="64"
          :collapsed-icon-size="20"
          @update:value="navigate"
        />
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

.brand span {
  color: var(--color-text-secondary);
}

.brand span {
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
  display: flex;
  flex-direction: row;
  direction: ltr;
  min-height: calc(100vh - 64px);
}

.desktop-sidebar {
  flex: 0 0 72px;
  width: 72px;
  min-height: calc(100vh - 64px);
  background: var(--color-sidebar);
  padding: 12px 4px;
}

.main-content {
  flex: 1 1 auto;
  min-width: 0;
}

.mobile-actions {
  display: none;
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
