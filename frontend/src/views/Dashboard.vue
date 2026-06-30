<template>
  <div class="dashboard-wrapper termius-layout">
    <!-- Left Sidebar (Desktop) -->
    <aside class="sidebar hidden-mobile">
      <div class="sidebar-header">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="logo-icon">
            <rect x="2" y="3" width="20" height="18" rx="4" ry="4" />
            <polyline points="7 8 12 12 7 16" />
            <line x1="14" y1="16" x2="18" y2="16" />
          </svg>
          <span class="logo-text">{{ $t('app.title') }}</span>
        </div>
        <div class="sidebar-actions">
          <el-tooltip :content="$t('serverForm.addTitle') || 'Add'" placement="bottom" :show-after="500">
            <button class="header-action-btn" @click="showAddServer = true">
              <el-icon><Plus /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip :content="$t('dashboard.batchSelect') || 'Batch'" placement="bottom" :show-after="500">
            <button class="header-action-btn" :class="{ 'is-active': isSelectMode }" @click="toggleSelectMode">
              <el-icon><Operation /></el-icon>
            </button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="handleManageCommand">
            <button class="header-action-btn">
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="import" :icon="Download">{{ $t('dashboard.importServers') || '导入配置' }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      
      <!-- Batch Action Toolbar -->
      <div class="batch-toolbar" v-if="isSelectMode">
        <el-checkbox 
          :model-value="isAllSelected" 
          :indeterminate="isIndeterminate" 
          @change="handleSelectAll"
          class="batch-checkbox"
        >
          {{ $t('dashboard.selectAll') || '全选' }} ({{ selectedServerIds.size }})
        </el-checkbox>
        <div class="batch-toolbar-actions">
          <el-tooltip :content="$t('dashboard.exportSelected') || 'Export'" placement="bottom" :show-after="500">
            <el-button size="small" text :icon="Upload" :disabled="selectedServerIds.size === 0" @click="handleExportSelected" />
          </el-tooltip>
          <el-tooltip :content="$t('serverList.deleteBtn') || 'Delete'" placement="bottom" :show-after="500">
            <el-button size="small" type="danger" text :icon="Delete" :disabled="selectedServerIds.size === 0" @click="handleBatchDelete" />
          </el-tooltip>
        </div>
      </div>

      <div class="sidebar-content">
        <ServerList 
          @connect="handleConnect" 
          @edit="editServer" 
          :is-select-mode="isSelectMode"
          v-model:selected-ids="selectedServerIds"
          compact 
        />
      </div>

      <div class="sidebar-footer">
        <el-button text class="footer-btn" @click="showSettings = true">
          <el-icon :size="20"><Setting /></el-icon>
        </el-button>
        <el-button text class="footer-btn" @click="showSecurity = true">
          <el-icon :size="20"><Key /></el-icon>
        </el-button>
        <el-button text class="footer-btn" @click="showAbout = true">
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
    <AboutDialog v-model="showAbout" />

    <!-- File Input for Import -->
    <input type="file" ref="fileInput" accept=".json,.csv" style="display: none" @change="handleFileImport">

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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="logo-icon">
              <rect x="2" y="3" width="20" height="18" rx="4" ry="4" />
              <polyline points="7 8 12 12 7 16" />
              <line x1="14" y1="16" x2="18" y2="16" />
            </svg>
            <span class="logo-text">{{ $t('app.title') }}</span>
          </div>
          <div class="sidebar-actions">
            <el-tooltip :content="$t('serverForm.addTitle') || 'Add'" placement="bottom" :show-after="500">
              <button class="header-action-btn" @click="showAddServer = true">
                <el-icon><Plus /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip :content="$t('dashboard.batchSelect') || 'Batch'" placement="bottom" :show-after="500">
              <button class="header-action-btn" :class="{ 'is-active': isSelectMode }" @click="toggleSelectMode">
                <el-icon><Operation /></el-icon>
              </button>
            </el-tooltip>
            <el-dropdown trigger="click" @command="handleManageCommand">
              <button class="header-action-btn">
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="import" :icon="Download">{{ $t('dashboard.importServers') || '导入配置' }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
        
        <!-- Batch Action Toolbar -->
        <div class="batch-toolbar" v-if="isSelectMode">
          <el-checkbox 
            :model-value="isAllSelected" 
            :indeterminate="isIndeterminate" 
            @change="handleSelectAll"
            class="batch-checkbox"
          >
            {{ $t('dashboard.selectAll') || '全选' }} ({{ selectedServerIds.size }})
          </el-checkbox>
          <div class="batch-toolbar-actions">
            <el-tooltip :content="$t('dashboard.exportSelected') || 'Export'" placement="bottom" :show-after="500">
              <el-button size="small" text :icon="Upload" :disabled="selectedServerIds.size === 0" @click="handleExportSelected" />
            </el-tooltip>
            <el-tooltip :content="$t('serverList.deleteBtn') || 'Delete'" placement="bottom" :show-after="500">
              <el-button size="small" type="danger" text :icon="Delete" :disabled="selectedServerIds.size === 0" @click="handleBatchDelete" />
            </el-tooltip>
          </div>
        </div>

        <div class="sidebar-content">
          <ServerList 
            @connect="handleConnect" 
            @edit="editServer" 
            :is-select-mode="isSelectMode"
            v-model:selected-ids="selectedServerIds"
            compact 
          />
        </div>

        <div class="sidebar-footer">
          <el-button text class="footer-btn" @click="showSettings = true">
            <el-icon :size="20"><Setting /></el-icon>
          </el-button>
          <el-button text class="footer-btn" @click="showSecurity = true">
            <el-icon :size="20"><Key /></el-icon>
          </el-button>
          <el-button text class="footer-btn" @click="showAbout = true">
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Monitor, Setting, Lock, Key, Reading, Operation, Upload, Download, Delete, MoreFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import ServerList from '../components/ServerList.vue'
import ServerForm from '../components/ServerForm.vue'
import Terminal from '../components/Terminal.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import VaultSecurityDialog from '../components/VaultSecurityDialog.vue'
import AboutDialog from '../components/AboutDialog.vue'
import { useTerminalStore } from '../stores/terminal'
import { useAuthStore } from '../stores/auth'
import { useServerStore } from '../stores/server'
import type { DecryptedServer } from '../stores/server'

const terminalStore = useTerminalStore()
const authStore = useAuthStore()
const serverStore = useServerStore()
const router = useRouter()
const { t } = useI18n()

const showAddServer = ref(false)
const showSettings = ref(false)
const showSecurity = ref(false)
const showAbout = ref(false)
const showMobileSidebar = ref(false)
const editingServer = ref<DecryptedServer | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const isSelectMode = ref(false)
const selectedServerIds = ref<Set<string>>(new Set())

const isAllSelected = computed(() => serverStore.servers.length > 0 && selectedServerIds.value.size === serverStore.servers.length)
const isIndeterminate = computed(() => selectedServerIds.value.size > 0 && selectedServerIds.value.size < serverStore.servers.length)

const handleSelectAll = (val: boolean | string | number) => {
  if (val) {
    selectedServerIds.value = new Set(serverStore.servers.map(s => s.id))
  } else {
    selectedServerIds.value.clear()
  }
}

const toggleSelectMode = () => {
  isSelectMode.value = !isSelectMode.value
  if (!isSelectMode.value) {
    selectedServerIds.value.clear()
  }
}

const handleManageCommand = (command: string) => {
  if (command === 'import') {
    fileInput.value?.click()
  }
}

const handleExportSelected = () => {
  if (selectedServerIds.value.size === 0) return
  try {
    serverStore.exportServersJSON(Array.from(selectedServerIds.value))
    ElMessage.success(t('dashboard.exportSuccess') || 'Export successful')
    isSelectMode.value = false
    selectedServerIds.value.clear()
  } catch (err: any) {
    ElMessage.error(err.message || 'Failed to export')
  }
}

const handleFileImport = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const content = e.target?.result as string
      let jsonStr = content
      if (file.name.endsWith('.csv')) {
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
        const servers = lines.slice(1).map(line => {
          const parts = line.split(',').map(p => p.trim())
          const [group, name, host, port, username, password] = parts
          return { group, name, host, port, username, password }
        })
        jsonStr = JSON.stringify(servers)
      }

      // Check conflicts
      const result = await serverStore.importServersJSON(jsonStr, 'dry-run')
      if (result.conflicts > 0) {
        ElMessageBox.confirm(
          t('dashboard.importConflictMsg', { count: result.total, conflicts: result.conflicts }) || `Found ${result.conflicts} conflicting servers. How do you want to proceed?`,
          t('dashboard.importConflictTitle') || 'Import Conflicts',
          {
            distinguishCancelAndClose: true,
            confirmButtonText: t('dashboard.overwriteBtn') || 'Overwrite',
            cancelButtonText: t('dashboard.skipBtn') || 'Skip Conflicting',
            type: 'warning'
          }
        ).then(async () => {
          // Overwrite
          await serverStore.importServersJSON(jsonStr, 'overwrite')
          ElMessage.success(t('dashboard.importSuccess', { count: result.total }) || `Successfully imported ${result.total} servers`)
        }).catch(async (action) => {
          if (action === 'cancel') {
            // Skip
            await serverStore.importServersJSON(jsonStr, 'skip')
            ElMessage.success(t('dashboard.importSuccess', { count: result.total - result.conflicts }) || `Successfully imported ${result.total - result.conflicts} servers`)
          }
        })
      } else {
        await serverStore.importServersJSON(jsonStr, 'overwrite')
        ElMessage.success(t('dashboard.importSuccess', { count: result.total }) || `Successfully imported ${result.total} servers`)
      }
    } catch (err: any) {
      ElMessage.error(err.message || 'Failed to import')
    } finally {
      if (target) target.value = ''
    }
  }
  reader.readAsText(file)
}

const handleBatchDelete = () => {
  if (selectedServerIds.value.size === 0) return
  ElMessageBox.confirm(
    t('dashboard.batchDeleteConfirm', { count: selectedServerIds.value.size }),
    t('dashboard.batchDeleteTitle', 'Delete Servers'),
    {
      confirmButtonText: t('serverList.deleteBtn') || 'Delete',
      cancelButtonText: t('serverList.cancelBtn') || 'Cancel',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(async () => {
    try {
      await serverStore.batchDeleteServers(Array.from(selectedServerIds.value))
      ElMessage.success(t('dashboard.batchDeleteSuccess', 'Servers deleted'))
      isSelectMode.value = false
      selectedServerIds.value.clear()
    } catch (err: any) {
      ElMessage.error(err.message || 'Failed to delete servers')
    }
  }).catch(() => {})
}

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

.sidebar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.header-action-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: rgba(128, 128, 128, 0.1);
  color: var(--text-secondary);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  cursor: pointer;
  outline: none;
  font-size: 16px;
}

.header-action-btn:hover {
  background-color: rgba(var(--el-color-primary-rgb), 0.15);
  color: var(--el-color-primary);
  transform: translateY(-1px);
}

.header-action-btn.is-active, 
.header-action-btn.primary {
  background-color: rgba(var(--el-color-primary-rgb), 0.1);
  color: var(--el-color-primary);
}

.header-action-btn.primary:hover {
  background-color: var(--el-color-primary);
  color: #ffffff;
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
  align-items: center;
  padding: 12px;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-secondary);
  height: 64px;
  box-sizing: border-box;
}

.batch-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.batch-checkbox {
  margin-right: 12px;
}

.batch-toolbar-actions {
  display: flex;
  gap: 8px;
}

.batch-toolbar-actions .el-button {
  margin: 0;
}

.btn-text {
  margin-left: 4px;
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
