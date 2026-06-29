<template>
  <div class="file-manager" v-loading="loading">
    <div class="fm-header">
      <div class="fm-path-bar">
        <el-button size="small" :icon="Top" @click="goUp" circle title="Go Up" />
        <el-input 
          v-model="inputPath" 
          size="small" 
          @keyup.enter="navigateTo(inputPath)" 
          style="margin-left: 8px; width: 100%;"
        >
          <template #prefix>
            <el-icon><Folder /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="fm-actions">
        <el-button size="small" :icon="Refresh" circle @click="refresh" />
        <el-button size="small" :icon="FolderAdd" circle @click="promptMkdir" />
        <el-button size="small" :icon="DocumentAdd" circle @click="promptCreate" />
        <el-button size="small" :icon="Upload" circle @click="() => fileInput?.click()" />
        <input type="file" ref="fileInput" style="display: none" @change="handleFileSelect" multiple />
      </div>
    </div>

    <el-table
      :data="files"
      style="width: 100%"
      height="100%"
      class="fm-table"
      @row-dblclick="handleRowDblClick"
      @row-contextmenu="handleContextMenu"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <el-table-column :label="$t('fileManager.name')" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <div class="file-name-cell">
            <el-icon class="file-icon" :color="row.isDir ? '#E6A23C' : '#909399'">
              <Folder v-if="row.isDir" />
              <Document v-else />
            </el-icon>
            <span>{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="$t('fileManager.size')" width="100">
        <template #default="{ row }">
          {{ row.isDir ? '--' : formatSize(row.size) }}
        </template>
      </el-table-column>
      <el-table-column :label="$t('fileManager.date')" width="160">
        <template #default="{ row }">
          {{ formatDate(row.modTime) }}
        </template>
      </el-table-column>
      <el-table-column width="100" align="right">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="(cmd: string) => handleCommand(cmd, row)">
            <el-button link :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="download" :icon="Download" v-if="!row.isDir">{{ $t('fileManager.download') }}</el-dropdown-item>
                <el-dropdown-item command="rename" :icon="Edit">{{ $t('fileManager.rename') }}</el-dropdown-item>
                <el-dropdown-item command="delete" :icon="Delete" class="danger">{{ $t('fileManager.delete') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <!-- Inline Editor Dialog -->
    <el-dialog v-model="editorVisible" :title="editingFileName" width="80%" top="5vh" class="editor-dialog" destroy-on-close>
      <div class="monaco-container">
        <vue-monaco-editor
          v-model:value="editorContent"
          theme="vs-dark"
          :language="editorLanguage"
          :options="editorOptions"
        />
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="editorVisible = false">{{ $t('fileManager.cancel') }}</el-button>
          <el-button type="primary" @click="saveFile" :loading="saving">{{ $t('fileManager.save') }}</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- Context Menu -->
    <ul
      v-show="contextMenuVisible"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
      class="context-menu"
      @click.stop
    >
      <li @click="handleCommand('download', contextMenuRow!)" v-if="!contextMenuRow?.isDir">
        <el-icon><Download /></el-icon> {{ $t('fileManager.download') }}
      </li>
      <li @click="handleCommand('rename', contextMenuRow!)">
        <el-icon><Edit /></el-icon> {{ $t('fileManager.rename') }}
      </li>
      <li class="danger" @click="handleCommand('delete', contextMenuRow!)">
        <el-icon><Delete /></el-icon> {{ $t('fileManager.delete') }}
      </li>
    </ul>

    <!-- Transfers Panel -->
    <div v-if="activeTransfers.length > 0" class="transfers-panel">
      <div v-for="t in activeTransfers" :key="t.id" class="transfer-item">
        <div class="transfer-info">
          <span>{{ t.type === 'upload' ? $t('fileManager.uploading', { name: t.name, progress: t.progress }) : $t('fileManager.downloading', { name: t.name, progress: t.progress }) }}</span>
          <span v-if="t.speed" class="transfer-speed">{{ t.speed }}</span>
        </div>
        <el-progress :percentage="t.progress" :show-text="false" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import '../lib/monaco-setup'
import { SSHConnection } from '../lib/ssh-client'
import type { FileInfo } from '../lib/ssh-client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Folder, Document, Refresh, 
  FolderAdd, DocumentAdd, MoreFilled, Edit, Delete, Upload, Download, Top
} from '@element-plus/icons-vue'

const props = defineProps<{
  sshConn: SSHConnection
  initialPath: string
}>()

const { t } = useI18n()

const loading = ref(false)
const files = ref<FileInfo[]>([])
const currentPath = ref('/root')
const inputPath = ref('/root')

// Editor state
const editorVisible = ref(false)
const editorContent = ref('')
const editingFilePath = ref('')
const editingFileName = ref('')
const editingFileModTime = ref(0)
const saving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

interface Transfer {
  id: string
  name: string
  type: 'upload' | 'download'
  progress: number
  speed?: string
}
const activeTransfers = ref<Transfer[]>([])

// Context menu state
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuRow = ref<FileInfo | null>(null)

const handleContextMenu = (row: FileInfo, _column: any, event: MouseEvent) => {
  event.preventDefault()
  contextMenuRow.value = row
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

const closeContextMenu = () => {
  contextMenuVisible.value = false
}

onMounted(() => {
  currentPath.value = props.initialPath
  inputPath.value = props.initialPath
  document.addEventListener('click', closeContextMenu)
  refresh()
})

watch(() => props.initialPath, (newVal) => {
  currentPath.value = newVal
  inputPath.value = newVal
  refresh()
})

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu)
})

const resolvePath = (part: string) => {
  if (currentPath.value === '/') return `/${part}`
  return `${currentPath.value}/${part}`
}

const refresh = async () => {
  loading.value = true
  try {
    const list = await props.sshConn.sftpList(currentPath.value)
    // Sort directories first, then alphabetically
    files.value = list.sort((a: FileInfo, b: FileInfo) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
  } catch (err: any) {
    ElMessage.error(t('fileManager.listFailed', { msg: err.message }))
    if (currentPath.value !== '/') {
      currentPath.value = '/' // fallback
      refresh()
    }
  } finally {
    loading.value = false
  }
}

const navigateTo = (path: string) => {
  if (!path) path = '/'
  if (!path.startsWith('/')) path = '/' + path
  currentPath.value = path
  inputPath.value = path
  refresh()
}

const goUp = () => {
  if (currentPath.value === '/') return
  const parts = currentPath.value.split('/').filter(p => p)
  parts.pop()
  navigateTo('/' + parts.join('/'))
}

const handleRowDblClick = async (row: FileInfo) => {
  if (row.isDir) {
    navigateTo(resolvePath(row.name))
  } else {
    if (row.size > 500 * 1024) {
      ElMessage.warning(t('fileManager.tooLarge'))
      return
    }
    // Open file editor
    const path = resolvePath(row.name)
    loading.value = true
    try {
      const content = await props.sshConn.sftpRead(path)
      editorContent.value = content
      editingFilePath.value = path
      editingFileName.value = row.name
      editingFileModTime.value = row.modTime
      editorVisible.value = true
    } catch (err: any) {
      ElMessage.error(t('fileManager.readFailed', { msg: err.message }))
    } finally {
      loading.value = false
    }
  }
}

const saveFile = async () => {
  saving.value = true
  try {
    const stat = await props.sshConn.sftpStat(editingFilePath.value)
    if (stat.modTime > editingFileModTime.value) {
      await ElMessageBox.confirm(
        t('fileManager.fileChangedOnServer'),
        t('fileManager.warning'),
        { type: 'warning', confirmButtonText: t('fileManager.overwrite'), cancelButtonText: t('fileManager.cancel') }
      )
    }
    await props.sshConn.sftpWrite(editingFilePath.value, editorContent.value)
    ElMessage.success(t('fileManager.saved'))
    editorVisible.value = false
    refresh()
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error(t('fileManager.saveFailed', { msg: err.message }))
    }
  } finally {
    saving.value = false
  }
}

const promptMkdir = async () => {
  try {
    const { value } = await ElMessageBox.prompt(t('fileManager.folderName'), t('fileManager.newFolder'))
    if (!value) return
    await props.sshConn.sftpMkdir(resolvePath(value))
    refresh()
  } catch (e) {
    // cancelled
  }
}

const promptCreate = async () => {
  try {
    const { value } = await ElMessageBox.prompt(t('fileManager.fileName'), t('fileManager.newFile'))
    if (!value) return
    await props.sshConn.sftpCreate(resolvePath(value))
    refresh()
  } catch (e) {
    // cancelled
  }
}

const handleCommand = async (cmd: string, row: FileInfo) => {
  closeContextMenu()
  const path = resolvePath(row.name)
  if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(t('fileManager.deleteConfirm', { name: row.name }), t('fileManager.warning'), { type: 'warning' })
      loading.value = true
      await props.sshConn.sftpRemove(path)
      refresh()
    } catch (e) {
      loading.value = false
    }
  } else if (cmd === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt(t('fileManager.newName'), t('fileManager.rename'), { inputValue: row.name })
      if (!value || value === row.name) return
      loading.value = true
      await props.sshConn.sftpRename(path, resolvePath(value))
      refresh()
    } catch (e) {
      loading.value = false
    }
  } else if (cmd === 'download' && !row.isDir) {
    const transferId = Math.random().toString(36).substring(2)
    const transfer: Transfer = { id: transferId, name: row.name, type: 'download', progress: 0 }
    activeTransfers.value.push(transfer)
    
    try {
      const blob = await props.sshConn.sftpDownload(path, (loaded, speed) => {
        const t = activeTransfers.value.find(x => x.id === transferId)
        if (t) {
          t.progress = Math.min(100, Math.round((loaded / row.size) * 100))
          t.speed = speed
        }
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = row.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      ElMessage.success(t('fileManager.downloadSuccess'))
    } catch (err: any) {
      ElMessage.error(t('fileManager.downloadFailed', { msg: err.message }))
    } finally {
      activeTransfers.value = activeTransfers.value.filter(t => t.id !== transferId)
    }
  }
}

const handleDrop = (e: DragEvent) => {
  const dt = e.dataTransfer
  if (dt && dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      uploadFile(dt.files[i])
    }
  }
}

const handleFileSelect = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (target.files) {
    for (let i = 0; i < target.files.length; i++) {
      uploadFile(target.files[i])
    }
    target.value = ''
  }
}

const uploadFile = async (file: File) => {
  if (activeTransfers.value.some(t => t.name === file.name && t.type === 'upload')) {
    ElMessage.warning(t('fileManager.alreadyUploading', { name: file.name }))
    return
  }

  const remotePath = resolvePath(file.name)
  const transferId = Math.random().toString(36).substring(2)
  const transfer: Transfer = { id: transferId, name: file.name, type: 'upload', progress: 0 }
  activeTransfers.value.push(transfer)

  try {
    await props.sshConn.sftpUpload(file, remotePath, (loaded, speed) => {
      const t = activeTransfers.value.find(x => x.id === transferId)
      if (t) {
        t.progress = Math.min(100, Math.round((loaded / file.size) * 100))
        t.speed = speed
      }
    })
    ElMessage.success(t('fileManager.uploadSuccess'))
    refresh()
  } catch (err: any) {
    ElMessage.error(t('fileManager.uploadFailed', { msg: err.message }))
  } finally {
    activeTransfers.value = activeTransfers.value.filter(t => t.id !== transferId)
  }
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

const editorOptions = {
  minimap: { enabled: false },
  wordWrap: 'on',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderLineHighlight: 'all',
}

const editorLanguage = computed(() => {
  const ext = editingFileName.value.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'md': 'markdown',
    'go': 'go',
    'py': 'python',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'sh': 'shell',
    'bash': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'php': 'php',
  }
  return ext ? (map[ext] || 'plaintext') : 'plaintext'
})

const formatDate = (ms: number) => {
  return new Date(ms).toLocaleString()
}
</script>

<style scoped>
.file-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--el-bg-color);
}

.fm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  background-color: var(--el-bg-color-page);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.fm-path-bar {
  display: flex;
  align-items: center;
  flex: 1;
  margin-right: 16px;
}

.fm-breadcrumbs::-webkit-scrollbar {
  display: none;
}

.separator {
  margin: 0 4px;
  color: var(--el-text-color-secondary);
}

.fm-actions {
  display: flex;
  gap: 4px;
}

.fm-table {
  flex: 1;
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.file-icon {
  font-size: 18px;
}

.danger {
  color: var(--el-color-danger);
}

.editor-dialog :deep(.el-dialog__body) {
  padding: 0;
}

.monaco-container {
  height: 60vh;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.context-menu {
  position: fixed;
  z-index: 3000;
  background-color: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  box-shadow: var(--el-box-shadow-light);
  padding: 4px 0;
  margin: 0;
  list-style: none;
  min-width: 120px;
}

.context-menu li {
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.context-menu li:hover {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.context-menu li.danger:hover {
  background-color: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.transfers-panel {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 300px;
  background-color: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
  padding: 12px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.transfer-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.transfer-speed {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
