import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue'
import TerminalTabs from '../src/components/TerminalTabs.vue'
import { useTerminalStore } from '../src/stores/terminal'
import messages from '../src/i18n/locales/en-US.json'

let wrapper: ReturnType<typeof mount>
let mounts: string[], unmounts: string[]

beforeEach(() => {
  mounts = []; unmounts = []
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useTerminalStore()
  store.$patch({
    tabs: ['a', 'b', 'c'].map(id => ({ id, serverId: 'same-server', title: `Session ${id}`, status: 'connecting' as const })),
    activeTabId: 'a',
  })
  const Session = defineComponent({
    props: { id: { type: String, required: true } },
    setup(props) {
      onMounted(() => mounts.push(props.id))
      onUnmounted(() => unmounts.push(props.id))
      return () => h('textarea', { 'data-session': props.id })
    },
  })
  wrapper = mount(TerminalTabs, {
    attachTo: document.body,
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': messages } })] },
    slots: { default: ({ tab }: any) => h(Session, { id: tab.id }) },
  })
})

afterEach(() => wrapper?.unmount())

describe('terminal tab interactions', () => {
  it('preserves terminal instances and contents across switch and reorder', async () => {
    const input = wrapper.get('[data-session="a"]').element as HTMLTextAreaElement
    input.value = 'retained terminal buffer'
    await wrapper.get('#label-b').trigger('click')
    useTerminalStore().moveTab('a', null)
    await nextTick()
    expect(wrapper.get('[data-session="a"]').element).toBe(input)
    expect(input.value).toBe('retained terminal buffer')
    expect(mounts).toEqual(['a', 'b', 'c'])
    expect(unmounts).toEqual([])
    expect(wrapper.findAll('.tab-item').map(item => item.attributes('data-tab-id'))).toEqual(['b', 'c', 'a'])
  })
  it('closes only the clicked background session without switching active tab', async () => {
    await wrapper.get('[data-tab-id="b"] .tab-close').trigger('click')
    expect(useTerminalStore().activeTabId).toBe('a')
    expect(unmounts).toEqual(['b'])
    expect(wrapper.findAll('.tab-close')).toHaveLength(2)
  })
  it('supports keyboard navigation, focus, close and status descriptions', async () => {
    await wrapper.get('#label-a').trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(useTerminalStore().activeTabId).toBe('b')
    expect(document.activeElement?.id).toBe('label-b')
    useTerminalStore().setTabStatus('b', 'error')
    await nextTick()
    expect(wrapper.get('#label-b').attributes('title')).toContain('Connection failed')
    expect(wrapper.get('#label-b .status-dot').classes()).toContain('error')
    await wrapper.get('#label-b').trigger('keydown', { key: 'Delete' })
    await nextTick()
    expect(useTerminalStore().activeTabId).toBe('c')
    expect(document.activeElement?.id).toBe('label-c')
  })
  it('requires the drag threshold and suppresses the click following a drop', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    wrapper.findAll('.tab-item').forEach((item, i) => {
      vi.spyOn(item.element, 'getBoundingClientRect').mockReturnValue({ left: i * 150, right: (i + 1) * 150, width: 150 } as DOMRect)
    })
    await wrapper.get('#label-a').trigger('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 30 })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 35 }))
    await nextTick()
    expect(wrapper.find('.drop-marker').exists()).toBe(false)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 500 }))
    await nextTick()
    expect(wrapper.find('.drop-marker').exists()).toBe(true)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 500 }))
    await nextTick()
    await wrapper.get('[data-tab-id="c"] .tab-close').trigger('click')
    expect(useTerminalStore().tabs.map(tab => tab.id)).toEqual(['b', 'c', 'a'])
    expect(useTerminalStore().activeTabId).toBe('a')
    expect(unmounts).toEqual([])
  })
  it('keeps touch scrolling native and lets Escape cancel a drag', async () => {
    await wrapper.get('#label-a').trigger('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0, clientX: 30 })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 500 }))
    await nextTick()
    expect(wrapper.find('.drop-marker').exists()).toBe(false)
    await wrapper.get('#label-a').trigger('pointerdown', { pointerType: 'mouse', pointerId: 2, button: 0, clientX: 30 })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 500 }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('.drop-marker').exists()).toBe(false)
    expect(useTerminalStore().tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
  })
})
