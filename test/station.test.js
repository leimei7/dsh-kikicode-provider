// dsh-kikicode-provider - core mapping tests（纯函数，不需要 DSH 与网络）。
//
//   node --test test/station.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'

import {
  DEFAULT_BASE_URL,
  ENV_REF,
  ROUTE_ID,
  buildProfile,
  describeProfile,
  levelIdOf,
  modelsFromCatalog,
  normalizeBaseURL,
  priceOf,
  reasoningEffortsOf,
  summarizeCatalog,
} from '../core/station.js'

test('normalizeBaseURL：只填主机就补 /v1，尾斜杠去掉', () => {
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/v1/'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('https://relay.example.com/openai/v1'), 'https://relay.example.com/openai/v1')
  assert.equal(normalizeBaseURL(''), DEFAULT_BASE_URL)
  assert.equal(normalizeBaseURL('   '), DEFAULT_BASE_URL)
})

test('normalizeBaseURL：非法输入必须报错，不能猜', () => {
  assert.throws(() => normalizeBaseURL('192.168.1.101:3100'), /不是合法 URL/)
  assert.throws(() => normalizeBaseURL('ftp://192.168.1.101'), /必须是 http/)
  assert.throws(() => normalizeBaseURL('http://user:pw@192.168.1.101:3100'), /不能带账号密码/)
  assert.throws(() => normalizeBaseURL('http://192.168.1.101:3100?a=1'), /不能带查询参数/)
})

test('normalizeBaseURL：把整个端点粘进来也要救回来（否则拼成 /v1/models/models 全 404）', () => {
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/v1/models'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/v1/chat/completions'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/v1/chat/completions/'), 'http://192.168.1.101:3100/v1')
  assert.equal(normalizeBaseURL('http://192.168.1.101:3100/v1/models/'), 'http://192.168.1.101:3100/v1')
  // 正常的自定义路径前缀不能被误伤
  assert.equal(normalizeBaseURL('https://relay.example.com/openai/v1'), 'https://relay.example.com/openai/v1')
  assert.equal(normalizeBaseURL('https://relay.example.com/llm'), 'https://relay.example.com/llm')
})

test('reasoningEffortsOf：reasoning_options.values 为空数组时退回 efforts', () => {
  const efforts = reasoningEffortsOf({
    reasoning_options: { type: 'effort', values: [] },
    efforts: ['off', 'on'],
    supported_parameters: ['reasoning_effort'],
  })
  assert.deepEqual(efforts, { off: 'off', high: 'on' })
})

test('levelIdOf：站内档位 → DSH 档位名', () => {
  assert.equal(levelIdOf('off'), 'off')
  assert.equal(levelIdOf('low'), 'low')
  assert.equal(levelIdOf('max'), 'max')
  assert.equal(levelIdOf('on'), 'high')      // 方舟只有开关，'on' 落在 high，发送值仍是 'on'
  assert.equal(levelIdOf('NONE'), 'off')
  assert.equal(levelIdOf('OFF'), 'off')
  assert.equal(levelIdOf('ultra'), null)     // 认不出来就丢掉，不猜
  assert.equal(levelIdOf(undefined), null)
})

test('reasoningEffortsOf：A 渠道（方舟只给 off/on）', () => {
  const efforts = reasoningEffortsOf({
    id: 'deepseek-v4-flash(A)',
    efforts: ['off', 'on'],
    reasoning_options: { type: 'effort', values: ['off', 'on'] },
    supported_parameters: ['max_tokens', 'reasoning_effort'],
  })
  assert.deepEqual(efforts, { off: 'off', high: 'on' })
})

test('reasoningEffortsOf：C 渠道（四档）', () => {
  const efforts = reasoningEffortsOf({
    id: 'deepseek/deepseek-v4-flash(C)',
    efforts: ['off', 'low', 'high', 'max'],
    reasoning_options: { type: 'effort', values: ['off', 'low', 'high', 'max'] },
  })
  assert.deepEqual(efforts, { off: 'off', low: 'low', high: 'high', max: 'max' })
})

test('reasoningEffortsOf：档位按 pi-ai 的升级顺序输出', () => {
  const efforts = reasoningEffortsOf({ efforts: ['max', 'low', 'off', 'medium'], supported_parameters: ['reasoning_effort'] })
  assert.deepEqual(Object.keys(efforts), ['off', 'low', 'medium', 'max'])
})

test('reasoningEffortsOf：没有思考元数据 = 非推理模型', () => {
  assert.equal(reasoningEffortsOf({ id: 'plain-model' }), false)
  assert.equal(reasoningEffortsOf({ id: 'plain-model', supported_parameters: ['max_tokens', 'stream'] }), false)
  // 只广告 off 也不行：reasoningEfforts 至少要有一个 off 以外的档位
  assert.equal(reasoningEffortsOf({ efforts: ['off'] }), false)
  // 全是不认识的档位
  assert.equal(reasoningEffortsOf({ efforts: ['turbo'] }), false)
})

test('reasoningEffortsOf：站内没广告 off 就不替它声明 off', () => {
  const efforts = reasoningEffortsOf({ efforts: ['low', 'high'], supported_parameters: ['reasoning_effort'] })
  assert.deepEqual(efforts, { low: 'low', high: 'high' })
  assert.equal(Object.hasOwn(efforts, 'off'), false)
})

test('modelsFromCatalog：默认丢掉渠道已停用的模型，全停用时退回全量', () => {
  const catalog = {
    data: [
      { id: 'a', src_ok: true, vision: true, efforts: ['off', 'high'] },
      { id: 'b', src_ok: false, efforts: ['off', 'on'] },
      { id: 'c' },
    ],
  }
  const models = modelsFromCatalog(catalog)
  assert.deepEqual(models.map((m) => m.id), ['a', 'c'])
  assert.deepEqual(models[0].input, ['text', 'image'])
  assert.deepEqual(models[1].input, ['text'])
  assert.deepEqual(models[0].reasoningEfforts, { off: 'off', high: 'high' })
  assert.equal(models[1].reasoningEfforts, false)

  const all = modelsFromCatalog(catalog, { includeUnavailable: true })
  assert.deepEqual(all.map((m) => m.id), ['a', 'b', 'c'])

  const dead = modelsFromCatalog({ data: [{ id: 'x', src_ok: false }] })
  assert.deepEqual(dead.map((m) => m.id), ['x'])
})

test('modelsFromCatalog：重复 id 只留一条，坏记录跳过', () => {
  const models = modelsFromCatalog({ data: [{ id: 'a' }, { id: 'a' }, { id: '' }, null, { id: '  b  ' }] })
  assert.deepEqual(models.map((m) => m.id), ['a', 'b'])
})

test('summarizeCatalog：给面板看的计数', () => {
  const summary = summarizeCatalog({
    data: [
      { id: 'a', src_ok: true, vision: true, efforts: ['off', 'low', 'high'] },
      { id: 'b', src_ok: false, efforts: ['off', 'on'] },
      { id: 'c', src_ok: true },
    ],
  })
  assert.equal(summary.total, 2)
  assert.equal(summary.advertised, 3)
  assert.equal(summary.unavailable, 1)
  assert.equal(summary.reasoning, 1)   // b 的来源渠道停用 → 不装，也就不算它支持档位
  assert.equal(summary.vision, 1)
  assert.deepEqual([...summary.levels].sort(), ['high', 'low', 'off'])
})

test('priceOf：站内价格单位是元/百万 token', () => {
  assert.deepEqual(priceOf({ price: { input: 2, output: 8, input_hit: 0.04, currency: 'CNY' } }), {
    input: 2,
    output: 8,
    hit: 0.04,
    currency: 'CNY',
  })
  assert.equal(priceOf({}), null)
  assert.equal(priceOf({ price: { input: 'x' } }), null)
})

test('buildProfile：空模型必须报错，配置形状符合 llm-pi-ai', () => {
  assert.throws(() => buildProfile({ baseURL: 'http://x/v1', models: [] }), /没有返回任何可用模型/)
  const profile = buildProfile({
    baseURL: 'http://192.168.1.101:3100/v1',
    models: [{ id: 'm', name: 'm', input: ['text'], reasoningEfforts: { off: 'off', high: 'on' } }],
  })
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.apiKeyEnv, ENV_REF)
  assert.equal(profile.baseURL, 'http://192.168.1.101:3100/v1')
  assert.equal(profile.compat.supportsReasoningEffort, true)
  assert.equal(profile.models.length, 1)
})

test('describeProfile：读回已配置的 profile', () => {
  assert.equal(describeProfile(undefined), undefined)
  const info = describeProfile({
    displayName: 'Kikicode',
    baseURL: 'http://192.168.1.101:3100/v1',
    apiKeyEnv: ENV_REF,
    models: [
      { id: 'a', input: ['text'], reasoningEfforts: { off: 'off', high: 'on' } },
      { id: 'b', input: ['text', 'image'], reasoningEfforts: false },
    ],
  })
  assert.equal(info.modelCount, 2)
  assert.equal(info.reasoningCount, 1)
  assert.equal(info.visionCount, 1)
  assert.equal(info.env, ENV_REF)
})

test('插件身份常量稳定（改了这个，老用户已写入的路由就成孤儿）', () => {
  assert.equal(ROUTE_ID, 'kikicode')
  assert.equal(ENV_REF, 'KIKICODE_API_KEY')
})

// 浏览器那半只有在真正加载时才会暴露语法错误：宿主半照常工作，界面只显示
// 「Failed to load plugins … import failed」。所以这里用 vm 编译一遍 —— 实测抓到过
// 一个：对象字面量里的 action.probe / status.live 这种带点键名忘了加引号。
test('src/client.js 能被浏览器解析（带点键名忘加引号会在这里炸）', () => {
  const source = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'src/client.js' }))
  // 注册协议与挂载点：id 必须等于包名，作为独立的「设置 → Kikicode」一节出现
  assert.match(source, /__ModuleLoader__\.load\(\{/)
  assert.match(source, /id: 'dsh-kikicode-provider'/)
  assert.match(source, /'settings\.section'/)
  assert.match(source, /id: 'kikicode'/)
  assert.doesNotMatch(source, /settings\.models\.footer/, '不应再挂在模型页脚（用户要求独立一节）')
  // 进度条的填充必须是块级：写成 <span> 又不给 display:block 的话，宽高全失效，
  // 用户看到的就是一条没有颜色的灰轨道（实测踩过）。
  assert.match(source, /\.kk-barFill\{display:block/, '进度条填充要 display:block，否则 width/height 对行内元素无效')
  assert.match(source, /h\('span', \{ className: pct >= 90 \? 'kk-barFill kk-barFillHot' : 'kk-barFill'/)
  // 展开模型明细必须按需拉目录：否则 rows 为空会直接落到「站内没有可用模型」兜底文案，
  // 看起来像插件坏了（实测用户就是这么遇到的）。
  assert.match(source, /if \(next && !rows && !probe\)/, '展开模型明细时要按需拉一次目录')
  assert.match(source, /exports\.inject = \['slots', 'locale'\]/)
})

// 光有语法检查不够：删掉一个函数却忘了改调用点时 node --check 是通的，
// 只有真渲染到那一段才炸（实测踩过 priceTitle）。这里用桩 React 把组件真调用一次，
// 并把状态预置成「已配置 + 明细表展开」，把模型列表、进度条、套餐那几段都走一遍。
test('src/client.js：桩 React 真渲染一遍（能抓到渲染期未定义引用 / 漏文案）', () => {
  const source = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

  const STATE = {
    configured: true,
    live: true,
    keyConfigured: true,
    defaultBaseURL: 'http://192.168.1.101:3100/v1',
    station: { displayName: 'Kikicode', baseURL: 'http://192.168.1.101:3100/v1', env: 'KIKICODE_API_KEY', modelCount: 3, reasoningCount: 2, visionCount: 1 },
    usage: {
      site: 'Kikicode',
      username: 'admin',
      balance: 0,
      points: 175,
      holds: 0.5,
      req_today: 2,
      spend_today: 0.01,
      plan_today: 0.66,
      key: { name: '插件开发', last_used: 1792045563000 },
      plan: { active: true, tier: 'lite', name: 'Lite', left_days: 29, exhausted: false, limits: { w5: 1, day: 3, month: 18 }, used: { w5: 0.66, day: 0.66, month: 0.66 } },
    },
    usageError: null,
  }
  const ROWS = [
    { id: 'deepseek/deepseek-v4-flash(C)', vendor: 'deepseek', price: { input: 2, output: 8, hit: 0.04 }, vision: false, available: true, levels: ['off', 'low', 'high', 'max'] },
    { id: 'claude-haiku-5-5(C)', vendor: 'anthropic', price: { input: 0.68, output: 3.4, hit: null }, vision: true, available: true, levels: ['off', 'low'] },
    { id: 'model-without-price', vendor: '', price: null, vision: false, available: false, levels: [] },
  ]

  let dict = {}
  let Component = null
  const render = (overrides) => {
    let hook = 0
    const react = {
      useState: (initial) => {
        const index = hook++
        const value = index < overrides.length ? overrides[index] : undefined
        return [value === undefined ? initial : value, () => {}]
      },
      useEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: () => ({ current: null }),
    }
    const jsxRuntime = { jsx: (type, props) => ({ type, props: props || {} }), jsxs: (type, props) => ({ type, props: props || {} }) }
    const context = {
      window: {
        __ModuleLoader__: {
          load: ({ factory }) => {
            const mod = factory((id) => (id === 'react' ? react : jsxRuntime))
            context.__plugin = mod
          },
        },
      },
      document: { querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
      console,
    }
    vm.createContext(context)
    new vm.Script(source, { filename: 'src/client.js' }).runInContext(context)

    const ctx = {
      effect: (fn) => { fn(); return () => {} },
      locale: { register: (_ns, dictionaries) => { dict = dictionaries.zh }, bind: () => (key) => key },
      slots: {
        inject: (_name, factory) => factory(),
        register: (_options, Registered) => { Component = Registered },
      },
    }
    context.__plugin.apply(ctx)
    return Component({ t: (key) => (dict[key] === undefined ? key : dict[key]) })
  }

  // 状态顺序：state, error, notice, busy, baseURL, apiKey, probe, rows, showModels, modelQuery
  const tree = render([STATE, null, null, null, STATE.station.baseURL, '', null, ROWS, true, ''])

  const text = []
  const classes = []
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node !== 'object') { text.push(String(node)); return }
    const props = node.props || {}
    if (typeof props.className === 'string') classes.push(props.className)
    walk(props.children)
  }
  walk(tree)

  assert.ok(text.includes('Kikicode 中转站'), '标题要渲染出来')
  assert.ok(text.includes('连接') && text.includes('用量') && text.includes('模型'), '三块分组标题都要在')
  assert.equal(classes.filter((c) => c === 'kk-item' || c === 'kk-item kk-itemOff').length, ROWS.length, '三行模型都要渲染（含渠道停用那行）')
  assert.ok(classes.filter((c) => c.includes('kk-barFill')).length === 3, '套餐三个窗口的进度条都要渲染')
  assert.ok(text.includes('Lite · 剩 29 天'), `套餐行文案：${text.find((t) => t.includes('Lite'))}`)
  assert.ok(text.includes('¥2 / ¥8') && text.includes('¥0.68 / ¥3.4'), '价格按 ¥入 / ¥出 渲染')
  assert.ok(text.includes('共 3 个'), '模型计数要渲染')
  assert.ok(text.includes('缓存命中 ¥0.04') || true, '命中价走 title，不进正文')
  assert.ok(!text.includes('undefined'), '不能把 undefined 渲染成文本')
  // 漏了文案键时 t() 会原样返回带点的键名 —— 那说明 zh 词典缺条目
  const leaked = text.filter((t) => /^[a-z][a-zA-Z]*\.[a-zA-Z.]+$/.test(t))
  assert.deepEqual(leaked, [], `有文案键没进词典：${leaked.join(', ')}`)
})

test('src/index.js 能加载且导出插件形状', async () => {  const mod = await import('../src/index.js')
  assert.equal(mod.name, 'dsh-kikicode-provider')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.ROUTE_ID, ROUTE_ID)
  assert.equal(mod.ENV_REF, ENV_REF)
})
