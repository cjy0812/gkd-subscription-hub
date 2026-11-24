<script setup lang="ts">
withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 })

type IconName =
  | 'activity'
  | 'external-link'
  | 'file-text'
  | 'folder'
  | 'layout-dashboard'
  | 'log-out'
  | 'menu'
  | 'plus'
  | 'refresh-cw'
  | 'search'
  | 'trash-2'

const paths: Record<IconName, string[]> = {
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  'external-link': ['M14 3h7v7', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  'file-text': ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 12h6', 'M9 16h6'],
  folder: ['M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  'layout-dashboard': [
    'M3 3h7v7H3z',
    'M14 3h7v7h-7z',
    'M14 14h7v7h-7z',
    'M3 14h7v7H3z',
  ],
  'log-out': ['M10 17l5-5-5-5', 'M15 12H3', 'M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  plus: ['M12 5v14', 'M5 12h14'],
  'refresh-cw': ['M20 7v5h-5', 'M4 17v-5h5', 'M5.6 9a7 7 0 0 1 11.8-2L20 12', 'M4 12l2.6 5a7 7 0 0 0 11.8-2'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'M17 17l4 4'],
  'trash-2': ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v5', 'M14 11v5'],
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(path, index) in paths[name]" :key="index" :d="path" />
  </svg>
</template>
