// Isolated development fixture: no vault, credentials or backend requests
import { createApp, defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import TerminalTabs from '../src/components/TerminalTabs.vue'
import { useTerminalStore, type ConnectionStatus, type TerminalTab } from '../src/stores/terminal'
import messages from '../src/i18n/locales/zh-CN.json'
import 'element-plus/dist/index.css'
import '../src/style.css'

const mounts = ref(0), unmounts = ref(0)
const Session = defineComponent({
  props: { tab: { type: Object, required: true } },
  setup(props) {
    onMounted(() => mounts.value++)
    onUnmounted(() => unmounts.value++)
    const content = ref(`${props.tab.title}\n输入一些文字，切换和拖动后应保持不变`)
    return () => h('textarea', { 'aria-label': `终端 ${props.tab.title}`, value: content.value, onInput: (event: Event) => { content.value = (event.target as HTMLTextAreaElement).value }, style: 'width:100%;height:100%;resize:none;background:#14151b;color:#d7dae0;border:0;padding:20px;font:15px monospace' })
  },
})

createApp(defineComponent({
  setup() {
    const store = useTerminalStore()
    const compact = ref(false)
    let sequence = 0
    const statuses: ConnectionStatus[] = ['connected', 'connecting', 'awaiting-input', 'error', 'disconnected']
    function add(count = 1) {
      for (let i = 0; i < count; i++) {
        const index = sequence++
        store.tabs.push({ id: `fixture-${index}`, serverId: 'fixture', title: index === 2 ? '服务器名称很长时仍然保留关闭按钮的位置' : `服务器 ${index + 1}`, status: statuses[index % statuses.length]! })
      }
      store.activeTabId ??= store.tabs[0]!.id
    }
    add(5)
    return () => h('div', { style: 'padding:24px;display:flex;flex-direction:column;height:100vh;gap:16px' }, [
      h('strong', '页签交互测试 · 模拟会话，不连接服务器'),
      h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [
        h('button', { onClick: () => add(8) }, '增加 8 个页签'),
        h('button', { onClick: () => compact.value = !compact.value }, '切换窄屏'),
        h('button', { onClick: () => document.documentElement.classList.toggle('dark') }, '切换深浅主题'),
        h('select', { 'aria-label': '当前会话状态', onChange: (event: Event) => { if (store.activeTabId) store.setTabStatus(store.activeTabId, (event.target as HTMLSelectElement).value as ConnectionStatus) } }, statuses.map(status => h('option', { value: status }, status))),
        h('span', `已创建 ${mounts.value} / 已销毁 ${unmounts.value}`),
      ]),
      h('div', { style: `display:flex;min-height:0;flex:1;width:${compact.value ? '360px' : '100%'};max-width:100%;border:1px solid var(--border-color)` }, [
        h(TerminalTabs, {}, { default: ({ tab }: { tab: TerminalTab }) => h(Session, { tab }) }),
      ]),
    ])
  },
})).use(createPinia()).use(createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': messages } })).mount('#app')
