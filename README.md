# dsh-kikicode-provider

把 **Kikicode**（局域网 OpenAI 兼容 AI 中转站）接进 [DeepSeek Harness](https://github.com/)（dsh）：**安装插件 → 在设置里粘贴一个 API Key → 完事。**

不用手改 `cordis.patch.yml`，不用写 YAML，也不用自己填模型清单：插件会去中转站拉 `/v1/models`，把 **112 个模型**连同每个模型**能选哪些思考档位**一次性写进官方 `llm-pi-ai` 路由。

```
设置 → 模型 → 页面底部「Kikicode 中转站」卡片 → 粘贴 Key → 启用
```

---

## 为什么需要这个插件

在 dsh 里手写一个自定义 provider（比如 `zz`）之后，很多人会撞上同一个坑：**模型选出来了，但没有「推理等级」那一栏**。

原因不在中转站，而在 dsh 自己的模型元数据机制：

| 环节 | 事实 |
|---|---|
| 前端什么时候画档位栏 | 只有模型带 `reasoning` 元数据时才画（`dsh-client-ui-model-selection`：没有时的空态文案是「当前模型未提供推理等级」） |
| 元数据从哪来 | 适配器 `reasoningInfo()`：`if (!model.reasoning) return {}` |
| `model.reasoning` 怎么定 | `resolveModelReasoning()`：**配置里没写 `reasoningEfforts` 就取内置目录里的同名模型，取不到就是 `false`** —— 自建渠道的自定义模型 ID 永远取不到 |
| 结论 | **dsh 不会去问 `/v1/models` 要推理能力**。中转站就算把 `reasoning_options` 写得很清楚，手写配置也拿不到 |

所以本插件做三件事：拉目录、**逐模型生成 `reasoningEfforts`**、写进官方设置。Kikicode 的 `/v1/models` 已经带了 `efforts` / `reasoning_options` / `supported_parameters` / `owned_by` / `vision` / `price`，插件把这些翻译成 dsh 认的形状。

## 安装

```sh
# 从 GitHub 装（推荐，现在就能用；公开仓库，匿名可拉）
dsh plugin --profile web add github:leimei7/dsh-kikicode-provider

# 本地开发挂载（改完源码立即生效，不用重装）
dsh plugin --profile web add link:/absolute/path/to/dsh-kikicode-provider

# 发布到 npm 之后这个名字也能装（目前只在 GitHub 上）
# dsh plugin --profile web add dsh-kikicode-provider
```

GUI 等价路径：**设置 → 插件 → 安装**，spec 填 `https://github.com/leimei7/dsh-kikicode-provider`（或上面的本地绝对路径）。

装完**重启 `dsh web`**，打开 **设置 → 模型**，页面底部就是「Kikicode 中转站」卡片，官方模型列表里也会多出「Kikicode」这一行（带 Key 配置状态与删除按钮）。

## 使用

1. **中转站地址**：默认已填 `http://192.168.1.101:3100/v1`（站点主人固定过的对外地址）。只填 `http://主机:端口` 也行，插件自动补 `/v1`。
2. **API Key**：在中转站注册后于「个人控制台 → 设备 Key」创建，粘进来。
3. 点 **检测**：插件会真去打一次 `/v1/models`，告诉你「112 个模型可用 · 60 个能选思考档位」，并列出将要装进去的模型（含厂商、价格、档位、是否支持图片）。
4. 点 **启用**：写凭据 + 写官方路由，**立即生效、无需重启**。
5. 回到聊天输入框的模型选择器，选 Kikicode 下的模型，档位栏就会出现（例如 `deepseek/deepseek-v4-flash(C)` → Off / Low / High / Max）。

卡片上还能看到**中转站用量**：余额、积分、套餐（名称 / 剩余天数 / 本月已用额度）、今日请求数与花费、这把 Key 的名字。按钮：**同步模型**（站点上新模型后点一下）、**换 Key**、**移除**。

## 工作原理

写入全部走 dsh 官方服务，插件不直接碰配置文件：

- `credentials.set('KIKICODE_API_KEY', key)` —— Key 进凭据服务（`$DSH_HOME/.credentials.yaml` 的 `refs:` 段），与手写 profile 用的是同一个引用；
- `settings.mutate('llm-pi-ai', [{ op:'set', path:['providers','kikicode'], value: profile }], revision)` —— 写进官方 pi-ai 命名空间的用户层，官方 schema 校验、适配器热注册。

插件**没有自己的 wire client**：请求走 dsh 自带的 `openai-completions` 适配器，所以能力与官方 provider 完全一致（流式、工具调用、图片、重试策略）。

档位怎么翻译（`core/station.js`）：

| 中转站广告的档位 | 写进 dsh 的 `reasoningEfforts` | 实际发出的 |
|---|---|---|
| `off` | `off: 'off'` | `reasoning_effort: "off"`（A 渠道 → `thinking:{type:disabled}`） |
| `on`（火山方舟只有开关） | `high: 'on'` | `reasoning_effort: "on"`（A 渠道 → `thinking:{type:enabled}`） |
| `low` / `medium` / `high` / `max` | 同名档位 | 原样透传 |

站内**没**广告 `off` 的模型，插件不会替它声明 `off` —— 声明了就等于承诺「发 off 能关掉思考」。没有思考元数据的模型写 `reasoningEfforts: false`，档位栏不出现。

安全：插件的五个 HTTP 路由只监听**回环**（socket、Host 头、Origin 三重校验），因为它们能写凭据；非回环来源一律 403。API Key 只存在 dsh 的凭据服务里，插件不落任何自己的文件。

## 卸载

```sh
dsh plugin --profile web remove dsh-kikicode-provider
```

已写入的 `providers.kikicode` 路由可以在卡片里点「移除」摘掉（默认**保留** Key，下次留空直接启用；想连 Key 一起删就再确认一次）。

## 常见问题

**「模型」页没有 Kikicode 卡片？**
插件没被加载。确认 `dsh plugin --profile web why dsh-kikicode-provider` 有输出、profile 的 `package.json` 里 `dsh.profile.bundles` 含本包，然后重启 `dsh web`。客户端那半是 classic client bundle（`window.__ModuleLoader__`），不需要构建步骤，但改完要刷新页面。

**卡片在，但模型选择器里没有档位栏？**
先看卡片上的「启用」是否成功（状态徽标 `运行中`）。档位来自模型自己的配置：模型若是非推理模型（中转站没广告 `efforts`），本来就没有档位。想确认某个模型：卡片里「看看会装进哪些模型」，档位列是空的就没有。

**检测报 `连不上中转站` / `401`？**
401 = Key 不对或被停用；连不上 = 地址写错、中转站没在跑，或两台机器不在同一局域网（手机热点与寝室路由器不是一张网）。

**报「凭据被启动环境遮蔽」？**
你是用 `KIKICODE_API_KEY=… dsh` 启动的，进程环境只读且优先级最高。去掉环境变量再在页面里填，或者继续用环境变量、页面里留空。

## 开发

```sh
node --test test/station.test.js     # 纯函数单测（映射 / 校验 / 目录裁剪），15 条
node tmp/harness.mjs                 # 宿主半全程实测：假 settings/credentials + 真 HTTP + 真中转站
node tmp/probe-live.mjs              # 只读探针：打一次 /v1/models，打印目录摘要与档位形状分布
```

`tmp/harness.mjs` 会：注册六个路由 → 起真 HTTP 服务 → 未配置状态 → 检测（真打中转站）→ 启用（校验写进凭据与路由的 profile）→ 用 **pi-ai 真正的 schema**（从本地 dsh 安装里 import）校验这份 profile → 读状态与用量 → 同步模型 → 移除 → 错误路径（错 Key 401 / 坏地址 400 / 未配置 404 / 跨源 403）。

`tmp/` 与 `.secret/` 已在 `.gitignore` 里；探针从 `%TEMP%\kikicode-devkey.txt` 读 Key，不入库。

## English

**dsh-kikicode-provider** wires a Kikicode LAN relay (any OpenAI-compatible gateway) into DeepSeek Harness: install the plugin, paste one API key on the official Settings → Models page, and the plugin syncs the whole model catalog — including each model's reasoning levels — into the shipped `llm-pi-ai` provider route. No YAML editing, no custom wire client, no restart.

The reasoning levels matter because dsh never asks `/v1/models` about reasoning capability: a hand-written custom provider gets `reasoning: false` for any custom model id, and the model picker silently offers no effort levels. This plugin translates the relay's own `efforts` / `reasoning_options` metadata into per-model `reasoningEfforts`, so `deepseek-v4-flash(A)` becomes `{off: 'off', high: 'on'}` and `deepseek/deepseek-v4-flash(C)` becomes `{off, low, high, max}`.

Writes go through the official services (`credentials.set` + `settings.mutate` on the `llm-pi-ai` namespace), the five helper routes are loopback-only, and the plugin keeps no state of its own.

## 许可

MIT © leimei7
