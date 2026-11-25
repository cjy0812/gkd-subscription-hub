<script setup lang="ts">
import {
  Activity, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Folder, GitBranch, Github,
  LayoutDashboard, LogOut, Menu, MessageSquare, Plus, RefreshCw, Search, Trash2,
} from '@lucide/vue'
import type { Component } from 'vue'

type IconName =
  | 'activity'
  | 'copy'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'external-link'
  | 'file-text'
  | 'folder'
  | 'git-branch'
  | 'github'
  | 'message-square'
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
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'external-link': ExternalLink,
  'file-text': FileText,
  folder: Folder,
  'git-branch': GitBranch,
  github: Github,
  'message-square': MessageSquare,
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
