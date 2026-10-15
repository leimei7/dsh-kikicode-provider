// dsh-kikicode-provider - core mapping layer (pure, no I/O).
//
// Kikicode 是一个局域网 OpenAI 兼容中转站。它的 GET /v1/models 除了 id 之外
// 还带着「哪些模型会思考、能选哪些档位、哪个渠道还活着、能不能看图、价格」这些
// 元数据；本文件把那份元数据翻译成 DSH 官方适配器 @deepseek-ai/dsh-llm-pi-ai
// 接受的 provider profile —— 关键是每个模型自己的 reasoningEfforts。
//
// 为什么必须逐模型声明：pi-ai 的 resolveModelReasoning() 在模型没写
// reasoningEfforts 时取「已装目录里的同名模型」，自建渠道的自定义模型 ID 取不到，
// 于是 reasoning=false —— 选模型时就没有「推理等级」那一栏。所以这里把站内
// 广告的档位原样搬过来，用户装完插件即得正确的档位表。

/** llm-pi-ai 里这个路由的 dict key（也是模型选择器里显示的 provider id）。 */
export const ROUTE_ID = 'kikicode'

/** 存放 API Key 的凭据引用名（credentials 服务里的 ref）。 */
export const ENV_REF = 'KIKICODE_API_KEY'

/** 模型选择器与设置面板里显示的供应商名。 */
export const DISPLAY_NAME = 'Kikicode'

/** 站点默认地址（站点主人固定过对外地址后，用户不改也能用）。 */
export const DEFAULT_BASE_URL = 'http://192.168.1.101:3100/v1'

/** pi-ai 认的思考档位，顺序即升级顺序（见 dsh-llm-pi-ai 的 THINKING_LEVELS）。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// 站内档位 → DSH 档位名。站内对火山方舟（A 渠道）只给 off/on（上游只认开关），
// 其它渠道给 off/low/high/max。'on' 在 DSH 的档位表里没有对应名字，落到 high，
// 但**发送值仍然是 'on'** —— 中转站据此把 A 渠道翻译成 thinking:{type:enabled}。
const LEVEL_ALIAS = {
  on: 'high',
  enabled: 'high',
  auto: 'high',
  none: 'off',
  disabled: 'off',
  no: 'off',
}

/**
 * 校验并规范化用户填的中转站地址。
 *
 * 允许填 `http://192.168.1.101:3100`（自动补 /v1）或 `.../v1`（原样）；
 * 拒绝带账号密码 / 查询参数 / # 的地址 —— 适配器之后也会拒绝，提前报错更好读。
 * @param value - 用户输入。
 * @returns 规范化后的 base URL（不带尾斜杠）。
 * @throws {Error} 地址不合法时。
 */
export function normalizeBaseURL(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return DEFAULT_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`中转站地址不是合法 URL：${raw}（示例 http://192.168.1.101:3100/v1）`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('中转站地址必须是 http(s)')
  if (url.username || url.password) throw new Error('中转站地址不能带账号密码')
  if (url.search || url.hash) throw new Error('中转站地址不能带查询参数或 #')
  let path = url.pathname.replace(/\/+$/, '')
  // 用户经常把整个端点粘进来（`.../v1/models`、`.../v1/chat/completions`）。
  // 留着它，拼出来的请求会变成 `/v1/models/models`，全是 404 —— 这里剥掉端点后缀。
  path = path.replace(/\/(models|chat\/completions|completions|responses|messages)$/i, '')
  if (path === '' || path === '/') path = '/v1'
  return `${url.protocol}//${url.host}${path}`
}

/**
 * 站内一个档位值对应的 DSH 档位名。
 * @param stationLevel - `/v1/models` 里 efforts/reasoning_options 的取值。
 * @returns DSH 档位名，认不出来时 null（直接丢掉，不猜）。
 */
export function levelIdOf(stationLevel) {
  const value = String(stationLevel ?? '').trim().toLowerCase()
  if (value === '') return null
  if (THINKING_LEVELS.includes(value)) return value
  return LEVEL_ALIAS[value] ?? null
}

/** 按 pi-ai 的升级顺序重排档位字典，读起来和选择器一致。 */
function orderEfforts(dict) {
  const ordered = {}
  for (const level of THINKING_LEVELS) if (Object.hasOwn(dict, level)) ordered[level] = dict[level]
  return ordered
}

/**
 * 一个站内模型能不能选思考档位、能选哪些 —— 生成 pi-ai 的 reasoningEfforts。
 *
 * 三种返回：字典（支持，键是 DSH 档位名、值是发给中转站的 wire 值）、
 * `false`（不支持，选择器不显示档位栏）。
 * 站内没广告 `off` 时不替它声明 off：声明了就等于承诺「发 off 能关掉思考」。
 * @param model - `/v1/models` 里的一条模型记录。
 * @returns 档位字典或 false。
 */
export function reasoningEffortsOf(model) {
  const options = model && typeof model === 'object' ? model.reasoning_options : undefined
  // reasoning_options.values 是空数组时退回 efforts：站内两个字段应当一致，
  // 但真出现不一致时，宁可相信有内容的那一个，也不要判成「非推理模型」。
  const values = Array.isArray(options?.values) && options.values.length > 0
    ? options.values
    : Array.isArray(model?.efforts)
      ? model.efforts
      : []
  const params = Array.isArray(model?.supported_parameters) ? model.supported_parameters : []
  const declaresEffort = values.length > 0 || params.includes('reasoning_effort')
  if (!declaresEffort) return false

  const dict = {}
  for (const raw of values) {
    const level = levelIdOf(raw)
    if (level === null) continue
    const wire = String(raw).trim().toLowerCase()
    if (level === 'off') {
      dict.off = wire
      continue
    }
    // 两个站内档位撞到同一个 DSH 名字时（例如 on 与 high），保留先出现的那个
    if (dict[level] === undefined) dict[level] = wire
  }
  const thinking = Object.keys(dict).filter((level) => level !== 'off')
  if (thinking.length === 0) return false
  return orderEfforts(dict)
}

/**
 * 把一份 `/v1/models` 应答翻成 pi-ai 的模型列表。
 *
 * 默认丢掉 `src_ok === false` 的模型（来源渠道已停用，装了也调不通）；
 * 一个都不剩时退回全量，避免用户看到空列表却不知道为什么。
 * @param body - `/v1/models` 的 JSON。
 * @param options - `{ includeUnavailable }` 为 true 时保留全部。
 * @returns pi-ai 的 models 数组。
 */
export function modelsFromCatalog(body, options = {}) {
  const list = Array.isArray(body?.data) ? body.data : []
  const includeUnavailable = options.includeUnavailable === true
  const build = (entry) => {
    const reasoningEfforts = reasoningEffortsOf(entry)
    const model = {
      id: entry.id.trim(),
      name: entry.id.trim(),
      input: entry.vision === true ? ['text', 'image'] : ['text'],
      reasoningEfforts,
    }
    // 上下文窗口：中转站从上游元数据导入过就用真的（OpenRouter 风格的
    // context_length / max_completion_tokens）。不带的话客户端吃自家默认值 ——
    // dsh 默认 256K，会把 20 万窗口的模型当 25.6 万用，长上下文请求就被上游拒。
    const context = Number(entry.context_length ?? entry.context_window ?? 0)
    const maxOut = Number(entry.max_completion_tokens ?? entry.max_output_tokens ?? 0)
    if (Number.isFinite(context) && context > 0) model.contextWindow = Math.floor(context)
    if (Number.isFinite(maxOut) && maxOut > 0) model.maxTokens = Math.floor(maxOut)
    return model
  }
  const seen = new Set()
  const available = []
  const everything = []
  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') continue
    if (seen.has(entry.id.trim())) continue
    seen.add(entry.id.trim())
    const model = build(entry)
    everything.push({ model, entry })
    if (entry.src_ok !== false) available.push({ model, entry })
  }
  const picked = includeUnavailable || available.length === 0 ? everything : available
  return picked.map((item) => item.model)
}

/**
 * 一份给设置面板看的目录摘要（用于「检测」按钮与已配置状态）。
 * @param body - `/v1/models` 的 JSON。
 * @returns 计数与样例行。
 */
export function summarizeCatalog(body) {
  const list = Array.isArray(body?.data) ? body.data : []
  const usable = list.filter((entry) => entry && entry.src_ok !== false)
  const models = modelsFromCatalog(body)
  const reasoning = models.filter((model) => model.reasoningEfforts !== false)
  const vision = models.filter((model) => model.input.includes('image'))
  return {
    total: models.length,
    advertised: list.length,
    unavailable: Math.max(0, list.length - usable.length),
    reasoning: reasoning.length,
    vision: vision.length,
    levels: [...new Set(reasoning.flatMap((model) => Object.keys(model.reasoningEfforts)))],
  }
}

/** 一份可显示的价格样例（站内价格单位：元 / 百万 token）。 */
export function priceOf(entry) {
  const price = entry && typeof entry === 'object' ? entry.price : undefined
  if (!price || typeof price !== 'object') return null
  const input = Number(price.input)
  const output = Number(price.output)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  return { input, output, hit: Number.isFinite(Number(price.input_hit)) ? Number(price.input_hit) : null, currency: price.currency || 'CNY' }
}

/**
 * 组装 llm-pi-ai 的 provider profile（写进 settings 的就是这个对象）。
 *
 * 路由级 compat.supportsReasoningEffort：中转站是自建端点，pi-ai 靠 baseUrl
 * 识别厂商的默认检测在局域网 IP 上不可靠；显式打开，避免 effort 被静默丢掉。
 * @param input - `{ baseURL, models, displayName? }`。
 * @returns provider profile。
 * @throws {Error} 模型列表为空时（适配器会拒绝空路由，提前报错更好读）。
 */
export function buildProfile(input) {
  const models = Array.isArray(input?.models) ? input.models : []
  if (models.length === 0) throw new Error('中转站没有返回任何可用模型（检查地址与 API Key）')
  return {
    displayName: typeof input.displayName === 'string' && input.displayName.trim() !== '' ? input.displayName.trim() : DISPLAY_NAME,
    api: 'openai-completions',
    baseURL: input.baseURL,
    apiKeyEnv: ENV_REF,
    compat: { supportsReasoningEffort: true },
    models,
  }
}

/**
 * 从一份已配置的 profile 里读出地址与模型数（state 路由用）。
 * @param profile - settings 里的 providers.kikicode。
 * @returns 摘要，未配置时 undefined。
 */
export function describeProfile(profile) {
  if (!profile || typeof profile !== 'object') return undefined
  const models = Array.isArray(profile.models) ? profile.models : []
  return {
    displayName: typeof profile.displayName === 'string' ? profile.displayName : DISPLAY_NAME,
    baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : DEFAULT_BASE_URL,
    env: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : ENV_REF,
    modelCount: models.length,
    reasoningCount: models.filter((model) => model.reasoningEfforts && model.reasoningEfforts !== false).length,
    visionCount: models.filter((model) => Array.isArray(model.input) && model.input.includes('image')).length,
  }
}
