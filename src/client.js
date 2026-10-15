// dsh-kikicode-provider - browser half.
//
// 设置左侧独立的「Kikicode」一节（slot: settings.section，id kikicode，紧挨官方
// 「模型」），像 Command Code 那样一个完整页面，分三块：
//
//   连接 —— 中转站地址 + API Key + 检测/启用/移除 + 状态徽标
//   用量 —— 余额 / 积分 / 今日请求与花费 / 套餐三窗口进度条（5 小时 · 今日 · 本月）
//   模型 —— 目录摘要 + 同步模型 + 可装模型的明细表（厂商 / 价格 / 档位 / 图片）
//
// classic client bundle（client-modules 协议）：注册到 window.__ModuleLoader__ 并导出
// apply()，不需要构建步骤。所有写入走后端的回环路由，这里只负责画和 fetch。
//
// ⚠️ 教训：对象字面量里 'station.balance': 这类带点键名必须加引号 —— 裸写是语法
// 错误，宿主半照常工作，只有浏览器报 "import failed"，卡片整个不出现。单测里的
// vm.Script 编译守卫就是为它加的。

window.__ModuleLoader__.load({
  id: 'dsh-kikicode-provider',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const { jsx } = jsxRuntime

    const NS = 'dsh-kikicode-provider'
    const ROUTE_PREFIX = '/dsh-kikicode'

    /** 小工具：children 走 props.children，跟 jsx runtime 的期望一致。 */
    const h = (type, props, ...children) =>
      jsx(type, {
        ...(props || {}),
        ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
      })

    // --- 文案 -----------------------------------------------------------------

    const zh = {
      nav: 'Kikicode',
      title: 'Kikicode 中转站',
      hint: '局域网 OpenAI 兼容中转站：填地址、粘贴 API Key，插件自动同步模型目录与每个模型的思考档位。写入官方 llm-pi-ai 设置与凭据服务，立即生效、无需重启。',
      'group.connection': '连接',
      'group.usage': '用量',
      'group.models': '模型',
      refresh: '刷新',
      loading: '读取中…',
      baseURL: '中转站地址',
      baseURLHint: '填到 /v1 为止；只填 http://主机:端口 会自动补 /v1',
      apiKey: 'API Key',
      apiKeyPlaceholder: '粘贴中转站里创建的 Key（sk-…）',
      apiKeyKeep: '留空 = 继续用已保存的 Key',
      'key.saved': '凭据里已有 Key',
      'action.probe': '检测',
      'action.enable': '启用',
      'action.refreshModels': '同步模型',
      'action.refreshUsage': '刷新用量',
      'action.remove': '移除',
      'action.showModels': '看看会装进哪些模型',
      'action.hideModels': '收起模型列表',
      'action.rekey': '换 Key / 改地址',
      'status.live': '运行中',
      'status.stored': '已写入',
      'status.noKey': '缺 Key',
      'status.unconfigured': '未配置',
      'conn.baseURL': '地址',
      'conn.key': 'Key',
      'conn.keyLastUsed': '上次使用',
      'conn.never': '从未',
      'usage.balance': '余额',
      'usage.points': '积分',
      'usage.today': '今日',
      'usage.todayValue': '{req} 次请求 · 余额付 ¥{spend} · 套餐额度 {plan}',
      'usage.holds': '在途预扣',
      'usage.plan': '套餐',
      'usage.planNone': '未开通套餐，按余额计费',
      'usage.planLeft': '{name} · 剩 {days} 天{exhausted}',
      'usage.exhausted': ' · 月额度已用完',
      'usage.window5h': '5 小时窗口',
      'usage.windowDay': '今日窗口',
      'usage.windowMonth': '本月额度',
      'usage.unreachable': '读不到用量：{error}',
      'models.summary': '{total} 个可用 · {reasoning} 个可选档位 · {vision} 个支持图片',
      'probe.title': '检测结果',
      'probe.value': '{total} 个模型可用（站内共 {advertised} 个，{unavailable} 个渠道已停用）· {reasoning} 个能选思考档位',
      'probe.levels': '出现的档位：{levels}',
      'models.id': '模型',
      'models.vendor': '厂商',
      'models.price': '价格（元 / 百万 token）',
      'models.levels': '思考档位',
      'models.vision': '图片',
      'models.unavailable': '渠道停用',
      'models.none': '站内没有可用模型',
      'models.search': '搜索模型…',
      'models.total': '共 {n} 个',
      'models.filtered': '{n} / {total} 个',
      'models.noLevels': '无档位',
      'models.windowTitle': '上下文窗口 {n} tokens（中转站从上游元数据导入）',
      'price.title': '输入 ¥{input} / 百万 token · 输出 ¥{output} / 百万 token{hit}',
      'price.hit': ' · 缓存命中 ¥{hit}',
      'price.none': '站内没有这个模型的价格',
      'notice.enabled': '已启用 Kikicode（{models} 个模型），去模型选择器就能看到',
      'notice.refreshed': '已同步模型目录（{models} 个）',
      'notice.removed': '已移除 Kikicode 路由',
      'remove.confirm': '移除 Kikicode？已保存的 API Key 会保留（想连 Key 一起删就再点一次确认）。',
      'removeKey.confirm': '连 API Key 一起删掉？',
      'error.keyRequired': '请先填写 API Key',
    }
    const en = {
      nav: 'Kikicode',
      title: 'Kikicode relay',
      hint: 'A LAN OpenAI-compatible relay: enter the address, paste the API key; the plugin syncs the model catalog and each model’s reasoning levels. Writes the official llm-pi-ai settings and credentials service — effective immediately, no restart.',
      'group.connection': 'Connection',
      'group.usage': 'Usage',
      'group.models': 'Models',
      refresh: 'Refresh',
      loading: 'Loading…',
      baseURL: 'Relay base URL',
      baseURLHint: 'Up to /v1; http://host:port gets /v1 appended',
      apiKey: 'API key',
      apiKeyPlaceholder: 'Paste a key created on the relay (sk-…)',
      apiKeyKeep: 'Leave empty to keep the stored key',
      'key.saved': 'a key is already stored',
      'action.probe': 'Test',
      'action.enable': 'Enable',
      'action.refreshModels': 'Sync models',
      'action.refreshUsage': 'Refresh usage',
      'action.remove': 'Remove',
      'action.showModels': 'Preview the models to be added',
      'action.hideModels': 'Hide the model list',
      'action.rekey': 'Replace key / address',
      'status.live': 'live',
      'status.stored': 'written',
      'status.noKey': 'no key',
      'status.unconfigured': 'not configured',
      'conn.baseURL': 'Address',
      'conn.key': 'Key',
      'conn.keyLastUsed': 'Last used',
      'conn.never': 'never',
      'usage.balance': 'Balance',
      'usage.points': 'Points',
      'usage.today': 'Today',
      'usage.todayValue': '{req} requests · ¥{spend} from balance · {plan} from plan quota',
      'usage.holds': 'In-flight holds',
      'usage.plan': 'Plan',
      'usage.planNone': 'No plan — billed from balance',
      'usage.planLeft': '{name} · {days} days left{exhausted}',
      'usage.exhausted': ' · monthly quota exhausted',
      'usage.window5h': '5-hour window',
      'usage.windowDay': 'Daily window',
      'usage.windowMonth': 'Monthly quota',
      'usage.unreachable': 'Usage unavailable: {error}',
      'models.summary': '{total} usable · {reasoning} with levels · {vision} with images',
      'probe.title': 'Probe result',
      'probe.value': '{total} usable models (relay advertises {advertised}, {unavailable} on disabled channels) · {reasoning} expose reasoning levels',
      'probe.levels': 'Levels seen: {levels}',
      'models.id': 'Model',
      'models.vendor': 'Vendor',
      'models.price': 'Price (CNY / 1M tokens)',
      'models.levels': 'Reasoning',
      'models.vision': 'Image',
      'models.unavailable': 'channel off',
      'models.none': 'No usable model on the relay',
      'models.search': 'Search models…',
      'models.total': '{n} total',
      'models.filtered': '{n} of {total}',
      'models.noLevels': 'no levels',
      'models.windowTitle': 'Context window {n} tokens (imported from the relay’s upstream metadata)',
      'price.title': 'Input ¥{input} / 1M tokens · output ¥{output} / 1M tokens{hit}',
      'price.hit': ' · cached ¥{hit}',
      'price.none': 'no price for this model on the relay',
      'notice.enabled': 'Kikicode enabled ({models} models) — see them in the model picker',
      'notice.refreshed': 'Model catalog synced ({models})',
      'notice.removed': 'Kikicode route removed',
      'remove.confirm': 'Remove Kikicode? The stored API key stays (confirm twice to delete the key too).',
      'removeKey.confirm': 'Delete the stored API key as well?',
      'error.keyRequired': 'Enter an API key first',
    }

    const format = (template, vars) =>
      String(template).replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] !== undefined ? String(vars[key]) : ''))

    // --- 样式（注入一次，class 前缀 kk-）--------------------------------------

    const CSS = `
.kk-page{max-width:760px;display:flex;flex-direction:column;gap:14px}
.kk-h1{font-size:16px;font-weight:600;margin:0}
.kk-hint{opacity:.7;line-height:1.55;margin:0;font-size:13px}
.kk-h2{font-size:13px;font-weight:600;margin:2px 0 8px;opacity:.85}
.kk-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:14px 16px;font-size:13px}
.kk-row{display:flex;align-items:baseline;gap:8px;padding:3px 0;line-height:1.6}
.kk-rowTop{align-items:center}
.kk-label{opacity:.6;min-width:88px;flex:none}
.kk-value{flex:1;min-width:0;overflow-wrap:anywhere}
.kk-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);opacity:.9;flex:none}
.kk-badgeLive{color:var(--dsw-alias-state-success-primary,#1d9a4a);border-color:var(--dsw-alias-state-success-primary,#1d9a4a)}
.kk-badgeWarn{color:var(--dsw-alias-state-warning-primary,#b8860b)}
.kk-field{display:flex;flex-direction:column;gap:4px;margin:8px 0}
.kk-input{width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:transparent;color:inherit;font-size:13px;box-sizing:border-box}
.kk-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:transparent;color:inherit;cursor:pointer;font-size:13px}
.kk-btnPrimary{padding:6px 16px;border-radius:8px;border:1px solid transparent;background:var(--dsw-alias-interactive-bg-hover,#2f6fec);color:#fff;cursor:pointer;font-size:13px;font-weight:600}
.kk-btnDanger{padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:transparent;color:var(--dsw-alias-state-error-primary,#c0392b);cursor:pointer;font-size:12px}
.kk-linkBtn{background:none;border:none;color:var(--dsw-alias-link,#2f6fec);cursor:pointer;font-size:12px;padding:0}
.kk-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.kk-error{color:var(--dsw-alias-state-error-primary,#c0392b);margin:4px 0}
.kk-notice{color:var(--dsw-alias-state-success-primary,#1d9a4a);margin:4px 0}
.kk-sub{opacity:.6;font-size:12px}
.kk-bar{display:block;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#e9ecf1);overflow:hidden;flex:1}
.kk-barFill{display:block;height:100%;width:0;border-radius:999px;background:var(--dsw-alias-brand-primary,#2f6fec);transition:width .3s ease}
.kk-barFillHot{background:var(--dsw-alias-state-warning-primary,#e67e22)}
.kk-window{display:flex;align-items:center;gap:10px;padding:2px 0;font-size:12px}
.kk-windowLabel{opacity:.65;width:88px;flex:none}
.kk-windowValue{opacity:.75;width:150px;flex:none;text-align:right}
.kk-chip{font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3,#e2e5ea);opacity:.85;margin-right:4px;display:inline-block}
.kk-chipLevel{border-color:var(--dsw-alias-brand-primary,#2f6fec);color:var(--dsw-alias-brand-primary,#2f6fec);opacity:1}
.kk-chipOff{color:var(--dsw-alias-state-error-primary,#c0392b);border-color:currentColor}
.kk-models{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.kk-modelsBar{display:flex;align-items:center;gap:10px}
.kk-search{flex:1;max-width:260px;padding:6px 9px}
.kk-list{max-height:340px;overflow:auto;border:1px solid var(--dsw-alias-border-l3,#eef0f3);border-radius:10px;padding:2px}
.kk-item{padding:8px 10px;border-radius:8px}
.kk-item:hover{background:var(--dsw-alias-bg-layer-1,#f2f4f7)}
.kk-item + .kk-item{border-top:1px solid var(--dsw-alias-border-l3,#f5f6f8)}
.kk-itemOff{opacity:.5}
.kk-itemTop{display:flex;align-items:baseline;gap:10px}
.kk-itemId{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kk-itemPrice{flex:none;font-size:12px;opacity:.6;white-space:nowrap}
.kk-itemMeta{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px}
.kk-empty{opacity:.6;font-size:12px;padding:8px 2px}
.kk-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-reduced-motion:reduce){.kk-barFill{transition:none}}
`

    function injectCss(id, css) {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-kikicode-provider'
      tag.dataset.pluginCss = id
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    // --- 后端调用 -------------------------------------------------------------

    async function call(path, init) {
      const response = await fetch(`${ROUTE_PREFIX}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!payload || payload.ok !== true) {
        throw new Error((payload && (payload.error || payload.code)) || `HTTP ${response.status}`)
      }
      return payload
    }

    const money = (value) => `¥${Number(value || 0).toFixed(2)}`
    const priceText = (price) => (price ? `¥${price.input} / ¥${price.output}` : '')
    /** 上下文窗口的紧凑写法：1000000 → 1M，200000 → 200K */
    const windowLabel = (n) => {
      const v = Number(n || 0)
      if (!Number.isFinite(v) || v <= 0) return ''
      return v >= 1000000 ? `${Math.round(v / 100000) / 10}M` : `${Math.round(v / 1000)}K`
    }

    // --- 页面 -----------------------------------------------------------------

    function KikicodeSection({ t }) {
      const tr = (key, vars) => format(t(key), vars)
      const [state, setState] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [notice, setNotice] = react.useState(null)
      const [busy, setBusy] = react.useState(null)
      const [baseURL, setBaseURL] = react.useState('')
      const [apiKey, setApiKey] = react.useState('')
      const [probe, setProbe] = react.useState(null)
      const [rows, setRows] = react.useState(null)
      const [showModels, setShowModels] = react.useState(false)
      const [modelQuery, setModelQuery] = react.useState('')
      const [rekey, setRekey] = react.useState(false)

      const load = react.useCallback(async () => {
        setBusy('__load')
        try {
          const next = await call('/state')
          setState(next)
          setBaseURL((current) => (current === '' ? next.baseURL || next.defaultBaseURL || '' : current))
          setError(null)
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }, [])

      react.useEffect(() => {
        load()
      }, [load])

      const run = async (label, fn) => {
        setBusy(label)
        setError(null)
        setNotice(null)
        try {
          return await fn()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
          return null
        } finally {
          setBusy(null)
        }
      }

      const doProbe = () =>
        run('__probe', async () => {
          const result = await call('/preview', { method: 'POST', body: JSON.stringify({ baseURL, key: apiKey }) })
          setProbe(result)
          setRows(result.models || [])
          setShowModels(true)
          return result
        })

      const doEnable = () =>
        run('__enable', async () => {
          const result = await call('/enable', { method: 'POST', body: JSON.stringify({ baseURL, key: apiKey }) })
          setApiKey('')
          setProbe(null)
          setRows(null)
          setShowModels(false)
          setRekey(false)
          setNotice(tr('notice.enabled', { models: result.models }))
          await load()
        })

      const doRefresh = () =>
        run('__refresh', async () => {
          const result = await call('/refresh', { method: 'POST', body: JSON.stringify({ baseURL }) })
          setRows(result.models_preview || null)
          setNotice(tr('notice.refreshed', { models: result.models }))
          await load()
        })

      const doRemove = async () => {
        const asked = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(tr('remove.confirm')) : true
        if (!asked) return
        const dropKey = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(tr('removeKey.confirm')) : false
        await run('__remove', async () => {
          await call('/remove', { method: 'POST', body: JSON.stringify({ removeKey: dropKey }) })
          setNotice(tr('notice.removed'))
          setRekey(false)
          await load()
        })
      }

      // 展开模型明细时按需拉一次目录（用已存的 Key，不写任何东西）。
      // 之前只在「检测」「同步模型」之后才有 rows，直接展开就会走到兜底文案
      // 「站内没有可用模型」—— 看起来像坏了，其实是没拉。
      const toggleModels = () => {
        const next = !showModels
        setShowModels(next)
        if (next && !rows && !probe) {
          void run('__rows', async () => {
            const result = await call('/preview', { method: 'POST', body: JSON.stringify({ baseURL }) })
            setRows(result.models || [])
          })
        }
      }

      const configured = state ? state.configured === true : false
      const info = state ? state.station : null
      const me = state && state.usage && state.usage.ok !== false ? state.usage : null
      const plan = me && me.plan && me.plan.active === true ? me.plan : null

      /** 价格悬浮说明：单位、命中价都用当前语言说清楚。 */
      const priceTip = (price) =>
        price
          ? format(t('price.title'), {
              input: price.input,
              output: price.output,
              hit: price.hit === null || price.hit === undefined ? '' : format(t('price.hit'), { hit: price.hit }),
            })
          : t('price.none')

      const statusBadge = () => {
        if (!state) return null
        const parts = []
        if (!configured) parts.push(tr('status.unconfigured'))
        else parts.push(state.live ? tr('status.live') : tr('status.stored'))
        if (configured && !state.keyConfigured) parts.push(tr('status.noKey'))
        const cls = !configured ? 'kk-badge' : state.live && state.keyConfigured ? 'kk-badge kk-badgeLive' : 'kk-badge kk-badgeWarn'
        return h('span', { className: cls }, parts.join(' · '))
      }

      const windowBar = (label, used, limit) => {
        const usedN = Number(used || 0)
        const limitN = Number(limit || 0)
        const pct = limitN > 0 ? Math.min(100, Math.round((usedN / limitN) * 100)) : 0
        return h('div', { className: 'kk-window', key: label },
          h('span', { className: 'kk-windowLabel' }, label),
          h('span', { className: 'kk-bar' },
            h('span', { className: pct >= 90 ? 'kk-barFill kk-barFillHot' : 'kk-barFill', style: { width: `${pct}%` } })),
          h('span', { className: 'kk-windowValue' }, `${money(usedN)} / ${money(limitN)} · ${pct}%`),
        )
      }

      const connectionCard = () =>
        h('div', { className: 'kk-card' },
          h('div', { className: 'kk-h2' }, tr('group.connection')),
          h('div', { className: 'kk-row kk-rowTop' },
            statusBadge(),
            h('span', { className: 'kk-sub' }, info ? tr('models.summary', { total: info.modelCount, reasoning: info.reasoningCount, vision: info.visionCount }) : null),
          ),
          configured && !rekey
            ? h('div', null,
                h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('conn.baseURL')), h('span', { className: 'kk-value kk-mono' }, info ? info.baseURL : '')),
                h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('conn.key')), h('span', { className: 'kk-value' },
                  state && state.keyConfigured ? tr('key.saved') : tr('status.noKey'),
                  me && me.key ? ` · ${me.key.name}` : '',
                )),
                h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('conn.keyLastUsed')), h('span', { className: 'kk-value' },
                  me && me.key && me.key.last_used ? new Date(me.key.last_used).toLocaleString() : tr('conn.never'),
                )),
              )
            : h('div', null,
                h('label', { className: 'kk-field' },
                  h('span', { className: 'kk-sub' }, tr('baseURL')),
                  h('input', {
                    className: 'kk-input',
                    value: baseURL,
                    placeholder: state ? state.defaultBaseURL : 'http://192.168.1.101:3100/v1',
                    onChange: (event) => setBaseURL(event.target.value),
                  }),
                  h('span', { className: 'kk-sub' }, tr('baseURLHint')),
                ),
                h('label', { className: 'kk-field' },
                  h('span', { className: 'kk-sub' }, tr('apiKey'), configured && state && state.keyConfigured ? ` · ${tr('key.saved')}` : ''),
                  h('input', {
                    className: 'kk-input',
                    type: 'password',
                    autoComplete: 'off',
                    value: apiKey,
                    placeholder: configured ? tr('apiKeyKeep') : tr('apiKeyPlaceholder'),
                    onChange: (event) => setApiKey(event.target.value),
                  }),
                ),
              ),
          h('div', { className: 'kk-actions' },
            configured && !rekey
              ? h('button', { type: 'button', className: 'kk-btn', disabled: busy !== null, onClick: doRefresh }, busy === '__refresh' ? tr('loading') : tr('action.refreshModels'))
              : h('button', { type: 'button', className: 'kk-btn', disabled: busy !== null, onClick: doProbe }, busy === '__probe' ? tr('loading') : tr('action.probe')),
            configured && !rekey
              ? h('button', { type: 'button', className: 'kk-btn', disabled: busy !== null, onClick: () => setRekey(true) }, tr('action.rekey'))
              : h('button', { type: 'button', className: 'kk-btnPrimary', disabled: busy !== null, onClick: doEnable }, busy === '__enable' ? tr('loading') : tr('action.enable')),
            configured
              ? h('button', { type: 'button', className: 'kk-btnDanger', disabled: busy !== null, onClick: doRemove }, tr('action.remove'))
              : null,
          ),
        )

      const usageCard = () => {
        if (!configured) return null
        if (state && state.usageError) {
          return h('div', { className: 'kk-card' },
            h('div', { className: 'kk-h2' }, tr('group.usage')),
            h('div', { className: 'kk-sub' }, tr('usage.unreachable', { error: state.usageError })))
        }
        if (!me) return null
        return h('div', { className: 'kk-card' },
          h('div', { className: 'kk-row kk-rowTop' },
            h('div', { className: 'kk-h2', style: { margin: 0, flex: 1 } }, tr('group.usage')),
            h('button', { type: 'button', className: 'kk-btn', disabled: busy !== null, onClick: load }, busy === '__load' ? tr('loading') : tr('action.refreshUsage')),
          ),
          h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.balance')), h('span', { className: 'kk-value' }, money(me.balance))),
          h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.points')), h('span', { className: 'kk-value' }, String(me.points ?? 0))),
          h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.today')), h('span', { className: 'kk-value' },
            tr('usage.todayValue', { req: me.req_today ?? 0, spend: Number(me.spend_today || 0).toFixed(4), plan: Number(me.plan_today || 0).toFixed(2) }))),
          Number(me.holds) > 0
            ? h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.holds')), h('span', { className: 'kk-value' }, money(me.holds)))
            : null,
          plan
            ? h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.plan')), h('span', { className: 'kk-value' },
                tr('usage.planLeft', { name: plan.name || plan.tier, days: plan.left_days, exhausted: plan.exhausted ? tr('usage.exhausted') : '' })))
            : h('div', { className: 'kk-row' }, h('span', { className: 'kk-label' }, tr('usage.plan')), h('span', { className: 'kk-value kk-sub' }, tr('usage.planNone'))),
          plan && plan.limits
            ? h('div', { style: { marginTop: 6 } },
                windowBar(tr('usage.window5h'), plan.used && plan.used.w5, plan.limits.w5),
                windowBar(tr('usage.windowDay'), plan.used && plan.used.day, plan.limits.day),
                windowBar(tr('usage.windowMonth'), plan.used && plan.used.month, plan.limits.month),
              )
            : null,
        )
      }

      const renderModels = () => {
        if (!showModels) return null
        if (busy === '__rows') return h('div', { className: 'kk-empty' }, tr('loading'))
        const all = rows || (probe && probe.models) || []
        if (all.length === 0) return h('div', { className: 'kk-empty' }, tr('models.none'))
        // 112 个模型平铺太吵：给一个搜索框，并把每行拆成「模型名 + 价格」和一行标签，
        // 比四列表格好读（表格里长模型名会和价格/档位挤在一起）。
        const query = modelQuery.trim().toLowerCase()
        const list = query === ''
          ? all
          : all.filter((row) => `${row.id} ${row.vendor || ''}`.toLowerCase().includes(query))
        return h('div', { className: 'kk-models' },
          h('div', { className: 'kk-modelsBar' },
            h('input', {
              className: 'kk-input kk-search',
              value: modelQuery,
              placeholder: tr('models.search'),
              onChange: (event) => setModelQuery(event.target.value),
            }),
            h('span', { className: 'kk-sub' },
              query === '' ? tr('models.total', { n: all.length }) : tr('models.filtered', { n: list.length, total: all.length })),
          ),
          list.length === 0
            ? h('div', { className: 'kk-empty' }, tr('models.none'))
            : h('div', { className: 'kk-list' },
                list.map((row) =>
                  h('div', { className: row.available === false ? 'kk-item kk-itemOff' : 'kk-item', key: row.id },
                    h('div', { className: 'kk-itemTop' },
                      h('span', { className: 'kk-itemId' }, row.id),
                      h('span', { className: 'kk-itemPrice', title: priceTip(row.price) }, priceText(row.price)),
                    ),
                    h('div', { className: 'kk-itemMeta' },
                      row.vendor ? h('span', { className: 'kk-chip' }, row.vendor) : null,
                      row.context ? h('span', { className: 'kk-chip', title: tr('models.windowTitle', { n: row.context }) }, windowLabel(row.context)) : null,
                      row.vision ? h('span', { className: 'kk-chip' }, tr('models.vision')) : null,
                      row.available === false ? h('span', { className: 'kk-chip kk-chipOff' }, tr('models.unavailable')) : null,
                      row.levels && row.levels.length > 0
                        ? row.levels.map((level) => h('span', { className: 'kk-chip kk-chipLevel', key: level }, level))
                        : h('span', { className: 'kk-sub' }, tr('models.noLevels')),
                    ),
                  ),
                ),
              ),
        )
      }

      const probeCard = () => {
        if (!probe) return null
        const summary = probe.summary || {}
        return h('div', { className: 'kk-card' },
          h('div', { className: 'kk-h2' }, tr('probe.title')),
          h('div', null, tr('probe.value', {
            total: summary.total ?? 0,
            advertised: summary.advertised ?? 0,
            unavailable: summary.unavailable ?? 0,
            reasoning: summary.reasoning ?? 0,
          })),
          summary.levels && summary.levels.length > 0
            ? h('div', { className: 'kk-sub' }, tr('probe.levels', { levels: summary.levels.join(' / ') }))
            : null,
        )
      }

      const modelsCard = () => {
        if (!configured && !probe) return null
        return h('div', { className: 'kk-card' },
          h('div', { className: 'kk-row kk-rowTop' },
            h('div', { className: 'kk-h2', style: { margin: 0, flex: 1 } }, tr('group.models')),
            h('button', { type: 'button', className: 'kk-linkBtn', disabled: busy !== null, onClick: toggleModels },
              busy === '__rows' ? tr('loading') : showModels ? tr('action.hideModels') : tr('action.showModels')),
          ),
          info
            ? h('div', { className: 'kk-row' }, h('span', { className: 'kk-value' },
                tr('models.summary', { total: info.modelCount, reasoning: info.reasoningCount, vision: info.visionCount })))
            : null,
          renderModels(),
        )
      }

      return h('div', { className: 'kk-page', 'data-dsh-part': 'kikicode' },
        h('h1', { className: 'kk-h1' }, tr('title')),
        h('p', { className: 'kk-hint' }, tr('hint')),
        error ? h('div', { className: 'kk-error' }, error) : null,
        notice ? h('div', { className: 'kk-notice' }, notice) : null,
        connectionCard(),
        usageCard(),
        probe ? probeCard() : null,
        modelsCard(),
      )
    }

    // --- 插件 -----------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-kikicode-provider: dictionaries')
      ctx.effect(() => injectCss('dsh-kikicode-provider', CSS), 'dsh-kikicode-provider: styles')
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'kikicode',
          order: 12,
          label: () => ctx.locale.bind(NS)('nav'),
          locale: NS,
        }, KikicodeSection),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
