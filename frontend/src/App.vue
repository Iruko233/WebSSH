<template>
  <el-container class="app-layout">
    <el-main class="app-main no-nav">
      <div v-if="authStore.isInitialized" class="main-content-wrapper">
        <VaultSaveNotice v-if="authStore.isAuthenticated" />
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" v-if="!$route.meta.requiresAuth || authStore.isAuthenticated" />
          </transition>
        </router-view>
      </div>
      <div v-else class="loading-state">
        <el-icon class="is-loading loading-icon"><Loading /></el-icon>
        <p>{{ $t('app.wakingUp') }}</p>
      </div>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'
import VaultSaveNotice from './components/VaultSaveNotice.vue'
import { Loading } from '@element-plus/icons-vue'

const authStore = useAuthStore()
useSettingsStore()
const router = useRouter()

watch(() => authStore.isAuthenticated, authenticated => {
  if (!authenticated && router.currentRoute.value.meta.requiresAuth) void router.replace('/setup')
}, { flush: 'sync' })

onMounted(async () => {
  await authStore.initialize()
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--bg-primary);
}

.app-main.no-nav {
  padding: 0;
  height: 100vh;
  height: 100dvh;
}

.main-content-wrapper {
  max-width: 100%;
  margin: 0;
  height: 100%;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  color: var(--text-secondary);
}

.loading-icon {
  font-size: 32px;
  color: var(--color-primary);
  margin-bottom: 16px;
}

/* Page Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
