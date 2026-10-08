# reference/ —— 上游素材（**只读**）

两样东西：① GitHub 上游的**源码镜像**；② 一份 ShortX 的**规则分享文件**
（不是源码，但记录了**上游在 ShortX 侧是怎么接线的** —— 见下）。

## ① GitHub 上游的完整镜像

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
| `ShortX-流体云组件3.7_超级岛版_.txt` | 276 | **不是源码** —— 是 ShortX 的**规则分享文件**（在 ShortX 里导出/导入用的格式） | ⚠️ **不移植、不参与构建**。价值在于**记录 ShortX 侧的接线**（见下） |

---

## ② `ShortX-流体云组件3.7_超级岛版_.txt` 是什么

**不是**「上游的新版本」，**是同一份规则在 ShortX 侧的另一种形态**。

| 项 | 值 |
|---|---|
| md5 | `9a59a2c3c433dd257e6da03281c43fbe` |
| 字节 | 22987（275 行 LF，**无 BOM、无 CRLF**） |
| `title` | 流体云组件3.7（超级岛版） |
| `author` | ShortX |
| `id` | `SHARE-rule-f994671e-5a9e-4a06-9ead-ef5c92fbaeaa`（`SHARE-` 前缀 = 分享格式） |
| `createTime` | 2024-08-11 |
| `lastUpdateTime` | **2025-12-01** |
| 格式 | 前半是规则 JSON，`###------###` 分隔，后半是 `{"type":"rule"}` |

⚠️ **别把 `3.7` 当成「比 `3.2.3` 新」** —— 两套编号体系不同，
而**时间上几乎重合**（本文件 2025-12-01 vs 上游 commit 2025-12-02）。
不能据此判断谁更新，**也不需要判断**：本项目只维护 `src/core.js` 那一份。

### 它为什么值得留（⭐ 真正的价值）

**GitHub 仓库里没有的东西，全在这里** —— 上游**在 ShortX 侧是怎么把 5 条触发源接进脚本的**。

此前 `docs/DESIGN.md` 关于这一层的描述只能从用户口述与 `core.js` 反推；
这份文件是**权威来源**（它就是 ShortX 实际执行的那份配置）。已逐条核对，
`DESIGN.md` 的 §2.1 / §3.2 / §4.3 与它**完全吻合**：

| # | 触发源（`facts`） | ShortX 侧取值 | 与文档的对应 |
|---|---|---|---|
| 1 | `ClipboardContentChanged`（tag `剪切板`） | `{clipboardContent}` 经 `ReplaceRegex` 清理 | §4.3 的「清理输入」 |
| 2 | `OnMenuActionTrigger`（tag `选中`） | `{selectedText}` 同样清理 | §4.4（**明确不做**） |
| 3 | `ActivityStarted`（`com.tencent.mobileqq` / `QQBrowserActivity`） | `ExecuteJS`：`/S.url=(.*?);/` + `decodeURIComponent` | §2.1 的 `intent_uri` |
| 4 | `ActivityStarted`（`com.tencent.mm` / `MMWebViewUI`） | `ExecuteJS`：`/S.rawUrl=(.*?);/` | 同上 |
| 5 | `Broadcast`（`com.nyehueh.fluidcloud.ACTION_URL_RECEIVED`） | `ExecuteMVEL`：`intent.getExtras().getString("url")` | §2.1 的 `extras_json` |

三条**别处没有**的信息（顺带记下）：

| 发现 | 说明 |
|---|---|
| **`ruleInstanceIdGenerator`** = `"{clipboardContent}{selectedText}"` | ShortX 用它给「同一条规则的每次触发」生成实例 id。**这正是「同一条规则反复触发」在 ShortX 侧的处理方式** —— 可对照我们这边的 `BLOCK_NEW` 重入（`DESIGN.md` 的「已知限制」表）。⚠️ **只是记录，不打算实现** |
| **错误提示是同一条规则内的 `IfThenElse`** | `jsRet` 不等于 `"运行中的错误：undefined"` 时弹 `ShowAlertDialog`（标题「错误！」+「复制日志」按钮 → `WriteClipboard`）。见 `DESIGN.md` §4.5「明确不新增错误弹窗模块」 |
| **引导代码与我们同思路** | 第二条 `ExecuteJS` 里那段 `readFileContent(ShortX_Path + "/data/Fluid_Cloud_Island/core.js")` + `eval` —— 与我们的 `src/bootstrap.js` 做法**一模一样**（大脚本放设备文件、工作流里只放引导） |

⚠️ **这份文件是只读参照，不要照它去改 `src/`** ——
`src/core.js` 已经把它体现的接线全部内化（`input` / `tiggerTag` 由 `src/adapter.js` 提供，
而不是由 ShortX 的 `ReplaceRegex` / `ExecuteJS` 赋值）。

---

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
