<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NCard, NEmpty, NGrid, NGridItem, NInput, NSpace, NSpin, NTag, NText } from 'naive-ui'

interface PublicSubscription {
  id: number; provider: string; owner: string; repo: string; branch: string; group: string;
  repoUrl: string; registeredAt: string; lastCheckedAt: string | null; fileCount: number;
  hasSubscription: boolean; subscriptionPath: string | null
}
interface PublicRule { id: number; name: string; version: string; author?: string; ruleCount: number; appsCount: number; categoriesCount: number }
interface ExplorerEntry { repository: { full_name?: string; html_url?: string; description?: string | null }; fork: boolean; subscriptions: PublicRule[] }

const route = useRoute()
const router = useRouter()
const subscriptions = ref<PublicSubscription[]>([])
const explorer = ref<ExplorerEntry[]>([])
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const loading = ref(true)
const loadError = ref('')
const copyError = ref('')
const copyMessage = ref('')
const visibleSubscriptions = computed(() => subscriptions.value.filter((item) => `${item.id} ${item.owner}/${item.repo} ${item.group}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const visibleExplorer = computed(() => explorer.value.filter((entry) => `${entry.repository.full_name || ''} ${entry.subscriptions.map((sub) => sub.name).join(' ')}`.toLowerCase().includes(query.value.trim().toLowerCase())))
watch(query, (value) => {
  const nextQuery = { ...route.query }
  const normalized = value.trim()
  if (normalized) nextQuery.q = normalized
  else delete nextQuery.q
  if (nextQuery.q !== route.query.q) void router.replace({ query: nextQuery })
})
watch(
  () => route.query.q,
  (value) => {
    const nextValue = typeof value === 'string' ? value : ''
    if (nextValue !== query.value) query.value = nextValue
  },
)


async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [subscriptionResponse, explorerResponse] = await Promise.all([
      fetch('/api/public/subscriptions', { headers: { accept: 'application/json' } }),
      fetch('/api/public/explorer', { headers: { accept: 'application/json' } }),
    ])
    if (!subscriptionResponse.ok || !explorerResponse.ok) throw new Error('公共目录暂时无法读取，请稍后重试')
    const subscriptionData = await subscriptionResponse.json() as { subscriptions: PublicSubscription[] }
    const explorerData = await explorerResponse.json() as { entries: ExplorerEntry[] }
    subscriptions.value = subscriptionData.subscriptions || []
    explorer.value = explorerData.entries || []
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '读取公共目录失败'
  } finally {
    loading.value = false
  }
}
async function copyUrl(item: PublicSubscription) {
  copyError.value = ''
  copyMessage.value = ''
  if (!item.subscriptionPath) {
    copyError.value = '此订阅源没有可用的 gkd.json5 文件'
    return
  }
  const encodedPath = item.subscriptionPath.split('/').map(encodeURIComponent).join('/')
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/${item.id}/${encodedPath}`)
    copyMessage.value = `已复制 ID ${item.id} 的订阅地址`
  } catch {
    copyError.value = '复制失败，请检查浏览器剪贴板权限'
  }
}
onMounted(() => { void load() })
</script>

<template>
  <main class="portal-page">
    <header class="portal-header">
      <a class="portal-brand" href="/" aria-label="GKD Hub 首页"><span class="brand-mark">G</span><span><strong>GKD Subscription Hub</strong><small>订阅源与规则发现目录</small></span></a>
      <a class="admin-link" href="/admin/">管理入口 <span aria-hidden="true">↗</span></a>
    </header>
    <section class="portal-hero">
      <p class="eyebrow">GKD COMMUNITY DIRECTORY</p>
      <h1>发现、浏览与订阅 GKD 规则</h1>
      <p>公开浏览已托管订阅源与已发现的规则仓库。此页面仅提供只读信息，不包含管理或扫描操作。</p>
      <label class="portal-search-field">
        <span>搜索订阅源与规则</span>
        <n-input
          v-model:value="query"
          clearable
          size="large"
          aria-label="搜索订阅源与规则"
          placeholder="搜索订阅 ID、仓库名称或规则名称"
          class="portal-search"
        />
      </label>
    </section>
    <n-space v-if="loadError" vertical class="portal-error">
      <n-text type="error">{{ loadError }}</n-text>
      <n-button secondary @click="load">重试加载目录</n-button>
    </n-space>
    <n-text v-if="copyError" type="error" class="portal-copy-error" role="alert">{{ copyError }}</n-text>
    <n-text v-if="copyMessage" type="success" class="portal-copy-success" role="status">{{ copyMessage }}</n-text>
    <n-spin :show="loading">
      <section class="portal-section">
        <div class="portal-section-heading"><div><h2>托管订阅源</h2><p>按订阅 ID 浏览，复制地址即可在 GKD 中添加。</p></div><n-tag :bordered="false">{{ visibleSubscriptions.length }} 个</n-tag></div>
        <n-grid cols="1 s:2 l:3" :x-gap="16" :y-gap="16" responsive="screen">
          <n-grid-item v-for="item in visibleSubscriptions" :key="item.id">
            <n-card class="portal-card" :bordered="false">
              <div class="portal-card-top"><span class="portal-id">#{{ item.id }}</span><n-tag size="small" :bordered="false">{{ item.group }}</n-tag></div>
              <h3>{{ item.owner }}/{{ item.repo }}</h3>
              <p class="portal-meta">{{ item.provider }} · {{ item.branch }} · {{ item.fileCount }} 个文件</p>
              <n-space align="center" justify="space-between"><a :href="`/${item.id}/dist/`">浏览文件目录</a><n-button size="small" secondary :disabled="!item.hasSubscription || !item.subscriptionPath" @click="copyUrl(item)">复制订阅地址</n-button></n-space>
            </n-card>
          </n-grid-item>
        </n-grid>
        <n-empty v-if="!visibleSubscriptions.length && !loading" description="没有匹配的托管订阅源" />
      </section>
      <section class="portal-section">
        <div class="portal-section-heading"><div><h2>GKD 规则发现</h2><p>来自已验证公开仓库的订阅条目；发现与扫描操作仅在管理端进行。</p></div><n-tag :bordered="false">{{ visibleExplorer.length }} 个仓库</n-tag></div>
        <n-grid cols="1 s:2 l:3" :x-gap="16" :y-gap="16" responsive="screen">
          <n-grid-item v-for="(entry, index) in visibleExplorer" :key="entry.repository.full_name || index">
            <n-card class="portal-card" :bordered="false">
              <h3><a :href="entry.repository.html_url" target="_blank" rel="noopener noreferrer">{{ entry.repository.full_name }}</a></h3>
              <p class="portal-meta">{{ entry.repository.description || '公开 GKD 规则仓库' }}</p>
              <div v-for="rule in entry.subscriptions" :key="`${rule.id}-${rule.version}`" class="rule-row">
                <strong>{{ rule.name }}</strong><span>v{{ rule.version }} · {{ rule.ruleCount }} 条规则 · {{ rule.appsCount }} 个应用</span>
              </div>
            </n-card>
          </n-grid-item>
        </n-grid>
        <n-empty v-if="!visibleExplorer.length && !loading" description="暂无匹配的规则发现结果" />
      </section>
    </n-spin>
    <footer class="portal-footer">公共只读目录 · <a href="/admin/">管理端</a></footer>
  </main>
</template>

<style scoped>
.portal-page{max-width:1240px;margin:0 auto;padding:24px 28px 52px;color:var(--color-text)}
.portal-header{display:flex;align-items:center;justify-content:space-between;gap:16px}
.portal-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}
.portal-brand>span:last-child{display:grid;gap:3px}.portal-brand small,.portal-meta{color:var(--color-text-secondary);font-size:13px}
.brand-mark{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:var(--color-accent);color:#fff;font-weight:700}
.admin-link{color:var(--color-accent);text-decoration:none;font-size:13px}
.portal-hero{padding:68px 0 52px;max-width:780px}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--color-accent);font-weight:700}
.portal-hero h1{font-size:clamp(30px,5vw,48px);line-height:1.16;letter-spacing:-.035em;margin:14px 0}.portal-hero>p:not(.eyebrow){font-size:16px;line-height:1.7;color:var(--color-text-secondary);max-width:680px}
.portal-search-field{display:grid;gap:7px;max-width:620px;margin-top:18px;font-size:13px;font-weight:600;color:var(--color-text)}.portal-search{max-width:620px}.portal-section{margin:20px 0 44px}.portal-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:18px}
.portal-section-heading h2{margin:0 0 5px;font-size:21px}.portal-section-heading p{margin:0;color:var(--color-text-secondary);font-size:13px}
.portal-card{height:100%;border:1px solid var(--color-border);border-radius:var(--radius-large);box-shadow:var(--shadow-card)}
.portal-card-top{display:flex;align-items:center;justify-content:space-between}.portal-id{font-weight:700;color:var(--color-accent);font-variant-numeric:tabular-nums}
.portal-footer{border-top:1px solid var(--color-border);padding-top:20px;color:var(--color-text-secondary);font-size:12px}.portal-footer a{color:inherit}
.portal-error{margin:16px 0}.portal-copy-error{display:block;margin:10px 0}.portal-copy-success{display:block;margin:10px 0}
.portal-card h3{font-size:16px;overflow-wrap:anywhere;margin:16px 0 6px}
.portal-card .portal-meta{min-height:38px;overflow-wrap:anywhere}
.portal-card a{color:var(--color-accent);text-decoration:none}
.portal-card a:hover{text-decoration:underline}
.portal-card h3 a{color:inherit;text-decoration:none}
.portal-card h3 a:hover{color:var(--color-accent)}
.rule-row{display:grid;gap:3px;padding:10px 0;border-top:1px solid var(--color-border)}
.rule-row span{font-size:12px;color:var(--color-text-secondary)}
@media(max-width:600px){.portal-page{padding:16px 16px 36px}.portal-hero{padding:48px 0 32px}.portal-section-heading{align-items:flex-start}.portal-card .portal-meta{min-height:0}}
</style>
