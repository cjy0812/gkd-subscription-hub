import { createRouter, createWebHistory } from 'vue-router'
import { getAdminToken } from './auth'
import AdminLayout from './layouts/AdminLayout.vue'
import DashboardPage from './pages/DashboardPage.vue'
import ExplorerPage from './pages/ExplorerPage.vue'
import LoginPage from './pages/LoginPage.vue'
import MonitoringPage from './pages/MonitoringPage.vue'
import ProjectsPage from './pages/ProjectsPage.vue'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    {
      path: '/',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'dashboard' } },
        { path: 'dashboard', name: 'dashboard', component: DashboardPage },
        { path: 'projects', name: 'projects', component: ProjectsPage },
        { path: 'monitoring', name: 'monitoring', component: MonitoringPage },
        { path: 'explorer', name: 'explorer', component: ExplorerPage },
      ],
    },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/:pathMatch(.*)*', redirect: { name: 'projects' } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !getAdminToken()) return { name: 'login' }
  if (to.name === 'login' && getAdminToken()) return { name: 'projects' }
  return true
})

if (typeof window !== 'undefined') {
  window.addEventListener('gkd:auth-expired', () => {
    void router.replace({ name: 'login' })
  })
}

export default router
