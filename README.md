# vFlow 流体云

把「复制 / 打开分享链接 → 识别 → 提示 → 全屏或小窗打开」做成一个 vFlow 工作流。

- **设计与可行性分析**：[`docs/DESIGN.md`](docs/DESIGN.md)（含真机验证记录、踩坑、未决项）
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
| `reference/` | 上游素材的**完整镜像**（原名，含未移植的 `onOpen.js` / `update.js`），**不进构建** | 一次性复制，**不要手改** |
| `dist/` | **构建产物**（脚本 + 规则库），是最终要用的东西 | `npm run build` 生成 |
| `test/` | 离线测试（Node 模拟 Rhino + Android） | 我们 |
| `tools/` | 通过 vFlow 远程 API 操作设备（建工作流 / 跑一次取日志） | 我们 |

## 构建

```bash
npm run build     # 两步全跑：合并规则 → 拼接脚本
```

或分步（改了什么跑什么）：

```bash
node src/bundle-rules.js   # 1. 合并 src/rules/ → dist/rules.json
node src/generate.js       # 2. adapter + core → dist/vflow-fluid-cloud.js（完整脚本）
```

> ⚠️ `src/bootstrap.js` 是**静态文件**（内容就是贴进工作流的引导脚本本身），
> **不是生成器** —— 没有「跑一下生成 dist/bootstrap.js」这回事。
> 改它之后要把新内容推回工作流（`python tools/install-workflows.py --force`）。

## 测试

```bash
npm test          # 等价于 node test/run.js（57 例）
npm run check     # build + 语法检查 + test
```

⚠️ **离线测试只覆盖纯 JS 那一半**（规则匹配 / 链接识别 / 岛参数生成 / 平台桥调用）。
**不能替代真机验证** —— 模块调用、岛渲染、小窗都测不到。详见 `test/harness.js` 文件头。

## 部署到设备

```bash
export MSYS_NO_PATHCONV=1      # ⚠️ Git Bash 下必须，否则 /sdcard 会被改写成 D:/develop/Git/sdcard

# 1. 规则库（首次；脚本首次运行会自检并在缺失时报错）
adb push dist/rules.json       /sdcard/vFlow/fluid-cloud/
adb push dist/nolinkrules.json /sdcard/vFlow/fluid-cloud/

# 2. 完整脚本（⚠️ 每次改了脚本都要重推）
adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/

# 3. 版本号（给将来的更新机制用，见 docs/DESIGN.md §3.4.4）
adb push version /sdcard/vFlow/fluid-cloud/version

# 4. 工作流（建一次，之后改脚本不用动它）
python tools/install-workflows.py          # 建缺失的；已存在则跳过
python tools/install-workflows.py --force  # 改了 bootstrap.js 之后（删掉重建）
```

工作流配置（`tools/install-workflows.py` 会照这个建）——
⭐ **一个工作流、两个触发器**（两条触发路跑的是同一份脚本）：

| 工作流 | 触发器 | `inputs`（键 → 值） |
|---|---|---|
| **流体云** | ① `剪贴板变更`（`vflow.trigger.clipboard`），标签 `剪切板`<br>② `广播`（`vflow.trigger.broadcast`），action `…fluidcloud.CLICK`、scheme `vflowfc`，标签 `点击` | `click_uri` → `{{fluid_click_broadcast.data_uri}}`<br>`clipboard_text` → `{{fluid_trigger_clipboard.text_content}}`<br>`trigger_label` → `[[__trigger_label]]` |

它的 `script` 是 `src/bootstrap.js` 全文（**不是**完整脚本）。

> ⚠️ **曾经是两个工作流**（「流体云」+「流体云·点击」），2026-10-08 合并成一个。
> 合并后有个**必须知道的新坑**：vFlow 对**未命中的触发器输出**不是给空串，
> 而是回退成字面量 `{{{stepId.outputId}}}`（**三个花括号**）——
> 一次执行里必然有一路是这个形态，脚本侧要在 `src/adapter.js` 的 `input` 里认出来当空处理，
> 否则会拿它去识别链接、**弹一个无意义的岛且不报错**。详见 `docs/DESIGN.md` §4.6。

⚠️ **为什么工作流里放的是 `bootstrap.js` 而不是完整脚本**：vFlow 远程 API 的请求体上限
是 **24 KB**（实测边界 24065 字节），而完整脚本 113 KB。引导脚本只有约 2 KB，
它从设备文件读完整脚本并 `eval`。⇒ **改脚本只需 `adb push`，不用重新建工作流。**

> ⚠️⚠️ **API 的 `parameters` 只能传裸值，不能传 `{"type","value"}` 形状** ——
> 远程 API 的 `POST` 走 `SimpleCreateWorkflowRequest`（`Map<String, Any?>`），
> 而 `PUT` 走 `UpdateWorkflowRequest`（`Map<String, VObjectDto>`）**且根本没有写盘逻辑**。
> 传错形状**不报错**，只是把 DTO 原样存进工作流、脚本从此读不到内容。
> 详见 `tools/install-workflows.py` 文件头。

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

## 脚本更新机制（**已定案，未实现**）

一句话：**从远端拉产物 → 覆盖本地 → 对比版本号打日志**。
触发方式是在工作流里加一个**手动触发器**（标签 `更新`）。

- 拉的是 **`dist/` 产物**（脚本 + 两个 JSON + `version`），不是源码
- **不走代理**（`proxy_mode = manual` + `proxy = direct`）
- **整份覆盖**，不做增量合并
- 版本号**只做字符串比较**（用户已明确「不关心它是不是最新的」）

⚠️ **源放哪、产物怎么发布（`dist/` 目前不入库）都还没定案。**
完整设计见 [`docs/DESIGN.md` §3.4](docs/DESIGN.md)。

## 当前状态

- ✅ **P0 已真机跑通**（浮窗形态）：复制分享文案 → 识别链接 → 弹浮窗
- ❌ **超级岛形态被阻塞**：`vflow.system.js` 里不能 `new` 抽象类。
  真因是 **vFlow 少覆写了 `ContextFactory.createClassLoader`**（不是 ART 的限制）。
  详见 `docs/DESIGN.md` §4.6
- ⏳ **脚本更新机制**：方案定案，未实现（§3.4）
