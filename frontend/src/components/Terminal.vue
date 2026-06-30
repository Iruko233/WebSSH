<template>
  <div class="terminal-container" :class="{ 'layout-bottom': settingsStore.sftpLayout === 'bottom' }">
    <div class="pane terminal-pane" :style="termThemeVars">
      <div class="terminal-outer" :style="{ padding: adaptivePadding + 'px' }">
        <div class="terminal-inner" ref="terminalRef"></div>
      </div>
      <div class="terminal-actions">
        <!-- Mobile Sidebar Toggle -->
        <el-tooltip :content="t('dashboard.openServerList')" placement="left">
          <el-button 
            class="hidden-desktop mobile-menu-btn" 
            @click="$emit('toggle-sidebar')" 
            circle
          >
            <el-icon><Menu /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip :content="t('terminal.commandBar') || 'Command Compose'" placement="left">
          <el-button 
            class="command-toggle" 
            :type="showCommandBar ? 'primary' : 'default'"
            @click="showCommandBar = !showCommandBar" 
            circle
          >
            <el-icon><ChatLineSquare /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip :content="t('monitor.title')" placement="left">
          <el-button
            class="stats-toggle"
            :type="showStats ? 'primary' : 'default'"
            @click="showStats = !showStats"
            circle
          >
            <span v-if="!sysStats" class="pulse-dot"></span>
            <el-icon v-else><Odometer /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip :content="t('terminal.toggleFileManager')" placement="left">
          <el-button 
            class="sftp-toggle" 
            :type="showSftp ? 'primary' : 'default'"
            @click="showSftp = !showSftp" 
            circle
          >
            <el-icon><Folder /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <Transition name="stats-slide">
        <div v-show="showStats" class="stats-panel">
          <div class="stats-panel-header">
            <span>{{ t('monitor.title') }}</span>
            <el-button text size="small" @click="showStats = false">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          <ServerStats v-if="sysStats" :stats="sysStats" />
        </div>
      </Transition>

      <div v-show="showCommandBar" class="command-bar">
        <el-input
          v-model="commandInput"
          type="textarea"
          :rows="2"
          resize="none"
          :placeholder="t('terminal.commandPlaceholder')"
          @keydown.ctrl.enter.prevent="sendCommand"
          class="command-input"
        />
        <el-button type="primary" class="command-send-btn" @click="sendCommand" circle>
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left: -2px; margin-top: 2px;">
            <polyline points="9 10 4 15 9 20"></polyline>
            <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
          </svg>
        </el-button>
      </div>

      <MobileKeyboard 
        v-if="width <= 768"
        :ctrl-active="ctrlActive"
        :alt-active="altActive"
        @toggle-ctrl="ctrlActive = !ctrlActive"
        @toggle-alt="altActive = !altActive"
        @input="handleKeyboardInput"
      />
    </div>
    
    <div v-if="showSftp" class="pane-divider"></div>
    
    <div class="pane sftp-pane" v-if="showSftp && sshConn && server">
      <FileManager 
        :ssh-conn="sshConn"
        :initial-path="server.credentials.username === 'root' ? '/root' : `/home/${server.credentials.username}`"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { SSHConnection } from '../lib/ssh-client'
import { useServerStore } from '../stores/server'
import { useSettingsStore } from '../stores/settings'
import { THEMES } from '../lib/themes'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { Folder, Odometer, Close, Menu, ChatLineSquare } from '@element-plus/icons-vue'
import FileManager from './FileManager.vue'
import ServerStats from './ServerStats.vue'
import MobileKeyboard from './MobileKeyboard.vue'
import type { SysStats } from '../lib/ssh-client'
import { useWindowSize } from '@vueuse/core'

const props = defineProps<{
  serverId: string
  tabId?: string
}>()

const { width } = useWindowSize()
const adaptiveFontSize = computed(() => width.value <= 768 ? Math.min(settingsStore.fontSize, 10) : settingsStore.fontSize)
const adaptivePadding = computed(() => width.value <= 768 ? 4 : settingsStore.padding)

defineEmits<{
  (e: 'toggle-sidebar'): void
}>()

const terminalRef = ref<HTMLElement | null>(null)
let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
const sshConn = shallowRef<SSHConnection | null>(null)
let resizeTimer: ReturnType<typeof setTimeout> | null = null
const serverStore = useServerStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const showSftp = ref(false)
const showStats = ref(false)
const showCommandBar = ref(false)
const commandInput = ref('')
const sysStats = ref<SysStats | null>(null)
const server = computed(() => serverStore.servers.find(s => s.id === props.serverId))

const currentThemeColors = computed(() => {
  return THEMES[settingsStore.theme]?.colors || THEMES['one-dark'].colors
})

const termThemeVars = computed(() => ({
  '--term-bg': currentThemeColors.value.background,
  '--term-fg': currentThemeColors.value.foreground,
  '--term-cursor': currentThemeColors.value.cursor,
}))

const ctrlActive = ref(false)
const altActive = ref(false)

const handleKeyboardInput = (data: string) => {
  if (sshConn.value) {
    sshConn.value.sendInput(data)
  }
  ctrlActive.value = false
  altActive.value = false
}

const sendCommand = () => {
  if (!commandInput.value || !sshConn.value) return
  sshConn.value.sendInput(commandInput.value + '\r')
  commandInput.value = ''
}

watch(() => sysStats.value, (newVal, oldVal) => {
  if (newVal && !oldVal && settingsStore.autoOpenMonitor) {
    showStats.value = true
  }
})

const initTerminal = () => {
  if (!terminalRef.value) return

  xterm = new Terminal({
    fontFamily: settingsStore.fontFamily,
    fontSize: adaptiveFontSize.value,
    lineHeight: 1.3,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'block',
    theme: THEMES[settingsStore.theme]?.colors || THEMES['one-dark'].colors
  })

  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(new WebLinksAddon())
  
  xterm.open(terminalRef.value)
  
  try {
    if (window.innerWidth > 768) {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      xterm.loadAddon(webglAddon)
    }
  } catch (e) {
    console.warn('WebGL addon failed to load, falling back to canvas', e)
  }

  fitAddon.fit()

  if (!server.value) {
    xterm.writeln(`\x1b[31m${t('terminal.serverNotFound')}\x1b[0m`)
    return
  }

  xterm.writeln(`${t('terminal.connecting', { name: server.value.name, username: server.value.credentials.username, host: server.value.credentials.host, port: server.value.credentials.port })}\r\n`)

  sshConn.value = new SSHConnection()
  
  const token = sessionStorage.getItem('jwt') || ''

  const textDecoder = new TextDecoder('utf-8', { fatal: false })
  const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

  const connectWithPassword = (pwd: string) => {
    sshConn.value?.connect({
      host: server.value!.credentials.host,
      port: server.value!.credentials.port,
      username: server.value!.credentials.username,
      password: pwd,
      jwt: token,
      expectedHostKey: server.value!.credentials.expectedHostKey,
      cols: xterm!.cols,
      rows: xterm!.rows,
      monitor_interval: settingsStore.monitorInterval || 5,
      encrypt_handshake: settingsStore.encryptHandshake,
      onConnected: () => {
        xterm?.writeln(`\x1b[32m${t('terminal.connected')}\x1b[0m\r\n`)
      },
      onHostKeyPrompt: (rawKey: string, fingerprint: string, isMismatch: boolean) => {
        const title = isMismatch ? t('terminal.hostKeyPromptMismatchTitle', 'Host key mismatch') : t('terminal.hostKeyPromptTitle', 'Unknown host key');
        const messageHtml = isMismatch 
          ? t('terminal.hostKeyPromptMismatch', { fingerprint }) 
          : t('terminal.hostKeyPromptNew', { fingerprint });

        ElMessageBox.confirm(messageHtml, title, {
          confirmButtonText: t('terminal.hostKeyPromptAccept', 'Accept'),
          cancelButtonText: t('terminal.hostKeyPromptReject', 'Reject'),
          confirmButtonClass: isMismatch ? 'el-button--danger' : 'el-button--primary',
          dangerouslyUseHTMLString: true,
          closeOnClickModal: false,
          closeOnPressEscape: false,
          showClose: false,
          customClass: 'host-key-prompt-box'
        }).then(async () => {
          try {
            const updatedCreds = {
              ...server.value!.credentials,
              expectedHostKey: rawKey
            };
            await serverStore.updateServer(server.value!.id, server.value!.name, updatedCreds);
            await serverStore.fetchServers();
            xterm?.writeln('\r\n\x1b[32m' + t('terminal.hostKeyAccepted') + '\x1b[0m\r\n');
            connectWithPassword(pwd);
          } catch (e: any) {
            ElMessage.error('Failed to save host key: ' + e.message);
          }
        }).catch(() => {
          xterm?.writeln('\r\n\x1b[31m' + t('terminal.connectionCancelled', 'Connection cancelled.') + '\x1b[0m\r\n');
        });
      },
    onOsInfo: async (os: string) => {
      if (server.value && server.value.credentials.os !== os) {
        const newCredentials = { ...server.value.credentials, os }
        try {
          await serverStore.updateServer(server.value.id, server.value.name, newCredentials)
        } catch (e) {
          console.error('Failed to update OS info', e)
        }
      }
    },
    onSysStats: (stats: SysStats) => {
      sysStats.value = stats
    },
    onData: (data: Uint8Array) => {
      if (settingsStore.keywordHighlight) {
        let text = textDecoder.decode(data, { stream: true })
        if (text) {
          const parts = text.split(ANSI_REGEX)
          const matches = text.match(ANSI_REGEX) || []
          let result = ''
          for (let i = 0; i < parts.length; i++) {
            let part = parts[i]
            if (part) {
              if (settingsStore.kwError) {
                part = part.replace(/\b(Error|ERROR|error|Failed|Failure|FATAL|fatal)\b/g, '\x1b[31m$1\x1b[39m')
              }
              if (settingsStore.kwWarning) {
                part = part.replace(/\b(Warning|WARNING|warn|Warn|WARN)\b/g, '\x1b[33m$1\x1b[39m')
              }
              if (settingsStore.kwOk) {
                part = part.replace(/\b(OK|ok|Success|SUCCESS|success)\b/g, '\x1b[32m$1\x1b[39m')
              }
              if (settingsStore.kwInfo) {
                part = part.replace(/\b(Info|INFO|info)\b/g, '\x1b[34m$1\x1b[39m')
              }
              if (settingsStore.kwDebug) {
                part = part.replace(/\b(Debug|DEBUG|debug)\b/g, '\x1b[35m$1\x1b[39m')
              }
              if (settingsStore.kwIpMac) {
                part = part.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, '\x1b[35m$1\x1b[39m')
                part = part.replace(/\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g, '\x1b[35m$1\x1b[39m')
              }
            }
            result += part
            if (i < matches.length) {
              result += matches[i]
            }
          }
          xterm?.write(result)
        }
      } else {
        xterm?.write(data)
      }
    },
    onError: (err: Error) => {
      xterm?.writeln(`\r\n\x1b[31m${t('terminal.connError', { msg: err.message })}\x1b[0m\r\n`)
      ElMessage.error(t('terminal.sshError', { msg: err.message }))
    },
    onClose: () => {
      xterm?.writeln(`\r\n\x1b[33m${t('terminal.closed')}\x1b[0m\r\n`)
    }
  })
}

if (!server.value.credentials.password) {
  ElMessageBox.prompt(t('serverForm.password'), t('terminal.authRequired', 'Authentication Required'), {
    confirmButtonText: t('serverList.connect', 'Connect'),
    cancelButtonText: t('serverForm.cancel', 'Cancel'),
    inputType: 'password',
    customClass: 'auth-prompt-dialog',
  }).then(({ value }) => {
    connectWithPassword(value)
  }).catch(() => {
    xterm?.writeln(`\x1b[31m${t('terminal.connectionCancelled', 'Connection cancelled.')}\x1b[0m\r\n`)
  })
} else {
  connectWithPassword(server.value.credentials.password)
}

  xterm.onData((data) => {
    if (sshConn.value) {
      if (ctrlActive.value || altActive.value) {
        if (data.length === 1) {
          let charCode = data.charCodeAt(0)
          let result = data

          if (ctrlActive.value) {
            if (charCode >= 97 && charCode <= 122) { // a-z
              charCode -= 96
            } else if (charCode >= 65 && charCode <= 90) { // A-Z
              charCode -= 64
            } else if (charCode >= 91 && charCode <= 95) { // [ \ ] ^ _
              charCode -= 64
            } else if (charCode === 32) { // Space -> \x00
              charCode = 0
            } else if (charCode === 63) { // ? -> \x7f (DEL/Backspace)
              charCode = 127
            }
            result = String.fromCharCode(charCode)
          }

          if (altActive.value) {
            result = '\x1b' + result
          }

          sshConn.value.sendInput(result)
        } else {
          sshConn.value.sendInput(data)
        }
        
        ctrlActive.value = false
        altActive.value = false
      } else {
        sshConn.value.sendInput(data)
      }
    }
  })

  xterm.onResize(({ cols, rows }) => {
    sshConn.value?.resize(cols, rows)
  })

  // Immediately sync current terminal size to SSH server
  sshConn.value?.resize(xterm.cols, xterm.rows)

  // ResizeObserver watches the INNER div — the actual xterm mount point.
  // When outer padding changes, the inner div shrinks/grows, triggering refit.
  resizeObserver = new ResizeObserver(() => {
    debouncedFit()
  })
  resizeObserver.observe(terminalRef.value)

  // Fallback: window resize catches fullscreen <-> windowed transitions
  window.addEventListener('resize', handleWindowResize)
}

const debouncedFit = () => {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (fitAddon) {
      try {
        fitAddon.fit()
      } catch (_e) {
        // ignore fit errors during rapid resizing
      }
    }
  }, 30)
}

const handleWindowResize = () => {
  debouncedFit()
}

onMounted(() => {
  initTerminal()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
  if (resizeTimer) clearTimeout(resizeTimer)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (sshConn.value) {
    sshConn.value.disconnect()
  }
  if (xterm) {
    xterm.dispose()
  }
})

watch(() => props.serverId, () => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (sshConn.value) {
    sshConn.value.disconnect()
  }
  if (xterm) {
    xterm.dispose()
  }
  initTerminal()
})

watch(() => settingsStore.fontFamily, (newFont) => {
  if (xterm) {
    xterm.options.fontFamily = newFont
    fitAddon?.fit()
  }
})

watch(() => settingsStore.fontSize, () => {
  if (xterm) {
    xterm.options.fontSize = adaptiveFontSize.value
    fitAddon?.fit()
  }
})

watch(adaptiveFontSize, (newSize) => {
  if (xterm) {
    xterm.options.fontSize = newSize
    fitAddon?.fit()
  }
})

watch(() => settingsStore.theme, (newTheme) => {
  if (xterm) {
    xterm.options.theme = THEMES[newTheme]?.colors || THEMES['one-dark'].colors
  }
})

watch(showSftp, () => {
  // Give DOM time to update flex layout before fitting
  setTimeout(() => {
    debouncedFit()
  }, 100)
})

watch(showCommandBar, () => {
  setTimeout(() => {
    debouncedFit()
  }, 100)
})
</script>

<style scoped>
.terminal-container {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-container.layout-bottom {
  flex-direction: column;
}

.pane {
  position: relative;
  box-sizing: border-box;
}

.terminal-pane {
  flex: 1;
  min-width: 0; /* important for flexbox to shrink */
  min-height: 0; /* important for column flexbox to shrink */
  display: flex;
  flex-direction: column;
}

.sftp-pane {
  width: 380px;
  min-width: 300px;
  background-color: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color-light);
}

.layout-bottom .sftp-pane {
  width: 100%;
  min-width: unset;
  height: 380px;
  min-height: 200px;
  flex-shrink: 0;
  border-left: none;
  border-top: 1px solid var(--el-border-color-light);
}

.pane-divider {
  width: 2px;
  background-color: var(--el-border-color);
  cursor: col-resize;
}

.layout-bottom .pane-divider {
  width: 100%;
  height: 2px;
  cursor: row-resize;
}

.terminal-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sftp-toggle, .stats-toggle, .command-toggle, .mobile-menu-btn {
  margin: 0 !important;
  background: color-mix(in srgb, var(--term-bg, #1e1e24) 70%, var(--term-fg, #abb2bf) 30%) !important;
  border: 1px solid color-mix(in srgb, var(--term-fg, #abb2bf) 20%, transparent) !important;
  color: color-mix(in srgb, var(--term-fg, #abb2bf) 60%, transparent) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
}

.sftp-toggle:hover, .stats-toggle:hover, .command-toggle:hover, .mobile-menu-btn:hover {
  background: color-mix(in srgb, var(--term-bg, #1e1e24) 50%, var(--term-fg, #abb2bf) 50%) !important;
  color: var(--term-fg, #abb2bf) !important;
  transform: scale(1.1);
}

.sftp-toggle.el-button--primary,
.stats-toggle.el-button--primary,
.command-toggle.el-button--primary,
.mobile-menu-btn.el-button--primary {
  background: color-mix(in srgb, var(--term-cursor, #528bff) 35%, var(--term-bg, #1e1e24) 65%) !important;
  border-color: color-mix(in srgb, var(--term-cursor, #528bff) 50%, transparent) !important;
  color: var(--term-cursor, #528bff) !important;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-warning);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.stats-panel {
  position: absolute;
  top: 16px;
  right: 56px;
  width: 240px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 10;
  padding: 12px;
  color: var(--text-primary);
}

.stats-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.stats-panel-header .el-button {
  color: var(--text-secondary) !important;
}

.stats-panel-header .el-button:hover {
  color: var(--text-primary) !important;
  background: var(--bg-primary) !important;
}

.stats-slide-enter-active,
.stats-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.stats-slide-enter-from,
.stats-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (max-width: 768px) {
  .terminal-container {
    flex-direction: column !important;
  }
  .sftp-pane {
    width: 100% !important;
    height: 45vh !important;
    min-width: unset !important;
    border-left: none !important;
    border-top: 1px solid var(--el-border-color-light) !important;
  }
  .pane-divider {
    width: 100% !important;
    height: 2px !important;
    cursor: row-resize !important;
  }
  .stats-panel {
    width: calc(100vw - 32px);
    right: 16px;
    max-width: 240px;
  }
}

.terminal-outer {
  flex: 1;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.terminal-inner {
  width: 100%;
  height: 100%;
}

/* Custom xterm.js scrollbar styling */
:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 10px;
}
:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}
:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: rgba(255, 255, 255, 0.4);
}

.command-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  z-index: 10;
}

.command-input {
  flex: 1;
}

.command-input :deep(.el-textarea__inner) {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border-color: var(--border-color);
  font-family: var(--font-sans);
  box-shadow: none;
}

.command-input :deep(.el-textarea__inner:focus) {
  border-color: var(--color-primary);
  background-color: var(--bg-secondary);
}

.command-send-btn {
  height: 44px;
  width: 44px;
  min-width: 44px;
  border-radius: 50% !important;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3) !important;
  transition: all 0.3s ease !important;
}

.command-send-btn:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4) !important;
}

.command-send-btn:active {
  transform: translateY(0) scale(0.95);
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.2) !important;
}
</style>
