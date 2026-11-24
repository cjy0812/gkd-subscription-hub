import { describe, expect, it } from 'vitest'
import {
  getAppsPage,
  getCategoriesPage,
  getGroupsPage,
  getRuleDetail,
  getRulesPage,
  isRawSubscription,
  summarizeSubscription,
} from './preview-model'
import type { RawSubscription } from '@gkd-kit/api'

function makeSubscription(): RawSubscription {
  return {
    id: 233,
    name: 'GKD 测试订阅',
    version: 123,
    author: 'tester',
    updateUrl: 'https://example.com/gkd.json5',
    apps: Array.from({ length: 55 }, (_, index) => ({
      id: 'com.example.app' + index,
      name: '应用 ' + index,
      groups: [
        {
          key: index + 1,
          name: '规则组 ' + index,
          desc: '组说明',
          enable: true,
          fastQuery: true,
          activityIds: ['.MainActivity'],
          rules: Array.from({ length: 60 }, (_, ruleIndex) => ({
            key: ruleIndex + 1,
            name: '规则 ' + ruleIndex,
            action: 'click',
            matches: 'TextView[text="跳过"]',
          })),
        },
      ],
    })),
    globalGroups: [
      {
        key: 900,
        name: '全局规则',
        enable: false,
        matchAnyApp: true,
        rules: [
          {
            key: 901,
            name: '全局点击',
            action: 'back',
            anyMatches: ['TextView[text="关闭"]', 'Button[text="取消"]'],
          },
        ],
      },
    ],
    categories: [
      { key: 1, name: '开屏广告' },
      { key: 2, name: '弹窗', enable: false },
    ],
  }
}

describe('GKD subscription preview model', () => {
  it('validates official subscription shape and summarizes metadata', () => {
    const value = makeSubscription()
    expect(isRawSubscription(value)).toBe(true)
    expect(isRawSubscription({ id: 1, name: '', version: 2 })).toBe(false)
    const objectRule = makeSubscription()
    if (objectRule.apps?.[0]?.groups[0]) {
      objectRule.apps[0].groups[0].rules = {
        key: 777,
        matches: 'TextView[text="继续"]',
      }
    }
    expect(isRawSubscription(objectRule)).toBe(true)
    expect(getRulesPage(objectRule, 'app', 0, 0, 1, 50).items[0]).toMatchObject({
      key: 777,
      matches: 'TextView[text="继续"]',
    })
    expect(summarizeSubscription(value)).toMatchObject({
      meta: { id: 233, name: 'GKD 测试订阅', version: 123, author: 'tester' },
      stats: {
        apps: 55,
        appGroups: 55,
        appRules: 3300,
        globalGroups: 1,
        globalRules: 1,
        categories: 2,
      },
    })
  })

  it('paginates and searches applications without returning full group data', () => {
    const value = makeSubscription()
    const secondPage = getAppsPage(value, 2, 50)
    expect(secondPage).toMatchObject({ page: 2, pageSize: 50, total: 55, pageCount: 2 })
    expect(secondPage.items).toHaveLength(5)
    expect(secondPage.items[0]).toMatchObject({
      index: 50,
      id: 'com.example.app50',
      name: '应用 50',
      groupCount: 1,
      ruleCount: 60,
    })
    expect(getAppsPage(value, 1, 50, 'APP54').items).toHaveLength(1)
  })

  it('loads app groups and rule pages only when requested', () => {
    const value = makeSubscription()
    const groups = getGroupsPage(value, 'app', 0, 1, 50)
    expect(groups.items[0]).toMatchObject({
      index: 0,
      key: 1,
      name: '规则组 0',
      ruleCount: 60,
      attributes: [
        { key: 'fastQuery', value: 'true' },
        { key: 'activityIds', value: '[".MainActivity"]' },
      ],
    })
    const rules = getRulesPage(value, 'app', 0, 0, 2, 50, 'textview')
    expect(rules).toMatchObject({ page: 2, total: 60, pageCount: 2 })
    expect(rules.items).toHaveLength(10)
    expect(rules.items[0].index).toBe(50)
    expect(rules.items.at(-1)?.index).toBe(59)
    expect(rules.items[0]).toMatchObject({
      index: 0,
      key: 1,
      name: '规则 0',
      action: 'click',
      matches: 'TextView[text="跳过"]',
    })
    expect(getRuleDetail(value, 'app', 0, 0, 0)).toMatchObject({
      name: '规则 0',
      action: 'click',
    })
  })

  it('supports global rules and categories through separate lazy requests', () => {
    const value = makeSubscription()
    expect(getGroupsPage(value, 'global', undefined, 1, 50).items[0]).toMatchObject({
      index: 0,
      key: 900,
      name: '全局规则',
      enabled: false,
      attributes: [{ key: 'matchAnyApp', value: 'true' }],
    })
    expect(getRulesPage(value, 'global', undefined, 0, 1, 50).items[0]).toMatchObject({
      key: 901,
      name: '全局点击',
      action: 'back',
      anyMatches: 'TextView[text="关闭"]\nButton[text="取消"]',
    })
    expect(getCategoriesPage(value, 1, 50, '弹窗').items).toEqual([
      { key: 2, name: '弹窗', enable: false },
    ])
  })
})
