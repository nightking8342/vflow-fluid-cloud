# vFlow 流体云 · 设计

> **项目**：`vFlow 流体云` —— 把「复制 / 打开分享链接 → 识别 → 超级岛提示 → 全屏或小窗打开」
> 这条链路做成 vFlow 工作流。
> **状态**：**P0 已跑通**（浮窗形态，真机验证通过）；**超级岛形态被一处 vFlow 配置缺失阻塞**（§4.6，**已定位真因，可解**）。
> **代码位置**：`D:/develop/myProjects/vflow-fluid-cloud`（**独立仓库**，分支 `main`；不再是 vFlow 的 worktree）。
> **脚本来源**：`D:/develop/myProjects/shortx-Fluid_Cloud_Island`（本地克隆，分支 `vflow`，**未做任何改动**；
> `version` = `3.2.3`，`core.js` 2810 行 / `onOpen.js` 223 行 / `update.js` 647 行）。
>
> ⚠️ 本文**所有关于 vFlow 现状的结论都已逐条核实过源码**（附 `file:line`）。
> 关于原脚本行为的结论标【源码直读】；关于 vFlow 缺口的结论标【已核实】或【推断】。
> **真机验证状态见 §7.1**（小米 MIX Fold 3 / Android 17）。
>
> **快速导航**：
> - §3.5 —— ⭐ **架构调整**：本项目**不再跟随上游源码**（`core.js` 就地维护、`vendor/` → `reference/` 完整镜像）
> - §3.4 —— **脚本更新机制**（拉产物 / 不走代理 / 覆盖 + 版本号对比）。**已定案，未实现**
> - §4.6 —— ⚠️ **头号阻塞项**：`vflow.system.js` 里不能 `new` 抽象类。
>   真因是 **vFlow 少覆写了 `ContextFactory.createClassLoader`**（不是 ART 的限制），
>   含实测矩阵、与 ShortX 的逐层对照、四条出路
> - §7.1 —— P0 真机验证记录（7 项通过 / 1 项阻塞 / 4 条既有行为）
> - §7.2 —— 为什么用「引导脚本 + adb push」（远程 API 的 24 KB 上限）

---

## 0. 这份文档回答什么

1. **要做的东西长什么样** —— 原脚本的功能结构（§1）。
2. **vFlow 现在能做到哪一步** —— 逐条能力对照，有/没有/部分（§2）。
3. **还差什么、怎么补** —— 缺口清单与实施方案（§3–§5）。

**已与用户确认的三条边界**（2026-10-07）：

- **超级岛通知**：vFlow 已有完整的岛装配层，但它**只服务于工作流执行进度通知**。
  用户明确表示「vFlow 只是适配了超级岛这种通知模式，不一定需要它给工作流提供能力」——
  ⇒ 本项目**不要求**先做出「用户可编排的岛通知模块」，
  该能力在 §4.1 按「**新增一个模块**」评估，**不是阻塞项**。
- **选中文本菜单触发器**（原脚本的 `OnMenuActionTrigger`）：用户在 ShortX 里**从未用过**，
  且实测长按选中**没有反应**（该路径大概率已失效）⇒ **本项目不做**（§4.4）。
- **错误弹窗**：vFlow 有 `vflow.device.toast` 等替代物，且该分支只在脚本异常时触发
  ⇒ **用现有模块替代即可，不新增专用模块**（§4.5）。

---

## 1. 原脚本结构

### 1.1 仓库构成

| 文件 / 目录 | 行数 / 数量 | 作用 |
|---|---|---|
| `core.js` | 2810 行 | **核心逻辑全部在此**。规则匹配、链接识别、UI 构建、岛通知、小窗启动 |
| `onOpen.js` | 223 行 | **指令启用时执行**。倒计时说明弹窗 → 写配置 → 从 GitHub 拉 `update.js` 并 `eval` |
| `update.js` | 647 行 | **远程更新脚本**。从 GitHub 拉 `rules/*.json` 与 `nolinkrules/*.json`，增量合并到本地配置 |
| `rules/` | 27 个 JSON | **有链接识别规则库**（115 / 夸克 / 淘宝 / 哔哩哔哩 …） |
| `nolinkrules/` | 2 个 JSON | **无链接的文案规则**（如「打开shortx」→ 启动 ShortX） |
| `version` | — | `3.2.3` |

### 1.2 五条触发源

| # | 原触发器 | tag | 捕获方式 | 用途 |
|---|---|---|---|---|
| 1 | `ClipboardContentChanged` | 剪切板 | 剪贴板变更 | 复制分享文案 → 识别链接 |
| 2 | `OnMenuActionTrigger` | 选中 | **选中文本菜单** | 选中文本 → 识别链接（**本项目不做**，§4.4） |
| 3 | `ActivityStarted` | QQ | 监听 `com.tencent.mobileqq/.activity.QQBrowserActivity` | 从 QQ 内置浏览器 Intent 里抠链接 |
| 4 | `ActivityStarted` | 微信 | 监听 `com.tencent.mm/.plugin.webview.ui.tools.MMWebViewUI` | 从微信内置浏览器 Intent 里抠链接 |
| 5 | `Broadcast` | 附加 | `com.nyehueh.fluidcloud.ACTION_URL_RECEIVED` | **外部附加插件**把链接投递进来 |

⚠️ 3 / 4 两条不是「通用 Activity 监听」，而是**针对特定 Activity 类名的精确匹配**——
这意味着它们**可以用 vFlow 的 `vflow.trigger.activity_changed` 的 `class_filter` 精确对应**（§2.1）。

### 1.3 核心逻辑分层

```
触发（5 条）
  ↓
【第一层】取输入文本，并按 tag 分派到不同的提取方式
  ├─ 剪切板 → {clipboardContent}
  ├─ 选中   → {selectedText}
  ├─ QQ     → JS 正则从 activityIntentUri 抠 S.url=...
  ├─ 微信   → JS 正则从 activityIntentUri 抠 S.rawUrl=...
  └─ 附加   → MVEL 从 intent.extras["url"] 取
  ↓  统一写入变量 replaceResult
【第二层】core.js 主体
  ├─ 读取配置（/data/system/shortx*/data/Fluid_Cloud_Island/）
  ├─ 规则匹配：rules/*.json 的正则 + 变量提取 + 条件判定
  ├─ 识别结果 → 链接列表（可能多个）
  ↓
【第三层】展示与交互
  ├─ 超级岛通知（NotificationManager + miui.focus.param）
  ├─ 悬浮胶囊窗（WindowManager + TYPE_APPLICATION_OVERLAY）
  └─ 选项列表对话框（自绘 WindowManager View）
  ↓
【第四层】打开方式
  ├─ 全屏：startActivityAsUser
  └─ 小窗：ActivityOptions.setLaunchWindowingMode + setLaunchBounds
```

**关键事实**：五条触发源在分派后**收敛成同一个入口**（`replaceResult` → `core.js`）。
⇒ 项目的**核心成本在第一层与第三层**，中间那 2000 多行的规则逻辑是**纯 JS、与平台无关**。

### 1.4 规则库格式（`rules/115.json` 为例）

```json
{
  "name": "115",
  "type": "url",
  "tigger": ["[/.]115cdn\\.com", "[/.]115\\.com"],       // 命中这些正则才启用本规则
  "check": "oof.disk://",                                 // 特征串
  "Custom_variable": [                                    // 从链接里抽变量
    { "name": "yywlink", "pattern": "^(.*?)(#|$)", "text": "link", "index": 1 }
  ],
  "rule": [                                               // 条件 → 产出文本
    { "condition": [...], "rule_text": "oof.disk://openurl/【yywlink】?password=【cleancode】" }
  ]
}
```

- `【变量名】` 是脚本自己的占位语法（`getVariablevalues` / `SynthesisRule` 解析）。
- 27 个规则文件全部是这个形状，**纯数据、无平台依赖** ⇒ **可以原样搬进 vFlow**。

---

## 2. vFlow 侧能力对照

### 2.1 触发源对照

| 原触发源 | vFlow 对应物 | 状态 | 证据 |
|---|---|---|---|
| 剪切板变更 | `vflow.trigger.clipboard` | ✅ **有** | `ClipboardTriggerModule.kt:38`；双通道（`standard` 进程内监听 / `core` 走 Shizuku 流式），输出 `text_content` / `image_content` |
| 选中文本菜单 | 无 | ❌ **没有** | 全仓无 `OnMenuAction` / `ActionMode` / `onTextContextMenuItem` 命中；Xposed 通道只挂了一个 hook 点（`HookTargets.kt` 仅 `ActivityResumed`）⇒ 用户已判定不做（§4.4） |
| QQ Activity | `vflow.trigger.activity_changed` | ✅ **有** | `ActivityChangedTriggerModule.kt:46`；底层 hook `ActivityRecord.activityResumedLocked`，输出含 **`intent_uri`**（`intent.toUri(1)`，`ActivityChangedSource.kt:280-292`）——**正是脚本要抠 `S.url=` 的那个串** |
| 微信 Activity | 同上 | ✅ **有** | 同上，用 `class_filter` 精确匹配 `MMWebViewUI` |
| 附加插件广播 | `vflow.trigger.broadcast` | ✅ **有** | `BroadcastTriggerModule.kt:70`；输出含 `extras_json`（`BroadcastTriggerModule.kt:225`）——脚本的 MVEL 取 `extras["url"]` 可由它替代 |

> ⚠️ **`activity_changed` 依赖 Xposed 通道**（`ActivityChangedTriggerModule.kt:65` 声明 `XPOSED_HOOK` 权限）。
> 本机设备已装 LSPosed 并验证过该通道（FORK.md 记有 P3/P4 真机结论），**前提成立**。

### 2.2 动作层对照

| 脚本用到的动作 | vFlow 对应物 | 状态 | 证据 |
|---|---|---|---|
| 写剪贴板 | `vflow.system.set_clipboard` | ✅ 有 | `SetClipboardModule.kt:30`（另有 Core 版 `vflow.core.set_clipboard`） |
| 读剪贴板 | `vflow.system.get_clipboard` | ✅ 有 | `GetClipboardModule.kt:26` |
| 执行 shell | `vflow.shizuku.shell_command` | ✅ 有 | 脚本里 `executeAction(ShellCommand)` 共 **2 处**（`core.js:2569` 等） |
| Toast | `vflow.device.toast` | ✅ 有 | `ToastModule.kt:21` |
| 启动 App / 打开链接 | `vflow.system.launch_app` / HTTP 模块等 | ✅ 有 | `LaunchAppModule.kt:25` |
| **正则替换** | 无 | ❌ **没有** | `TextReplaceModule` 是**字面量**替换；`TextProcessingModule` 的 `regex_extract` **只提取不替换** ⇒ 见 §4.3 |
| **超级岛通知** | 岛装配层存在，**但无工作流模块** | ⚠️ **部分** | `IslandNotificationDispatcher.dispatch` 的**生产调用点只有 2 处**，都在 `ExecutionNotificationManager.kt:399/451`（执行进度通知）⇒ 见 §4.1 |
| **小窗** | 无模块 | ❌ **没有**，但有**已验证的绕过路径** | 见 §4.2 |

### 2.3 脚本层对照

| 能力 | vFlow `vflow.system.js` | 状态 |
|---|---|---|
| Rhino 引擎 | ✅ 与 ShortX 等价（同为 Rhino 1.9.0） | ✅ |
| 真实 Android `context` | ✅ `JsExecutor.kt:72-76` 注入 `applicationContext` | ✅ |
| `importClass` / `importPackage` | ✅ 已补（`ImporterTopLevel`） | ✅ |
| `console` 对象 | ✅ 已补（`JsConsole.kt`，12 个方法） | ✅ |
| 模块树 `vflow.*` | ✅ 约 195 个模块 | ✅ |
| 读写全局变量 | ✅ `vars_api.setGlobalVar` / `removeGlobalVar` / `reloadGlobalVars`（`JsExecutor.kt:187-265`） | ✅ |
| 超时保护 | ⚠️ 引擎支持但**两个既有调用点都不传** ⇒ **当前无生产消费者**（FORK.md 已记） | ⚠️ 见 §6-5 |
| **系统 Context（UID 1000）** | ❌ 不可能（需 Xposed） | ❌ 但**本项目不需要**（§4.2） |

> ⚠️ **`vflow.xposed.js` 不能用来跑 core.js**：它跑在 system_server、**不注入 `vflow.*` 模块树**
> （`ScriptExecutor.kt:217`），而 core.js 依赖大量 Android UI 类与自己的文件读写。
> 且它崩溃半径是整机。⇒ **本项目一律用 `vflow.system.js`**。

---

## 3. 脚本改造点

### 3.1 平台专有 API 清单（**全量，只有三处调用点**）

这是改造面最关键的量化结论：`core.js` 里对 ShortX 专有 API 的依赖**只有 3 处**：

| 位置 | 代码 | 替代方案 |
|---|---|---|
| `core.js:84` | `shortx.executeAction(ShowToast…)` | `vflow.device.toast({ message: … })` |
| `core.js:1801` | `shortx.executeAction(WriteClipboard…)` | `vflow.system.set_clipboard({ text: … })` |
| `core.js:2569` | `shortx.executeAction(ShellCommand…)` | `vflow.shizuku.shell_command({ mode: 'auto', command: … })` |

外加 3 行 import（`core.js:23/24/31`，`Packages.tornaco.apps.shortx.core.proto.action.*`）**整行删除**。

> ✅ **结论**：脚本与原平台的耦合**极浅**。2000 多行核心逻辑（规则匹配、UI 构建、岛参数）
> **全是公开 Android API + 纯 JS**，无需改动。

### 3.2 `{factTag}` → `[[__trigger_label]]`

脚本在 5 处读 `tiggerTag` / `factTag`（`core.js:2402/2513/2635/2724` 等）来判断「本次是哪条触发源」。

- 原平台：短变量 `{factTag}`，值取自触发器的 `tag` 字段（`剪切板` / `选中` / `QQ` / `微信` / `附加`）。
- vFlow：**已有等价机制** —— 触发器标签（`docs/fork/trigger-label-design.md`，已合入 `dev`）：
  - 存储键 / 引用 / AI 三处同名 `__trigger_label`
  - 工作流内以命名变量引用：`[[__trigger_label]]`
  - **未设置 / 未命中时是空串**（不是 `VNull`），保证 `If` 比较不炸

⇒ **改造方式**：在 vFlow 的每个触发器上填标签（`剪切板` / `QQ` / `微信` / `附加`），
脚本里把 `factTag` 的取值来源改为 vFlow 的命名变量。

⚠️ **`factTag` 在原脚本里被当作全局变量直接读**（`if(!isRunAction){ var tiggerTag=factTag; }`）。
移植时需在脚本开头显式赋值：

```javascript
// vFlow 适配层：把命名变量接进来
var factTag = (typeof inputs !== "undefined" && inputs.fact_tag) ? String(inputs.fact_tag) : "";
```

⚠️ **注入时机**：`WorkflowExecutor` 在 `execute()` 构造 `initialContext` 时
把命中触发器的标签注入 `namedVariables`（FORK.md 已登记）。脚本侧读到的是**已展开的值**。

### 3.3 路径与配置

| 原平台侧 | vFlow 侧 | 说明 |
|---|---|---|
| `/data/system/shortx*/data/Fluid_Cloud_Island/` | 需重新选择 | ⚠️ **`/data/system/` 在 vFlow（UID 10684）不可写**（`script-system-overview.md:590-603` 有实测）⇒ 配置目录要改到 App 私有目录或 `/sdcard/` |
| 配置文件 `config.json` / `rules.json` / `nolinkrules.json` | 同结构，换路径 | 纯 JSON，可原样迁移 |
| `findRandomDirWithPrefix("/data/system/", "shortx")` | **删除**（vFlow 路径固定） | 这是原平台的多用户目录探测逻辑 |

⚠️ **路径变更会牵动上游的 `update.js`**（它负责从 GitHub 拉规则并写到那个目录）。
本项目的更新机制**另起一套**（不移植 `update.js`）—— 见 §3.4。

### 3.4 脚本更新机制（**已定案，未实现**）

> ⚠️ **本节是设计，不是现状。** 2026-10-07 与用户敲定的架构调整：
> **本项目不再跟随上游源码**（`core.js` 已就地维护，见 §3.5），
> 但**脚本本身**要能「从远端拉一份新的覆盖掉本地的」。
> **本轮只写文档，不写实现。**

#### 3.4.1 上游 `update.js` 的做法（作为对照）

- 指令启用时 `httpGet(raw.githubusercontent.com/...)` → `eval` → **增量合并**规则
  （只加新规则、保留用户改过的）。
- ⚠️ **本项目不采用增量合并**：它要求「远端与本地都是结构化的、可逐条 diff 的数据」，
  而本项目的产物里有一份 2400 行的**完整脚本**，没法逐条合并。

#### 3.4.2 定案的三条（用户 2026-10-07 拍板）

| # | 决定 | 含义 |
|---|---|---|
| 1 | **拉产物** | 拉的是 `dist/` 下的**构建产物**（`vflow-fluid-cloud.js` + `rules.json` + `nolinkrules.json` + `version`），**不是源码**。远端不需要 Node、不需要构建 |
| 2 | **不走代理** | 更新这一步**必须能在无代理的网络下完成** ⇒ 源的选型受此约束（见 §3.4.3） |
| 3 | **覆盖** | 拿到就整份覆盖本地文件，**不做增量合并、不做冲突处理**。代价是「用户在设备上手改过的规则会丢」—— **接受**（用户的规则改动应当回仓库，而不是留在设备上） |

补充一条用户明确说过的：**「只拉产物，不关心它是不是最新的」** ——
即更新逻辑**不做「远端比本地新才拉」的优化**，也不需要保证远端一定是最新构建。
（§3.4.4 的版本号对比是**用户可读的反馈**，不是「要不要拉」的判据。）

#### 3.4.3 源放哪（**待定，有一个硬约束**）

约束来自决定 2：**国内网络需能直连**。候选：

| 方案 | 直连可行性 | 代价 |
|---|---|---|
| **A. jsDelivr CDN**（`cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/dist/...`） | 需实测 | 依赖第三方 CDN 的可用性与缓存刷新延迟 |
| B. GitHub raw（`raw.githubusercontent.com/...`） | ⚠️ **国内通常需要代理** ⇒ 与决定 2 冲突 | — |
| C. 自有服务器 / 对象存储 | 可控 | 多一处要维护的东西 |

⚠️ **本节的可用性结论【未实测】，不得当作已定论引用。**
真要实施时，第一步是**在目标网络下用 `curl` 实测 A 与 C**，
把结果回写到本表（本仓库「库行为断言必须先实测」那条规矩的复用）。

⚠️ **`dist/` 目前不在版本控制里**（`.gitignore` 有 `dist/`）⇒ 方案 A 用不了。
落地前必须先决定产物的发布形态，三选一：

| 形态 | 做法 |
|---|---|
| ① `dist/` 入库 | 从 `.gitignore` 移除 `dist/`，产物随 `main` 走 |
| ② 单独分支 | 产物推到 `dist` 分支（`main` 保持干净） |
| ③ Release 附件 | 每次发版把产物附到 Release 上 |

⚠️ **倾向 ②**：① 会让每次改脚本都在 `main` 里多一份 113 KB 的 diff（review 噪音大），
③ 需要人手动发版（与「更新是自动的」不搭）。**②** 让「源码」与「产物」各有各的分支、
各按各的节奏走。**未定案，实施前需确认。**

#### 3.4.4 版本号对比（用户要求）

**两边各有一个 `version` 文件**：

| 位置 | 内容 | 谁写 |
|---|---|---|
| 仓库根 `version`（**已建**） | `0.1.0` | 人工维护（改产物时一并改） |
| 设备 `/sdcard/vFlow/fluid-cloud/version` | 同上 | 更新步骤写入 |

> ⚠️ 这与 `reference/version`（`3.2.3`）**不是一回事** ——
> 那是**上游 ShortX 脚本**的版本，只作来历记录，**不参与**任何对比。
> （两者**同名**，别拿错文件 —— 根目录那个 `version` 才是本项目的。）

**用途**：更新后打一条日志「`0.1.0 → 0.2.0`」或「已是最新（`0.1.0`）」，
让用户**看得出这次更新到底有没有换掉东西**。它是**反馈**，不是判据（见 §3.4.2 的补充条）。

⚠️ **不做语义化比较**（不解析 `1.2.3` 的段、不判断「谁更新」）——
只做**字符串相等比较**。理由：判断「谁新」需要一套版本号语义，而用户已经明确
「不关心它是不是最新的」⇒ 有语义的只有「**变没变**」。字符串比较足够了。

#### 3.4.5 触发方式：手动触发器 + 标签

**形态**（用户 2026-10-07 提出）：在工作流里加一个**手动触发器**，给它打标签（如 `更新`），
手动触发时走更新分支。脚本靠 `[[__trigger_label]]` 分流（与 §3.2 是同一套机制）。

⚠️ **这意味着更新分支要写进 `core.js` 的分派逻辑里** —— 也就是：
`core.js` 的顶层入口要能识别「本次是更新触发」，并**直接 return，不走进识别链路**。
（现状是「拿到 `input` 就开始识别」，更新触发时 `input` 是空的。）

⚠️⚠️ **一个必须处理的顺序问题**：更新是**覆盖脚本自己**。
`bootstrap.js` 已经把整份脚本 `eval` 进内存了 ⇒ 覆盖文件**不影响本次执行**，
下次触发才用新代码。这是**好事**（更新中途出错不会把当前这次搞崩），
但要在日志里说清楚，否则用户会以为「点了更新没生效」。

#### 3.4.6 更新步骤的实现形态（**不进 `core.js`，走工作流模块**）

⭐ **关键设计**：更新这件事**不适合写在脚本里**。理由是它要「写文件 + 覆盖自己」，
而脚本正跑在那份文件里 —— 自举那一段（`adapter.js`）已经很小心了，不该再往里塞。

⇒ **倾向：更新做成工作流的独立步骤**（脚本模块之前），只留一个「跳过识别」的信号给脚本：

| 步骤 | 模块 | 参数（倾向） |
|---|---|---|
| 触发器 | `手动触发` | 标签 `更新` |
| 1 | `HTTP 请求`（`vflow.network.http_request`） | `url` = 产物地址；**`proxy_mode = "manual"` + `proxy = "direct"`** ⇒ 强制直连 |
| 2 | `文件操作`（`vflow.data.file_operation`） | `operation = write`、`overwrite = true` ⇒ 覆盖 |
| 3 | `JavaScript脚本` | 现有那一步（靠标签判断要不要识别） |

⚠️ **「不走代理」怎么落实**：`moduleProxyInputDefinitions()`（`PushModuleSupport.kt:81`）
提供 `proxy_mode`（`follow_global` / `manual`）+ `proxy` 两个输入。
`resolveModuleProxyAddress` 里 `manual` 时取 `proxy` 的值，而
**`"direct"` / `"none"` / `"off"` / `"直连"` / `"不使用代理"` 会被识别成「强制直连」**
（`isDirectProxyOverride`，`PushModuleSupport.kt:156-163`）。
⇒ **`proxy_mode = "manual"` + `proxy = "direct"` 就是「不走代理」**。
⚠️ **不要只填 `follow_global`** —— 那会跟随全局设置，用户开了全局代理就又走代理了，
而这是**静默**的（功能照常工作，只是没满足「不走代理」这条要求）。

⚠️ **整条链路的具体参数（模块 id、输入 id、写文件的原子性）本轮未核实** ——
实施前必须去 vFlow 仓库逐条核对（`AGENTS.md` 的「要查什么去哪」表）。

#### 3.4.7 必须处理的静默失效点（写进 §6 的延伸）

| 风险 | 表现 | 防法 |
|---|---|---|
| **半截文件** | 下载中断 ⇒ 覆盖出一份不完整脚本 ⇒ **下次触发整个工作流崩** | 先写临时文件、**校验长度**、再改名覆盖（`bootstrap.js` 已有「< 1000 字符就抛错」的先例） |
| **拉失败把旧的删了** | 更新失败 ⇒ 功能没了（比不更新更糟） | 失败时**保留原文件**，只打日志 |
| **远端 404 返回 HTML** | 把一段 HTML 当脚本写进去 ⇒ 下次触发语法错误 | 校验内容特征（如必须含某个标记串） |
| **更新后没提示** | 用户不知道更没更新 | 打版本号对比日志（§3.4.4） |
| **规则库与脚本版本错配** | 新脚本读旧规则格式 ⇒ 静默识别不出 | 产物**整组一起更新**（脚本 + 两个 JSON + version），不单独更新某一个 |

### 3.5 架构调整：不再跟随上游源码（2026-10-07 定案）

**这是本项目与「fork」的根本区别。**

**改动前**：`vendor/core.js` 是上游的只读镜像，`src/build.js` 每次构建都**重新打一遍补丁**。
好处是能跟上游同步；代价是①每次上游改动都可能让补丁断言失败；②`core.js` 的改动**只存在于构建产物里**，
要改一行逻辑得去改 `build.js` 的字符串替换规则。

**改动后**：

| 变化 | 从 | 到 |
|---|---|---|
| 核心逻辑 | `vendor/core.js`（只读镜像）+ `src/build.js`（打补丁） | **`src/core.js`（就地维护的源文件）** |
| 规则库 | `vendor/rules/` | **`src/rules/`** |
| 上游素材 | `vendor/` | **`reference/`**（**完整镜像**，不参与构建） |
| 构建 | 三步：打补丁 → 合并规则 → 拼接 | **两步**：合并规则 → 拼接 |

**⇒ `src/build.js` 已删除**。补丁是**一次性**做完的，结果落盘成 `src/core.js`；
改动点在文件里**就地标注**（搜 `/* [vflow] */` 可见，共 12 处）。

**理由**（用户 2026-10-07）：

> 「我们也不必跟上游同步。后续我们只要把这个流体云搬过来之后，就只维护这一个了」

⚠️ **代价（如实记录）**：**失去「跟上上游更新」的能力**。
上游 `shortx-Fluid_Cloud_Island` 之后再改规则/加站点，本项目**不会自动获得**。
`reference/` 保留为**来历记录**（「这份代码从哪来的」的证据），**不是**同步基线。

#### `reference/` 是**完整镜像**，且**保持上游原名**

| 决定 | 理由 |
|---|---|
| **文件名与上游一致** | 目录本身已说明「这是上游的」。加前缀（`upstream-core-3.2.3.js` 之类）① 是**冗余**；② 更糟的是**做了名字映射** —— 想对照「我们改了什么」时得先在脑子里过一遍「`src/core.js` 对应 `reference/` 的哪个文件」 |
| **完整，不筛** | `onOpen.js`（223 行）与 `update.js`（647 行）**都没移植**，但**都留着** —— 它**不是**「将来要用的素材」，是**对照基线**。筛掉的话，判断「某个功能上游有没有」就得回去翻另一个仓库 |

```bash
diff reference/core.js src/core.js        # 我们改了什么（5 类移植改动 + 之后所有就地修改）
diff -r reference/rules src/rules         # 逐字节相同 = 规则库没改过
```

⚠️ **`reference/` 里的东西一律不改** —— 改了它就失去「能对照原始实现」这个用途。
它**不进构建**：改了也不影响产物（正因为不进构建，改错也不会当场暴露 ⇒ 所以更不该改）。
唯一的例外是它自己的 `README.md`（**本项目加的**，说明哪些移植了、哪些没有、为什么）。

**未移植的两个文件**（理由详见 `reference/README.md`）：

| 文件 | 为什么不做 |
|---|---|
| `onOpen.js` | 它做的事（弹使用说明 / 写 ShortX 局部变量 / 拉 `update.js`）**逐条都依赖原平台**，且第 1 条的触发时机（「指令启用时」）**vFlow 没有对应钩子** |
| `update.js` | **不是「忘了」，是这条路已废弃** —— 它做的是「拉规则 + **增量合并**」，而本项目定的是「拉产物 + **整份覆盖**」（§3.4）。但**必须留着**：新机制里「哪些东西要一起更新」的判断就是从它那儿来的 |

---

## 4. 缺口与方案

### 4.1 缺口 1：超级岛通知

**现状**（已核实）：岛装配层 `services/island/` 是 `internal object`，
`IslandNotificationDispatcher.dispatch` 的**生产调用点只有执行进度通知那 2 处**，
用户**无法在工作流里主动推一条自定义岛通知**。

**但要先纠正一个误解**：脚本里的岛通知（`core.js:1974-2150`）
**根本没用任何平台专有 API** —— 它是：

```javascript
var builder = new NotificationBuilder(context, channelId)   // 公开 API
    .setContentTitle(title).setContentText(content)…;
notification.extras.putString("miui.focus.param", islandParams);  // 公开 extras
NotificationManager.notify(notificationId, notification);         // 公开 API
```

⇒ **用 `vflow.system.js` 完全可以直接做**（`script-system-overview.md:398-404` 的实测判定：
「超级岛 ✅ 能 —— 就是 `NotificationManager.notify()` + `notification.extras.putString("miui.focus.param", json)`，
**公开 Notification API，无特权要求**」）。

⇒ **两条路线**：

| 路线 | 做法 | 成本 | 建议 |
|---|---|---|---|
| **A（P0 采用）** | 岛通知**写在脚本里**，用 `vflow.system.js` 直接 `notify` | **0 行 Kotlin** | ✅ 先跑通链路 |
| **B（P1 可选）** | 新增 `vflow.notification.island` 模块，复用现有 `IslandParamsBuilder` | 1 个模块 + 注册 + 三语文案 | 想让「岛」成为**通用可编排能力**时再做 |

⚠️ 路线 A 的代价：**岛参数 JSON 要脚本自己拼**，与 vFlow 的 `IslandParamsBuilder`
（`IslandParamsBuilder.kt` 279 行，含能力探测、`param_v2` 结构、图标装配）是**两份实现**。
本仓库对「两份实现」有明确教训（`FORK.md` 记过 logcat 双份的代价：**改一处忘另一处，表现是静默不一致**）。
⇒ 若 P0 用 A 跑通、P1 要转 B，**必须把脚本里那份删掉**，不能两份并存。

**关于路线 B 的一个待核实点**：`IslandParamsBuilder` 目前产出的 `param_v2` 结构是
**为「执行进度」设计的**（含 `stepName` / `progressText` / 状态胶囊）。
而脚本用的是**「信息展示为主」**（`islandProperty: 1`、`bigIslandArea.imageTextInfoLeft` + `textInfo`、
`actions[0].actionTitle` 一个按钮）。**两者是同一协议的不同业务形态**，
⇒ 做 B 之前要先确认 `IslandParamsBuilder` 能否表达脚本那种形状（**未核实，列为未决项**）。

### 4.2 缺口 2：小窗打开（**vFlow 已有可行路径**）

**原脚本做法**（`core.js:1704-1790`，【源码直读】）：直接构造 `ActivityOptions`：

```javascript
var options = ActivityOptions.makeBasic();
options.setLaunchWindowingMode(useMode);              // useMode = 5（freeform）
options.setLaunchBounds(new Rect(left, top, right, bottom));
context.startActivityAsUser(intent, options.toBundle(), userHandle);
```

**vFlow 侧为什么不能照抄**：`setLaunchWindowingMode` / `setLaunchBounds` 是 **`@hide` API**，
App 进程（UID 10684）受限；且 `ActivityOptions` 需要构造 `Rect` 对象参数，
**shell 的 `service call` 传不了对象**（`script-system-overview.md:334-357`）。

**已验证的绕过路径**（`script-system-overview.md:408-455`，**已实测**）：

```bash
TID=$(dumpsys activity activities | grep -m1 'topResumedActivity' | grep -oE ' t[0-9]+' | tr -d ' t')
service call activity_task 138 i32 $TID i32 $flag s16 '' i32 0
# 138 = launchMiniFreeFormWindowVersion2 的事务码（MIUI 私有 AIDL）
```

```javascript
var r = vflow.shizuku.shell_command({ mode: 'auto', command: cmd });
```

⚠️ **诚实标注的代价**（同文档 §6.2）：
- **事务码 `138` 硬编码**：系统升级可能变（失效时由 `mode=freeform` 回读报 FAIL，**不会静默**）
- 依赖 `dumpsys` 输出格式
- 依赖 Shizuku / Root
- `launchMiniFreeFormWindowVersion2` 是 **MIUI / 澎湃私有接口**（本项目的目标机型恰好是）

⇒ **小窗可用，但只有「目标机型是小米 + 装了 Shizuku」这一条路**。
非小米机型应**降级为全屏**（原脚本已有类似判断，`core.js:1765`）。

#### ⭐ 2026-10-07 补：`am start --windowingMode` **也能开小窗**（已真机实测）

上面那条是**让已有 task 变 freeform**（`launchMiniFreeFormWindowVersion2`）；
**开新 task 时直接指定窗口模式**还有另一条路 —— `am start` 自带的参数：

```bash
am start --windowingMode 5 -a android.intent.action.VIEW -d "<url>"
# 5 = WINDOWING_MODE_FREEFORM（全屏是 1）
```

**实测（小米 MIX Fold 3 / Android 17）**：

| 命令 | 结果 |
|---|---|
| `am start --windowingMode 5 -n com.android.settings/.Settings` | ✅ `Task{… mode=freeform …}`（回读确认） |
| `am start --windowingMode 5 -a VIEW -d https://www.bilibili.com` | ⚠️ 起了，但落到了 **IntentResolver** 的 freeform task（没指定包名，系统在问「用哪个应用打开」） |
| `am start --windowingMode 5 -a VIEW -d … -p tv.danmaku.bili` | ❌ `unable to resolve Intent`（B 站没注册该 URL 的 filter） |
| `am start --windowingMode 5 -a VIEW -d … -n <正确的 component>` | ❌ 我给的 component 名不对（`does not exist`）—— **不是这条路的错** |

⇒ **机制成立**（`--windowingMode 5` 确实产出 `mode=freeform` 的 task），
**但「打开哪个 App 的哪个页面」仍需 `-p` 或 `-n` 给对** —— 而这正是
`core.js` 的 `matchRules` 已经在算的东西（它产出 `pkg` / `activity`）。

**两条路的关系**：

| | `service call … 138`（§4.2 原文） | `am start --windowingMode 5`（本条） |
|---|---|---|
| 作用 | 把**已有** task 变 freeform | **新开**一个 freeform task |
| 需要 | `dumpsys` 取 taskId + **私有事务码** | 只要包名/component |
| 机型 | ⚠️ **小米私有** | ⚠️ **未验**（`--windowingMode` 是 AOSP 的 shell 命令参数，但各 ROM 是否放行未测） |
| 全屏 | 不适用 | 同一条命令把 `5` 换成 `1` |

⚠️ **倾向新路**（命令更短、不依赖私有事务码），但**机型覆盖只有一台设备的数据**
⇒ **不得当成「通用可行」引用**，跨机型需按 §4.2 那套回读验证再确认。

### 4.3 缺口 3：正则替换（**一行可补，建议补**）

脚本用 `ReplaceRegex` 做了两件事：
1. **清理输入**（`{\|}\|\`\|\\` → 空格，见规则 JSON 的 action 1/2）
2. 规则匹配内部的正则替换（`replaceAll`，`core.js:1326`，是**脚本自己实现的**，不依赖平台）

第 2 类**不受影响**（纯 JS）。第 1 类在 vFlow 里的替代：

| 方案 | 成本 |
|---|---|
| 用 `vflow.system.js` 写 `text.replace(/[{}`\\]/g, " ")` | **0 行 Kotlin**，P0 采用 |
| 给 `vflow.data.text_replace` 加一个「正则模式」开关 | 改上游模块（diff 面积小，但要动 `InputDefinition` + 执行分支） |

⇒ **P0 用脚本；若后续发现脚本里正则替换用得频繁，再考虑给模块加开关**（不在必做项）。

### 4.4 明确不做：选中文本菜单触发器

- **用户判定**：在原平台里从未用过，且实测长按选中**没有反应**（该路径大概率已失效）。
- **vFlow 侧成本**（若要做）：需要新增一个 Xposed hook source
  （hook `android.widget.Editor` 或 system_server 侧的选中事件），
  涉及 `HookTargets.kt` 登记 + `xposed/sources/` 新增 Source + `wire/` 事件信封 + 触发器模块 + Handler + 两处注册。
  **这是本项目里最大的一块新增基础设施**，而它对应的功能**用户不用**。
- ⇒ **本项目不做**。若将来需要，按 `docs/fork/xposed-architecture-v2.md` §3.4.3 的
  「新增 hook 触发器 = 框架 + 适配器」姿势单独评估。

### 4.5 明确不新增：错误弹窗模块

- 脚本的 `ShowAlertDialog` 只用在**一个地方**：`core.js` 尾部的错误分支
  （「运行中的错误：…」+「复制日志」按钮）。
- **用户判定**：这不是缺口 ——「我们有很多可以替代的 vFlow，直接 toast 或者静默也行」。
- **替代方案**：
  - `vflow.device.toast`（`ToastModule.kt:21`）—— 轻量提示
  - `vflow.data.log`（`LogModule.kt`，本仓库新增）—— 写进工作流日志
  - **推荐两者都用**：日志留痕（可事后查）+ Toast 提示（当场可见）
- ⚠️ **不要为此新增「通用对话框模块」**。vFlow 已有 `vflow.data.quick_view` /
  `vflow.data.input` / `vflow.logic.list.choose` 三种专用弹窗，
  再加一个「任意标题+正文+按钮」的通用对话框是**为单个脚本的单个错误分支造基础设施**。

> 📌 顺带记一处**现状观察**（非本项目引入）：`UiBlockDefinitions.kt:17-20` 定义了
> `DIALOG_PAIRING` / `vflow.ui.dialog.start|show|end` 三个常量，但**全仓无对应类实现、也未注册**
> （`ModuleRegistry.kt:293-299` 只注册了 Activity 与悬浮窗，注释里却写着「Activity / 悬浮窗 / 对话框」）。
> ⇒ 这是一处**预留但未落地**的 ID。本项目**不动它**，但登记在此以免后来者以为它可用。

### 4.6 实测结论：`vflow.system.js` 里**不能 `new` 抽象类**（2026-10-07 真机）

> 这一节是**上真机之后才发现的**，设计阶段完全没预料到。它是本项目 P0 的**头号阻塞项**。
>
> ⚠️ **本节经历过一次结论更正**：初稿把真因写成「ART 的 `PathClassLoader` 没有 `defineClass`，
> App 进程无法运行时定义类」——**那是错的**。核对 ShortX 的 `com.faendir:rhino-android`
> 源码后发现：**真因是 vFlow 少覆写了 `ContextFactory.createClassLoader` 这一层**。
> 更正过程见下面的「为什么走不通」小节（保留原文以记录这次误判）。

#### 现象

脚本跑到 `core.js` 的岛通知函数时**报错退出**：

```
E WorkflowExecutor: 模块执行失败: JavaScript脚本执行失败 -
  JavaScript Error at line 2157: 0: 实例化错误 (can't load this type of class file)：
  类 android.content.BroadcastReceiver 是接口或抽象类
```

`core.js:2008` 的写法是 Rhino 的**经典「new + 字面量」子类化**：

```javascript
var receiver = new BroadcastReceiver({           // ← 这一行炸
    onReceive: function (context, intent) { … }
});
```

#### 实测矩阵（真机，逐条隔离跑，不是推断）

| # | 写法 | 结果 |
|---|---|---|
| 1 | `typeof JavaAdapter` | ✅ `function`（对象存在） |
| 2 | `new` **接口**（`View.OnClickListener`） | ✅ 成功（`cls` = `$Proxy6`，动态代理） |
| 3 | `JavaAdapter(接口, {...})` | ❌ `can't load this type of class file` |
| 4 | `new` **抽象类**（`BroadcastReceiver`） | ❌ **同一条报错** |
| 5 | `JavaAdapter(抽象类, {...})` | ❌ 同一条报错 |
| 6 | `new` **具体类**（`java.util.ArrayList` / `java.lang.Thread`） | ⚠️ **看情况**：`Thread` 跑得通但**没生成子类**；`ArrayList` 直接 NPE |
| 7 | `new java.lang.Thread({run: …})` | ⚠️ `run()` 被调用，但 `getClass().getName()` 仍是 `java.lang.Thread` |

⇒ **规律**：
- **接口** ✅ 可靠（`java.lang.reflect.Proxy`，**不需要定义新类**）
- **具体类** ⚠️ **不是真的子类化**（类名没变），且换一个类就可能崩 —— **不可依赖**
- **抽象类** ❌ 必然失败（需要生成真子类 ⇒ 撞上 `defineClass`）

#### 为什么走不通（机制）—— **不是 ART 的限制，是 vFlow 少配了一层**

> ⚠️ 本节初稿曾写成「ART 的 `PathClassLoader` 没有 `defineClass`，所以 App 进程无法运行时定义类」。
> **那个说法是错的** —— ShortX 在同样的 ART 上跑通了同一个脚本。以下是**核对过两边的字节码与源码**之后的结论。

**Rhino 的类加载链**（`javap` 逐层核实）：

```
Context.enter()
  └─ Context.createClassLoader(parent)          // 转发给 factory
       └─ ContextFactory.createClassLoader(parent)   // ← 可覆写点
            └─ 默认返回 DefiningClassLoader
                 └─ defineClass() → ClassLoader.defineClass(String, byte[], int, int, ProtectionDomain)
```

`DefiningClassLoader` 调的是 **`java.lang.ClassLoader.defineClass`**（`javap` 已确认字节码）。
那是 **JVM 的类定义入口**，在 ART 上对 App 的 `PathClassLoader` 调用**必然抛**
`can't load this type of class file` —— 因为 ART 只认 **dex**，不认 `.class`。

**关键在这里**：`ContextFactory.createClassLoader` 是 **`protected` 且可覆写**的。

| | ShortX | vFlow |
|---|---|---|
| Rhino 库 | `com.faendir:rhino-android` | `org.mozilla:rhino:1.9.0`（裸库） |
| `ContextFactory` | `AndroidContextFactory`（**覆写了 `createClassLoader`**） | `JsTimeoutContextFactory`（**只覆写 `observeInstructionCount`**） |
| 返回的 `GeneratedClassLoader` | `InMemoryAndroidClassLoader` | Rhino 默认的 `DefiningClassLoader` |
| `defineClass` 的实现 | **`.class` → dex 翻译后再加载**（见下） | `ClassLoader.defineClass`（ART 上无效） |

`rhino-android` 的做法（源码直读，`BaseAndroidClassLoader.java`）：

```java
public Class<?> defineClass(String name, byte[] data) {
    DexOptions dexOptions = new DexOptions();
    DexFile dexFile = new DexFile(dexOptions);
    DirectClassFile classFile = new DirectClassFile(data, name.replace('.', '/') + ".class", true);
    …
    dexFile.add(CfTranslator.translate(context, classFile, null, new CfOptions(), dexOptions, dexFile));
    Dex dex = new Dex(dexFile.toDex(null, false));
    …
    return loadClass(dex, name);     // → new InMemoryDexClassLoader(ByteBuffer.wrap(dex.getBytes()), parent)
}
```

即：**把 Rhino 生成的 `.class` 字节码用 `dx`（`com.android.dx`）翻译成 dex，
再用 `InMemoryDexClassLoader` 从内存加载。** 这条链在 ART 上成立。

⇒ **真因是「vFlow 没有覆写 `createClassLoader`」**，而不是「ART 做不到」。
**vFlow 的 `JsTimeoutContextFactory` 只覆写了超时回调，类加载那一层直接落回了 JVM 版实现。**

#### 附带发现：**具体类的「子类化」也不可靠**（实测）

实测矩阵的第 6/7 条（`new ArrayList({...})` / `new Thread({run})`）**看着成功，其实不是真的子类化**：

| 探测 | 结果 |
|---|---|
| `var t = new java.lang.Thread({run:function(){called=true;}}); t.run();` | ✅ `called=true`，但 `t.getClass().getName()` = **`java.lang.Thread`**（不是生成的子类） |
| `var o = new java.util.ArrayList({size:function(){return 999;}})` | ❌ `Wrapped java.lang.NullPointerException: Attempt to get length of null array` |
| `var l = new android.view.View.OnClickListener({onClick:...})` | ✅ `hit=true`，`cls` = **`$Proxy6`**（`java.lang.reflect.Proxy` 动态代理） |

⇒ 三类的真实情况：

| 类别 | 机制 | 可靠性 |
|---|---|---|
| **接口** | `java.lang.reflect.Proxy` 动态代理（**不需要 dex**） | ✅ 可靠 |
| **具体类** | 走 Rhino 的某条特例路径（**不是子类化**），且**换一个类就可能崩**（`ArrayList` 就崩了） | ⚠️ **不可靠** |
| **抽象类** | 必须生成真子类 ⇒ 撞上 `defineClass` | ❌ 必然失败 |

⚠️ 这加强了结论：**不是「避开抽象类就行」，而是「这套子类化机制整体不可用」**。
`core.js` 里凡是「用 JS 字面量实现 Java 接口/抽象类」的地方**都踩在这条不稳的路径上**。

#### 影响面：这**不是「岛通知一条路」的问题**

`core.js` 里**三处**依赖「子类化抽象类 / 用 JavaAdapter」，**每处都带一个功能**：

| 位置 | 依赖 | 功能 | 后果 |
|---|---|---|---|
| `core.js:2008` | `new BroadcastReceiver`（**抽象类**） | **岛通知的点击回传**（点岛 → 全屏 / 点按钮 → 小窗） | ❌ **必然抛异常** ⇒ 整条岛路径死 |
| `core.js:757` | `new View.OnClickListener`（**接口**） | 浮窗的点击 / 滑动 | ✅ 走 `Proxy`，可靠 |
| `core.js:806` | `new Runnable`（具体类） | 超时线程 | ⚠️ 「碰巧能跑」（实测 `getClass()` 没变），**不属于可靠路径** |

⇒ 眼下**只有岛通知那条路径挂掉**，浮窗那条能跑。
这也是为什么把 `use_islandNotification` 改成 `false` 后功能立刻正常 —— 见 §7.1 的真机记录。

#### 出路（按推荐度，**2026-10-07 重排**）

> ⚠️ 这张表被改过两次，两次都值得记：
> ① 初稿把「用浮窗替代」列为出路 ①，那是在**误以为 ART 做不到**的前提下写的；
> ② 初稿的「中转 Activity」被用户否掉（见下），换成「广播 → vFlow 广播触发器」。

| 出路 | 做法 | 代价 / 风险 |
|---|---|---|
| **① 把「点击之后做什么」交给工作流（广播 → vFlow 广播触发器）**（推荐先做） | 脚本**只发广播**（`data` 带载荷 + `setPackage` 指 vFlow），**不再自己当接收方** ⇒ 删掉 `new BroadcastReceiver` 那一整段。工作流里配一个广播触发器来接，并由**工作流**执行打开 | ⚠️ 需在工作流里加触发器与对应步骤；⚠️ **只覆盖「终结动作」**，多链接/打开方式那类**选择**要一并搬进工作流（见下）。**换来「不阻塞」** —— 详见下一小节 |
| **② 给 vFlow 的 `ContextFactory` 覆写 `createClassLoader`（**根治**）** | 照 `rhino-android` 的做法实现一个 `GeneratedClassLoader`：`.class` → dex（`dx`）→ `InMemoryDexClassLoader`。**不引第三方库，自己写这一层**（`rhino-android` 已 2021 年停更，且它绑 `rhino-runtime:1.7.13`，与 vFlow 的 1.9.0 不同代） | ① 需要 `com.android.tools:r8`（含 `com.android.dx`）作为**运行期依赖** —— ⚠️ **体积**（dx 约 1 MB）；② **同时惠及 App 侧与 hook 侧**（两侧用的是同一套 `ContextFactory` 模式）；③ ⚠️ 这是**改上游核心文件**（`JsTimeout.kt` / 新增文件），按 `FORK.md` 需登记 |
| **③ 用浮窗替代岛（P0 的临时手段）** | 配置 `use_islandNotification=false` | ⚠️ **丢掉超级岛**，退化成 `TYPE_APPLICATION_OVERLAY` 胶囊浮窗。**实测可用**，但不是用户要的形态 |
| **④ 走 `vflow.xposed.js`** | hook 侧可以**在 Kotlin 里写固定类**（如 `IslandClickReceiver`）暴露给脚本 | 成本最高，且 hook 侧**同样缺这一层**（见下） |

> ⚠️ **hook 侧也缺**（已核实）：`xposed/script/ScriptSandbox.kt` 的 factory
> **同样没有覆写 `createClassLoader`** ⇒ 换到 `vflow.xposed.js` 跑**不会自动解决**，
> 除非同时补那一层（出路 ② 的实现对两侧通用）。

#### ⭐ 出路 ①：把「点击之后做什么」交给工作流（广播 → vFlow 广播触发器）（**2026-10-07 定案，未实现**）

> ⚠️ **标题里的「回传」二字后来去掉了** —— 用户 2026-10-07 追问「多链接怎么还走广播了」
> 之后，才看清这条路**不是「回传」**（回传是 B 类交互，做不到），
> 而是**把动作的执行权交给工作流**。措辞差别很大：前者暗示「脚本还在等」，
> 后者说明**脚本已经退场**。

> ⚠️ **本节取代了初稿的「中转 Activity」方案。** 初稿写的是「按钮也走
> `PendingIntent.getActivity` + 新增一个中转 Activity」，**用户否掉了**
> —— 理由是**根本不需要**：vFlow 里**已经有**广播触发器，而脚本这边只需要
> **发**一个广播，那不需要 receiver、不需要新增任何 Activity、不需要改 vFlow。

**这条路的立足点是「方向搞反了」**：`new BroadcastReceiver` 之所以炸，
是因为**脚本想自己当接收方**。而点一下按钮本来就不该由脚本自己处理 ——
**发送**是脚本的活，**接收**是工作流的活，两者不该挤在同一段脚本里。

##### 现状：这条广播长什么样（`core.js:1857-1906`）

| 项 | 值 | 说明 |
|---|---|---|
| 发出者 | `PendingIntent.getBroadcast`（`core.js:1906`） | **由系统在点击时发**，不是脚本主动 `sendBroadcast` |
| action（主体） | `FLUID_CLOUD_CLICK_MAIN_<notificationId>` | `notificationId` = `System.currentTimeMillis() & 0x7fffffff`（`core.js:1858`） |
| action（按钮） | `FLUID_CLOUD_CLICK_BUTTON_<notificationId>` | 同上 |
| **extras** | ⚠️ **一个都没有** | `new Intent(action)`，数据全在**脚本的闭包变量**（`opts` / `result`）里 |
| package / component | ⚠️ **都没设** ⇒ **隐式广播** | 靠 action 唯一性 + 随机后缀避免被别人匹配到 |
| requestCode | 主体 `0` / 按钮 `1`（`core.js` 原文） | ⚠️ **写死的** —— 见「契约 C」 |
| flags | 主体 `FLAG_UPDATE_CURRENT \| FLAG_IMMUTABLE`；按钮只有 `FLAG_IMMUTABLE` | ⚠️ 按钮那个**不含** `UPDATE_CURRENT` |
| 接收方 | 脚本自己的 `new BroadcastReceiver`（`core.js:1863`） | **这正是撞墙的地方** |

⇒ **改动的实质是「换接收方 + 加 extras」**，不是「换一种广播」——
**广播本身已经是这条路径的机制**（用户 2026-10-07 指出：原实现走的就是广播）。

`core.js:1863` 的 receiver **同时承担两件事**（这是问题所在）：

| 职责 | 内容 |
|---|---|
| **点击回传** | 收到 `ACTION_CLICK_MAIN` / `ACTION_CLICK_BUTTON` ⇒ 写 `result`（**脚本还在等**） |
| **决策 + 执行** | 等 `result` 非空 ⇒ `openWith.openact` 分流全屏 / 小窗 |

而**它本来就不是必须的**：按钮的 `PendingIntent` 是 `getBroadcast`（`core.js:1906`），
系统只是**发**一个广播；**谁收**是另一件事 —— 可以是脚本的 receiver，**也可以是 vFlow 的广播触发器**。

##### 改后：三段拆开

```
① 触发（脚本）：识别出链接 → 弹岛（或浮窗）→ **直接 return，不等待**
                    按钮 PendingIntent = 一个自定义 action 的广播
                    extras 带上「打开哪个链接 / 用哪种方式 / 哪个 App」

② 点击（系统）：用户点岛上的按钮 → 系统发那条广播

③ 执行（工作流）：vFlow 的「广播触发」触发器收到 → 工作流里执行打开
```

**脚本侧只需三处改动**（**都不碰 receiver 那一段，直接删掉**）：

| # | 改动 | 说明 |
|---|---|---|
| 1 | **删掉 `new BroadcastReceiver`**（`core.js:1863`）与 `registerReceiver` | 整段消失 —— 这正是撞墙的地方 |
| 2 | **删掉 `while (result === null) { Thread.sleep(150); }` 那几处**（`core.js:1976`（岛）/ `:799`（浮窗）/ `:942`（对话框）） | 不再等回传 ⇒ **不再阻塞** |
| 3 | 两条 `PendingIntent` 都改成**固定 action + 带 `data` 载荷** | `data` 里装「打开哪个链接 / 全屏还是小窗」。⚠️ **`requestCode` 主体用 `notificationId`、按钮用 `+1`**（契约 C） |
| 4 | **清理「超时线程」那一段**（`core.js:1961`） | ⚠️ **容易漏**：它也在 `result` / `unregisterReceiver` 上（`if (result === null)` + `receiverRef.get()`）。receiver 删了之后，这两句的语义全没了 —— 见下 |

⚠️ **第 4 条不是「顺手清理」，漏了会静默出问题**：那段线程在 `timeout` 之后
把 `result` 写成 `"取消"`（`core.js:1964-1966`）。而不再等待之后 `result` 已经没有读者，
**写它不会报错**（`var result = null` 是个普通局部变量）——
但 `context.unregisterReceiver(...)` 那两处会**抛**（receiver 已不存在），
被 `try/catch(e){}` **吞掉**（`core.js:1969-1971`）⇒ 表现是「日志里什么都没有，但那段代码在空转」。

⚠️ **并且它自己就踩在不可靠路径上**：`new Thread(new Runnable({…}))`
（`core.js:1961`，实测矩阵第 6/7 条）。**别指望它能用** ——
若决定保留超时收岛，先确认它在真机上真的会跑。

##### ✅ 实施状态（2026-10-07）：**已改完，未上真机**

脚本侧（`src/core.js`）已按本方案改完，改动集中在四处：

| 位置 | 改动 |
|---|---|
| 文件顶部新增注释块 | 说明为什么改、只覆盖哪类场景（A 类） |
| 新增 `buildClickPayload` / `createClickBroadcastIntent` | 载荷编码 + PendingIntent 构造（在 `createLaunchIntent` 之前） |
| `showIslandNotification` | 删掉 receiver 段与等待循环；两条 PendingIntent 改成广播；`return "已发送"` |
| `showFloatingPrompt` | 加 `opts.openWith` 分流（没有 openWith 的走浮窗 —— 见「A/B 两类」） |

⚠️ **`VFLOW_CLICK_BROADCAST`（`src/core.js` 顶部）是回退开关**，默认 `true`。
置 `false` 时退回旧行为（主体 `getActivity`、按钮仍走广播但没人接）——
它是**排查用的**，不是长期配置项。

⚠️ **配套的工作流改动（加广播触发器 + 处理步骤）尚未做** ——
脚本现在发出去的广播**还没有人接**。⇒ 在配上触发器之前，**点岛不会有任何反应**
（这是**预期的**，不是缺陷）。

##### ⚠️⚠️ 三条必须同时成立的契约（漏任一条都是**静默失效**）

**契约 A：脚本发的 action 必须与工作流里配的完全一致。**

脚本发的 action 是**运行期拼**的（原实现带 `notificationId` 后缀保证唯一，`core.js:1858`），
而 `IntentFilter` 里的 action 是**注册期就固定**的（`BroadcastTriggerModule` 的
`actions` 参数**不接受变量**，见该模块的 `InputDefinition`）。
⇒ **不能带任何运行期后缀**，必须是**写死的常量**。

⚠️ 原实现带后缀是有原因的（避免与上一次的点击串台）。改成固定 action 后，
这个「串台」问题**必须由契约 C 解决** —— 判据是 `requestCode` + `data`，而**不是 extras**（见下）。

**契约 B：点击时「要做什么」必须跟着广播走，不能靠「最近一次」。**

固定 action ⇒ 无法从 action 区分是哪一次岛。而**「用最近一次识别的结果」是错的** ——
用户完全可能先看到 A 的岛、不点，再复制 B 触发第二个岛，然后回头点 A。
⇒ 脚本要把**这次的全部决策信息**（链接、方式、包名…）随广播发出去，
工作流直接用它，**不查任何「最近一次」状态**。

⚠️ **现在是一个 extras 都没有**（`core.js:1905-1906` 只 `new Intent(action)`）——
数据全在脚本的闭包变量（`opts` / `result`）里。⇒ **这是本次新增的要求，不是「搬一下」。**

##### ⭐ 载体选型：**放 `data`（URI），不放 `extras`**

用户 2026-10-07 提的：「能放广播的 data 里面吗」。**能，而且更好。** 三条理由：

| # | 理由 | 依据 |
|---|---|---|
| 1 | **`extras` 有 8 KiB 预算、`data` 没有** | `BroadcastTriggerHandler.kt:106` 的 `MAX_EXTRAS_JSON_BYTES = 8 * 1024`；而 `dataUri = intent.dataString`（`:365`）**原样输出、无预算** |
| 2 | **能精确指定接收者** | `setPackage("<vFlow 包名>")` —— `data` 不变（URI 是给**工作流**看的），package 是给**系统**看的，两者独立。⇒ 把「任意 App 可伪造」收窄成「必须知道包名 + action + URI 形状」 |
| 3 | **`data` 支持 `addDataScheme` 精确过滤** | 正好卡掉别的 App 发来的同 action 广播 |

⚠️ **`setPackage` 是本方案里唯一需要「知道 vFlow 包名」的地方** ——
而脚本本来就跑在 vFlow 里，`context.getPackageName()` 直接就有（`core.js:2032`
已经在用 `context.getPackageName()` 了）。**不是硬编码。**

**载荷形状**（`vflowfc://` 这个 scheme 是新的，不会与别的广播撞）：

```
vflowfc://click?act=window&pkg=tv.danmaku.bili&uid=0&type=url&url=<encodeURIComponent(原始链接)>
```

| 参数 | 来自 | 说明 |
|---|---|---|
| `act` | `openWith.openact` | `fullscreen` / `window` |
| `pkg` | `openWith.pkg` | 目标包名 |
| `uid` | `openWith.UserId` | 多用户 |
| `type` | `openWith.type` | `url` / `intent`（决定 `url` 怎么解析） |
| `url` | `openWith.urlsharme` | ⚠️ **必须 `encodeURIComponent`** |

⚠️ **`url` 必须编码**：链接里**本来就有 `?` 与 `&`**（如
`https://…/video/BV1xx?share_source=copy_web&vd_source=…`），
不编码会被 URI 解析器**吃掉**（`&` 之后的段变成新的 query 参数）。
`encodeURIComponent` 的代价很小 —— 实测一条 92 字节的链接编成 110 字节（**1.20×**），
而它换来的是「解析绝不会错」。脚本侧 `encodeURIComponent` / 工作流侧
`vflow.data.url_codec`（decode）**一对现成函数**。

**类型限制**（`ExtrasJsonCodec.putTyped` 只支持 String / Boolean / Int / Long / Float / Double
/ 各类数组，`:171-230`）⇒ **别把整个 `openWith` 对象塞 extras**，只挑上面五个标量。
这也是选 `data` 的一个附带好处：URI 里本来就只放字符串。

⚠️ **对照：把 `openWith` 整个塞 extras** —— 实测一条 317 字节，8 KiB 预算下
**25 倍余量，够用**。所以这不是「extras 装不下」，而是「`data` 在
精确寻址 + 无预算 + 可 scheme 过滤三件事上都更好」。

**工作流侧怎么取**：广播触发器的 `data_uri` 输出拿到整串 ⇒
`vflow.data.url_codec` 解码 + `vflow.data.parse_json`（或文本提取）拆出五个字段
⇒ 拼 `am start` 命令给 `vflow.shizuku.shell_command`（全屏用
`am start --windowingMode 1`，小窗用 `--windowingMode 5` —— 两者共用一条命令）。

**契约 C（⚠️ 最容易漏的一条）：`PendingIntent` 的 `requestCode` 必须让每条通知、每条通道都不同。**

> ⚠️ **本节初稿把等价判据写错了** —— 初稿说「`filterEquals` **不**比较 `data`」，
> 依据是官方文档的 `PendingIntent` 页面。**去 AOSP 源码逐字核实后发现那是错的**：
> `filterEquals` **比较 `data`**。判据与结论都已在下面更正（`data` 参与判据这件事，
> 恰好是「两条 PendingIntent 不会互相顶掉」的原因；但它**不够保险**，见下）。

**真正的等价判据**（系统侧，不是 `Intent.equals`）：

```java
// services/core/java/com/android/server/am/PendingIntentRecord.java
// final static class Key.equals —— 已逐字核实（android16-release）
type / userId / packageName / featureId / activity / who /
requestCode / requestIntent.filterEquals / requestResolvedType / flags
```

```java
// core/java/android/content/Intent.java:11837 —— 已逐字核实
public boolean filterEquals(Intent other) {
    ... mAction / mData / mType / mIdentifier / mPackage / mComponent / mCategories ...
}
// ⇒ **比较 data**；不比较 extras；**也不比较 flags**
```

**命中已有 Key 时的处置**（`services/core/java/com/android/server/am/PendingIntentController.java:167-180`）：

```java
if (!cancelCurrent) {
    if (updateCurrent) { rec.key.requestIntent.replaceExtras(...); }  // ⚠️ 只换 extras，不换 data
    return rec;                                                        // ← 没带 UPDATE_CURRENT 就直接返回旧的
}
```

⇒ **两个坑，都是静默的**：

| 坑 | 后果 |
|---|---|
| `requestCode` 写死 + **两条通道（主体/按钮）的 `data` 只差 `act=`** | 侥幸能跑（`data` 参与判据）。但**一旦有人把 `act` 从 payload 去掉**，两条就完全同身份 ⇒ **点按钮变全屏** |
| `requestCode` 写死 + **跨通知也相同**（`data` 也相同） | 第二条通知命中第一条，**直接返回旧记录**（本实现没带 `FLAG_UPDATE_CURRENT`）⇒ **点第二条的按钮，打开的是第一条的链接** |

⚠️ **两条都不会报错、不会崩**。后者的表现是「偶尔点错了链接」，**只在同时存在两个岛时**才复现 ——
单条链路的验收**测不出来**。

⇒ **解法（两道保险都上）**：

| 通道 | `requestCode` | `data` |
|---|---|---|
| 主体（全屏） | `notificationId` | `…&act=fullscreen&…` |
| 按钮（小窗） | **`notificationId + 1`** | `…&act=window&…` |

跨通知靠 `notificationId` 不同；同通知内两条靠 `+1` 与 `act` 不同。
`+1` **不加价**，而它挡的是「将来有人动了 payload 结构」这类改动。

⚠️ **不能改用 `FLAG_UPDATE_CURRENT` 来「修」这个** —— 它只 `replaceExtras`，
**不换 `data`**（见上面的源码），而本方案的载荷恰恰在 `data` 里 ⇒ 换了也没用。

##### ⚠️ 新攻击面：接收方从「脚本进程内」变成 `EXPORTED`

现在的广播是**隐式**的（没 `setPackage`）、action 带**随机后缀**
⇒ 别的 App 基本不可能匹配到（`core.js` 原文）。

⚠️ **实现在 2026-10-07 补了 `setPackage(context.getPackageName())`** ⇒ 从「隐式」变成
**显式指向 vFlow**，攻击面比初稿评估的更小（伪造者还要知道包名）。
但接收方本身仍是
`ContextCompat.RECEIVER_EXPORTED`（`BroadcastTriggerHandler.kt:262`）
⇒ **任何应用都能伪造这条广播**，而 extras 里装的就是「打开哪个链接」。

| 项 | 评估 |
|---|---|
| **危害量级** | 约等于「任意 App 自己 `startActivity(ACTION_VIEW)`」⇒ **不新增实质能力** |
| **何时需要重新评估** | 如果这条工作流里挂的**不只是打开链接**（比如还带副作用步骤），那就成了「任意 App 触发任意工作流」 |
| **缓解** | ① 把 action 起得足够特异（`com.chaomixian.vflow.fluidcloud.CLICK` 之类）；② 工作流侧对 extras 做白名单校验（只接受已知的 URL 形态）；③ ⚠️ **不要**为此加鉴权层 —— 用户 2026-10-07 已明确否掉广播触发器的鉴权（见 `FORK.md` 的广播触发器条目） |

##### ✅ 这条路额外买到的东西：**不阻塞**

现在的岛/浮窗是**同步等待**的：`while (result === null) { Thread.sleep(150); }`
（`core.js:1976`）。默认 `Fluid_Cloud_timeout = 3000`（`adapter.js:208`）
⇒ **每次触发都把工作流线程占住 3 秒**（点了按钮则提前结束）。

改成「动作交给工作流」之后，脚本**弹完就返回** ⇒ 工作流立刻结束。

⚠️ **代价是「超时兜底」要重新想**：原实现到点（默认 3 秒）会
`NotificationManager.cancel(notificationId)` 自动收岛（`core.js:1963-1971`）。
三条路，**未定，实施时需真机确认**：

| 做法 | 代价 |
|---|---|
| 保留那段超时线程（**去掉** `result` / `unregisterReceiver` 那两句） | 它跑在 `new Thread(new Runnable{…})` 上 —— **不可靠路径**（实测矩阵 6/7） |
| 交给岛自己的超时（`islandTimeout`，`core.js:2001` 已写 `10`） | ⚠️ **未验证岛到点会不会自己消失** |
| 干脆不收（通知常驻到用户点或划掉） | 观感变差，但**行为可预测** |

##### ⚠️⚠️ 但这条路**只对「一次点击 = 一个终结动作」的场景成立**

**这是本方案真正的边界，必须先说清楚** —— 否则会以为「把岛的通知路径改掉就行了」。

`core.js` 里**有两类交互**，它们的性质完全不同：

| 类别 | 例子 | 点击后要做什么 | 广播方案适用？ |
|---|---|---|---|
| **A. 终结动作** | 岛上的**按钮**（「浮窗打开」） | 打开一个链接，**然后结束** | ✅ **适用** —— 工作流接了就能干完 |
| **B. 交互回合** | **多链接选择框**（`showOptionsDialog(AllLinks, "选择链接")`，`core.js:2185`）<br>**打开方式选择框**（`core.js:1782` / `:2270`）<br>**「其他打开方式」二级框**（`core.js:2317`）<br>**识别模式选择**（`core.js:1681`） | 用户选一项 ⇒ **脚本还要拿这个结果继续跑**（`matchRules` → 再弹框 → 最后才 `launchWithMode`） | ❌ **不适用** |

**为什么 B 类不能照搬**：那些框的点击是**脚本自己画的浮窗上的 `View.OnClickListener`**
（`core.js:874`，`new View.OnClickListener` —— **接口，走 `Proxy`，本来就不炸**），
结果**直接写回脚本的局部变量 `result`**。而广播是**跨进程**的 ——
工作流接住点击之后，**没法把结果塞回那段已经返回的脚本**。

⇒ **B 类的选择是「在哪儿做」的问题，不是「怎么回传」的问题**（见下）。

##### 那 B 类怎么办：**把选择也挪进工作流**

⭐ **这正是用户 2026-10-07 提的「单独搞一个广播触发器的工作流」的意义** ——
它不只是「接一个按钮」，而是**把整段交互搬出脚本**：

| 环节 | 现在（脚本内） | 改后（工作流内） |
|---|---|---|
| 识别链接 | 脚本 | 脚本（**照旧**，识别是纯计算） |
| **弹什么、选什么** | 脚本自绘 `WindowManager` 浮窗 + 阻塞等待 | **工作流模块**：`vflow.logic.list.choose`（选项列表）、`vflow.ui.*` 那套 UI 积木 |
| 用户选完 | 写回脚本的 `result`，脚本继续跑 | **工作流继续往下走**（`If` / 分支），**不需要回传** |
| 打开 | 脚本调 `launchWithMode` | 工作流调 `am start` |

⚠️ **这个搬法的前提是「选择之后要做的事，工作流能表达」** ——
本项目恰好成立：选择之后的动作就是「打开某个链接」（`launchWithMode`），
而它已经被 §4.2 的方案简化为**一条 `am start` 命令**（见下）。
⇒ **不需要把 2400 行脚本逻辑搬进工作流，只需要搬「选择」这一步。**

⚠️ **不成立的反例（别硬搬）**：若某个选择之后要跑的**是脚本里的大段逻辑**
（比如「重新识别」——它要重新走一遍 `RecognitionMain` + 再弹框），
那就得让工作流**再触发一次脚本执行**（而 `BLOCK_NEW` 重入策略会忽略这次触发，
见「已知限制」表）。⇒ **「重新识别」这一类按钮不适合直接照搬，需单独设计。**

##### 通知的「收尾」：两个 timeout 单位不同，且上游一个都没用系统能力

⚠️ **2026-10-08 真机暴露**：用户反馈「**岛一会儿就消失了，但通知栏里那条一直在**」。

**真因（已核实）**：上游 `reference/core.js` **完全依赖自己那段超时线程**去
`NotificationManager.cancel`（`reference/core.js:2124-2135`），而
`setTimeoutAfter` / `setAutoCancel` / `setOngoing` **一个都没用**
（`grep` 逐条核实，零命中）。本次改动把那段线程删了（不再阻塞）⇒ **通知永久留在通知栏**。

**三个「超时」的单位各不相同，混起来不会报错、只会「消失得太快/太慢」**：

| 字段 | 位置 | 单位 | 上游取值 |
|---|---|---|---|
| `Fluid_Cloud_timeout` | `config.json` | **毫秒** | 3000 |
| `param_island.islandTimeout` | 岛参数 | **秒** | ⚠️ **写死 10**（没读配置） |
| `timeout`（根级） | 岛参数 | **分钟** | ⚠️ **写死 10** |
| `setTimeoutAfter(ms)` | `Notification.Builder` | **毫秒** | ⚠️ **上游没用** |

**本轮的处置**：

| # | 改动 | 依据 |
|---|---|---|
| 1 | **加 `setTimeoutAfter(Fluid_Cloud_timeout)`** | AOSP `NotificationManagerService` 用 `AlarmManager.setExactAndAllowWhileIdle` 到点 cancel（`NMS.java:10269-10274`）⇒ **不依赖 App 进程活着** |
| 2 | **`islandTimeout` 改读配置**（`Fluid_Cloud_timeout / 1000` 向上取整） | 用户 2026-10-08 要求。⚠️ **副作用**：默认配置下岛从 **10 秒变成 3 秒**（嫌快就调大配置） |
| 3 | **载荷带 `nid`**（通知 ID）⇒ `launchFromClick` 里 `cancelNotificationById(payload.nid)` | ⚠️ 用户点开之后那条通知没有理由继续挂着 —— 原来靠脚本 cancel，现在脚本不参与点击了 |
| 4 | **根级 `timeout` 也按配置推导**（秒 → 分钟，向上取整、至少 1） | 与 2 同源，避免「岛 3 秒、通知 10 分钟」这种两套语义 |

**真机验证（小米 MIX Fold 3 / Android 17，2026-10-08）**：

| 项 | 结果 |
|---|---|
| 触发后通知出现 | ✅ 第 1 秒 `channel=fluid_cloud_channel` 计数 = 2（通知本体 + 岛相关记录） |
| 3 秒后自动消失 | ✅ 第 3 秒计数 = **0**（`setTimeoutAfter` 生效） |
| 点按钮 → 小窗打开 | ✅ `Task{… mode=freeform}` |
| 点击后通知被收掉 | ✅ 日志 `已收掉通知 id=391000172`，通知计数 = 0 |

⚠️ **未验**：`islandTimeout` 从 10 改成 3 之后**岛的实际存活**（用户说「好像一会儿就消失」，
但那是改之前的行为）。改后的 3 秒是否符合预期，**要用户自己看一眼**。

##### ⚠️ 已知限制（如实记录）

| 限制 | 说明 |
|---|---|
| **只覆盖「终结动作」** | 见上一小节的 A / B 两类。B 类（多链接选择 / 打开方式选择）**不能靠回传**，得把选择本身搬进工作流 |
| **只绕开「岛这一处」的子类化** | 岛/浮窗的**构造**部分（`Notification.Builder` / `PendingIntent` / `Icon` / `Bundle`）**不涉及子类化**，本来就没问题；而 `core.js` 别处若再出现「实现抽象类」仍会撞墙（根治要出路 ②） |
| **需要 Shizuku / Root** | 广播触发器本身不需要，但**打开链接**走的是 `am start`（§4.2 的 shell 通道）⇒ 仍依赖 |
| **`setPackage` 要填对包名** | 填错 ⇒ 广播**发不出去**（`FLAG_EXCLUDE_STOPPED_PACKAGES` 之类不会兜底）。⚠️ 用 `context.getPackageName()` 而不是硬编码 |
| **跨用户场景** | 原实现用 `createPackageContextAsUser` 取图标（`core.js:1918`），广播本身不跨用户；`data` 里带 `uid` 由工作流侧处理 |
| **`am start --windowingMode` 的事务语义** | 与 `service call 138` **不同**（一个走 shell 命令、一个走 binder 事务码）。⚠️ **已实测能开小窗**（见 §4.2），但**机型覆盖未验** |

##### 与出路 ② 的关系

**两者不冲突，且都值得做**：

- **①** 让**岛这条路径立刻能跑**（不依赖改 vFlow）—— 代价是「动作执行挪到工作流」
- **②** 是**根治**（让脚本能子类化抽象类）—— 但**改上游核心文件**（`FORK.md` 要登记）
  + 引入 dx 依赖（约 1 MB）

⇒ **建议先做 ① 打通岛路径，再评估 ②**。而且 ① 做完之后，
**② 的优先级会下降** —— 「动作执行挪到工作流」换来的不只是权宜之计，
**「不阻塞」本身就是一个改善**（见上）。

#### 对 P0 的影响

**P0 的目标（「复制 → 识别 → 提示 → 打开」）用浮窗路径已经跑通**（见 §7.1）。
岛形态的恢复**不阻塞 P0**，但**是用户的核心诉求** ⇒ 列为 P1 第一项（出路 ①，见上）。

---

## 5. 实施计划

> **已与用户确认**：第一个里程碑 = **先跑通单条链路**（不追求一次到位）。

### P0 —— 最小闭环（**已跑通，浮窗形态**）

**目标**：剪贴板复制一条分享文案 → 识别出链接 → 弹出提示 → 点击打开。

| # | 事项 | 状态 |
|---|---|---|
| 1 | 建 vFlow 工作流：`vflow.trigger.clipboard` + 标签「剪切板」 | ✅ 走 API 创建（`tools/create-workflow.py`） |
| 2 | 移植 `core.js`（**改 3 处专有 API + 1 处路径 + 1 处 `factTag`**） | ✅ 5 类补丁**一次性做完**，结果落盘为 `src/core.js`（改动点就地标 `/* [vflow] */`，共 12 处）。⚠️ 架构调整后**不再有构建期出现次数断言**（见 §3.5），改由 `test/run.js` 的产物 + 源码双路断言兜底 |
| 3 | 规则库放进 vFlow 可读目录 | ✅ `/sdcard/vFlow/fluid-cloud/` |
| 4 | `vflow.system.js` 步骤 | ✅ 引导脚本 + `eval`（§7.2） |
| 5 | 弹提示 | ⚠️ **岛被 §4.6 阻塞，暂用浮窗**（`use_islandNotification=false`） |
| 6 | 点击 → 打开链接 | ⚠️ 浮窗路径的点击**未单独验**（浮窗弹出后需人工点）；岛路径的点击是阻塞点 |

**P0 验收判据**（真机，逐条对 §7.1）：
- [x] 复制一条含链接的分享文案 → 浮窗弹出，标题/副标题正确
- [ ] 点浮窗主体 → 全屏打开链接（**待人工点一次确认**）
- [x] 规则命中（「打开哔哩哔哩」）
- [x] `console.log` 输出能在 logcat 里看到（`JsScript: [fluid-cloud] …`）
- [ ] ~~岛形态~~ —— **被 §4.6 阻塞**，见 P1 第 0 项

### P1 —— 补齐触发源与打开方式

| # | 事项 | 说明 |
|---|---|---|
| **0** | ⭐ **把「点击之后做什么」交给工作流（广播 → vFlow 广播触发器）** | 见 §4.6 出路 ①。**恢复超级岛形态的路径**，且**不用改 vFlow**、顺带解决「阻塞 3 秒」。⚠️ 多链接/打开方式那类**选择**要一并搬进工作流 |
| **0b** | （可选，根治）**补上 `ContextFactory.createClassLoader`（`dx` 那条链）** | 见 §4.6 出路 ②。做完 0 之后**优先级下降**；它是本批**唯一要改 vFlow 核心代码**的项 |
| 7 | QQ / 微信触发源 | `vflow.trigger.activity_changed` + `class_filter` 精确匹配；脚本里改用 `intent_uri` 抠 `S.url=` / `S.rawUrl=` |
| 8 | 附加插件广播触发源 | `vflow.trigger.broadcast` + `extras_json`；⚠️ 需确认附加插件（`com.nyehueh.fluidcloud`）是否要改，或改用 vFlow 自己的广播 |
| 9 | 小窗打开 | `service call activity_task 138`（§4.2）；非小米机型降级全屏 |
| 10 | 选项列表对话框 | 用 `vflow.logic.list.choose` 替代自绘 WindowManager View |

### P2 —— 完整形态

| # | 事项 | 说明 |
|---|---|---|
| 11 | 图形化设置页 | 脚本用自绘 `WindowManager` View（`showsettingsui`，`core.js:274-490`）⇒ vFlow 有 `vflow.ui.activity.*` UI 积木可替代，但**工作量不小** |
| 12 | **脚本更新机制**（拉产物 / 覆盖 / 版本号） | **方案已定案**（§3.4，2026-10-07），**未实现**。⚠️ **不移植上游 `update.js`** —— 它做的是「增量合并规则」，而本项目定的是「整份覆盖产物」 |
| 13 | （可选）岛通知模块化 | §4.1 路线 B：新增 `vflow.notification.island`，**并把脚本里那份删掉** |

---

## 6. 静默失效点清单

本仓库的核心教训是「**改错了不报错、只静默变差**」。本项目的风险点：

| # | 风险 | 表现 | 防法 |
|---|---|---|---|
| 1 | **`factTag` 未接上** | 脚本走错分支 / 全部落空，**不报错** | 脚本开头显式赋值 + 兜底空串；用日志打印实际值 |
| 2 | **`[[__trigger_label]]` 未设置** | 值是**空串**（不是 `VNull`）⇒ `If` 比较恒 false | 每个触发器都要填标签；未命中时脚本要有默认分支 |
| 3 | **规则文件路径不可读** | 规则库为空 ⇒ 识别不出任何链接，**表现为「功能没反应」** | 脚本启动时检查文件存在性并**显式报错**（原脚本有 `throw "核心文件不存在"`） |
| 4 | **`service call 138` 事务码失效** | 小窗静默变成全屏（或失败） | 按 `script-system-overview.md` §6.2 做 `mode=freeform` **回读验证** |
| 5 | **`vflow.system.js` 无超时生效** | 脚本死循环**永久挂住执行线程**（FORK.md：引擎有超时能力但**两个调用点都不传**） | ⚠️ **本项目直接暴露在这个风险下**（§7 未决项） |
| 6 | **岛参数两份实现漂移** | 若 P0 脚本内拼 + P1 转模块化，两份 `param_v2` 会不一致 | §4.1：转 B 时**必须删掉脚本那份** |
| 7 | **Xposed 通道未连接** | `activity_changed` 触发器**静默不触发**（P1 的 QQ/微信源） | 首页有 Xposed 状态卡；`TriggerService` 会显示提示 |
| 8 | **`extras_json` 被截断** | 广播 extras 超 8 KiB 时 `truncated=true`（`BroadcastTriggerHandler` 的预算） | 检查 `truncated` 输出；附加插件的 URL 通常很短，风险低 |

---

## 7.1 P0 真机验证记录（2026-10-07，小米 MIX Fold 3 / Android 17）

> 设备：`192.168.1.32:38079`（无线调试）。工作流 id `aa070997-fdba-46bd-9ef7-e1fb7a7ac5cf`。
> 全流程走的是**远程 API**（`tools/create-workflow.py`），没有手工粘贴 —— 见 §7.2。

### ✅ 已通过

| # | 判据 | 证据 |
|---|---|---|
| 1 | 引导脚本在 vFlow 里**能跑起来** | `JsScript: [fluid-cloud] 首次运行，已创建配置目录 /sdcard/vFlow/fluid-cloud` |
| 2 | 完整脚本从设备文件读取并 `eval` 成功 | 后续所有 `core.js` 内部函数都跑到了（`获取用户列表失败` 是 core.js 内部的日志） |
| 3 | 规则库被读到 | 无「规则库缺失」报错；链接识别产出正确结果 |
| 4 | **链接识别 + 规则匹配 + 提取码回填** | 浮窗标题显示「打开哔哩哔哩」（规则命中），副标题「点击全屏打开哔哩哔哩」 |
| 5 | **浮窗真的弹出来了**（截图证据） | 顶部胶囊：B站图标 + 「打开哔哩哔哩 / 点击全屏打开哔哩哔哩」+ 「浮窗打开」按钮 |
| 6 | 剪贴板触发器接线正确 | `ClipboardTriggerHandler: 触发工作流 '流体云'，事件: clipboard_changed (standard)` |
| 7 | 端到端全自动（无需人工干预） | 用 API 写剪贴板 → 触发器命中 → 工作流执行 → 浮窗弹出 |

### ❌ 阻塞项（已定位，见 §4.6）

| # | 问题 | 现象 |
|---|---|---|
| 1 | **`vflow.system.js` 里不能 `new` 抽象类** | 岛通知路径抛 `can't load this type of class file：类 android.content.BroadcastReceiver 是接口或抽象类` |
| 2 | 因此**超级岛形态当前用不了** | 只能退化成浮窗（配置 `use_islandNotification=false`） |

**真因（已核实，非推断）**：vFlow 的 `JsTimeoutContextFactory` **没有覆写
`ContextFactory.createClassLoader`**，于是 Rhino 落回默认的 `DefiningClassLoader`
（它调 JVM 的 `ClassLoader.defineClass`，在 ART 上无效）。
ShortX 用 `com.faendir:rhino-android` 覆写了这一层 —— 把 `.class` 用 `dx` 翻成 dex
再用 `InMemoryDexClassLoader` 加载。**⇒ 补上这一层即可恢复**（P1 第 0 项）。

### ⚠️ 一处**看着像成功、其实是误判**的探测（记下来防重蹈）

第一次探测时把 `new java.lang.Thread({run:…})` 判成「具体类可以子类化」。
**再探一次发现**：`getClass().getName()` 仍是 `java.lang.Thread` —— **根本没有生成子类**。
`new java.util.ArrayList({size:…})` 更是直接 NPE。

⇒ 教训：**判据不能只看「调用有没有返回值」**，要看**实际类型**（`getClass()`）。
这直接影响了 §4.6 的结论排序（把「浮窗替代」从出路 ① 一路降到 ③）。

### ⚠️ 顺带发现的既有行为（**不是缺陷**，但会误导排查）

| # | 现象 | 说明 |
|---|---|---|
| 1 | 第二次写**相同**的剪贴板内容不触发 | `ClipboardTriggerHandler` 有 `lastStandardSignature` 去重（`ClipboardTriggerHandler.kt:57-61`）—— 上游有意设计。**测试时必须换内容** |
| 2 | `获取用户列表失败: SecurityException: need MANAGE_USERS` | `core.js:1196` 的 `getAllUserIds()` 调 `UserManager.getUsers()`，普通 App 无该权限。**被 core.js 自己的 try/catch 接住**，回落 `[0]`。不影响单用户场景 |
| 3 | API 执行接口的 `input_variables` 是**死参数** | `ExecutionManager.executeWorkflowInternal` 的签名里有它，**函数体内零引用**（实测 grep）。⇒ 通过 API **无法注入变量**，只能用「写剪贴板 + 触发器」这条真实通路 |
| 4 | 工作流执行期间再次触发会被忽略 | `WorkflowExecutor` 的 `BLOCK_NEW` 重入策略：`工作流 '流体云' 已在运行，忽略新的执行请求` |

---

## 7.2 为什么最终用「引导脚本 + adb push」

vFlow 远程 API 的请求体上限是 **24 KB**（`BaseHandler.readBody` 的
`CharArray(contentLength)` + `session.inputStream.reader()`，按字符读 —— 实测边界在
**body 24065 字节**），而完整脚本是 **113 KB**。

⇒ 直接 POST 完整脚本会：① 服务端读不全 → 截断 → `gson.fromJson` 失败 →
`400 Invalid request body`；② 更大的 body 会让连接被重置（实测 64 KB 时 `ConnectionResetError`）。

**解法**：工作流里只放 **2 KB 的引导脚本**，它从
`/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js` 读完整脚本并 `eval`。

| 好处 | 说明 |
|---|---|
| 建/改工作流只需几百字节的 payload | 远低于 24 KB |
| **改脚本不用改工作流** | `adb push` 覆盖文件即可，API 一次都不用调 |
| 脚本可在设备上直接看/改 | 路径就在 `/sdcard/vFlow/fluid-cloud/` |

⚠️ **`eval` 必须是「直接 eval 且在最外层」**（不能包 IIFE、不能用 `new Function`）——
`core.js` 的主入口是它自己的顶层代码，且要能访问 `JsExecutor` 注入的
`inputs` / `vars` / `context`。详见 `src/bootstrap.js` 的注释。

---

## 7. 未决项

| # | 问题 | 影响 | 何时需要答 | 现状 |
|---|---|---|---|---|
| 0 | **岛通知怎么绕开「不能 `new` 抽象类」** | **P0 的头号阻塞项**。见 §4.6 的四条出路 | P1 第一项 | ✅ **已定案**（2026-10-07）：**脚本只发广播、不当接收方**，由 vFlow 广播触发器接（§4.6 出路 ①）。**未实施** |
| 0a | **按钮 extras 的字段设计** | 固定 action 后，靠 extras 区分「哪一次、打开什么、怎么打开」⇒ 字段一旦定错，工作流侧拼不出正确命令 | 实施出路 ① 时**先定** | ⚠️ **未定**。必须与「工作流里怎么取值」一起定（§4.6 的契约 B） |
| 0b | **岛的超时兜底怎么办** | 不阻塞后，原来「3 秒后自动收岛」那一段（`core.js:1965`）要不要保留？改由 `islandTimeout` 承担的话，**岛会不会自己消失**未验证 | 实施出路 ① 时 | ⚠️ **未验**（需真机看岛的超时行为） |
| 0c | **`com.android.tools:r8` 作运行期依赖的体积代价** | **出路 ②**（根治）需要 `dx`（约 1 MB）打进 APK。是否接受？是否只给 `:app` 加、`:core` 不加？ | 若做出路 ② | 未答（做 ① 则不需要） |
| 0d | **`rhino-android` 要不要直接用** | 它 2021 年停更、绑 `rhino-runtime:1.7.13`（vFlow 用 1.9.0）⇒ **不建议直接依赖**，倾向自己实现那一层 | 若做出路 ② | 倾向**自己写**（做 ① 则不需要） |
| 1 | **配置目录放哪** | 决定 §3.3 的全部路径改造 | P0 第 3 步之前 | ✅ **已答**：`/sdcard/vFlow/fluid-cloud/`（实测可读写） |
| 2 | **`vflow.system.js` 要不要开超时** | 不开则脚本死循环挂线程（§6-5）。但**给 `JsModule` 加超时参数是一次独立的行为变更**（存量脚本会开始失败），FORK.md 明确说要单独评估 | P0 之后、上真机之前 | ⚠️ **真机实测影响有限**：`core.js` 的阻塞点是 `while (result === null) { Thread.sleep(150); }`，有 `timeout` 兜底（默认 3 秒），**不会无限挂**。⇒ 优先级降到 P2 |
| 3 | **岛通知走 A（脚本内拼）还是 B（新增模块）** | 决定 §4.1 的路线与工作量 | P0 第 5 步之前 | ⚠️ **已被 §4.6 改变前提**：路线 A 在**点击处理**上撞墙（`new BroadcastReceiver`）⇒ 需要先解 #0 |
| 4 | **`IslandParamsBuilder` 能否表达「信息展示型」岛**（`islandProperty: 1` + 单按钮） | 若不能，路线 B 需要扩框架 | 若选 B | 未核 |
| 5 | **附加插件（`com.nyehueh.fluidcloud`）是否继续用** | 它是个第三方 APK，通过广播投递 URL。vFlow 已有 `vflow.trigger.broadcast`，**但要确认它是否绑定了原平台的包名** | P1 第 8 步 | 未核 |
| 6 | **脚本更新的源放哪** | 决定 §3.4 能否落地（「不走代理」是硬约束） | 实施 §3.4 前 | ⚠️ **未核**：候选三个（jsDelivr / 自有服务器 / 其他），**必须在目标网络下实测直连**；且 `dist/` 现在不入库，发布形态也待定（§3.4.3） |
| 7 | **产物发布形态**（`dist/` 入库 / 单独分支 / Release 附件） | 同上 —— 源放哪的前提 | 实施 §3.4 前 | 倾向 **单独分支**，未定案（§3.4.3） |

---

## 8. 一句话总结

**这个脚本与原平台的耦合只有 3 处 API 调用 + 1 个短变量 + 1 组路径假设**，
2000 多行核心逻辑是纯 JS + 公开 Android API；
**vFlow 侧的 5 条触发源里 4 条已有直接对应物，1 条（选中菜单）用户不用**；
**真正的缺口只有「小窗」（已有已验证的绕过路径）与「岛通知」（脚本自己就能做）**。

⇒ **可行性高，且不需要先给 vFlow 补任何基础设施。**
