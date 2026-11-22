import { createRouter, createWebHistory } from 'vue-router'
import ExplorerPage from './pages/ExplorerPage.vue'
import ProjectsPage from './pages/ProjectsPage.vue'

export default createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', name: 'projects', component: ProjectsPage },
    { path: '/explorer', name: 'explorer', component: ExplorerPage },
    { path: '/:pathMatch(.*)*', redirect: '/projects' },
  ],
})
