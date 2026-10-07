# reference/ —— 上游素材（**只读**）

上游项目：[`nightking8342/shortx-Fluid_Cloud_Island`](https://github.com/nightking8342/shortx-Fluid_Cloud_Island)
的**完整镜像**，逐字节一致，**没有任何改名或删减**。

| 项 | 值 |
|---|---|
| 上游 commit | `bcdf98d3c2269040e3a6cc50f7fc1b33790a780d` |
| commit 时间 | 2025-12-02 |
| `version` | `3.2.3` |

## 规矩

- ⚠️ **一律不改** —— 改了它就失去「能对照原始实现」这个用途
- ⚠️ **不参与构建** —— `src/` 才是构建输入（见 `AGENTS.md` 的「不跟随上游」一节）
- 想核对「我们改了什么」，直接跟这里的同名文件 diff（**名字一样，不用做映射**）

## 文件

| 文件 | 行数 | 在上游是什么 | 在本项目里 |
|---|---|---|---|
| `core.js` | 2810 | **核心逻辑全部在此** | **已一次性移植** ⇒ `src/core.js`（就地维护，改动点标 `/* [vflow] */`） |
| `rules/` | 27 个 JSON | 有链接识别规则库 | **已移植** ⇒ `src/rules/`（按 App 分文件便于 diff） |
| `nolinkrules/` | 2 个 JSON | 无链接的文案规则 | **已移植** ⇒ `src/nolinkrules/` |
| `onOpen.js` | 223 | **指令启用时执行** | ⚠️ **未移植**（见下） |
| `update.js` | 647 | **远程更新脚本** | ⚠️ **未移植**（见下） |
| `version` | — | 上游版本号 `3.2.3` | ⚠️ **不参与任何对比** —— 本项目的版本号是**根目录**那个 `version`（`docs/DESIGN.md` §3.4.4） |

## 为什么 `onOpen.js` 没有移植

它做的事**全部**依赖原平台，且**逐条都没有对应物**：

| # | 它做什么 | 为什么不做 |
|---|---|---|
| 1 | 弹「使用说明」倒计时窗（自绘 `WindowManager` View） | 那是 ShortX「指令启用」这个时机的产物 —— **vFlow 的工作流没有「被启用时」这个钩子**。而且它是个一次性的使用说明，用户读过一次就没用了 |
| 2 | 点「下一步」写一个 ShortX 局部变量（`WriteLocalVar("next", "true")`） | 平台专有 API（`Packages.tornaco.apps.shortx...`）。vFlow 的等价物是全局变量，但**没有东西去消费它**（第 1 条的产物） |
| 3 | 从 GitHub 拉 `update.js` 并 `eval` | **正是被 §3.4 那套新机制取代的东西**（拉产物 / 不走代理 / 覆盖），而且它的实现方式（远程 `eval`）本身是安全面 |
| 4 | `showToast` | 平台专有 API ⇒ 已由 `VFLOW_ADAPTER.toast` 取代（在 `src/adapter.js`） |

⚠️ **保留它是为了对照**，不是为了以后启用。真要参考「怎么弹一个说明窗」，
vFlow 侧有 `vflow.ui.activity.*` 那套 UI 积木（`docs/DESIGN.md` §5 的 P2 第 11 项）。

## 为什么 `update.js` 没有移植（⭐ 这一条最要紧）

它**做的是另一件事**：从 GitHub 拉 `rules/*.json` **增量合并**进本地配置
（只加新规则、保留用户改过的）。

而本项目定的是 **「整份覆盖产物」**（`docs/DESIGN.md` §3.4.2 三条定案）：
拉的是 `dist/` 下的**构建产物**（脚本 + 两个 JSON + `version`），拿到就覆盖。

| | 上游 `update.js` | 本项目 §3.4 |
|---|---|---|
| 拉什么 | 只拉 `rules/` 与 `nolinkrules/`（**不更新脚本本体**） | **整组产物**（含脚本本体） |
| 怎么处理 | **增量合并**（保留用户改过的） | **整份覆盖** |
| 从哪拉 | `raw.githubusercontent.com`（⚠️ 国内需代理） | ⚠️ **待定**（「不走代理」是硬约束，见 §3.4.3） |
| 触发时机 | 指令启用时 | 手动触发器 + 标签 |
| 实现形态 | 脚本里 `httpGet` + `eval` | **倾向做成工作流步骤**（不进 `core.js`，见 §3.4.6） |

⇒ **不是「忘了复制」，是这条路已经废弃。**
但**必须留着**：新机制里「哪些东西要一起更新」的判断，就是从它那儿来的
（它知道规则库不是孤立的一份）。

⚠️ **另外它本身跑不动**：`update.js` 依赖 `onOpen.js` 里的 `httpGet`
（`downloadAndExecuteUpdate` 用 `eval` 把整份 `update.js` 注进同一个作用域），
**两个文件是一对**，单看 `update.js` 会找不到 `httpGet`。
