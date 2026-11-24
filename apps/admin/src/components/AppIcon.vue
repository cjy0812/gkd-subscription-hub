<script setup lang="ts">
import {
  Activity, Copy, ExternalLink, FileText, Folder, LayoutDashboard, LogOut, Menu, Plus,
  RefreshCw, Search, Trash2,
} from '@lucide/vue'
import type { Component } from 'vue'

type IconName =
  | 'activity'
  | 'copy'
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

const props = withDefaults(
  defineProps<{ name: IconName; size?: number; strokeWidth?: number }>(),
  { size: 18, strokeWidth: 1.8 },
)
const icons: Record<IconName, Component> = {
  activity: Activity,
  copy: Copy,
  'external-link': ExternalLink,
  'file-text': FileText,
  folder: Folder,
  'layout-dashboard': LayoutDashboard,
  'log-out': LogOut,
  menu: Menu,
  plus: Plus,
  'refresh-cw': RefreshCw,
  search: Search,
  'trash-2': Trash2,
}
</script>

<template>
  <component
    :is="icons[props.name]"
    :size="props.size"
    :stroke-width="props.strokeWidth"
    aria-hidden="true"
    focusable="false"
  />
</template>
