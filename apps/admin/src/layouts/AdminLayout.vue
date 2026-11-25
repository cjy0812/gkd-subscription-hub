<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NButton, NDrawer, NDrawerContent, NIcon, NLayout, NLayoutContent, NLayoutHeader,
  NLayoutSider, NMenu, NTag,
} from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { clearAdminToken } from '../auth'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const showMobileNav = ref(false)
let edgeTouchStart: { x: number; y: number } | null = null

function onTouchStart(event: TouchEvent) {
  const touch = event.changedTouches[0]
  const edgeWidth = Math.min(48, Math.max(24, window.innerWidth * 0.08))
  edgeTouchStart = touch && touch.clientX <= edgeWidth ? { x: touch.clientX, y: touch.clientY } : null
}
function onTouchEnd(event: TouchEvent) {
  if (!edgeTouchStart) return
  const touch = event.changedTouches[0]
  if (touch && window.matchMedia('(max-width: 760px)').matches) {
    const deltaX = touch.clientX - edgeTouchStart.x
    const deltaY = Math.abs(touch.clientY - edgeTouchStart.y)
    if (deltaX >= 72 && deltaY <= 80) showMobileNav.value = true
  }
  edgeTouchStart = null
}
onMounted(() => {
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
})

const menuIcon = (name: 'layout-dashboard' | 'folder' | 'file-text' | 'activity' | 'search') => () =>
  h(NIcon, { size: 20 }, { default: () => h(AppIcon, { name, size: 20 }) })

const menuOptions = [
  { label: '仪表盘', key: '/admin/dashboard', icon: menuIcon('layout-dashboard') },
  { label: '订阅源管理', key: '/admin/projects', icon: menuIcon('folder') },
  { label: '文件管理', key: '/admin/files', icon: menuIcon('file-text') },
  { label: '运行监控', key: '/admin/monitoring', icon: menuIcon('activity') },
  { label: '规则发现', key: '/admin/explorer', icon: menuIcon('search') },
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
      <div class="mobile-menu">
        <n-button quaternary size="small" aria-label="打开导航菜单" title="菜单（也可从屏幕左边缘向右滑动）" @click="showMobileNav = true">
          <template #icon><AppIcon name="menu" /></template>
        </n-button>
      </div>
      <div class="brand">
        <div class="brand-mark small">G</div>
        <div><strong>GKD Hub</strong><span>Subscription Manager</span></div>
      </div>
      <div class="topbar-actions">
        <n-tag :bordered="false" type="success">Worker 在线管理</n-tag>
        <n-button quaternary size="small" title="退出登录" aria-label="退出登录" @click="logout">
          <template #icon><AppIcon name="log-out" /></template>
          <span class="logout-label">退出</span>
        </n-button>
      </div>
    </n-layout-header>
    <n-layout has-sider class="workspace" dir="ltr">
      <n-layout-sider class="desktop-sidebar" bordered :width="72" :native-scrollbar="false">
        <n-menu :options="menuOptions" :value="route.path" :collapsed="true" :collapsed-width="64" :collapsed-icon-size="20" @update:value="navigate" />
      </n-layout-sider>
      <n-layout-content class="main-content">
        <router-view />
      </n-layout-content>
    </n-layout>
    <n-drawer v-model:show="showMobileNav" placement="left" :width="280">
      <n-drawer-content title="GKD Hub">
        <n-menu :options="menuOptions" :value="route.path" @update:value="navigate" />
      </n-drawer-content>
    </n-drawer>
  </n-layout>
</template>

<style scoped>
.app-layout{min-height:100vh;background:var(--color-canvas)}
.topbar{display:flex;height:64px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--color-border);background:var(--color-surface);padding:0 24px}
.brand,.topbar-actions,.mobile-menu{display:flex;align-items:center}
.brand{gap:12px}.brand>div:last-child{display:grid;gap:1px}.brand strong{font-size:15px}
.brand span{color:var(--color-text-secondary);font-size:11px;letter-spacing:.08em}
.brand-mark{display:grid;width:42px;height:42px;place-items:center;border-radius:var(--radius-container);background:var(--color-accent);color:white;font-size:17px;font-weight:700}
.brand-mark.small{width:34px;height:34px;font-size:14px}
.topbar-actions{gap:16px}
.workspace{display:flex;flex-direction:row;direction:ltr;min-height:calc(100vh - 64px)}
.desktop-sidebar{flex:0 0 72px;width:72px;min-height:calc(100vh - 64px);background:var(--color-sidebar);padding:12px 4px}
.main-content{flex:1 1 auto;min-width:0}.mobile-menu{display:none}
@media(max-width:760px){
  .topbar{height:58px;justify-content:flex-start;padding:0 12px}
  .mobile-menu{display:flex;margin-right:8px}
  .topbar-actions{margin-left:auto;gap:0}
  .topbar-actions :deep(.n-tag),.logout-label{display:none}
  .workspace{min-height:calc(100vh - 58px)}
  .desktop-sidebar{display:none}
}
</style>
