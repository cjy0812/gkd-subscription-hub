import { createRouter, createWebHistory } from 'vue-router'
import ProjectsPage from './pages/ProjectsPage.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', name: 'projects', component: ProjectsPage },
    { path: '/:pathMatch(.*)*', redirect: '/projects' },
  ],
})
