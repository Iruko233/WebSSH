<template>
  <div class="dashboard-wrapper termius-layout">
    <!-- Left Sidebar (Desktop) -->
    <aside class="sidebar hidden-mobile">
      <div class="sidebar-header">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="logo-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M4 15V9a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          </svg>
          <span class="logo-text">{{ $t('app.title') }}</span>
        </div>
        <el-button type="primary" :icon="Plus" circle size="small" @click="showAddServer = true" />
      </div>
      
      <div class="sidebar-content">
        <ServerList @connect="handleConnect" @edit="editServer" compact />
      </div>

      <div class="sidebar-footer">
        <el-button text class="footer-btn" @click="showSettings = true">
          <el-icon :size="20"><Setting /></el-icon>
        </el-button>
        <el-button text class="footer-btn" @click="showSecurity = true">
          <el-icon :size="20"><Key /></el-icon>
        </el-button>
        <el-button text class="footer-btn" @click="router.push('/about')">
          <el-icon :size="20"><Reading /></el-icon>
        </el-button>
        <el-button text class="footer-btn" @click="handleLogout">
          <el-icon :size="20"><Lock /></el-icon>
        </el-button>
      </div>
    </aside>

    <!-- Main Workspace -->
    <main class="workspace">
      <div v-if="terminalStore.tabs.length === 0" class="empty-state">
        <el-icon :size="48"><Monitor /></el-icon>
        <p>{{ $t('dashboard.noActiveSession') }}</p>
        <el-button type="primary" class="hidden-desktop mt-4" @click="showMobileSidebar = true" size="large">
          <el-icon class="mr-2"><Plus /></el-icon>
          {{ $t('dashboard.openServerList') }}
        </el-button>
      </div>
      
      <el-tabs 
        v-else
        v-model="terminalStore.activeTabId" 
        type="card" 
        class="terminal-tabs"
        closable
        @tab-remove="handleTabRemove"
      >
        <el-tab-pane
          v-for="tab in terminalStore.tabs"
          :key="tab.id"
          :name="tab.id"
        >
          <template #label>
            <div class="tab-label">
              <span class="status-dot"></span>
              {{ tab.title }}
            </div>
          </template>
          <!-- Using v-show inside the component wrapper if needed, but el-tab-pane handles keep-alive by default with DOM if not destroyed -->
          <div class="terminal-pane-inner">
            <Terminal :server-id="tab.serverId" :tab-id="tab.id" @toggle-sidebar="showMobileSidebar = true" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </main>

    <el-dialog 
      v-model="showAddServer" 
      :title="editingServer ? $t('serverForm.editTitle') : $t('serverForm.addTitle')"
      width="480px"
      destroy-on-close
      @closed="handleDialogClosed"
      class="server-dialog"
    >
      <ServerForm :server="editingServer" @success="handleFormSuccess" @cancel="showAddServer = false" />
    </el-dialog>

    <SettingsDialog v-model="showSettings" />
    <VaultSecurityDialog v-model="showSecurity" />

    <!-- Mobile Drawer Sidebar -->
    <el-drawer 
      v-model="showMobileSidebar" 
      direction="ltr" 
      size="80%" 
      :with-header="false" 
      class="mobile-sidebar-drawer hidden-desktop"
    >
      <div class="sidebar" style="width: 100%; height: 100%; border: none;">
        <div class="sidebar-header">
          <div class="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="logo-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M4 15V9a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
            </svg>
            <span class="logo-text">{{ $t('app.title') }}</span>
          </div>
          <el-button type="primary" :icon="Plus" circle size="small" @click="showAddServer = true" />
        </div>
        
        <div class="sidebar-content">
          <ServerList @connect="handleConnect" @edit="editServer" compact />
        </div>

        <div class="sidebar-footer">
          <el-button text class="footer-btn" @click="showSettings = true">
            <el-icon :size="20"><Setting /></el-icon>
          </el-button>
          <el-button text class="footer-btn" @click="showSecurity = true">
            <el-icon :size="20"><Key /></el-icon>
          </el-button>
          <el-button text class="footer-btn" @click="router.push('/about')">
            <el-icon :size="20"><Reading /></el-icon>
          </el-button>
          <el-button text class="footer-btn" @click="handleLogout">
            <el-icon :size="20"><Lock /></el-icon>
          </el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Monitor, Setting, Lock, Key, Reading } from '@element-plus/icons-vue'
import ServerList from '../components/ServerList.vue'
import ServerForm from '../components/ServerForm.vue'
import Terminal from '../components/Terminal.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import VaultSecurityDialog from '../components/VaultSecurityDialog.vue'
import { useTerminalStore } from '../stores/terminal'
import { useAuthStore } from '../stores/auth'
import type { DecryptedServer } from '../stores/server'

const terminalStore = useTerminalStore()
const authStore = useAuthStore()
const router = useRouter()

const showAddServer = ref(false)
const showSettings = ref(false)
const showSecurity = ref(false)
const showMobileSidebar = ref(false)
const editingServer = ref<DecryptedServer | null>(null)

let lastConnectTime = 0
const handleConnect = (serverId: string) => {
  const now = Date.now()
  if (now - lastConnectTime < 500) return // 500ms debounce for double-clicks
  lastConnectTime = now
  
  terminalStore.addTab(serverId)
  showMobileSidebar.value = false // Auto-close drawer on mobile when connected
}

const handleTabRemove = (targetName: string) => {
  terminalStore.removeTab(targetName)
}

const editServer = (server: DecryptedServer) => {
  editingServer.value = server
  showAddServer.value = true
}

const handleFormSuccess = () => {
  showAddServer.value = false
}

const handleDialogClosed = () => {
  editingServer.value = null
}

const handleLogout = () => {
  authStore.logout()
  router.push('/setup')
}
</script>

<style scoped>
.dashboard-wrapper.termius-layout {
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background-color: var(--bg-primary);
}

.sidebar {
  width: 280px;
  min-width: 280px;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

.logo-icon {
  width: 24px;
  height: 24px;
  color: var(--el-color-primary);
}

.logo-text {
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
}

.sidebar-footer {
  display: flex;
  justify-content: space-around;
  padding: 12px;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-secondary);
}

.footer-btn {
  flex: 1;
  height: 40px;
  color: var(--text-secondary);
}

.footer-btn:hover {
  color: var(--text-primary);
  background-color: rgba(255,255,255,0.05);
}

.workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.3s;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.empty-state p {
  margin-top: 16px;
  font-size: 1.125rem;
}

.terminal-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

:deep(.terminal-tabs > .el-tabs__header) {
  margin: 0;
  border-bottom: none !important;
  background-color: rgba(0, 0, 0, 0.2);
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__nav-wrap) {
  width: 100%;
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__nav-scroll) {
  display: flex;
  width: 100%;
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__nav) {
  border: none !important;
  border-radius: 0;
  display: flex;
  width: 100%;
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__item) {
  border: none !important;
  border-right: 1px solid rgba(255, 255, 255, 0.05) !important;
  color: var(--text-secondary);
  transition: background-color 0.2s, color 0.2s;
  height: 40px;
  line-height: 40px;
  background: transparent;
  flex: 1;
  text-align: center;
  padding: 0 16px;
  min-width: 80px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__item:hover) {
  background-color: rgba(255, 255, 255, 0.05);
}

:deep(.terminal-tabs > .el-tabs__header .el-tabs__item.is-active) {
  background-color: transparent !important;
  color: var(--el-color-primary) !important;
  border-bottom: 2px solid var(--el-color-primary) !important;
}

:deep(.terminal-tabs > .el-tabs__content) {
  flex: 1;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

:deep(.terminal-tabs .el-tab-pane) {
  height: 100%;
  width: 100%;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--el-color-success);
}

.terminal-pane-inner {
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
}
</style>
