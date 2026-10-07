# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## 这是什么

**vFlow 流体云** —— 一个 vFlow 工作流项目。做的事：

> 复制 / 打开一条分享文案 → 从里面认出链接 → 弹一条提示（超级岛或浮窗）→
> 用户点一下 → 全屏或小窗打开。

**它不是 vFlow 的 fork，也不含任何 vFlow 源码。** 它是一个**独立的脚本工程**：
产出物是一段 JavaScript（跑在 vFlow 的「JavaScript脚本」模块里）+ 一份规则库。

**素材来源**：上游脚本 [nightking8342/shortx-Fluid_Cloud_Island](https://github.com/nightking8342/shortx-Fluid_Cloud_Island)
（原为 ShortX 写的，`version` = `3.2.3`）。`reference/` 是它的**只读参考**。

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

📖 完整对照见 `docs/DESIGN.md` §3.5。

---

## ⚠️ vFlow 本地源码在哪（开发时必读）

**`D:/develop/myProjects/vflow`**（分支 `dev`）。

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
├── reference/            # 上游素材**只读参考**（不进构建，勿改）
│   ├── upstream-core-3.2.3.js   #   上游核心 2810 行（一次性移植的来源）
│   └── upstream-version.txt     #   `3.2.3`
├── src/                  # ✍️ 手写（我们维护的就是这些）
│   ├── adapter.js        #   平台桥 VFLOW_ADAPTER + 全局变量 + 首次自举
│   ├── core.js           #   ★ 核心逻辑（从上游移植后**就地维护**，直接改）
│   ├── bundle-rules.js   #   合并 src/rules/*.json → dist/rules.json
│   ├── generate.js       #   adapter + core → dist/vflow-fluid-cloud.js
│   ├── bootstrap.js      #   引导脚本**本身**（静态文件，不是生成器）
│   ├── rules/            #   27 个有链接规则（一文件一条）
│   └── nolinkrules/      #   2 个无链接规则
├── dist/                 # 🔨 构建产物（不入库）
│   ├── vflow-fluid-cloud.js   # ★ 完整脚本（113 KB）→ push 到设备
│   ├── rules.json / nolinkrules.json  # ★ 规则库 → push 到设备
├── test/                 # 离线测试（Node 模拟 Rhino + Android）
└── tools/                # 通过 vFlow 远程 API 操作设备
```

---

## 常用命令

```bash
npm run build     # 两步全跑：合并规则 → 拼接脚本
npm test          # 离线测试（33 例）
npm run check     # build + 语法检查 + test

# 单独跑某一步（改了什么跑什么）
node src/bundle-rules.js   # 改规则库后
node src/generate.js       # 改了 adapter.js 或 core.js 后
```

> ⚠️ `src/bootstrap.js` 是**静态文件**（内容就是贴进工作流的引导脚本本身），
> **不是生成器**，没有「跑一下生成 dist/bootstrap.js」这回事。
> 改它之后要**手动把新内容贴进工作流**（或 `tools/create-workflow.py --update`）。

---

## 部署到设备

```bash
export MSYS_NO_PATHCONV=1      # ⚠️ Git Bash 下必须，否则 /sdcard 会被改写成 D:/develop/Git/sdcard

# 1. 规则库（首次；脚本首次运行会自检并在缺失时抛错）
adb push dist/rules.json       /sdcard/vFlow/fluid-cloud/
adb push dist/nolinkrules.json /sdcard/vFlow/fluid-cloud/

# 2. 完整脚本（⚠️ 每次改了脚本都要重推）
adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/

# 3. 版本号（给将来的更新机制用，见 docs/DESIGN.md §3.4.4）
adb push version /sdcard/vFlow/fluid-cloud/version

# 4. 工作流只创建一次（用远程 API）
python tools/create-workflow.py          # 首次
python tools/create-workflow.py --update # 之后（按名字找到并覆盖）
```

⚠️ **Windows + Git Bash 下 `adb push` 前要 `export MSYS_NO_PATHCONV=1`**，
否则 `/sdcard/...` 会被 MSYS 改写成 `D:/develop/Git/sdcard/...`（已实际踩过）。

**为什么分两个文件**：vFlow 远程 API 的**请求体上限是 24 KB**
（`BaseHandler.readBody` 用 `CharArray(contentLength)` 按字符读；实测边界 24065 字节），
而完整脚本 113 KB。⇒ 工作流里只放约 2 KB 的**引导脚本**，
它从设备文件读完整脚本并 `eval`。**好处是改脚本只需 `adb push`，不用改工作流。**

---

## 架构：三段式

```
vFlow 工作流
  ├── 触发器 vflow.trigger.clipboard（标签「剪切板」）
  └── 步骤 vflow.system.js
        ├── script = src/bootstrap.js 的内容（约 2 KB）
        │     └─ eval(读 /sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js)
        │           ├─ src/adapter.js（手写：平台桥 + 全局变量 + 自举）
        │           └─ src/core.js   （核心逻辑，就地维护）
        └── inputs = { text: "{{触发器.text_content}}",
                       trigger_label: "[[__trigger_label]]" }
```

### 移植时的 5 类改动（**一次性，已落进 `src/core.js`**）

> ⚠️ 这张表是**来历记录**（「相对上游改了什么」），**不是**每次构建要跑的东西。
> 补丁已经做完并落盘，现在改 `src/core.js` 直接改就行。

| # | 位置 | 原（ShortX） | 改（vFlow） |
|---|---|---|---|
| 1 | 3 行 `importClass` | `Packages.tornaco.apps.shortx...` | 删除 |
| 2 | `showToast` | `shortx.executeAction(ShowToast…)` | `VFLOW_ADAPTER.toast` → `vflow.device.toast` |
| 3 | `CopyText` | `shortx.executeAction(WriteClipboard…)` | `VFLOW_ADAPTER.setClipboard` → `vflow.system.set_clipboard` |
| 4 | `OpenMain` 的 shell | `shortx.executeAction(ShellCommand…)` | `VFLOW_ADAPTER.shell` → `vflow.shizuku.shell_command` |
| 5 | 9 处路径 | `ShortX_Path + "/data/Fluid_Cloud_Island"` | `FLUID_CLOUD_DIR`（`/sdcard/vFlow/fluid-cloud`） |

⚠️ **改动点在源码里就地标注**（`/* [vflow] */`，共 12 处）。
⚠️ **但改动点不再有「出现次数断言」** —— 那是 `build.js` 时代的东西，随它一起删了。
⇒ 现在靠 `test/run.js` 的**产物 + 源码双路断言**兜底（§「测试」）。

### adapter.js 补的全局变量

`core.js` **自己不定义**这些（原脚本靠工作流的第一个动作赋值）：

| 变量 | 来源 |
|---|---|
| `input` | `inputs.text`（工作流传入的触发器输出） |
| `tiggerTag` | `inputs.trigger_label` ← `[[__trigger_label]]`（触发器标签） |
| `DebugMode` / `isRunAction` / `show_toast` | 固定值（`false` / `false` / `true`） |
| `FLUID_CLOUD_DIR` | `/sdcard/vFlow/fluid-cloud` |
| `VFLOW_ADAPTER` | 平台桥（3 个方法 + 2 个文件读写工具） |

---

## ⚠️ 头号已知问题：脚本里**不能 `new` 抽象类**

**现象**：走超级岛路径时抛

```
实例化错误 (can't load this type of class file)：类 android.content.BroadcastReceiver 是接口或抽象类
```

**真因**（已核实，不是推断）：vFlow 的 `ContextFactory`（`JsTimeoutContextFactory`）
**没有覆写 `createClassLoader`**，于是 Rhino 落回默认的 `DefiningClassLoader` ——
它调 JVM 的 `ClassLoader.defineClass`，在 ART 上**必然失败**（ART 只认 dex）。

ShortX 用 `com.faendir:rhino-android` 覆写了这一层（`.class` → `dx` → dex →
`InMemoryDexClassLoader`）。**⇒ 这是 vFlow 侧要补的一层，不是 ART 的限制。**

**当前绕过**：配置里 `use_islandNotification = false`，走浮窗路径（**已真机验证可用**）。

**实测矩阵**（判据是 `getClass().getName()`，不是「有没有返回值」）：

| 类别 | 结果 |
|---|---|
| **接口** | ✅ 可靠（走 `java.lang.reflect.Proxy`，`$Proxy6`） |
| **具体类** | ⚠️ **不是真子类化**（`getClass()` 仍是原类），且换一个类可能崩（`ArrayList` 直接 NPE） |
| **抽象类** | ❌ 必然失败 |

完整分析见 `docs/DESIGN.md` §4.6。

---

## 真机验证环境

| 项 | 值 |
|---|---|
| 设备 | 小米 MIX Fold 3 / Android 17（**澎湃 OS**，超级岛协议相关） |
| 连接 | 无线调试 `192.168.1.32:38079`（`adb connect <addr>`） |
| vFlow 远程 API | `http://192.168.1.32:8080`（需在设备上开启「远程 Web 服务」） |
| 工作流 id | `aa070997-fdba-46bd-9ef7-e1fb7a7ac5cf`（名字「流体云」） |
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

---

## 改代码时的规矩

| 改了什么 | 要做什么 |
|---|---|
| `src/adapter.js` / `src/core.js` | `npm run check` + **重新 `adb push` 完整脚本** |
| `src/rules/` / `src/nolinkrules/` | `npm run check` + 重新 push **两个 JSON** |
| `src/bootstrap.js` | `npm run check` + **把新内容贴进工作流**（`tools/create-workflow.py --update`） |
| `version` | 改了产物就一并改它（§3.4.4） |
| ⚠️ `reference/` | **一律不改** —— 那是来历记录，改了就失去对照价值 |

> ⚠️ **改了 `src/` 里的任何东西，产物都要重新 push。** `dist/` 不入库，
> 设备上跑的是 `/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js`，
> **不 push 就等于没改**（而 App 侧完全看不出来）。

**测试能覆盖什么**：`test/` 用 Node 模拟 Rhino + Android，**只覆盖纯 JS 那一半**
（规则匹配 / 链接识别 / 岛参数 JSON / 平台桥调用）。
**测不到**：真的模块调用、岛渲染、小窗、权限、任何真机行为。
⇒ **改了影响真机行为的代码，必须上真机验**（见 `test/harness.js` 文件头的完整说明）。

⚠️ **判据分「产物」与「源码」两路**（`test/run.js` 的 `[2]` 节）——
产物能发现「拼错了」，源码能发现「补丁从 `src` 里丢了但 `dist` 是旧的」。
**两路都要过**，只有一路会漏掉另一种改错。

---

## 未决项（优先看 `docs/DESIGN.md` §7）

1. ⭐ **补 vFlow 的 `ContextFactory.createClassLoader`**（恢复超级岛形态的前提）
2. **脚本更新机制**（拉产物 / 不走代理 / 覆盖 + 版本号对比）——
   **方案已定案，未实现**，见 `docs/DESIGN.md` §3.4
3. QQ / 微信触发源（`vflow.trigger.activity_changed` + `class_filter`）
4. 小窗打开（`service call activity_task 138`，小米私有事务码）
5. 附加插件（`com.nyehueh.fluidcloud`）是否继续用
