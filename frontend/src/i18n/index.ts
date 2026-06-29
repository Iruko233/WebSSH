import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

export const i18n = createI18n({
  legacy: false, // you must set `false`, to use Composition API
  locale: 'zh-CN', // default locale
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  }
})
