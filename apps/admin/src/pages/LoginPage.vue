<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { setAdminToken } from '../auth'

const message = useMessage()
const router = useRouter()
const password = ref('')
const submitting = ref(false)

async function login() {
  if (!password.value) {
    message.warning('请输入管理员密码')
    return
  }
  const credential = password.value
  submitting.value = true
  try {
    await api('/api/projects', credential)
    setAdminToken(credential)
    message.success('登录成功')
    await router.replace({ name: 'projects' })
  } catch (error) {
    message.error(error instanceof Error ? error.message : '登录失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <n-card class="login-card" :bordered="false">
      <div class="brand-mark">GKD</div>
      <p class="eyebrow">订阅管理平台</p>
      <h1>管理中心</h1>
      <p class="muted">登录后管理订阅源、检查上游更新。</p>
      <n-form @submit.prevent="login">
        <n-form-item label="管理员密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="请输入管理员密码…"
            @keyup.enter="login"
          />
        </n-form-item>
        <n-button type="primary" block :loading="submitting" @click="login">登录</n-button>
      </n-form>
    </n-card>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(ellipse at 15% 15%, rgb(37 99 235 / 9%), transparent 42%), var(--color-canvas);
}

.login-card {
  width: min(420px, 100%);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-large);
  box-shadow: var(--shadow-overlay);
}

.login-card .brand-mark {
  margin-bottom: 18px;
}

.login-card h1 {
  margin: 4px 0 6px;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.03em;
}

.login-card .muted {
  margin: 0 0 24px;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: var(--radius-container);
  background: var(--color-accent);
  color: white;
  font-size: 17px;
  font-weight: 700;
}
</style>
