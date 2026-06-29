import { createRouter, createWebHistory } from 'vue-router'
import VaultSetup from '../views/VaultSetup.vue'
import Dashboard from '../views/Dashboard.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/setup',
      name: 'VaultSetup',
      component: VaultSetup
    },
    {
      path: '/about',
      name: 'About',
      component: () => import('../views/About.vue')
    },
    {
      path: '/',
      name: 'Dashboard',
      component: Dashboard,
      meta: { requiresAuth: true }
    }
  ]
})

router.beforeEach(async (to, _from) => {
  const authStore = useAuthStore()
  
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // If vault exists but not unlocked, authStore status check should redirect them
    // to unlock flow, otherwise to create flow
    await authStore.checkStatus()
    if (!authStore.isAuthenticated) {
      return { name: 'VaultSetup' }
    }
  } else if (to.name === 'VaultSetup' && authStore.isAuthenticated) {
    return { name: 'Dashboard' }
  }
})

export default router
