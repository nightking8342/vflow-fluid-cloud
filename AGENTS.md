# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## 这是什么

**vFlow 流体云** —— 一个 vFlow 工作流项目。做的事：

> 复制 / 打开一条分享文案 → 从里面认出链接 → 弹一条提示（超级岛或浮窗）→
> 用户点一下 → 全屏或小窗打开。

**它不是 vFlow 的 fork，也不含任何 vFlow 源码。** 它是一个**独立的脚本工程**：
产出物是一段 JavaScript（跑在 vFlow 的「JavaScript脚本」模块里）+ 一份规则库。

**素材来源**：上游脚本 [nightking8342/shortx-Fluid_Cloud_Island](https://github.com/nightking8342/shortx-Fluid_Cloud_Island)
（原为 ShortX 写的，`version` = `3.2.3`）。`reference/` 是它的**逐字节镜像**。

---

## ⚠️⚠️ 本项目**不跟随上游**（2026-10-07 架构调整）

**这是一条硬规矩，改任何东西之前先读这一节。**

| 变化 | 从 | 到 |
|---|---|---|
| 核心逻辑 | `vendor/core.js`（上游只读镜像）+ `src/build.js`（每次构建重新打补丁） | **`src/core.js`（就地维护的源文件，直接改）** |
| 规则库 | `vendor/rules/` | **`src/rules/`** |
| 上游素材 | `vendor/` | **`reference/`**（只读参考，**不参与构建**） |
| 构建脚本 | `src/build.js`（打补丁） | **已删除** |
| 构建 | 三步（打补丁 → 合并规则 → 拼接） | **两步**（合并规则 → 拼接） |

⇒ **`src/build.js` 已删除**。5 类补丁是**一次性**做完的，结果落盘成 `src/core.js`；
12 处改动点在文件里**就地标注**（`grep -n "\[vflow\]" src/core.js` 可见）。

**理由**（用户 2026-10-07 原话）：

> 「我们也不必跟上游同步。后续我们只要把这个流体云搬过来之后，就只维护这一个了」

⚠️ **代价（如实记录）**：**失去「跟上上游更新」的能力**。
上游之后再改规则/加站点，本项目**不会自动获得**。
`reference/` 保留为**来历记录**（「这份代码从哪来的」的证据），**不是**同步基线。

⚠️ **`reference/` 里的东西一律不改** —— 改了它就失去「能对照原始实现」这个用途。
它**不进构建**，改了也不影响产物（正因为不进构建，改错也不会当场暴露 ⇒ 所以更不该改）。

### `reference/` 是**完整镜像**，文件**保持上游原名**

⚠️ 这有两个刻意的决定，都别改回去：

| 决定 | 理由 |
|---|---|
| **文件名与上游一致**（`core.js` / `onOpen.js` / `update.js` / `version`） | 目录本身已经说明了「这是上游的」。再加前缀（`upstream-core-3.2.3.js` 之类）① 是**冗余**；② 更糟的是**做了名字映射** ⇒ 想对照「我们改了什么」时得先在脑子里过一遍「`src/core.js` 对应 `reference/` 的哪个文件」 |
| **完整，不筛**（`onOpen.js` / `update.js` 虽然**没移植**也留着） | 它**不是**「将来要用的素材」，是**对照基线**。筛掉的话，判断「某个功能上游有没有」就得回去翻另一个仓库 |

**要对照「我们改了什么」**：

```bash
diff reference/core.js src/core.js        # 5 类移植改动 + 之后所有就地修改
diff -r reference/rules src/rules          # 规则库（逐字节相同 = 没改过规则）
```

⚠️ `reference/` 里**没有 `.git`**（那是上游仓库的工作区），`README.md` 是本项目加的
（说明哪些移植了、哪些没有、为什么）。**除 `README.md` 与下面那份 `.txt` 外，其余文件逐字节等于上游。**

### ⚠️ 唯一一个**不是**上游源码的例外

`reference/ShortX-流体云组件3.7_超级岛版_.txt` —— ShortX 的**规则分享文件**
（用户在 ShortX 里导出/导入用的格式，不是 GitHub 上的文件）。

**为什么破例收进来**：它是**唯一记录「上游在 ShortX 侧怎么接线」的权威材料** ——
5 条触发源分别取哪个变量（`{clipboardContent}` / `{selectedText}` /
`activityIntentUri` 的 `S.url=` / `S.rawUrl=` / `extras["url"]`）、
`ruleInstanceIdGenerator` 怎么写、错误提示怎么挂，**GitHub 仓库里全都没有**。
此前这些只能从用户口述与 `core.js` 反推。

⚠️ **同样只读**，且**别把 `3.7` 当成「比 `3.2.3` 新」** —— 两套编号体系不同，
时间上也几乎重合（2025-12-01 vs 上游 commit 2025-12-02）。
详情见 `reference/README.md`。

📖 完整对照见 `docs/DESIGN.md` §3.5。

---

## ⚠️ vFlow 本地源码在哪（开发时必读）

**vFlow 主仓库**（[`nightking8342/vFlow`](https://github.com/nightking8342/vFlow)，分支 `dev`），
开发时是本地克隆。**本文件不写它的本地绝对路径** —— 每台机器不一样，
按自己的克隆位置找即可（下文引用 vFlow 侧文件时都写**仓库内相对路径**）。

本项目的脚本要调 vFlow 的模块、要遵守 vFlow 的脚本注入约定，
**遇到「vflow 的某个模块参数叫什么」「脚本里能拿到什么变量」这类问题，
必须去那个仓库读源码核实，不要猜。**

那个仓库里有两份**必读**文档：

| 文档 | 为什么读它 |
|---|---|
| `docs/fork/surveys/script-system-overview.md` | **脚本体系的权威梳理**：`JsExecutor` 注入了哪些全局符号（`inputs` / `sys` / `vars` / `global` / `context` / `vflow.*`）、能力边界三层拆解、与 ShortX 的逐项对照、**写脚本的高频陷阱**（§8.5，含异步回调、错误被吞、路径权限） |
| `AGENTS.md`（仓库根） | vFlow 自己的开发规范。本项目**不适用**它的 fork 规矩，但里面「模块系统」「验证门禁」两节对理解 vFlow 有用 |

**其它有用路径**（都在那个仓库里）：

| 要查什么 | 去哪 |
|---|---|
| 某个模块的参数 id / 输出 id | `app/src/main/java/com/chaomixian/vflow/core/workflow/module/**/<Xxx>Module.kt` |
| 触发器清单与输出 | `docs/fork/surveys/trigger-system-overview.md` |
| 超级岛（小米）协议 | `services/island/IslandParamsBuilder.kt` + `docs/fork/notification-island-design.md` |
| 脚本引擎实现 | `core/execution/JsExecutor.kt`、`JsConsole.kt`、`JsTimeout.kt` |
| 远程 API | `api/`（`BaseHandler.kt` 里那条 **24 KB 请求体上限**见下文） |
| **代理参数怎么关**（§3.4 的「不走代理」） | `core/workflow/module/network/PushModuleSupport.kt` 的 `moduleProxyInputDefinitions` / `isDirectProxyOverride` |

---

## 目录

```
├── version               # 本项目版本号（与设备上那份对比用，见 docs/DESIGN.md §3.4.4）
├── docs/DESIGN.md        # ⭐ 设计与可行性分析（含真机验证记录、踩坑、未决项）
├── docs/UPDATE.md        # ⭐ **脚本更新机制方案**（✅ **已实施** 2026-10-09；取代 DESIGN.md §3.4；
│                         #   标了每条决策的来源 + §10 真机待核实项）
├── reference/            # 上游素材**完整镜像**（只读，不进构建，勿改）
│   ├── README.md         #   ⚠️ 本文件是**本项目加的**（说明哪些移植了、为什么）
│   ├── core.js           #   上游核心 2810 行 ⇒ 已移植到 src/core.js
│   ├── rules/            #   27 条有链接规则 ⇒ 已移植到 src/rules/
│   ├── nolinkrules/      #   2 条无链接规则 ⇒ 已移植到 src/nolinkrules/
│   ├── onOpen.js         #   223 行，指令启用时执行 ⇒ **未移植**（无对应时机）
│   ├── update.js         #   647 行，远程更新 ⇒ **未移植**（被 docs/UPDATE.md 那套取代；
│   │                     #   ⚠️ 但**留着**作对照 —— src/update.js 的「合并语义」是从它推出来的）
│   ├── ShortX-流体云组件3.7_超级岛版_.txt  # ⚠️ **不是上游源码** —— ShortX 规则分享文件，
│   │                     #   记录「上游在 ShortX 侧怎么接线」（别处没有）
│   └── version           #   `3.2.3`（⚠️ 与根目录的 version **不是一回事**）
├── src/                  # ✍️ 手写（我们维护的就是这些）
│   ├── adapter.js        #   平台桥 VFLOW_ADAPTER + 全局变量 + 首次自举
│   ├── core.js           #   ★ 核心逻辑（从上游移植后**就地维护**，直接改）
│   ├── update.js         #   ⭐ **更新器**（独立文件，不进主脚本；**已实施**，见 docs/UPDATE.md）
│   ├── bundle-rules.js   #   合并 src/rules/*.json → dist/rules.json
│   ├── generate.js       #   adapter + core → dist/vflow-fluid-cloud.js（+ update.js 独立输出）
│   ├── bootstrap.js      #   引导脚本**本身**（静态文件，不是生成器）
│   ├── rules/            #   27 个有链接规则（一文件一条）
│   └── nolinkrules/      #   2 个无链接规则
├── workflow/             # 📄 工作流产物
│   └── fluid-cloud.json  #   ★ 在 vFlow 里**导入**它就建好工作流（字段完整）
├── dist/                 # 🔨 构建产物（⚠️ **已入库**，见 docs/UPDATE.md §2.1）
│   ├── vflow-fluid-cloud.js   # ★ 完整脚本（128 KB，adapter + core，**不含 updater**）→ push 到设备
│   ├── update.js              # ★ 更新器（独立）→ push 到设备（⚠️ **更新流程不更新它**）
│   ├── rules.json / nolinkrules.json  # ★ 规则库 → push 到设备
├── test/                 # 离线测试（Node 模拟 Rhino + Android）
└── tools/                # 刷新工作流产物 / 推送到设备 / 跑一次取日志
```

---

## 常用命令

```bash
npm run build          # 两步全跑：合并规则 → 拼接脚本
npm run build:workflow # bootstrap.js → workflow/fluid-cloud.json（改了它才要跑）
npm test               # 离线测试（104 例）
npm run check          # build + 语法检查 + test

# 单独跑某一步（改了什么跑什么）
node src/bundle-rules.js       # 改规则库后
node src/generate.js           # 改了 adapter.js 或 core.js 后
python tools/build-workflow.py # 改了 bootstrap.js 后
```

> ⚠️ `src/bootstrap.js` 是**静态文件**（内容就是贴进工作流的引导脚本本身），
> **不是生成器**，没有「跑一下生成 dist/bootstrap.js」这回事。
> 但它的**全文会进 `workflow/fluid-cloud.json`** ⇒ 改它之后必须跑
> `python tools/build-workflow.py` 刷新，否则**导入到设备上的还是旧脚本**
> （两边都看不出来 —— 这正是它被写进 `npm test` 的原因）。

---

## 部署到设备

```bash
export MSYS_NO_PATHCONV=1      # ⚠️ Git Bash 下必须，否则 /sdcard 会被改写成 D:/Git/sdcard

# 1. 规则库（首次；脚本首次运行会自检并在缺失时抛错）
adb push dist/rules.json       /sdcard/vFlow/fluid-cloud/
adb push dist/nolinkrules.json /sdcard/vFlow/fluid-cloud/

# 2. 完整脚本（⚠️ 每次改了脚本都要重推）
adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/

# 2b. 更新器（⚠️ **独立文件** —— 只在它自己改了时才推。
#     更新流程**不会**更新它，所以它的改动只能这样手工推，见 docs/UPDATE.md §7.3）
adb push dist/update.js        /sdcard/vFlow/fluid-cloud/

# 3. 版本号（给更新机制用，见 docs/UPDATE.md §4.3）
adb push version /sdcard/vFlow/fluid-cloud/version

# 4. 工作流 —— ⭐ 走**导入**，不走 API（建一次，之后改脚本不用动它）
python tools/deploy-workflow.py            # 刷新 JSON → 推到设备 → 唤起导入
                                           # ⚠️ 设备上弹「冲突」时点【替换】才是更新
```

⚠️ **工作流走导入而不是 API**：API 的 `POST /api/v1/workflows`
（`SimpleCreateWorkflowRequest`）**没有** `reentryBehavior` / `silentExecution` /
`logLevel` / `cardIconRes` / `cardThemeColor` 这些字段 ⇒ 建出来的工作流**永远差一截**，
而且**不报错**。导出/导入那条路字段是完整的（vFlow 2026-10-08 把四条读写路径
收敛到 `WorkflowJsonCodec`，导出改反射派生）。
⇒ **产物 = `workflow/fluid-cloud.json`**，旧的 `tools/install-workflows.py` 已删除。

⚠️ **Windows + Git Bash 下 `adb push` 前要 `export MSYS_NO_PATHCONV=1`**，
否则 `/sdcard/...` 会被 MSYS 改写成 `D:/Git/sdcard/...`（已实际踩过）。

**为什么分两个文件**：完整脚本 113 KB —— 把它塞进工作流 JSON 意味着
**每次改脚本都要重新导入一次工作流**（而改脚本本该只是 `adb push` 的事）。
⇒ 工作流里只放约 2 KB 的**引导脚本**，它从设备文件读完整脚本并 `eval`。
**好处是改脚本只需 `adb push`，不用动工作流。**

---

## 架构：三段式

```
vFlow 工作流（workflow/fluid-cloud.json，导入即得）
  ├── 触发器 ① vflow.trigger.clipboard（标签「剪切板」）
  ├── 触发器 ② vflow.trigger.broadcast（标签「点击」，action …CLICK / scheme vflowfc）
  ├── 触发器 ③ vflow.trigger.manual（标签「设置」）→ 弹上游那三个自绘界面
  └── 步骤 vflow.system.js
        ├── script = src/bootstrap.js 的内容（约 2 KB）
        │     └─ eval(读 /sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js)
        │           ├─ src/adapter.js（手写：平台桥 + 全局变量 + 自举）
        │           └─ src/core.js   （核心逻辑，就地维护）
        └── inputs = { click_uri:      "{{fluid_click_broadcast.data_uri}}",
                       clipboard_text: "{{fluid_trigger_clipboard.text_content}}",
                       trigger_label:  "{{vars.__trigger_label}}" }
```

> ⚠️ 三条触发路跑的是**同一份脚本**，脚本内部靠 `input` / `tiggerTag` 顶层分派
> （`vflowfc://click?…` → 打开；标签 `设置` → 设置界面；其余 → 识别链路）。
> 一次执行里**必然有未命中的输出**，而 vFlow 对未命中**不给空串**、
> 给字面量 `{{{stepId.outputId}}}`（三个花括号）⇒ `adapter.js` 的 `input` 必须认出来当空。
> 详见 §「脚本侧的高频陷阱」第 7 条。
>
> ⚠️ 触发器 ③ 是 2026-10-08 加的（手动跑 → 设置界面，`docs/DESIGN.md` §3.4.5）。
> 加它之后**卡片上的「▶ 执行」按钮会消失**（vFlow 只在「有手动触发器**且没有**自动触发器」
> 时才画它）⇒ 手动跑改用桌面快捷方式（⋮ →「添加到桌面」）。

### 移植时的 5 类改动（**一次性，已落进 `src/core.js`**）

> ⚠️ 这张表是**来历记录**（「相对上游改了什么」），**不是**每次构建要跑的东西。
> 补丁已经做完并落盘，现在改 `src/core.js` 直接改就行。

| # | 位置 | 原（ShortX） | 改（vFlow） |
|---|---|---|---|
| 1 | 3 行 `importClass` | `Packages.tornaco.apps.shortx...` | 删除 |
| 2 | `showToast` | `shortx.executeAction(ShowToast…)` | `VFLOW_ADAPTER.toast` → `vflow.device.toast` |
| 3 | `CopyText` | `shortx.executeAction(WriteClipboard…)` | `VFLOW_ADAPTER.setClipboard` → `vflow.system.set_clipboard` |
| 4 | `OpenMain` 的 shell（**仅 1 处**，在「系统选择框」分支） | `shortx.executeAction(ShellCommand…)` | `VFLOW_ADAPTER.shell` → `vflow.shizuku.shell_command` |
| 5 | 9 处路径 | `ShortX_Path + "/data/Fluid_Cloud_Island"` | `FLUID_CLOUD_DIR`（`/sdcard/vFlow/fluid-cloud`） |

⚠️ **改动点在源码里就地标注**（`/* [vflow] */`，共 12 处）。
⚠️ **但改动点不再有「出现次数断言」** —— 那是 `build.js` 时代的东西，随它一起删了。
⇒ 现在靠 `test/run.js` 的**产物 + 源码双路断言**兜底（§「测试」）。

### adapter.js 补的全局变量

`core.js` **自己不定义**这些（原脚本靠工作流的第一个动作赋值）：

| 变量 | 来源 |
|---|---|
| `input` | `inputs.text`（工作流传入的触发器输出） |
| `tiggerTag` | `inputs.trigger_label` ← `{{vars.__trigger_label}}`（触发器标签） |
| `DebugMode` / `isRunAction` / `show_toast` | 固定值（`false` / `false` / `true`） |
| `FLUID_CLOUD_DIR` | `/sdcard/vFlow/fluid-cloud` |
| `VFLOW_ADAPTER` | 平台桥（3 个方法 + 2 个文件读写工具） |

---

## ⚠️ 头号已知问题：脚本里**不能 `new` 抽象类**（**已绕过**）

**现象**：走超级岛路径时抛

```
实例化错误 (can't load this type of class file)：类 android.content.BroadcastReceiver 是接口或抽象类
```

**真因**（已核实，不是推断）：vFlow 的 `ContextFactory`（`JsTimeoutContextFactory`）
**没有覆写 `createClassLoader`**，于是 Rhino 落回默认的 `DefiningClassLoader` ——
它调 JVM 的 `ClassLoader.defineClass`，在 ART 上**必然失败**（ART 只认 dex）。

ShortX 用 `com.faendir:rhino-android` 覆写了这一层（`.class` → `dx` → dex →
`InMemoryDexClassLoader`）。**⇒ 这是 vFlow 侧要补的一层，不是 ART 的限制。**

### ✅ 现状（2026-10-08）：**限制仍在，但已绕过**

**脚本只发广播、不当接收方** —— 删掉 `new BroadcastReceiver` 那一整段，
按钮的 `PendingIntent` 发一个**固定 action** 的广播（URI 里带「打开哪个链接 / 全屏还是小窗」），
由 **vFlow 的广播触发器**（`vflow.trigger.broadcast`）接住并执行打开。
**不用改 vFlow，也顺带解决了「阻塞 3 秒」。**
⚠️ 三条必须同时成立的契约（action 写死 / scheme 必须声明 / URI 能定位到哪一次）
见 `docs/DESIGN.md` §4.6 出路 ①。

⚠️⚠️ **只改了「按钮」那一条 `PendingIntent`** —— 通知**主体**那条仍是上游原样的
`PendingIntent.getActivity`（系统直接拉起 Activity，**脚本不参与、不阻塞**）。
早先版本把两条都改成广播，那是**过度改动**（用户 2026-10-08 纠正）。

**实测矩阵**（判据是 `getClass().getName()`，不是「有没有返回值」）：

| 类别 | 结果 |
|---|---|
| **接口** | ✅ 可靠（走 `java.lang.reflect.Proxy`，`$Proxy6`） |
| **具体类** | ⚠️ **不是真子类化**（`getClass()` 仍是原类），且换一个类可能崩（`ArrayList` 直接 NPE） |
| **抽象类** | ❌ 必然失败 |

完整分析见 `docs/DESIGN.md` §4.6。

---

## 真机验证环境

> ⚠️ **本文件进公开仓库，所以不写具体设备地址。** 按下面的方式取当前值。

| 项 | 值 |
|---|---|
| 设备 | 小米 MIX Fold 3 / Android 17（**澎湃 OS**，超级岛协议相关） |
| 连接 | 无线调试：`adb connect <设备地址>`（地址在设备的「无线调试」页里；默认端口 **38079**） |
| vFlow 远程 API | `http://<设备地址>:8080`（需在设备上开启「远程 Web 服务」；API 端口**默认 8080**） |
| 工作流 id | ⚠️ **以 `workflow/fluid-cloud.json` 里的 `id` 为准** —— 导入会保留它。`tools/run.py` 按**名字**找，不依赖这个值 |
| 配置目录 | `/sdcard/vFlow/fluid-cloud/` |
| 脚本日志 | `adb logcat -d \| grep JsScript`（`console.log` 落到这里，**不在**工作流日志里） |

---

## 脚本侧的高频陷阱

这几条**都是实测踩出来的**，写脚本/改脚本前先看：

| # | 陷阱 | 表现 |
|---|---|---|
| 1 | **触发器标签为空** | `core.js` 靠 `tiggerTag` 判断「哪条触发源」。空串会让所有分支走 false —— **静默**。adapter.js 会打一条日志提醒 |
| 2 | **`Thread.sleep` 在脚本里是阻塞的** | `core.js` 有 `while (result === null) { Thread.sleep(150); }` 的等待循环。它**没有超时保护**（vFlow 的 JS 超时**只覆盖纯计算死循环**，对阻塞调用无效） |
| 3 | **剪贴板触发器有去重** | `ClipboardTriggerHandler` 用 `lastStandardSignature` 去重 ⇒ **写相同内容不会再次触发**。测试时必须换内容 |
| 4 | **工作流执行中再触发会被忽略** | `WorkflowExecutor` 的 `BLOCK_NEW` 重入策略。调试时先 `disable` 再 `enable`，或重启 App |
| 5 | **API 的 `input_variables` 是死参数** | `ExecutionManager.executeWorkflowInternal` 签名里有它，**函数体内零引用**。⇒ 无法通过 API 注入变量，只能「写剪贴板 + 靠触发器」 |
| 6 | **`adb logcat` 读不到脚本的早期日志** | 脚本的 `console.log` 走 `JsScript` tag。启动洪流会冲掉开机后的日志 —— 抓不到就重启 App 后立刻抓 |
| 7 | ⚠️⚠️ **未命中的触发器输出是 `{{{...}}}`，不是空串** | 一个工作流挂两个触发器时**一次执行必然有一路未命中**，而 vFlow 对它回退成字面量 `{{{stepId.outputId}}}`（**三个花括号**，`VariableResolver.kt:133`）。直接当值用 ⇒ 拿它去识别链接 ⇒ **弹一个无意义的岛，且不报错**。`adapter.js` 的 `input` 里显式认出来当空处理 |
| 8 | ⚠️ **导出/导入的 JSON 是 Gson 写的** | HTML-safe 转义（`< > & = '` → `\uXXXX`）、**区分 int/float**（`cooldown_ms: 0.0`）。用 JS 的 `JSON` 或 `jq` 重排会**整份文件变成一行噪声** —— 功能正常但 diff 全废。⇒ 改它走 `tools/build-workflow.py`（它做了保形自检） |

---

## 改代码时的规矩

| 改了什么 | 要做什么 |
|---|---|
| `src/adapter.js` / `src/core.js` | `npm run check` + **重新 `adb push` 完整脚本** |
| `src/update.js` | `npm run check` + **重新 `adb push` `dist/update.js`**（⚠️ **更新流程不会更新它**，见 `docs/UPDATE.md` §7.3） |
| `src/rules/` / `src/nolinkrules/` | `npm run check` + 重新 push **两个 JSON** |
| `src/bootstrap.js` | `npm run check` + `npm run build:workflow` + **导入工作流**（`tools/deploy-workflow.py`） |
| `workflow/fluid-cloud.json`（改颜色 / 描述 / 各种开关） | **导入工作流**（`tools/deploy-workflow.py --no-build`） |
| ⚠️ **触发器**（`triggers` 现在是**派生**的，见 `tools/build-workflow.py` 的 `TRIGGERS`） | 改 `build-workflow.py` → `python tools/build-workflow.py` → **导入工作流**。⚠️ **不要直接手改 JSON 里的 `triggers`** —— 下次刷新会被覆盖回去 |
| `version` | 改了产物就一并改它（`docs/UPDATE.md` §4.3） |
| ⚠️ `dist/` | **`npm run build` 之后要一起提交**（已入库）—— 否则仓库里是旧产物，两边都看不出来 |
| ⚠️ `reference/` | **一律不改** —— 那是来历记录，改了就失去对照价值 |

> ⚠️ **改了 `src/` 里的任何东西，产物都要重新 push。** 设备上跑的是
> `/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js`，**不 push 就等于没改**
> （而 App 侧完全看不出来）。
>
> ⚠️⚠️ **`dist/` 已入库**（2026-10-09，`docs/UPDATE.md` §2.1）—— 所以还有**第二条**要求：
> **`npm run build` 之后要把 `dist/` 一起提交**。否则仓库里的产物是旧的，
> 用户更新到旧脚本，而**两边都看不出来**。
> ⇒ 有断言兜底：`test/run.js` 的 `[13]` 节把 `dist/` 与「当场重跑一次 `generate` 的输出」
> **逐字节**比（该文档 §8 第 6 条）。⚠️ 局限：`npm run check` 是「先 build 再 test」，
> 所以在 `check` 这条流程下它**恒绿** —— 价值在于**单独跑 `npm test`**。

**测试能覆盖什么**：`test/` 用 Node 模拟 Rhino + Android，**只覆盖纯 JS 那一半**
（规则匹配 / 链接识别 / 岛参数 JSON / 平台桥调用）。
**测不到**：真的模块调用、岛渲染、小窗、权限、任何真机行为。
⇒ **改了影响真机行为的代码，必须上真机验**（见 `test/harness.js` 文件头的完整说明）。

⚠️ **判据分「产物」与「源码」两路**（`test/run.js` 的 `[2]` 节）——
产物能发现「拼错了」，源码能发现「补丁从 `src` 里丢了但 `dist` 是旧的」。
**两路都要过**，只有一路会漏掉另一种改错。

---

## 未决项（优先看 `docs/DESIGN.md` §7）

1. ~~**脚本更新机制**~~ —— ✅ **已实施**（2026-10-09），见 **`docs/UPDATE.md`**
   （⚠️ 不是 `DESIGN.md` §3.4，那一节已被取代）。
   ⚠️ **真机验证未做**（设备不可达）：`/sdcard` 上 `renameTo` 的原子性、
   `vflow.network.http_request` 的 JS 桥接、`eval(update.js)` 能否读到主脚本全局 ——
   这三项**必须在真机上确认**（该文档 §10 六项）
2. QQ / 微信触发源（`vflow.trigger.activity_changed` + `class_filter`）
3. 附加插件（`com.nyehueh.fluidcloud`）是否继续用
4. ~~补 vFlow 的 `ContextFactory.createClassLoader`~~ —— **不再是阻塞项**：
   超级岛形态已用「按钮发广播 + 广播触发器接住」绕过（见上文「头号已知问题」）。
   补那一层仍能顺带解决「具体类子类化不可靠」，但**没有需求驱动**
5. ~~小窗打开~~ —— **已解决**：`ActivityOptions.setLaunchWindowingMode` +
   `setLaunchBounds` 在 vFlow 的 JS 里**可用**（真机实测，见 `docs/DESIGN.md` §4.2），
   不需要 `service call` 那条私有事务码
