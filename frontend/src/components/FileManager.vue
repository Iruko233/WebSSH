<template>
  <div 
    class="file-manager" 
    @dragenter.prevent="handleDragEnter"
    @dragleave.prevent="handleDragLeave"
    @dragover.prevent
    @drop.prevent="handleDrop"
  >
    <div class="fm-header">
      <div v-show="selectedFiles.length === 0" class="fm-path-bar" @dblclick="pathEditMode = true">
        <el-button size="small" :icon="Top" @click="goUp" circle title="Go Up" />
        <template v-if="!pathEditMode">
          <div class="fm-breadcrumbs">
            <el-breadcrumb separator="/">
              <el-breadcrumb-item class="path-root" @click="navigateTo('/')">/</el-breadcrumb-item>
              <el-breadcrumb-item 
                v-for="(part, idx) in pathParts" 
                :key="idx" 
                @click="navigateToPart(idx)"
              >
                {{ part }}
              </el-breadcrumb-item>
            </el-breadcrumb>
          </div>
          <el-button link :icon="EditPen" @click="pathEditMode = true" size="small" class="path-edit-btn" />
        </template>
        <el-input 
          v-else
          v-model="inputPath" 
          size="small" 
          ref="pathInputRef"
          @keyup.enter="handlePathEnter" 
          @blur="pathEditMode = false"
          class="path-input"
        />
      </div>
      <span v-if="selectedFiles.length > 0" class="selection-count" aria-live="polite" :title="$t('fileManager.selectedCount', { count: selectedFiles.length })">
        {{ $t('fileManager.selectedCount', { count: selectedFiles.length }) }}
      </span>
      <fieldset class="fm-actions">
        <template v-if="selectedFiles.length > 0">
          <el-tooltip :content="$t('fileManager.download')" :show-after="500">
            <el-button size="small" :icon="Download" @click="batchDownload" :disabled="!canOperate" type="primary" plain circle :aria-label="$t('fileManager.download')" />
          </el-tooltip>
          <el-tooltip :content="$t('fileManager.delete')" :show-after="500">
            <el-button size="small" :icon="Delete" @click="batchDelete" :disabled="!canOperate" type="danger" plain circle :aria-label="$t('fileManager.delete')" />
          </el-tooltip>
          <el-tooltip :content="$t('fileManager.clearSelection')" :show-after="500">
            <el-button size="small" :icon="Close" @click="fileTableRef?.clearSelection()" circle :aria-label="$t('fileManager.clearSelection')" />
          </el-tooltip>
        </template>
        <template v-else>
          <el-button size="small" :icon="Refresh" circle :disabled="!canOperate" @click="refresh" />
          <el-button size="small" :icon="FolderAdd" circle :disabled="!canOperate" @click="promptMkdir" />
          <el-button size="small" :icon="DocumentAdd" circle :disabled="!canOperate" @click="promptCreate" />
          <el-button size="small" :icon="Upload" circle :disabled="!canOperate" @click="() => fileInput?.click()" />
        </template>
        <input type="file" ref="fileInput" style="display: none" :disabled="!canOperate" @change="handleFileSelect" multiple />
      </fieldset>
    </div>

    <div class="table-container" v-loading="loading && client.state.phase === 'ready'" :aria-busy="sftpPending || loading">
      <div v-if="client.state.phase !== 'ready'" class="sftp-state" :role="sftpPending ? 'status' : 'alert'">
        <el-icon v-if="sftpPending" class="sftp-spinner" aria-hidden="true"><Loading /></el-icon>
        <span>{{ sftpPending ? $t('sftp.initializing') : errorText(client.state.error || 'SFTP_CLOSED') }}</span>
      </div>
      <el-table
        v-show="client.state.phase === 'ready'"
        ref="fileTableRef"
        :data="files"
        style="width: 100%"
        height="100%"
        class="fm-table"
        @selection-change="handleSelectionChange"
      @row-dblclick="handleRowDblClick"
      @row-contextmenu="handleContextMenu"
    >
      <el-table-column type="selection" width="40" :selectable="() => canOperate" />
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
      <el-table-column :label="$t('fileManager.permissions')" width="110" prop="permissions" />
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
            <el-button link :icon="MoreFilled" :disabled="!canOperate" />
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
    </div>

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
      ref="contextMenuRef"
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

    <div v-if="activeTransfers.length" class="transfers-panel">
      <div v-for="task in activeTransfers" :key="task.id" class="transfer-item">
        <div class="transfer-header">
          <span class="transfer-name" :title="task.path">{{ task.type === 'upload' ? '↑' : '↓' }} {{ task.name }}</span>
          <span class="transfer-status" :class="task.state" :title="task.saved ? $t('sftp.handedToBrowser') : undefined">{{ $t(`sftp.states.${task.saved ? 'handed-off' : task.state}`) }}</span>
          <button
            type="button"
            class="transfer-dismiss"
            :aria-label="`${$t(isTransferActive(task) ? 'sftp.cancelTransfer' : 'sftp.clear')}: ${task.name}`"
            :title="$t(isTransferActive(task) ? 'sftp.cancelTransfer' : 'sftp.clear')"
            @click="isTransferActive(task) ? cancelTransfer(task.id) : clearTransfer(task.id)"
          ><el-icon><Close /></el-icon></button>
        </div>
        <el-progress :percentage="transferPercentage(task)" :show-text="false" :status="task.state === 'failed' || task.state === 'uncertain' ? 'exception' : undefined" />
        <div class="transfer-info">
          <span>{{ formatSize(task.transferredBytes) }} / {{ formatSize(task.totalBytes) }}</span>
          <span v-if="task.state === 'running'">{{ formatSize(task.speedBps) }}/s</span>
        </div>
        <div v-if="task.error" class="transfer-error">{{ errorText(task.error) }}</div>
        <div v-if="task.temporaryPath" class="transfer-error">{{ $t('sftp.temporaryPath') }}: {{ task.temporaryPath }}</div>
        <el-button v-if="task.state === 'ready-to-save'" class="transfer-save" size="small" type="primary" text @click="saveTransfer(task.id)">{{ $t(task.saved ? 'sftp.saveAgain' : 'sftp.saveLocally') }}</el-button>
      </div>
    </div>
    <!-- Drag Overlay -->
    <div v-show="isDragging" class="drag-overlay">
      <div class="drag-content">
        <el-icon class="drag-icon"><UploadFilled /></el-icon>
        <span>{{ $t('fileManager.dropHere') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import '../lib/monaco-setup'
import { SSHConnection } from '../lib/ssh-client'
import { asError, type FileInfo } from '../lib/sftp-client'
import { chooseDownloadFile } from '../lib/download-target'
import { transfers, queueDownload, queueUpload, cancelTransfer, clearTransfer, saveTransfer, isTransferActive, transferPercentage, onTransferDirectoryChange } from '../stores/transfers'
import { ElMessage, ElMessageBox, ElCheckbox, type TableInstance } from 'element-plus'
import { Folder, Document, Refresh, FolderAdd, DocumentAdd, MoreFilled, Edit, Delete, Upload, Download, Top, EditPen, UploadFilled, Close, Loading } from '@element-plus/icons-vue'

const props = defineProps<{ sshConn: SSHConnection; initialPath: string; tabId: string }>()
const { t, te } = useI18n()
type ListedFile = FileInfo & { fullPath: string; connectionKey: string }
const client = computed(() => props.sshConn.sftp)
const loading = ref(false)
const files = ref<ListedFile[]>([])
const currentPath = ref(props.initialPath)
const inputPath = ref(props.initialPath)
const pathEditMode = ref(false)
const pathInputRef = ref<any>(null)
const selectedFiles = ref<ListedFile[]>([])
const fileTableRef = ref<TableInstance>()
const pathParts = computed(() => currentPath.value.split('/').filter(Boolean))
const editorVisible = ref(false)
const editingFilePath = ref('')
const editingFileName = ref('')
const editingConnectionKey = ref('')
const editingFileInfo = ref<FileInfo | null>(null)
const editorContent = ref('')
const saving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const activeTransfers = computed(() => transfers.filter(task => task.tabId === props.tabId || task.orphaned))
const canOperate = computed(() => !loading.value && client.value.state.phase === 'ready')
const sftpPending = computed(() => client.value.state.phase === 'idle' || client.value.state.phase === 'initializing')
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuRow = ref<ListedFile | null>(null)
const contextMenuRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
let dragCounter = 0
let disposed = false
let requestRevision = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const errorText = (error: unknown) => {
  const message = typeof error === 'string' ? error : asError(error).message
  const code = message.match(/SFTP_[A-Z_]+/)?.[0]
  return code && te(`sftp.errors.${code}`) ? t(`sftp.errors.${code}`) : message
}
const joinPath = (directory: string, name: string) => `${directory === '/' ? '' : directory}/${name}`
const normalizePath = (path: string) => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return '/' + parts.join('/')
}
const validName = (name: string) => !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes(String.fromCharCode(0))
const assertConnection = (key: string) => { if (client.value.key !== key || client.value.state.phase !== 'ready') throw new Error('SFTP_CLOSED') }
const closeContextMenu = () => { contextMenuVisible.value = false }
const rowUsable = (row: ListedFile) => canOperate.value && files.value.includes(row) && row.connectionKey === client.value.key

const refresh = async () => {
  const revision = ++requestRevision
  const connection = client.value
  const key = connection.key
  const path = currentPath.value
  selectedFiles.value = []
  closeContextMenu()
  files.value = []
  if (connection.state.phase !== 'ready') { loading.value = false; return }
  loading.value = true
  try {
    const list = await connection.list(path)
    if (disposed || revision !== requestRevision || path !== currentPath.value || key !== client.value.key) return
    files.value = list.map(file => ({ ...file, fullPath: joinPath(path, file.name), connectionKey: key }))
      .sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
  } catch (error) {
    if (!disposed && revision === requestRevision && key === client.value.key) ElMessage.error(t('fileManager.listFailed', { msg: errorText(error) }))
  } finally {
    if (!disposed && revision === requestRevision) loading.value = false
  }
}
const scheduleDirectoryRefresh = (key: string, directory: string) => {
  if (disposed || key !== client.value.key || normalizePath(directory) !== currentPath.value) return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { if (key === client.value.key && normalizePath(directory) === currentPath.value) void refresh() }, 200)
}
const unsubscribeDirectory = onTransferDirectoryChange(scheduleDirectoryRefresh)
onMounted(() => { document.addEventListener('click', closeContextMenu); void refresh() })
onUnmounted(() => {
  disposed = true
  requestRevision++
  clearTimeout(refreshTimer)
  unsubscribeDirectory()
  document.removeEventListener('click', closeContextMenu)
})
watch(() => props.initialPath, value => navigateTo(value))
watch(() => [client.value.key, client.value.state.phase], () => { void refresh() })
watch(pathEditMode, async value => { if (value) { inputPath.value = currentPath.value; await nextTick(); pathInputRef.value?.focus() } })
const navigateTo = (path: string) => { currentPath.value = normalizePath(path); inputPath.value = currentPath.value; void refresh() }
const navigateToPart = (index: number) => navigateTo('/' + pathParts.value.slice(0, index + 1).join('/'))
const handlePathEnter = () => { navigateTo(inputPath.value); pathEditMode.value = false }
const goUp = () => navigateTo(currentPath.value.slice(0, currentPath.value.lastIndexOf('/')) || '/')
const handleSelectionChange = (value: ListedFile[]) => { selectedFiles.value = value }
const handleContextMenu = async (row: ListedFile, _column: unknown, event: MouseEvent) => {
  event.preventDefault()
  if (!rowUsable(row)) return
  contextMenuRow.value = row
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
  await nextTick()
  const rect = contextMenuRef.value?.getBoundingClientRect()
  if (rect) {
    contextMenuX.value = Math.max(10, Math.min(event.clientX, window.innerWidth - rect.width - 10))
    contextMenuY.value = Math.max(10, Math.min(event.clientY, window.innerHeight - rect.height - 10))
  }
}

const startDownload = async (row: ListedFile, nativePicker = true) => {
  const connection = client.value
  const key = row.connectionKey
  const path = row.fullPath
  try {
    assertConnection(key)
    const handle = nativePicker ? await chooseDownloadFile(row.name) : undefined
    if (disposed) return
    assertConnection(key)
    queueDownload(props.tabId, connection, path, handle)
  } catch (error) { if (asError(error).name !== 'AbortError') ElMessage.error(errorText(error)) }
}
const batchDownload = () => {
  if (!canOperate.value) return
  const snapshot = [...selectedFiles.value]
  // Batch items use explicit save buttons, browsers cannot show multiple pickers from one gesture
  for (const file of snapshot) if (!file.isDir) void startDownload(file, false)
}
const handleRowDblClick = async (row: ListedFile) => {
  if (!rowUsable(row)) return
  if (row.isDir) { navigateTo(row.fullPath); return }
  const connection = client.value
  const key = row.connectionKey
  const path = row.fullPath
  const ext = row.name.split('.').pop()?.toLowerCase() || ''
  const binary = ['zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so', 'bin', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac']
  try {
    let isBinary = binary.includes(ext)
    if (!isBinary) isBinary = (await connection.read(path, 512, true)).data.includes(0)
    if (isBinary) {
      await ElMessageBox.confirm(t('fileManager.binaryPrompt'), t('fileManager.warning'), { type: 'warning' })
      await startDownload(row, false)
      return
    }
    const result = await connection.read(path)
    assertConnection(key)
    if (disposed) return
    editingFilePath.value = path
    editingFileName.value = row.name
    editingConnectionKey.value = key
    editingFileInfo.value = result.info
    editorContent.value = new TextDecoder().decode(result.data)
    editorVisible.value = true
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    if (asError(error).message === 'SFTP_EDITOR_TOO_LARGE') {
      try {
        await ElMessageBox.confirm(t('fileManager.textTooLarge'), t('fileManager.warning'), { type: 'warning' })
        await startDownload(row, false)
      } catch { /* download prompt cancelled */ }
    } else ElMessage.error(t('fileManager.readFailed', { msg: errorText(error) }))
  }
}
const saveFile = async () => {
  const connection = client.value
  const key = editingConnectionKey.value
  const path = editingFilePath.value
  const content = editorContent.value
  saving.value = true
  try {
    assertConnection(key)
    const stat = await connection.stat(path)
    if (!stat || stat.isDir || stat.isLink) throw new Error('SFTP_NOT_REGULAR')
    if (!editingFileInfo.value || stat.size !== editingFileInfo.value.size || stat.modTime !== editingFileInfo.value.modTime) {
      await ElMessageBox.confirm(t('fileManager.fileChangedOnServer'), t('fileManager.warning'), { type: 'warning', confirmButtonText: t('fileManager.overwrite'), cancelButtonText: t('fileManager.cancel') })
    }
    assertConnection(key)
    queueUpload(props.tabId, connection, path, new Blob([content]), true, stat)
    editorVisible.value = false
    ElMessage.success(t('sftp.queued'))
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error)) }
  finally { saving.value = false }
}
const promptNew = async (directory: boolean) => {
  if (!canOperate.value) return
  const connection = client.value
  const key = connection.key
  const parent = currentPath.value
  try {
    const { value } = await ElMessageBox.prompt(t(directory ? 'fileManager.folderName' : 'fileManager.fileName'), t(directory ? 'fileManager.newFolder' : 'fileManager.newFile'), { inputValidator: value => validName(value) || t('sftp.invalidName') })
    assertConnection(key)
    if (directory) await connection.mkdir(joinPath(parent, value))
    else await connection.create(joinPath(parent, value))
    scheduleDirectoryRefresh(key, parent)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error)) }
}
const promptMkdir = () => promptNew(true)
const promptCreate = () => promptNew(false)
const handleCommand = async (command: string, row: ListedFile) => {
  closeContextMenu()
  if (!rowUsable(row)) return
  const connection = client.value
  const key = row.connectionKey
  const path = row.fullPath
  const parent = path.slice(0, path.lastIndexOf('/')) || '/'
  if (command === 'download') { await startDownload(row); return }
  try {
    if (command === 'delete') {
      await ElMessageBox.confirm(t('fileManager.deleteConfirm', { name: row.name }), t('fileManager.warning'), { type: 'warning' })
      assertConnection(key)
      await connection.remove(path)
      ElMessage.success(t('fileManager.deleteSuccess'))
    } else if (command === 'rename') {
      const { value } = await ElMessageBox.prompt(t('fileManager.newName'), t('fileManager.rename'), { inputValue: row.name, inputValidator: value => validName(value) || t('sftp.invalidName') })
      if (value === row.name) return
      assertConnection(key)
      await connection.rename(path, joinPath(parent, value))
      ElMessage.success(t('fileManager.renameSuccess'))
    }
    scheduleDirectoryRefresh(key, parent)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error)) }
}
const batchDelete = async () => {
  if (!canOperate.value) return
  const connection = client.value
  const key = connection.key
  const parent = currentPath.value
  const snapshot = [...selectedFiles.value]
  try { await ElMessageBox.confirm(t('fileManager.deleteConfirm', { name: t('fileManager.selectedCount', { count: snapshot.length }) }), t('fileManager.warning'), { type: 'warning' }) }
  catch { return }
  const failed: string[] = []
  for (const file of snapshot) {
    try { assertConnection(key); await connection.remove(file.fullPath) }
    catch (error) { failed.push(`${file.name}: ${errorText(error)}`) }
  }
  scheduleDirectoryRefresh(key, parent)
  if (failed.length) ElMessage.error(failed.join('\n'))
  else ElMessage.success(t('fileManager.deleteSuccess'))
}
const uploadBatch = async (uploadFiles: File[]) => {
  if (!canOperate.value) return
  const connection = client.value
  const key = connection.key
  const parent = currentPath.value
  let policy: 'overwrite' | 'skip' | undefined
  for (const file of uploadFiles) {
    try {
      assertConnection(key)
      const path = joinPath(parent, file.name)
      const existing = await connection.stat(path)
      let overwrite = false
      if (existing) {
        if (existing.isDir || existing.isLink) throw new Error('SFTP_NOT_REGULAR')
        let choice = policy
        if (!choice) {
          const all = ref(false)
          try {
            await ElMessageBox.confirm(() => h('div', [h('p', t('sftp.overwritePrompt', { name: file.name })), h(ElCheckbox, { modelValue: all.value, 'onUpdate:modelValue': (value: unknown) => { all.value = !!value } }, () => t('sftp.applyBatch'))]), t('fileManager.warning'), { confirmButtonText: t('fileManager.overwrite'), cancelButtonText: t('sftp.skip'), distinguishCancelAndClose: true })
            choice = 'overwrite'
          } catch (action) { if (action === 'cancel') choice = 'skip'; else return }
          if (all.value) policy = choice
        }
        if (choice === 'skip') continue
        overwrite = true
      }
      assertConnection(key)
      queueUpload(props.tabId, connection, path, file, overwrite, existing ?? undefined)
    } catch (error) {
      ElMessage.error(`${file.name}: ${errorText(error)}`)
      if (connection.state.phase !== 'ready' || connection.key !== key) return
    }
  }
}
const handleDragEnter = (event: DragEvent) => { if (canOperate.value && event.dataTransfer?.types.includes('Files')) { dragCounter++; isDragging.value = true } }
const handleDragLeave = () => { if (--dragCounter <= 0) { dragCounter = 0; isDragging.value = false } }
const handleDrop = (event: DragEvent) => { dragCounter = 0; isDragging.value = false; if (!editorVisible.value && event.dataTransfer) void uploadBatch(Array.from(event.dataTransfer.files)) }
const handleFileSelect = (event: Event) => { const target = event.target as HTMLInputElement; if (target.files) void uploadBatch(Array.from(target.files)); target.value = '' }

const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))))
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
.fm-actions { border: 0; margin: 0; padding: 0; min-width: 0; }
.sftp-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  overflow-wrap: anywhere;
}

.sftp-spinner {
  flex-shrink: 0;
  font-size: 18px;
  animation: sftp-spin 1.2s linear infinite;
}

@keyframes sftp-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .sftp-spinner { animation: none; }
}
.transfer-error { color: var(--el-color-danger); overflow-wrap: anywhere; font-size: 12px; }

.file-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--el-bg-color);
  position: relative;
}

.fm-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  background-color: var(--el-bg-color-page);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.fm-path-bar {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.fm-path-bar > .el-button {
  flex-shrink: 0;
}

.path-input {
  flex: 1;
  min-width: 0;
  margin-left: 8px;
}

.fm-breadcrumbs {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}
.fm-breadcrumbs::-webkit-scrollbar {
  display: none;
}
.fm-breadcrumbs :deep(.el-breadcrumb) {
  display: flex;
  align-items: center;
}
.fm-breadcrumbs :deep(.el-breadcrumb__item) {
  cursor: pointer;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.fm-breadcrumbs :deep(.path-root .el-breadcrumb__separator) {
  display: none;
}
.fm-breadcrumbs :deep(.path-root:not(:last-child)) {
  margin-right: 8px;
}
.fm-breadcrumbs :deep(.el-breadcrumb__inner) {
  cursor: pointer !important;
  font-weight: normal;
}
.fm-breadcrumbs :deep(.el-breadcrumb__inner:hover) {
  color: var(--el-color-primary);
}
.path-edit-btn {
  margin-left: 4px;
}
.selection-count {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.separator {
  margin: 0 4px;
  color: var(--el-text-color-secondary);
}

.fm-actions {
  display: flex;
  flex: 0 0 108px;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  white-space: nowrap;
}

.fm-actions :deep(.el-button) {
  flex-shrink: 0;
}

.fm-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.table-container {
  position: relative;
  flex: 1;
  min-height: 0;
  height: 0;
  width: 100%;
}

.fm-table {
  width: 100%;
  height: 100%;
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
  box-sizing: border-box;
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: min(300px, calc(100% - 40px));
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
  min-width: 0;
}

.transfer-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content 24px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}

.transfer-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}

.transfer-status {
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.transfer-status.completed { color: var(--el-color-success); }
.transfer-status.failed { color: var(--el-color-danger); }
.transfer-status.uncertain { color: var(--el-color-warning); }

.transfer-dismiss {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.transfer-dismiss:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.transfer-dismiss:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.transfer-save {
  align-self: flex-end;
  margin: 0;
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}

.transfer-info > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-info > span + span {
  flex-shrink: 0;
  white-space: nowrap;
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(var(--el-color-primary-rgb), 0.1);
  backdrop-filter: blur(4px);
  z-index: 4000;
  display: flex;
  justify-content: center;
  align-items: center;
  border: 2px dashed var(--el-color-primary);
  border-radius: 8px;
  margin: 8px;
  pointer-events: none;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--el-color-primary);
  font-size: 24px;
  font-weight: 500;
  pointer-events: none;
}

.drag-icon {
  font-size: 64px;
  animation: bounce 1s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.preview-dialog :deep(.el-dialog__body) {
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--el-bg-color-overlay);
  min-height: 200px;
}

.preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  max-height: 80vh;
}

.preview-image {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
}

.preview-video {
  max-width: 100%;
  max-height: 80vh;
}

.preview-audio {
  width: 100%;
  max-width: 600px;
  margin: 20px;
}
</style>
