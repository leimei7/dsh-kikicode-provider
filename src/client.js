// dsh-kikicode-provider - browser half.
//
// 官方「设置 → 模型」页脚上挂一张 Kikicode 卡片（slot: settings.models.footer）：
// 填地址 + 粘贴 API Key → 启用，插件自己去中转站拉模型目录（含每个模型的思考档位）、
// 写官方 llm-pi-ai 路由与凭据，并显示余额/积分/套餐/今日用量。
//
// 这是一个 classic client bundle（client-modules 协议）：注册到
// window.__ModuleLoader__ 并导出 apply()，不需要构建步骤，除 react 与官方
// primitives 外不依赖任何东西。所有写入都走后端的回环路由，这里只负责画和 fetch。

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
      title: 'Kikicode 中转站',
      hint: '局域网中转站：填地址、粘贴 API Key，插件自动同步模型目录与每个模型的思考档位。写入官方 llm-pi-ai 设置与凭据服务，立即生效、无需重启。',
      refresh: '刷新',
      loading: '读取中…',
      baseURL: '中转站地址',
      baseURLHint: '填到 /v1 为止；只填 http://主机:端口 会自动补 /v1',
      apiKey: 'API Key',
      apiKeyPlaceholder: '粘贴中转站里创建的 Key（sk-…）',
      apiKeyKeep: '留空 = 继续用已保存的 Key',
      'action.probe': '检测',
      'action.enable': '启用',
      'action.refreshModels': '同步模型',
      'action.remove': '移除',
      'action.showModels': '看看会装进哪些模型',
      'action.hideModels': '收起模型列表',
      'action.rekey': '换 Key',
      'status.live': '运行中',
      'status.stored': '已写入',
      'status.noKey': '缺 Key',
      'status.configured': '已配置',
      'station.title': '中转站状态',
      'station.site': '站点',
      'station.user': '账号',
      'station.key': 'Key',
      'station.balance': '余额',
      'station.points': '积分',
      'station.plan': '套餐',
      'station.planNone': '未开通套餐',
      'station.planLeft': '{name} · 剩 {days} 天 · 本月已用 {used}/{limit}',
      'station.today': '今日',
      'station.todayValue': '{req} 次请求 · 余额 ¥{spend} · 套餐额度 {plan}',
      'station.models': '模型',
      'station.modelsValue': '{total} 个可用 · {reasoning} 个可选档位 · {vision} 个支持图片',
      'station.unreachable': '读不到用量：{error}',
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
      'notice.enabled': '已启用 Kikicode（{models} 个模型）',
      'notice.refreshed': '已同步模型目录（{models} 个）',
      'notice.removed': '已移除 Kikicode 路由',
      'remove.confirm': '移除 Kikicode？已保存的 API Key 会保留（想连 Key 一起删就再点一次删除 Key）。',
      'removeKey.confirm': '连 API Key 一起删掉？',
      'error.keyRequired': '请先填写 API Key',
      'key.saved': '凭据里已有 Key',
    }
    const en = {
      title: 'Kikicode relay',
      hint: 'A LAN relay: enter the address, paste the API key; the plugin syncs the model catalog and each model’s reasoning levels. Writes the official llm-pi-ai settings and credentials service — effective immediately, no restart.',
      refresh: 'Refresh',
      loading: 'Loading…',
      baseURL: 'Relay base URL',
      baseURLHint: 'Up to /v1; http://host:port gets /v1 appended',
      apiKey: 'API key',
      apiKeyPlaceholder: 'Paste a key created on the relay (sk-…)',
      apiKeyKeep: 'Leave empty to keep the stored key',
      'action.probe': 'Test',
      'action.enable': 'Enable',
      'action.refreshModels': 'Sync models',
      'action.remove': 'Remove',
      'action.showModels': 'Preview the models to be added',
      'action.hideModels': 'Hide the model list',
      'action.rekey': 'Replace key',
      'status.live': 'live',
      'status.stored': 'written',
      'status.noKey': 'no key',
      'status.configured': 'configured',
      'station.title': 'Relay status',
      'station.site': 'Site',
      'station.user': 'Account',
      'station.key': 'Key',
      'station.balance': 'Balance',
      'station.points': 'Points',
      'station.plan': 'Plan',
      'station.planNone': 'no plan',
      'station.planLeft': '{name} · {days} days left · used {used}/{limit} this month',
      'station.today': 'Today',
      'station.todayValue': '{req} requests · balance ¥{spend} · plan quota {plan}',
      'station.models': 'Models',
      'station.modelsValue': '{total} usable · {reasoning} with levels · {vision} with images',
      'station.unreachable': 'Usage unavailable: {error}',
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
      'notice.enabled': 'Kikicode enabled ({models} models)',
      'notice.refreshed': 'Model catalog synced ({models})',
      'notice.removed': 'Kikicode route removed',
      'remove.confirm': 'Remove Kikicode? The stored API key stays (confirm twice to delete the key too).',
      'removeKey.confirm': 'Delete the stored API key as well?',
      'error.keyRequired': 'Enter an API key first',
      'key.saved': 'a key is already stored',
    }

    const format = (template, vars) =>
      String(template).replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] !== undefined ? String(vars[key]) : ''))

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

    // --- 样式 -----------------------------------------------------------------

    const S = {
      card: { border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', borderRadius: 12, padding: '14px 16px', marginTop: 16, fontSize: 13 },
      header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
      title: { fontWeight: 600, fontSize: 14 },
      hint: { opacity: 0.7, lineHeight: 1.5, marginBottom: 10 },
      rowLabel: { opacity: 0.6, minWidth: 62, display: 'inline-block' },
      field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 },
      label: { opacity: 0.75 },
      input: { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'inherit', fontSize: 13, boxSizing: 'border-box' },
      button: { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
      primary: { padding: '7px 16px', borderRadius: 8, border: '1px solid transparent', background: 'var(--dsw-alias-interactive-bg-hover, #2f6fec)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
      danger: { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary, #c0392b)', cursor: 'pointer', fontSize: 12 },
      linkButton: { background: 'none', border: 'none', color: 'var(--dsw-alias-link, #2f6fec)', cursor: 'pointer', fontSize: 12, padding: 0 },
      badge: { fontSize: 11, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', opacity: 0.85 },
      chip: { fontSize: 11, padding: '1px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3, #e2e5ea)', opacity: 0.8, marginRight: 4 },
      grow: { flex: 1 },
      error: { color: 'var(--dsw-alias-state-error-primary, #c0392b)', margin: '6px 0' },
      notice: { color: 'var(--dsw-alias-state-success-primary, #1d9a4a)', margin: '6px 0' },
      panel: { border: '1px solid var(--dsw-alias-border-l3, #eef0f3)', borderRadius: 10, padding: '10px 12px', marginTop: 8, lineHeight: 1.7 },
      table: { marginTop: 8, maxHeight: 260, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l3, #eef0f3)', borderRadius: 10 },
      th: { position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-l1, transparent)', textAlign: 'left', padding: '6px 10px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid var(--dsw-alias-border-l3, #eef0f3)' },
      td: { padding: '5px 10px', fontSize: 12, borderBottom: '1px solid var(--dsw-alias-border-l3, #f5f6f8)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      sub: { opacity: 0.6, fontSize: 12 },
      actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
    }

    const money = (value) => `¥${Number(value || 0).toFixed(2)}`
    const priceText = (price) => (price ? `${price.input} / ${price.output}${price.hit !== null && price.hit !== undefined ? `（命中 ${price.hit}）` : ''}` : '-')

    // --- 卡片 -----------------------------------------------------------------

    function KikicodeCard({ t }) {
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

      const configured = state ? state.configured === true : false
      const info = state ? state.station : null
      const usage = state ? state.usage : null
      const me = usage && usage.ok !== false ? usage : null

      const statusBadges = () => {
        if (!state) return null
        const parts = []
        if (!configured) return null
        parts.push(state.live ? tr('status.live') : tr('status.stored'))
        if (!state.keyConfigured) parts.push(tr('status.noKey'))
        return h('span', { style: S.badge }, parts.join(' · '))
      }

      const renderModels = () => {
        const list = rows || (probe && probe.models) || null
        if (!showModels || !list) return null
        if (list.length === 0) return h('div', { style: S.sub }, tr('models.none'))
        return h('div', { style: S.table },
          h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null,
              h('tr', null,
                h('th', { style: S.th }, tr('models.id')),
                h('th', { style: S.th }, tr('models.vendor')),
                h('th', { style: S.th }, tr('models.price')),
                h('th', { style: S.th }, tr('models.levels')),
              ),
            ),
            h('tbody', null,
              list.map((row) =>
                h('tr', { key: row.id, style: row.available === false ? { opacity: 0.45 } : undefined },
                  h('td', { style: { ...S.td, ...S.mono } }, row.id, row.available === false ? ` · ${tr('models.unavailable')}` : ''),
                  h('td', { style: S.td }, row.vendor || '-'),
                  h('td', { style: S.td }, priceText(row.price)),
                  h('td', { style: S.td },
                    row.levels && row.levels.length > 0
                      ? row.levels.map((level) => h('span', { key: level, style: S.chip }, level))
                      : h('span', { style: S.sub }, '-'),
                    row.vision ? h('span', { style: S.chip }, tr('models.vision')) : null,
                  ),
                ),
              ),
            ),
          ),
        )
      }

      const renderUsage = () => {
        if (!configured) return null
        if (state && state.usageError) return h('div', { style: S.sub }, tr('station.unreachable', { error: state.usageError }))
        if (!me) return null
        const plan = me.plan && me.plan.active === true ? me.plan : null
        return h('div', { style: S.panel },
          h('div', null, h('span', { style: S.rowLabel }, tr('station.site')), me.site || '-', '  ·  ', h('span', { style: S.rowLabel }, tr('station.user')), me.username || '-'),
          h('div', null,
            h('span', { style: S.rowLabel }, tr('station.balance')), money(me.balance), '  ·  ',
            h('span', { style: S.rowLabel }, tr('station.points')), String(me.points ?? 0), '  ·  ',
            h('span', { style: S.rowLabel }, tr('station.key')), (me.key && me.key.name) || '-',
          ),
          h('div', null,
            h('span', { style: S.rowLabel }, tr('station.plan')),
            plan
              ? tr('station.planLeft', { name: plan.name || plan.tier, days: plan.left_days, used: plan.used ? plan.used.month : 0, limit: plan.limits ? plan.limits.month : 0 })
              : tr('station.planNone'),
          ),
          h('div', null,
            h('span', { style: S.rowLabel }, tr('station.today')),
            tr('station.todayValue', { req: me.req_today ?? 0, spend: Number(me.spend_today || 0).toFixed(4), plan: Number(me.plan_today || 0).toFixed(2) }),
          ),
          info
            ? h('div', null,
                h('span', { style: S.rowLabel }, tr('station.models')),
                tr('station.modelsValue', { total: info.modelCount, reasoning: info.reasoningCount, vision: info.visionCount }),
              )
            : null,
        )
      }

      const renderForm = () =>
        h('div', null,
          h('label', { style: S.field },
            h('span', { style: S.label }, tr('baseURL')),
            h('input', {
              style: S.input,
              value: baseURL,
              placeholder: state ? state.defaultBaseURL : 'http://192.168.1.101:3100/v1',
              onChange: (event) => setBaseURL(event.target.value),
            }),
            h('span', { style: S.sub }, tr('baseURLHint')),
          ),
          h('label', { style: S.field },
            h('span', { style: S.label },
              tr('apiKey'),
              configured && state && state.keyConfigured ? ` · ${tr('key.saved')}` : '',
            ),
            h('input', {
              style: S.input,
              type: 'password',
              autoComplete: 'off',
              value: apiKey,
              placeholder: configured ? tr('apiKeyKeep') : tr('apiKeyPlaceholder'),
              onChange: (event) => setApiKey(event.target.value),
            }),
          ),
          h('div', { style: S.actions },
            h('button', { type: 'button', style: S.button, disabled: busy !== null, onClick: doProbe }, busy === '__probe' ? tr('loading') : tr('action.probe')),
            h('button', { type: 'button', style: S.primary, disabled: busy !== null, onClick: doEnable }, busy === '__enable' ? tr('loading') : configured ? tr('action.refreshModels') : tr('action.enable')),
            configured
              ? h('button', { type: 'button', style: S.danger, disabled: busy !== null, onClick: doRemove }, busy === '__remove' ? tr('loading') : tr('action.remove'))
              : null,
          ),
        )

      const renderProbe = () => {
        if (!probe) return null
        const summary = probe.summary || {}
        return h('div', { style: S.panel },
          h('b', null, tr('probe.title')),
          h('div', null, tr('probe.value', {
            total: summary.total ?? 0,
            advertised: summary.advertised ?? 0,
            unavailable: summary.unavailable ?? 0,
            reasoning: summary.reasoning ?? 0,
          })),
          summary.levels && summary.levels.length > 0
            ? h('div', null, tr('probe.levels', { levels: summary.levels.join(' / ') }))
            : null,
        )
      }

      return h('section', { style: S.card, 'data-dsh-part': 'kikicode' },
        h('div', { style: S.header },
          h('span', { style: S.title }, tr('title')),
          statusBadges(),
          h('span', { style: S.grow }),
          busy === '__load'
            ? h('span', { style: S.sub }, tr('loading'))
            : h('button', { type: 'button', style: S.button, disabled: busy !== null, onClick: load }, tr('refresh')),
        ),
        h('div', { style: S.hint }, tr('hint')),
        error ? h('div', { style: S.error }, error) : null,
        notice ? h('div', { style: S.notice }, notice) : null,
        renderUsage(),
        configured && !rekey
          ? h('div', { style: S.actions },
              h('button', { type: 'button', style: S.button, disabled: busy !== null, onClick: doRefresh }, busy === '__refresh' ? tr('loading') : tr('action.refreshModels')),
              h('button', { type: 'button', style: S.button, disabled: busy !== null, onClick: () => setRekey(true) }, tr('action.rekey')),
              h('button', { type: 'button', style: S.danger, disabled: busy !== null, onClick: doRemove }, tr('action.remove')),
            )
          : renderForm(),
        probe ? renderProbe() : null,
        (probe || rows)
          ? h('div', { style: { marginTop: 8 } },
              h('button', { type: 'button', style: S.linkButton, onClick: () => setShowModels((open) => !open) },
                showModels ? tr('action.hideModels') : tr('action.showModels')),
            )
          : null,
        renderModels(),
      )
    }

    // --- 插件 -----------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-kikicode-provider: dictionaries')
      ctx.slots.inject('settings.models.footer', () =>
        ctx.slots.register({ name: 'settings.models.footer', id: 'kikicode', order: 10, locale: NS }, KikicodeCard),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
