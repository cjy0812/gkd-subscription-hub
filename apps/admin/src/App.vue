<script setup lang="ts">
import type { GlobalThemeOverrides } from 'naive-ui'
import { NConfigProvider, NMessageProvider, zhCN, dateZhCN } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: 'var(--color-accent)',
    primaryColorHover: 'var(--color-accent-hover)',
    primaryColorPressed: 'var(--color-accent-pressed)',
    borderRadius: 'var(--radius-container)',
    borderRadiusSmall: 'var(--radius-control)',
  },
}
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <n-message-provider>
      <router-view />
    </n-message-provider>
  </n-config-provider>
</template>
