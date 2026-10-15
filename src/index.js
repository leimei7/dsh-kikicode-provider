// dsh-kikicode-provider - host half.
//
// 五个只监听回环的 JSON 路由，给浏览器那半（./client 的「Kikicode」设置卡片）调用：
//
//   GET  /dsh-kikicode/state    -> 是否已配置、Key 在不在、路由是否已注册、用量
//   POST /dsh-kikicode/preview  -> { baseURL, key? } 只读探测：拿到模型数与档位，不写任何东西
//   POST /dsh-kikicode/enable   -> { baseURL, key } 拉模型目录 + 写凭据 + 写官方 llm-pi-ai 路由
//   POST /dsh-kikicode/refresh  -> 用已存的 Key 重新拉一遍模型目录（站点上新模型后点一下）
//   GET  /dsh-kikicode/usage    -> 转发中转站的 /v1/me（余额 / 积分 / 套餐 / 今日用量）
//   POST /dsh-kikicode/remove   -> { removeKey? } 摘掉路由（默认保留 Key）
//
// 所有写入都走官方服务，不碰 settings.yaml / .credentials.yaml：
//   * credentials.set('KIKICODE_API_KEY', key) 存 Key，与手写 profile 用的是同一个 ref；
//   * settings.mutate('llm-pi-ai', [set providers.kikicode], revision) 写官方 pi-ai
//     命名空间的用户层 —— 服务端校验 profile 并**立即重新注册路由**，无需重启、无需改 YAML。
//
// 因此用户装完插件只需要：粘贴 API Key → 启用。

import {
  DEFAULT_BASE_URL,
  DISPLAY_NAME,
  ENV_REF,
  ROUTE_ID,
  buildProfile,
  describeProfile,
  modelsFromCatalog,
  normalizeBaseURL,
  priceOf,
  reasoningEffortsOf,
  summarizeCatalog,
} from '../core/station.js'

export const name = 'dsh-kikicode-provider'

const ROUTE_PREFIX = '/dsh-kikicode'
const PI_AI_NS = 'llm-pi-ai'
const CATALOG_TIMEOUT_MS = 15000
const USAGE_TIMEOUT_MS = 6000

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

// --- http helpers（与其它回环插件同一道栅栏）--------------------------------

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function isLocalHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  const name = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('aborted')))
  })
}

// 这些路由能写凭据，所以必须三道都过：回环 socket、回环 Host 头、同源 Origin（浏览器发的话）
function guard(req, res) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'loopback only' })
    return false
  }
  const host = req.headers.host
  if (!isLocalHostHeader(host)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'unexpected host' })
    return false
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originHost = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (originHost !== host) {
      sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-origin request' })
      return false
    }
  }
  return true
}

// --- 官方服务 -----------------------------------------------------------------

function services(ctx) {
  return { settings: ctx.get('settings'), credentials: ctx.get('credentials'), llm: ctx.get('llm') }
}

function piAiDescriptor(settings) {
  const descriptors = settings?.describe?.() ?? []
  return descriptors.find((descriptor) => descriptor.ns === PI_AI_NS)
}

function userProviders(descriptor) {
  const providers = descriptor?.user && typeof descriptor.user === 'object' ? descriptor.user.providers : undefined
  return providers && typeof providers === 'object' ? providers : {}
}

function isConflict(error) {
  if (error && error.name === 'SettingsConflictError') return true
  return /conflict|revision/i.test(String((error && error.message) || error))
}

/** 取回已保存的 Key（凭据服务只在调用时解析，不缓存）。 */
async function resolveKey(credentials) {
  if (!credentials) return ''
  try {
    const resolved = await credentials.resolve(ENV_REF)
    const value = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : ''
    return value
  } catch {
    return ''
  }
}

// --- 中转站调用 ---------------------------------------------------------------

async function stationGet(baseURL, path, key, timeoutMs) {
  const url = `${String(baseURL).replace(/\/+$/, '')}${path}`
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const reason = error && error.name === 'TimeoutError' ? `连接超时（${timeoutMs / 1000}s）` : String((error && error.message) || error)
    throw new HttpError(502, 'station-unreachable', `连不上中转站 ${url}：${reason}`)
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? '（API Key 不对，或这把 Key 被停用了）' : ''
    throw new HttpError(response.status === 401 || response.status === 403 ? 401 : 502, 'station-http', `中转站 ${url} 返回 ${response.status}${hint}`)
  }
  try {
    return await response.json()
  } catch {
    throw new HttpError(502, 'station-json', `中转站 ${url} 没有返回 JSON`)
  }
}

/** 目录里每条模型的可显示摘要（设置面板的「这次会装进什么」列表）。 */
function catalogRows(body, limit = 300) {
  const list = Array.isArray(body?.data) ? body.data : []
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') continue
    const efforts = reasoningEffortsOf(entry)
    rows.push({
      id: entry.id.trim(),
      vendor: typeof entry.owned_by === 'string' ? entry.owned_by : '',
      price: priceOf(entry),
      vision: entry.vision === true,
      available: entry.src_ok !== false,
      levels: efforts === false ? [] : Object.keys(efforts),
      // 上下文窗口（中转站从上游元数据导入的；没有就是 0，面板不显示）
      context: Number(entry.context_length ?? entry.context_window ?? 0) || 0,
      maxOut: Number(entry.max_completion_tokens ?? entry.max_output_tokens ?? 0) || 0,
    })
    if (rows.length >= limit) break
  }
  return rows
}

// --- 读状态 -------------------------------------------------------------------

async function stateOf(ctx) {
  const { settings, credentials, llm } = services(ctx)
  if (!settings) throw new HttpError(503, 'service-missing', 'DSH 设置服务不可用')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册（pi-ai 适配器未加载）')
  const profile = userProviders(descriptor)[ROUTE_ID]
  const info = describeProfile(profile)
  const live = new Set((llm?.listProviders?.() ?? []).map((provider) => provider.id))
  const keyConfigured = credentials ? (await credentials.describe(ENV_REF).catch(() => undefined))?.configured === true : false

  let usage = null
  let usageError = null
  if (info && keyConfigured) {
    const key = await resolveKey(credentials)
    if (key !== '') {
      try {
        usage = await stationGet(info.baseURL, '/me', key, USAGE_TIMEOUT_MS)
      } catch (error) {
        usageError = String((error && error.message) || error)
      }
    }
  }

  return {
    revision: descriptor.revision,
    route: ROUTE_ID,
    env: ENV_REF,
    displayName: DISPLAY_NAME,
    defaultBaseURL: DEFAULT_BASE_URL,
    configured: info !== undefined,
    live: live.has(ROUTE_ID),
    keyConfigured,
    station: info ?? null,
    baseURL: info?.baseURL ?? DEFAULT_BASE_URL,
    usage,
    usageError,
  }
}

// --- 写 -----------------------------------------------------------------------

async function preview(ctx, body) {
  const { credentials } = services(ctx)
  let baseURL
  try {
    baseURL = normalizeBaseURL(body.baseURL)
  } catch (error) {
    throw new HttpError(400, 'invalid-base-url', String((error && error.message) || error))
  }
  const typed = typeof body.key === 'string' ? body.key.trim() : ''
  const key = typed !== '' ? typed : await resolveKey(credentials)
  if (key === '') throw new HttpError(400, 'key-required', '请先填写 API Key')
  const catalog = await stationGet(baseURL, '/models', key, CATALOG_TIMEOUT_MS)
  return { baseURL, summary: summarizeCatalog(catalog), models: catalogRows(catalog) }
}

async function enable(ctx, body) {
  const { settings, credentials } = services(ctx)
  if (!settings || !credentials) throw new HttpError(503, 'service-missing', 'DSH 设置或凭据服务不可用')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册')

  let baseURL
  let profile
  try {
    baseURL = normalizeBaseURL(body.baseURL)
  } catch (error) {
    throw new HttpError(400, 'invalid-base-url', String((error && error.message) || error))
  }

  const typed = typeof body.key === 'string' ? body.key.trim() : ''
  const existing = typed === '' ? await resolveKey(credentials) : ''
  const key = typed !== '' ? typed : existing
  if (key === '') throw new HttpError(400, 'key-required', '请填写 API Key（也可以用「检测」先试一次）')

  // 先拿目录再写盘：Key 不对 / 地址不通时不留半个配置
  const catalog = await stationGet(baseURL, '/models', key, CATALOG_TIMEOUT_MS)
  const models = modelsFromCatalog(catalog, { includeUnavailable: body.includeUnavailable === true })
  try {
    profile = buildProfile({ baseURL, models, displayName: body.displayName })
  } catch (error) {
    throw new HttpError(400, 'invalid-profile', String((error && error.message) || error))
  }

  if (typed !== '') {
    try {
      await credentials.set(ENV_REF, typed)
    } catch (error) {
      throw new HttpError(409, 'credential-not-writable', `无法写入凭据 ${ENV_REF}：${String((error && error.message) || error)}`)
    }
  }

  try {
    await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', ROUTE_ID], value: profile }], descriptor.revision)
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'conflict', '设置已被其它界面改动，请刷新后重试')
    throw new HttpError(500, 'write-failed', `写入 llm-pi-ai 失败：${String((error && error.message) || error)}`)
  }

  return {
    route: ROUTE_ID,
    baseURL,
    models: models.length,
    reasoning: models.filter((model) => model.reasoningEfforts !== false).length,
    summary: summarizeCatalog(catalog),
    models_preview: catalogRows(catalog),
  }
}

async function refresh(ctx, body) {
  const { settings, credentials } = services(ctx)
  if (!settings || !credentials) throw new HttpError(503, 'service-missing', 'DSH 设置或凭据服务不可用')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册')
  const profile = userProviders(descriptor)[ROUTE_ID]
  const info = describeProfile(profile)
  if (!info) throw new HttpError(404, 'not-configured', 'Kikicode 还没有配置过')

  let baseURL
  if (typeof body.baseURL === 'string' && body.baseURL.trim() !== '') {
    try {
      baseURL = normalizeBaseURL(body.baseURL)
    } catch (error) {
      throw new HttpError(400, 'invalid-base-url', String((error && error.message) || error))
    }
  } else {
    baseURL = info.baseURL
  }
  const key = await resolveKey(credentials)
  if (key === '') throw new HttpError(400, 'key-required', `凭据 ${ENV_REF} 里没有 Key，请重新填一次`)
  const catalog = await stationGet(baseURL, '/models', key, CATALOG_TIMEOUT_MS)
  const models = modelsFromCatalog(catalog, { includeUnavailable: body.includeUnavailable === true })
  const next = buildProfile({ baseURL, models, displayName: profile?.displayName })
  try {
    await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', ROUTE_ID], value: next }], descriptor.revision)
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'conflict', '设置已被其它界面改动，请刷新后重试')
    throw new HttpError(500, 'write-failed', `写入 llm-pi-ai 失败：${String((error && error.message) || error)}`)
  }
  return { route: ROUTE_ID, baseURL, models: models.length, summary: summarizeCatalog(catalog), models_preview: catalogRows(catalog) }
}

async function remove(ctx, body) {
  const { settings, credentials } = services(ctx)
  if (!settings) throw new HttpError(503, 'service-missing', 'DSH 设置服务不可用')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册')
  if (!Object.hasOwn(userProviders(descriptor), ROUTE_ID)) throw new HttpError(404, 'not-configured', 'Kikicode 还没有配置过')
  try {
    await settings.mutate(PI_AI_NS, [{ op: 'unset', path: ['providers', ROUTE_ID] }], descriptor.revision)
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'conflict', '设置已被其它界面改动，请刷新后重试')
    throw new HttpError(500, 'write-failed', `移除失败：${String((error && error.message) || error)}`)
  }
  if (body.removeKey === true && credentials) {
    try {
      await credentials.unset(ENV_REF)
    } catch {
      // 路由已经摘掉；残留的 Key 无害，/state 里能看到它还在
    }
  }
  return { route: ROUTE_ID }
}

async function usage(ctx) {
  const { settings, credentials } = services(ctx)
  const descriptor = settings ? piAiDescriptor(settings) : undefined
  const profile = descriptor ? userProviders(descriptor)[ROUTE_ID] : undefined
  const info = describeProfile(profile)
  if (!info) throw new HttpError(404, 'not-configured', 'Kikicode 还没有配置过')
  const key = await resolveKey(credentials)
  if (key === '') throw new HttpError(400, 'key-required', `凭据 ${ENV_REF} 里没有 Key`)
  const me = await stationGet(info.baseURL, '/me', key, USAGE_TIMEOUT_MS)
  return { baseURL: info.baseURL, me }
}

// --- 插件 ---------------------------------------------------------------------

export function apply(ctx) {
  const registerRoutes = (webServer, fiber) => {
    fiber.effect(() =>
      webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/state`,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' })
            return
          }
          try {
            sendJson(res, 200, { ok: true, ...(await stateOf(ctx)) })
          } catch (error) {
            const status = error instanceof HttpError ? error.status : 500
            const code = error instanceof HttpError ? error.code : 'internal'
            sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
          }
        },
      }),
    )

    fiber.effect(() =>
      webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/usage`,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' })
            return
          }
          try {
            sendJson(res, 200, { ok: true, ...(await usage(ctx)) })
          } catch (error) {
            const status = error instanceof HttpError ? error.status : 500
            const code = error instanceof HttpError ? error.code : 'internal'
            sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
          }
        },
      }),
    )

    const postRoute = (suffix, run) => {
      fiber.effect(() =>
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/${suffix}`,
          handler: async (req, res) => {
            if (!guard(req, res)) return
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
              return
            }
            let body = {}
            try {
              const raw = await readBody(req)
              if (raw) body = JSON.parse(raw)
            } catch {
              sendJson(res, 400, { ok: false, code: 'invalid', error: 'malformed JSON body' })
              return
            }
            try {
              const payload = body && typeof body === 'object' ? body : {}
              sendJson(res, 200, { ok: true, ...(await run(payload)) })
            } catch (error) {
              const status = error instanceof HttpError ? error.status : 500
              const code = error instanceof HttpError ? error.code : 'internal'
              sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
            }
          },
        }),
      )
    }

    postRoute('preview', (body) => preview(ctx, body))
    postRoute('enable', (body) => enable(ctx, body))
    postRoute('refresh', (body) => refresh(ctx, body))
    postRoute('remove', (body) => remove(ctx, body))
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    registerRoutes(webServer, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub))
  }
}

export { DEFAULT_BASE_URL, ENV_REF, ROUTE_ID }
