# vFlow 流体云

把「复制 / 打开分享链接 → 识别 → 提示 → 全屏或小窗打开」做成一个 vFlow 工作流。

- **设计与可行性分析**：[`docs/DESIGN.md`](docs/DESIGN.md)（含真机验证记录、踩坑、未决项）
- **脚本更新机制方案**：[`docs/UPDATE.md`](docs/UPDATE.md)（取代 `DESIGN.md` §3.4）
- **给 coding agent 的规范**：[`AGENTS.md`](AGENTS.md)

> 这不是 vFlow 的 fork，也不含 vFlow 源码 —— 它是一个独立的**脚本工程**，
> 产出物是一段 JavaScript（跑在 vFlow 的「JavaScript脚本」模块里）+ 一份规则库。
> 素材来自上游脚本 [`nightking8342/shortx-Fluid_Cloud_Island`](https://github.com/nightking8342/shortx-Fluid_Cloud_Island)（`3.2.3`）。

> ⚠️⚠️ **本项目不跟随上游。** 上游素材已**一次性**移植进 `src/core.js`，
> 此后只维护这一份（`reference/` 只作来历记录，**不参与构建**）。
> 详见 [`docs/DESIGN.md` §3.5](docs/DESIGN.md) 与 [`AGENTS.md`](AGENTS.md) 开头那一节。

## 目录

| 目录 | 内容 | 谁维护 |
|---|---|---|
| `src/` | **手写的全部东西**（核心逻辑 + 适配层 + 构建脚本 + 规则库） | 我们 |
| `workflow/` | **工作流产物**（`fluid-cloud.json`）—— 在 vFlow 里**导入**它就建好了工作流 | 我们（`tools/build-workflow.py` 刷新脚本部分） |
| `reference/` | 上游素材的**完整镜像**（原名，含未移植的 `onOpen.js` / `update.js`），**不进构建**。另含一份 ShortX **规则分享文件**（唯一记录「上游在 ShortX 侧怎么接线」的材料） | 一次性复制，**不要手改** |
| `dist/` | **构建产物**（脚本 + 更新器 + 规则库），是最终要用的东西。⚠️ **已入库**（2026-10-09）—— 改完 `src/` **必须重跑 `npm run build` 并把 `dist/` 一起提交** | `npm run build` 生成 |
| `test/` | 离线测试（Node 模拟 Rhino + Android） | 我们 |
| `tools/` | 刷新工作流产物 / 推送到设备 / 跑一次取日志 | 我们 |

## 构建

```bash
npm run build     # 两步全跑：合并规则 → 拼接脚本
```

或分步（改了什么跑什么）：

```bash
node src/bundle-rules.js       # 1. 合并 src/rules/ → dist/rules.json
node src/generate.js           # 2. adapter + core → dist/vflow-fluid-cloud.js
                               #    同时 → dist/update.js（独立更新器，**不并进主脚本**）
python tools/build-workflow.py # 3. bootstrap.js → workflow/fluid-cloud.json（改了脚本才要跑）
```

> ⚠️ `src/bootstrap.js` 是**静态文件**（内容就是贴进工作流的引导脚本本身），
> **不是生成器** —— 没有「跑一下生成 dist/bootstrap.js」这回事。
> 但它的**全文会进工作流 JSON** ⇒ 改它之后必须跑 `tools/build-workflow.py` 刷新
> `workflow/fluid-cloud.json`，否则**导入到设备上的还是旧脚本**（两边都看不出来）。

## 测试

```bash
npm test          # 等价于 node test/run.js（104 例）
npm run check     # build + 语法检查 + test
```

⚠️ **离线测试只覆盖纯 JS 那一半**（规则匹配 / 链接识别 / 岛参数生成 / 平台桥调用）。
**不能替代真机验证** —— 模块调用、岛渲染、小窗都测不到。详见 `test/harness.js` 文件头。

## 部署到设备

```bash
export MSYS_NO_PATHCONV=1      # ⚠️ Git Bash 下必须，否则 /sdcard 会被改写成 D:/Git/sdcard

# 1. 规则库（首次；脚本首次运行会自检并在缺失时报错）
adb push dist/rules.json       /sdcard/vFlow/fluid-cloud/
adb push dist/nolinkrules.json /sdcard/vFlow/fluid-cloud/

# 2. 完整脚本（⚠️ 每次改了脚本都要重推）
adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/

# 2b. 更新器（⚠️ **独立文件** —— 只在它自己改了时才推。
#     更新流程**不会**更新它，见 docs/UPDATE.md §7.3）
adb push dist/update.js        /sdcard/vFlow/fluid-cloud/

# 3. 版本号（给更新机制用，见 docs/UPDATE.md §4.3）
adb push version /sdcard/vFlow/fluid-cloud/version

# 4. 工作流 —— ⭐ 走**导入**，不走 API
python tools/deploy-workflow.py            # 刷新 JSON → 推到设备 → 唤起导入
                                           # ⚠️ 设备上弹「冲突」时点【替换】才是更新
```

> ⚠️ **为什么工作流走导入而不是 API**：远程 API 的 `POST /api/v1/workflows` 用的是
> `SimpleCreateWorkflowRequest`，它**没有** `reentryBehavior` / `silentExecution` /
> `logLevel` / `cardIconRes` / `cardThemeColor` 这些字段 ⇒ 建出来的工作流**永远差一截**，
> 而且**不报错**（表现是「卡片颜色不对」「静默执行没生效」）。
> 导出/导入那条路字段是**完整**的（vFlow 2026-10-08 把四条读写路径收敛到
> `WorkflowJsonCodec` 之后，导出是反射派生的）。
> ⇒ **工作流的产物 = `workflow/fluid-cloud.json`**，改工作流 = 改这份文件 + 导入回设备。

工作流长这样（`workflow/fluid-cloud.json`）——
⭐ **一个工作流、三个触发器**（三条触发路跑的是同一份脚本）：

| 工作流 | 触发器 | `inputs`（键 → 值） |
|---|---|---|
| **流体云** | ① `剪贴板变更`（`vflow.trigger.clipboard`），标签 `剪切板`<br>② `广播`（`vflow.trigger.broadcast`），action `…fluidcloud.CLICK`、scheme `vflowfc`，标签 `点击`<br>③ `手动触发`（`vflow.trigger.manual`），标签 `设置` | `click_uri` → `{{fluid_click_broadcast.data_uri}}`<br>`clipboard_text` → `{{fluid_trigger_clipboard.text_content}}`<br>`trigger_label` → `{{vars.__trigger_label}}` |

⭐ **③ 手动触发 = 打开设置界面**（上游「点指令图标 → 执行动作」那条路的 vFlow 版）：
跑它 → 脚本按标签 `设置` 分流 → 弹「设置指令 / 编辑规则 / 编辑无链接规则」菜单。
⚠️ 这三个界面是**上游原样的自绘 `WindowManager` View**（不是 vFlow 的 UI 积木），
见 `docs/DESIGN.md` §5 P2-11。

> ⚠️ **加了这个触发器之后，卡片上那个「▶ 执行」按钮会消失** ——
> vFlow 只在「有手动触发器 **且没有**自动触发器」时才画它
> （`WorkflowListScreen.kt:943`），而本工作流一直有剪贴板/广播触发器。
> ⇒ 要手动跑就用**桌面快捷方式**：卡片 ⋮ 菜单 →「添加到桌面」
> （判据是 `hasManualTrigger()`，本改动后可用）。

它的 `script` 是 `src/bootstrap.js` 全文（**不是**完整脚本）。

> ⚠️ **曾经是两个工作流**（「流体云」+「流体云·点击」），2026-10-08 合并成一个。
> 合并后有个**必须知道的新坑**：vFlow 对**未命中的触发器输出**不是给空串，
> 而是回退成字面量 `{{{stepId.outputId}}}`（**三个花括号**）——
> 一次执行里必然有一路是这个形态，脚本侧要在 `src/adapter.js` 的 `input` 里认出来当空处理，
> 否则会拿它去识别链接、**弹一个无意义的岛且不报错**。详见 `docs/DESIGN.md` §4.6。

⚠️ **为什么工作流里放的是 `bootstrap.js` 而不是完整脚本**：完整脚本 113 KB，
而工作流 JSON 里塞这么一大段，**每次改脚本都要重新导入一次工作流**
（改脚本本该只是 `adb push` 的事）。引导脚本只有约 2 KB，
它从设备文件读完整脚本并 `eval`。⇒ **改脚本只需 `adb push`，不用动工作流。**

## 改造点（相对上游）

**一次性**的移植改动，**全量只有 5 类**，结果已落进 `src/core.js`：

1. 删 3 行 ShortX protobuf 类的 `importClass`
2. `showToast` → `vflow.device.toast`
3. `CopyText` → `vflow.system.set_clipboard`
4. 一处 `ShellCommand` → `vflow.shizuku.shell_command`（**全脚本唯一用 shell 的地方**）
5. 9 处配置路径 → `/sdcard/vFlow/fluid-cloud`

另加适配层（`src/adapter.js`）补的全局变量：`input` / `tiggerTag` / `DebugMode` /
`isRunAction` / `FLUID_CLOUD_DIR` / `VFLOW_ADAPTER` + 首次运行自举。

改动点在源码里**就地标注**（`/* [vflow] */`，共 12 处）：
`grep -n "\[vflow\]" src/core.js`

## 脚本更新机制（**✅ 已实施，2026-10-09**）

一句话：**设置菜单点「检查更新」→ `core.js` 读设备上的 `update.js` 并调用它 →
从 GitHub 官方 raw 拉产物 → 主脚本整份覆盖 / 规则增量合并 → 提示「下次执行生效」**。

| 文件 | 策略 | 谁写 |
|---|---|---|
| `vflow-fluid-cloud.js` | **整份覆盖**（写 `.tmp` → 校验 → `renameTo`） | `update.js` |
| `rules.json` / `nolinkrules.json` | **增量合并**（按 `name`） | `update.js` |
| `config.json` | **增量合并**（基准 = 主脚本内置 `DEFAULT_CONFIG`，版本闸控制） | `adapter.js`（每次执行） |
| ⚠️ **`update.js`** | **不更新** —— 更新流程不拉、不写它；要改就**手动 push** | 人工 |

⭐ **`update.js` 是独立文件**（`src/update.js` → `dist/update.js` → 设备上同名），
**不并进主脚本、也不自我更新** —— 它是「脚本坏了能修脚本」的唯一安全网。

- **只走 GitHub 官方 raw**（`raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/…`），
  **不做镜像**，连通性交给用户
- **`dist/` 入库**（随 `main` 走）
- 版本号**只做字符串相等比较**（用户已明确「不关心它是不是最新的」），
  它既是「要不要拉」的闸、也是给用户看的反馈

📖 **完整方案见 [`docs/UPDATE.md`](docs/UPDATE.md)** ——
那一份把「哪条是用户拍的、哪条是实现者定的」逐条标了来源。
⚠️ `docs/DESIGN.md` §3.4 里的旧决策（不走代理 / 走工作流模块 / 源选型 / 单独分支）
**已推翻**，只作来历记录。

## 当前状态

- ✅ **P0 已真机跑通**（浮窗形态）：复制分享文案 → 识别链接 → 弹浮窗
- ✅ **超级岛形态已打通**（2026-10-08）：脚本里**不能 `new BroadcastReceiver`**
  这个限制**依然存在**（vFlow 的 `ContextFactory` 没覆写 `createClassLoader`，
  不是 ART 的限制 —— 详见 `docs/DESIGN.md` §4.6），但**已经绕过**：
  **按钮只发一条固定 action 的广播**，由 vFlow 的**广播触发器**接住并执行打开。
  ⇒ 脚本不当接收方，也就不需要 `new` 任何东西。
  真机验证：点击回传 → 工作流 → `mode=freeform` 小窗打开 ✅
- ✅ **脚本更新机制已实施**（2026-10-09）：设置菜单点【检查更新】→ 读设备上的
  `update.js` 并 `eval` → 从 GitHub 官方 raw 拉产物 → 主脚本整份覆盖、
  规则/配置增量合并 → 提示「下次执行生效」。见 [`docs/UPDATE.md`](docs/UPDATE.md)。
  ⚠️ 真机验证状态见该文档 §10（其中 `renameTo` 原子性、HTTP 桥接、`eval` 作用域
  三项**必须在真机上确认**）
