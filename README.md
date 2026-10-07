# vFlow 流体云

把「复制 / 打开分享链接 → 识别 → 提示 → 全屏或小窗打开」做成一个 vFlow 工作流。

- **设计与可行性分析**：[`docs/DESIGN.md`](docs/DESIGN.md)（含真机验证记录、踩坑、未决项）
- **给 coding agent 的规范**：[`AGENTS.md`](AGENTS.md)

> 这不是 vFlow 的 fork，也不含 vFlow 源码 —— 它是一个独立的**脚本工程**，
> 产出物是一段 JavaScript（跑在 vFlow 的「JavaScript脚本」模块里）+ 一份规则库。
> 素材来自上游脚本 [`nightking8342/shortx-Fluid_Cloud_Island`](https://github.com/nightking8342/shortx-Fluid_Cloud_Island)（`3.2.3`）。

## 目录

| 目录 | 内容 | 谁维护 |
|---|---|---|
| `vendor/` | 上游原样素材（`core.js` + `rules/` + `nolinkrules/`），**只读** | 从上游仓库复制，**不要手改** |
| `src/` | **手写**的适配层与构建脚本 | 我们 |
| `dist/` | **构建产物**（脚本 + 规则库），是最终要用的东西 | `npm run build` 生成 |
| `test/` | 离线测试（Node 模拟 Rhino + Android） | 我们 |
| `tools/` | 通过 vFlow 远程 API 操作设备（建工作流 / 跑一次取日志） | 我们 |

## 构建

```bash
npm run build     # 四步全跑
```

或分步（改了什么跑什么）：

```bash
node src/build.js          # 1. 把 vendor/core.js 补丁成 dist/core.vflow.js
node src/bundle-rules.js   # 2. 合并 vendor/rules/ → dist/rules.json
node src/generate.js       # 3. adapter + core → dist/vflow-fluid-cloud.js（完整脚本）
node src/bootstrap.js      # 4. 生成 dist/bootstrap.js（引导脚本）
```

## 测试

```bash
npm test          # 等价于 node test/run.js（27 例）
npm run check     # build + 语法检查 + test
```

⚠️ **离线测试只覆盖纯 JS 那一半**（规则匹配 / 链接识别 / 岛参数生成 / 平台桥调用）。
**不能替代真机验证** —— 模块调用、岛渲染、小窗都测不到。详见 `test/harness.js` 文件头。

## 部署到设备

```bash
export MSYS_NO_PATHCONV=1      # ⚠️ Git Bash 下必须，否则 /sdcard 会被改写成 D:/develop/Git/sdcard

# 1. 规则库（一次性；脚本首次运行会自检并在缺失时报错）
adb push dist/rules.json       /sdcard/vFlow/fluid-cloud/
adb push dist/nolinkrules.json /sdcard/vFlow/fluid-cloud/

# 2. 完整脚本（⚠️ 每次改了脚本都要重推）
adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/

# 3. 工作流（只创建一次，之后改脚本不用动它）
python tools/create-workflow.py            # 首次
python tools/create-workflow.py --update   # 之后（按名字找到并覆盖）
```

工作流配置（`tools/create-workflow.py` 会照这个建）：

| 步骤 | 模块 | 参数 |
|---|---|---|
| 触发器 | `剪贴板变更`（`vflow.trigger.clipboard`） | 标签填 `剪切板` |
| 1 | `JavaScript脚本`（`vflow.system.js`） | `script` = `dist/bootstrap.js` 全文（**不是**完整脚本）<br>`inputs` = `{ "text": "{{触发器.text_content}}", "trigger_label": "[[__trigger_label]]" }` |

⚠️ **为什么工作流里放的是 `bootstrap.js` 而不是完整脚本**：vFlow 远程 API 的请求体上限
是 **24 KB**（实测边界 24065 字节），而完整脚本 120 KB。引导脚本只有 1.6 KB，
它从设备文件读完整脚本并 `eval`。⇒ **改脚本只需 `adb push`，不用重新建工作流。**

## 改造点（相对上游）

补丁清单见 `src/build.js`，**全量只有 5 类**：

1. 删 3 行 ShortX protobuf 类的 `importClass`
2. `showToast` → `vflow.device.toast`
3. `CopyText` → `vflow.system.set_clipboard`
4. 一处 `ShellCommand` → `vflow.shizuku.shell_command`
5. 9 处配置路径 → `/sdcard/vFlow/fluid-cloud`

另加适配层（`src/adapter.js`）补的全局变量：`input` / `tiggerTag` / `DebugMode` /
`isRunAction` / `FLUID_CLOUD_DIR` / `VFLOW_ADAPTER` + 首次运行自举。

## 同步上游

```bash
# 在 ../shortx-Fluid_Cloud_Island 里
git fetch origin && git checkout main && git pull

# 复制过来（vendor/ 是只读镜像）
cp ../shortx-Fluid_Cloud_Island/core.js       vendor/core.js
cp ../shortx-Fluid_Cloud_Island/version       vendor/version
rm -rf vendor/rules vendor/nolinkrules
cp -r ../shortx-Fluid_Cloud_Island/rules       vendor/rules
cp -r ../shortx-Fluid_Cloud_Island/nolinkrules vendor/nolinkrules

# 重建
npm run build && npm test
```

⚠️ `src/build.js` 的每条补丁都带**出现次数断言**。上游改了对应位置时构建会**当场失败**，
并打印期望/实际次数 —— 按提示更新补丁片段即可，**不会静默产出一份半残的脚本**。

## 当前状态

- ✅ **P0 已真机跑通**（浮窗形态）：复制分享文案 → 识别链接 → 弹浮窗
- ❌ **超级岛形态被阻塞**：`vflow.system.js` 里不能 `new` 抽象类。
  真因是 **vFlow 少覆写了 `ContextFactory.createClassLoader`**（不是 ART 的限制）。
  详见 `docs/DESIGN.md` §4.6
