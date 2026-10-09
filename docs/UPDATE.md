# 脚本更新机制 · 方案

> ✅ **本文件是现状 —— 方案已实施（2026-10-09）。**
> 定案时间：2026-10-08 / 2026-10-09（分多轮谈定，见 §1 的决策来源）。
> ⚠️⚠️ **2026-10-09 形态调整**：更新逻辑从**独立文件** `src/update.js`
> **搬进了工作流脚本** `src/bootstrap.js`（用户定，见 §7「已推翻」）。
> 现在的形态是：**导入工作流 + 跑一次即自足**，不需要手动 push 任何文件。
> 实施落点：`src/bootstrap.js` / `src/core.js` / `src/adapter.js` / `src/generate.js`，
> 见 §9 实施清单。⚠️ 真机验证（§10）**未做**（设备不可达），逐条见 §10。

---

## 0. 一句话

> **新用户**：在 vFlow 里**导入 `workflow/fluid-cloud.json`** → 跑一次 ⇒
> 工作流脚本发现设备上缺产物，从 **GitHub 官方 raw** 拉全套
> （主脚本 + 两份规则 + 版本号）⇒ **全就位，本次执行即可用**。
>
> **之后**：在**设置菜单**里点「检查更新」→ 工作流脚本里的 `vflowUpdateRun()` 开跑：
> 拉远端版本号比一比 → **主脚本整份覆盖 / 规则增量合并** → 提示「下次执行生效」。
>
> ⚠️ **更新逻辑本身不在更新范围内** —— 它就在工作流脚本里。要改它，
> **重新导入工作流**（不再是 push 一个文件）。见 §7。

---

## 1. 决策来源（**区分「用户拍的」与「我定的」**）

本仓库之前的教训是「文档里的决策分不清是谁定的」（用户 2026-10-09 指出：
`docs/DESIGN.md` 里有若干条是早先 Agent 未经允许写下的）。⇒ 本节把来源标清楚。

| # | 决策 | 谁定的 | 备注 |
|---|---|---|---|
| 1 | **只走 GitHub 官方 raw**，不做镜像（jsDelivr / gitee / ghproxy 都不用） | **用户** | 「连通性交给用户，我们不管」 |
| 2 | **不做连通性探针** | **用户** | 「你不用探」 |
| 3 | **`dist/` 入库**（从 `.gitignore` 移除），产物随 `main` 走 | **用户** | 另外两个选项（单独分支 / Release 附件）**已否** |
| 4 | 触发方式 = **设置菜单加一项**，**core 内直接调**（不做广播触发器） | **用户**（广播被否）+ 我核实 | 见 §6 |
| 5 | **config 增量合并** | **用户** | 「不仅 config.json 要增量更新，rules.json 也要增量更新」 |
| 6 | **rules 增量合并** | **用户** | 同上 |
| 7 | `ensureRules()` 改成 `exists()`（不再读全文判存在） | **用户**（「第一点可以」） | §5.4 |
| 8 | ~~⭐ **`update.js` 是独立文件**，**不进主脚本**~~ | **用户**（2026-10-09 先定，**同日又推翻**） | ⚠️ **已推翻**：改为**放在工作流脚本里**（`src/bootstrap.js`），目的是「导入即自足」。见 §7.0 |
| 9 | ⭐ **更新逻辑不更新它自己**；它要改就**人工介入** | **用户** | ⚠️ 结论不变，**通道变了**：不再是「手动 push 一个文件」，而是**重新导入工作流**。见 §7.3 |
| 9b | ⭐ **更新逻辑放进工作流脚本**（导入工作流 + 跑一次即自足） | **用户**（2026-10-09） | 见 §7 |
| 10 | config 的合并语义（补新键 / 数组并集 / 标量保留本地） | **我定** | 用户说「你看着办」 |
| 11 | 版本号既是**闸**也是**反馈** | **我定** | §4.3；不违反「不关心是不是最新」 |

### ⚠️ 被本次**推翻**的旧决策

| 旧决策 | 出处 | 为什么推翻 |
|---|---|---|
| 「不走代理」（`proxy_mode = manual` + `proxy = direct`） | `DESIGN.md` §3.4.2 决定 2 | 前提是「要能直连」。用户现在说连通性交给用户 ⇒ **改为跟随全局代理**（`follow_global`，即模块默认值）。否则用户开着代理反而连不上 |
| 「更新做成工作流步骤，不进脚本」 | `DESIGN.md` §3.4.6 | 增量合并是**代码**，现成模块做不了（见 §6.2） |
| 「产物整份覆盖、不做增量」 | `DESIGN.md` §3.4.2 决定 3 | 用户 2026-10-09 明确要求 config 与 rules **都要增量** |
| 「updater 并进主脚本」 | **本文件 2026-10-09 的初稿**（我擅自改的） | 用户明确纠正：**必须是独立文件**，且**不自我更新**。见 §7 |

---

## 2. 产物与发布形态

### 2.1 `dist/` 入库（用户已定）

```
仓库 main 分支
├── version                          ← 产物组版本号（与 package.json 一致）
├── src/…                            ← 源码
│   └── bootstrap.js                 ← ⭐ 工作流脚本（**更新逻辑在这里**，见 §7）
├── workflow/fluid-cloud.json        ← ⭐ 导入它即建好工作流（含上面那段 script）
└── dist/                            ← ⭐ 入库（设备侧产物）
    ├── vflow-fluid-cloud.js         ← 完整脚本（adapter + core）
    ├── rules.json
    └── nolinkrules.json
```

⚠️ **没有 `dist/update.js` 了** —— 上一版它是个独立产物，已随 §7 的调整删除。

远端地址（**只有这一个形态，没有回退源**）：

```
https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/version
https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/vflow-fluid-cloud.js
https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/rules.json
https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/nolinkrules.json
```

⚠️ **改 `.gitignore` 时要一并处理 `.gitattributes`**：
`dist/*.js` 是文本、`dist/*.json` 是 JSON，都需要 `-text`（与 `workflow/*.json` 同理，
理由见 `.gitattributes` 里那段注释）。**不加的话**：本机 `core.autocrlf=true`
⇒ 检出时变 CRLF ⇒ 本机测不出来，换台机器就炸。

⚠️ **代价（如实记录）**：每次改脚本，`main` 上多一份 **148 KB 的 diff**（脚本是多行文本，
diff 可读，但量大）。用户已接受。

⚠️ **`dist/` 入库后，「构建产物不入库」这条老规矩就没了** ⇒
必须有一条断言防「改了 `src/` 忘了重跑 `npm run build` 再提交」。
见 §8 第 6 条。

### 2.2 设备侧布局

```
/sdcard/vFlow/fluid-cloud/
├── vflow-fluid-cloud.js     ← 完整脚本（adapter + core）
├── rules.json
├── nolinkrules.json
├── config.json              ← 用户配置（有版本头）
├── recordcopy.json
└── version                  ← 本地产物组版本号
```

⚠️ **设备上不再有 `update.js`** —— 更新逻辑在工作流脚本里（§7）。
它的「存放位置」是 `workflow/fluid-cloud.json` 的 `steps[0].parameters.script`。

---

## 3. 四类文件、四种策略

| 文件 | 策略 | 谁写 | 何时 |
|---|---|---|---|
| `vflow-fluid-cloud.js` | **整份覆盖**（原子写） | 工作流脚本（bootstrap） | 首次自足 / 手动更新 |
| `rules.json` / `nolinkrules.json` | **增量合并**（按 `name`）；首次自足时**整份覆盖** | 同上 | 同上 |
| `config.json` | **增量合并**（按 key + 数组并集） | **`adapter.js`**（基准 = 脚本内置 `DEFAULT_CONFIG`） | **每次执行**（版本闸控制） |
| `version` | 整份写 | 工作流脚本（bootstrap） | 首次自足 / 手动更新 |
| ⚠️ **工作流脚本自己**（= 更新逻辑） | **不更新** —— 它更新不了自己 | 人工（**重新导入工作流**） | 更新逻辑本身要改时（§7） |

⭐ **`config.json` 不走 updater 是有意的**：它的「基准」就是**新主脚本里的 `DEFAULT_CONFIG`** ——
脚本一更新，基准自然就是新的。这样：

- 不需要远端多一个「config 默认值」文件
- 不需要第二套合并逻辑（工作流脚本里一份、`adapter.js` 里一份）
- **更新主脚本 → 下次执行自动完成配置迁移**，不需要联网、不需要用户点任何东西

⭐ **工作流脚本不在更新范围内也是有意的**（用户定）—— 见 §7.3。

---

## 4. 更新流程

### 4.0 首次自足（**导入工作流后跑第一次**）

```
bootstrap 顶层开跑
1. 检查三份产物：
   ├─ 主脚本：不存在 **或** 内容校验不过（长度 ≤ 1000 / 缺特征串）⇒ 需要下载
   ├─ rules.json / nolinkrules.json：不存在 **或** 为空 ⇒ 需要下载
   └─ 三份都可用 ⇒ **不联网**，直接跳到第 4 步
2. 需要下载 ⇒ **整组拉四份**（version + 主脚本 + 两份规则）
   （主脚本与规则库必须同版 —— 缺一份却只补一份会造出「半新半旧」）
3. 逐份写 .tmp → 校验 → renameTo 原子覆盖（失败 ⇒ 报错中止，不拿半份继续跑）
4. 读主脚本 → 校验 → eval（本次执行即可用）
```

⚠️ **判据不能只看「文件在不在」**：主脚本存在但被截断时直接 eval 会语法错误
⇒ **整个工作流从此崩**。所以 bootstrap 用**内容校验**判 —— 于是它成了
**主脚本之外的那一层**：主脚本坏掉时它仍能跑并修好它（这是 §7 的主要收益）。

### 4.1 手动主流程（点「检查更新」后）

```
0. core.js 的「检查更新」调 vflowUpdateRun()
   （工作流脚本与主脚本**共享作用域** ⇒ 直接可见，不读文件、不传参）
   └─ 函数不存在（用户导入的是**旧工作流**）→ 弹「请重新导入工作流」并结束（**不静默**）

1. 拉远端 version（几十字节）
2. 与本地 /sdcard/vFlow/fluid-cloud/version 比
   ├─ 相同 → 弹「已是最新（0.3.0）。要强制重新下载吗？」[是/否]
   │         └─ 是 → 跳过第 3 步的闸，继续往下（用于「本地文件被改坏」的修复）
   └─ 不同 → 继续
3. 依次拉三份产物 → 各自写 .tmp → 校验 → renameTo 覆盖/合并写
   ├─ dist/vflow-fluid-cloud.js  → 整份覆盖（校验特征串 + 长度）
   ├─ dist/rules.json            → 与本地按 name 合并 → 原子写
   └─ dist/nolinkrules.json      → 同上
4. 写本地 version
5. 提示「更新完成（0.3.0 → 0.4.0），下次执行生效」
```

⚠️ **第 5 步那句「下次执行生效」必须打**：bootstrap 已经把整份主脚本 `eval` 进内存了
⇒ 覆盖文件**不影响本次执行**。不说清楚用户会以为「点了更新没生效」。

⚠️ **第 0 步那个分支必须显式报错**，不能静默 —— 详见 §7.4。

### 4.2 失败处理（**逐份独立，不整体回滚**）

| 失败点 | 处理 |
|---|---|
| **首次自足**：三份里有缺的、但拉不到 | 弹错并 `throw` 中止（**不 eval 主脚本**）。本地文件**一个都没动** |
| **首次自足**：远端主脚本校验不过（404 的 HTML） | 同上。**不写盘**（不会把 HTML 当脚本存下来） |
| 拉 `version` 失败 | 直接报错结束（**不猜、不降级**）。此时本地文件**一个都没动** |
| 拉主脚本失败 | 报错结束。**主脚本不动**，后续两份也不拉（避免出现「新规则 + 旧脚本」） |
| 主脚本校验不过 | 报错结束。`.tmp` 删掉，**主脚本不动** |
| 拉 / 合并 rules 失败 | **主脚本已经覆盖了** ⇒ 这里要**显式提示**「脚本已更新，规则未更新，请重试」。下次点更新会重来（因为还没写 version，下次仍走完整流程） |
| 写 `version` 失败 | 提示「更新完成但版本号没写上」⇒ 下次会重复更新一遍（幂等，无害） |
| 工作流脚本里没有 `vflowUpdateRun`（**旧工作流**） | 弹「请重新导入工作流」并结束。**不静默** |

⭐ **`version` 最后写**是有意的：它是「本次更新完整成功」的标志。
中途失败 ⇒ version 不变 ⇒ 下次重来。**幂等**。

⚠️ **不整体回滚**（不做「把已经覆盖的主脚本还原回去」）：那需要额外备份一份 148 KB，
而「半新半旧」的代价只是「下次再点一次」，不值得那套复杂度。如实记录。

### 4.3 版本号对比（**既是闸，也是反馈**）

| 位置 | 内容 | 谁写 |
|---|---|---|
| 仓库根 `version`（**已建**，现 `0.4.0`） | 与 `package.json` 一致 | 人工维护（改产物时一并改） |
| 设备 `/sdcard/vFlow/fluid-cloud/version` | 同上 | 工作流脚本（bootstrap） |

- **只做字符串相等比较**，**不解析 `1.2.3` 的段、不判断谁更新** ——
  判断「谁新」需要一套版本号语义，而用户已明确「不关心它是不是最新的」⇒
  有语义的只有「**变没变**」。
- 它与 `reference/version`（`3.2.3`）**不是一回事**（那是上游 ShortX 脚本的版本）。
- ⚠️ **`version` 是「产物组」的版本，不是主脚本单独一版** ——
  规则库没有自己的版本头（`bundle-rules.js` 输出纯 JSON）。理由：主脚本与规则库
  **必须整组一起换**（新脚本读旧规则格式会静默识别不出），共用一版最省事。
- ⚠️ **工作流脚本（更新逻辑）不参与版本对比** —— 它的版本不体现在 `version` 里
  （它不自我更新，也就没有「变没变」的问题）。它自己的版本由 §7.4 的**接口探针**兜底。

---

## 5. 两种增量合并的语义

### 5.1 config.json（`adapter.js`，每次执行）

**基准** = 脚本内置的 `DEFAULT_CONFIG`（`src/adapter.js`，版本 `1.5`）。

**闸**：读 `config.json` 第 2 行的版本号（`configVersion()` 的读法，见
`reference/update.js:194-215`）与 `adapter.js` 的 `CONFIG_VERSION` 比：

```
相同 → 直接 return（连合并都不做，不写盘）
不同 → 合并 + 写盘 + 写新版本号
```

⚠️ **成本 ≈ 0 是结构性的**，不是靠实测数字：`ensureConfig()`
（`src/adapter.js:260-269`）**现在就已经在每次执行时把 config.json 全文读出来了**
（为了判 `"Top_Level_Domain"` 在不在）：

```javascript
var existing = VFLOW_ADAPTER.readText(path);   // ← 已经读了
if (existing !== null && existing.indexOf("\"Top_Level_Domain\"") !== -1) return false;
```

⇒ 判版本只需要**复用这个字符串**，**连第二次 IO 都不用**。

**合并规则**：

| 键的类型 | 语义 |
|---|---|
| 本地**缺**的键 | 用 `DEFAULT_CONFIG` 的值补上 |
| **数组**键（`Top_Level_Domain` / `Email_Keyword_List` / …） | 取「本地 ∪ 默认」的**并集**（去重） |
| **标量**键（`Fluid_Cloud_Position` / `Fluid_Cloud_timeout` / `browser` / …） | **永远保留本地** |
| **对象**键（`Window_Configuration`） | **整体保留本地**（与上游 `update.js:419` 的分支一致） |

⚠️ **代价（如实说）**：用户**删掉**的默认项**会被加回来**（上游也是这样，
`update.js:422-426` 就是往默认里 push 本地的）。接受不了就得存一份「上次的基准」
做三路合并 —— **那个复杂度不值**。

⚠️ **另一个代价**：写盘用的是 `configRemarks() + JSON.stringify(config, null, 2)`，
会**丢掉用户在 config.json 里手写的注释**、重排键序。这是上游行为，**接受**。
（正因为有这个代价，才需要**版本闸** —— 否则每次执行都会重写一遍。）

### 5.2 rules.json / nolinkrules.json（工作流脚本，手动更新时）

**按 `name` 比对**（照上游 `update.js:503-572` 的语义）：

| 情形 | 结果 |
|---|---|
| 远端有、本地没有 | **追加** |
| 两边都有 | **远端覆盖本地** |
| 本地独有（用户自己加的规则） | **保留** |

⚠️ **顺序**（照上游）：**本地独有在前，远端规则在后**。
顺序会影响 `matchRules` 的命中结果（先匹配到的先产出，`src/core.js:1444`）
⇒ 必须确定性，不能依赖对象遍历顺序。

⚠️ **上游那套「老格式规则转换」不移植**（`processRules` 里把 `"rule": "字符串"` +
`condition: [...]` 转成新格式的那几十行）—— 那是在兼容**上游历史格式的规则文件**，
而我们的 `src/rules/*.json` 已经是新格式（见 `docs/DESIGN.md` §1.4）。
⇒ 只做「按 name 合并」，不做格式迁移。

### 5.3 原子写（**不能省**）

`vflow.data.file_operation` 的写是 `FileOutputStream(file, !overwrite)`
（`FileOperationModule.kt:570`）—— **直接截断原文件**，不是原子写。
写到一半挂掉 ⇒ 半截脚本 ⇒ bootstrap 的 `length < 1000` 检查会让**整个工作流从此崩**。

⇒ **工作流脚本自己实现**（脚本里 `java.io.File` 可用）：

```
1. 写 <目标>.tmp
2. 校验（见 §5.5）
3. new java.io.File(tmp).renameTo(new java.io.File(目标))
   ⚠️ renameTo 返回 boolean，**必须检查**（失败时原文件还在，不会损坏）
```

⚠️ **不用 `vflow.data.file_operation` 写** —— 两个理由：① 它不是原子写
（`FileOperationModule.kt:570` 的 `FileOutputStream(file, !overwrite)` 直接截断原文件）；
② 它没有 `rename` 操作（`FileOperationModule.kt:41-45` 只有
`read` / `write` / `append` / `delete` / `create`，已核实）。

⚠️ **待核实**：`/sdcard`（FUSE/sdcardfs）上 `renameTo` 是否**真的原子**。
理论上同目录内 rename 是原子的，但 sdcardfs 是用户态文件系统，**未实测**。
⇒ 实施时上真机验一次（判据：rename 前后 `ls -i` 的 inode 变化 + 无中间态）。
即使不原子，「写 `.tmp` 再 rename」也比「直接截断原文件」安全得多（原文件在 rename 前完好）。

### 5.4 `ensureRules()` 改成 `exists()`（用户已同意）

现状（`src/adapter.js:289-302`）：每次执行**读全文** 14.5 KB **只为判存在**。

```javascript
if (VFLOW_ADAPTER.readText(rulesPath) === null) { throw … }   // ← 读全文
```

改成：

```javascript
if (!new java.io.File(rulesPath).exists()) { throw … }
```

⚠️ 这是**既有开销**，比本次新增的版本判断大一个量级（实测：4 次读文件 ≈ 2.6 ms，
其中 rules 两份占大头）。

⚠️ **判据不能弱化**：原来「读得到内容」现在变成「文件在」。文件在但内容为空
（如上次写坏了）的情形，从「抛错」变成「不抛错、静默识别不出」。
⇒ 折中：**`exists()` 判存在 + 长度下界**（`File.length() > 0`）。
这一条要在实现时落实，别只判 `exists()`。

### 5.5 内容校验（防「把 404 的 HTML 当脚本写进去」）

| 产物 | 校验 |
|---|---|
| 主脚本 | 长度 > 1000 **且**包含特征串（如 `var FLUID_CLOUD_ACTION_CLICK`） |
| `rules.json` / `nolinkrules.json` | `JSON.parse` 成功 **且** 是数组 **且** 每项有 `name` |
| `version` | 非空、短（< 64 字节）、只含版本号字符 |

⚠️ **HTTP 模块对 404 不抛异常**（`HttpRequestModule.kt:268-279`：`statusCode` 只被原样
放进输出，**任何状态码都返回 `ExecutionResult.Success`**；只有 `IOException` 才 Failure）
⇒ **必须自己判 `status_code === 200`**，不能靠 try/catch。

---

## 6. 触发方式：设置菜单 + core 内直接调

### 6.1 形态

`showManualActionsUI()`（`src/core.js:2724`，顶层分派里那个）现在弹的是
`["设置指令", "编辑规则", "编辑无链接规则", "取消"]`，加一项：

```
["设置指令", "编辑规则", "编辑无链接规则", "检查更新", "取消"]
```

点「检查更新」→ 直接调工作流脚本里的 `vflowUpdateRun()`（§4.1 第 0 步）→ 弹结果。
⚠️ 函数不存在（旧工作流）⇒ 弹「请重新导入工作流」，**不静默**。

⚠️ **加在「第一层菜单」，不是 `showsettingsui()` 那个界面里** ——
后者要从「设置指令」再进一层（路径变三级），而且那一层的语义是
「编辑各种字符串列表」，塞一个动作项进去不搭。

### 6.2 为什么不做广播触发器（**用户提过，核实后否**）

用户提过「在设置里加一项，通过广播触发（再加一个广播触发器）」。技术上成立
（`BroadcastTriggerHandler` 每个触发器各注册一个 receiver，就是为绕开
「已有 1 个时第 2 个不注册」那个坑），但**买不到任何东西**：

| | 说明 |
|---|---|
| **代码还是在脚本里** | 这个工作流**只有一个步骤**（`vflow.system.js`，`test/workflow.js` 有断言锁着）。广播触发器命中 → **还是跑那同一个 JS 步骤** → bootstrap 读脚本 → eval → core.js 按标签分流。**换了个入口而已** |
| **多一个 `EXPORTED` receiver** | 任意应用发那个 action 就能触发一次更新 |
| **多一条要维护的触发路** | 而用户刚点完按钮就在等结果，多这一层不划算 |
| **广播那条路曾有个时序坑** | 设置那次执行还没结束（`showOptionsDialog` 还在 `while` 等）⇒ `reentryBehavior = block_new` 会把广播那次**丢掉**（静默）。要修得改 `allow_parallel`，那会让剪贴板连点两次并发跑两份识别 |

⇒ **`reentryBehavior` 保持 `block_new` 不动**，工作流 JSON **不用改**。

⚠️ **`DESIGN.md` §3.4.6 那条「更新不适合写在脚本里」要改** ——
它原来的理由是「它要写文件 + 覆盖自己，而脚本正跑在那份文件里」。
但这个理由**不成立**：bootstrap 已经把整份主脚本 `eval` 进内存了，
覆盖文件**不影响本次执行**（这正是 §4.1 第 5 步要提示「下次生效」的原因）。
⇒ 写文件这件事本身没有额外风险。
（**注意**：这不等于「更新逻辑该并进主脚本」—— 它仍然是独立文件，见 §7。）

### 6.3 阻塞与重入（**如实记录**）

| 项 | 情况 |
|---|---|
| 卡不卡 UI | **不卡**。工作流跑在 `Dispatchers.Default`（`WorkflowExecutor.executorScope`），JS 步骤**不切线程**（`JsModule` 里没有 `withContext`）⇒ 阻塞的是工作流线程 |
| 会不会超时 | **不会**。`JsModule` 调 `jsExecutor.execute(script, scriptInputs)`（`JsModule.kt:114`）**不传 `timeoutMs`** ⇒ 用 `JsExecutor.execute` 的默认值 `null`（`JsExecutor.kt:41`）= 不超时 |
| 阻塞多久 | 下载 148 KB + 14 KB × 2 + 几十字节。取决于网络，**慢的时候可能十几秒** |
| ⚠️ **代价** | 这期间**剪贴板触发会被丢弃**（`block_new`）。用户主动点了更新 ⇒ 预期行为，但要在文档里写明 |
| ⚠️ **另一个代价** | HTTP 模块的 `timeout` 默认 10 秒（`HttpRequestModule.kt:227` `getVariableAsLong("timeout") ?: 10`，四个 OkHttp 超时都用它，含 `callTimeout`）⇒ 网络慢时**可能超时失败**。实施时把它调到 30 秒 |

---

## 7. 更新逻辑在**工作流脚本**里（**用户定，2026-10-09 形态调整**）

### 7.0 ⚠️ 被本次**推翻**的形态（上一版）

上一版把更新器做成**独立文件** `src/update.js` → `dist/update.js` → 设备
`/sdcard/vFlow/fluid-cloud/update.js`，`core.js` 点「检查更新」时**读它 + eval**。

| 旧形态（已推翻） | 为什么推翻 |
|---|---|
| 独立文件 + 「只有路径一个契约」 | ⚠️ **新用户导入工作流后什么都跑不起来** —— 主脚本 / 规则 / version / update.js 全得手动 push。用户 2026-10-09 要求「导入工作流 + 跑一次即可自足」 |
| 「平时零成本」（只在点更新时才 parse 它） | 搬到工作流脚本后，**每次执行都要 parse** 那约 500 行（约 20 KB）。代价**如实接受**（见 §7.3） |
| 「它是唯一的安全网」（`update.js` 坏了只能 adb） | 新形态下安全网是 **bootstrap 自己**（它在主脚本之外，主脚本坏掉时它仍能跑并修）；而 **bootstrap 坏了 ⇒ 只能重新导入工作流** |

⚠️ 旧形态里**保留下来**的东西（没被推翻）：
版本闸、`version` 最后写、原子写、按 name 合并、只走官方 raw、失败显式报错。

### 7.1 形态

| 位置 | 是什么 |
|---|---|
| 仓库源码 | `src/bootstrap.js` —— **就是工作流里那段 script**（静态文件，不是生成器） |
| 仓库产物 | `workflow/fluid-cloud.json` 的 `steps[0].parameters.script`（由 `tools/build-workflow.py` 派生） |
| 设备 | **不落文件** —— 它随工作流走，vFlow 从工作流 JSON 里读 |

⇒ **改更新逻辑 = 改 `src/bootstrap.js` = 重新导入工作流**（`tools/deploy-workflow.py`）。

`src/generate.js` **不再**有第二个输出；`dist/` 只剩三份（主脚本 + 两份规则）。
`core.js` 的「检查更新」只调一个函数（见 §7.4）。

### 7.2 为什么这样（用户 2026-10-09 的理由）

| 理由 | 说明 |
|---|---|
| ⭐ **导入即自足** | 新用户只要「导入工作流 + 跑一次」—— 缺的产物自动下载。这是本次调整的**唯一目的** |
| **更新逻辑天然在「主脚本之外」** | 它本来就要在主脚本**之前**跑（否则拿什么 eval？）⇒ 顺手成了「主脚本坏掉也能修」的那一层 |
| **与已有机制同构** | `bootstrap.js` 原本就是「读主脚本 + eval」。更新逻辑只是把它从「只读」扩成「缺了就拉」 |

### 7.3 ⚠️ 代价（**如实记录**）

| 代价 | 说明 |
|---|---|
| ⚠️ **改更新逻辑要重新导入工作流** | 不再是 `adb push` 一个文件。这是本形态的**主要代价** |
| **每次执行多 parse 约 500 行** | 工作流 script 从 ~1.6 KB 涨到 ~20 KB。相对主脚本（148 KB）不算大，但**不再「零成本」** |
| **首次执行必须联网** | 设备上什么都没有时，没网就跑不起来（**显式报错**，不是静默） |
| ⚠️ **bootstrap 自己坏掉 ⇒ 只能重新导入工作流** | 没有比它更外层的救援通道了。这正是它**不自我更新**的原因（见下） |

⭐ **它仍然不自我更新**（用户定，理由与旧形态相同）：`core.js` 坏了它能修、
`rules.json` 坏了它能修；**它自己坏了只能重新导入工作流**。自我更新让这条唯一通道
每次更新都被重写一遍（出事概率上升），而救援能力**没有变强**。

### 7.4 ⚠️ 唯一的接口：**共享作用域里的一个函数名**

`core.js` 与工作流脚本**共享同一作用域**（bootstrap 在**顶层** `eval(主脚本)`）⇒
`core.js` 直接调 `vflowUpdateRun()`，**不读文件、不传参**。

```javascript
// core.js 侧 —— 全部就这几行
if (typeof vflowUpdateRun !== "function") {
    弹错「当前工作流版本过旧（缺更新逻辑），请重新导入 workflow/fluid-cloud.json」;
    return;
}
vflowUpdateRun();
```

```javascript
// bootstrap.js 侧 —— 顶层直接开跑（末尾那道闸），另暴露 vflowUpdateRun() 给 core 调
```

⭐ **没有参数约定** —— 接口只有「一个函数名」。它是**双向**的：
bootstrap 也能读到主脚本的 `showToast` / `showOptionsDialog`
（见 `vflowUpdateInfo` / `vflowUpdateAsk`，主脚本没加载时自己兜底）。

#### 三条约束

| # | 约束 | 违反的表现 |
|---|---|---|
| 1 | **`eval(主脚本)` 必须在 bootstrap 的顶层**（不能包 IIFE、不能放进函数） | ⚠️ 放进函数 ⇒ 主脚本的 `var` 落在**函数作用域**、出不去 ⇒ 表现是「脚本加载了但什么都没发生」（**静默**）。⚠️ 这条**离线测得到**（Node `vm` 与 Rhino 行为一致） |
| 2 | **`vflowUpdate*` 一律带前缀** | 顶层 `var` 是共享作用域 ⇒ 用 `code` / `validate` 这种通用名会**悄悄覆盖**主脚本的同名全局 |
| 3 | **所有失败都要弹错**（不能只 `console.log`） | 静默的表现是「点了检查更新，什么都没发生」 |

⚠️ **约束 2 的代价（如实记录）**：主脚本哪天把 `showToast` / `showOptionsDialog` 改名，
bootstrap 会**静默退化**到 `vflow.device.toast`（功能还在，只是少了提示开关）。
这是**已知**的、可接受的代价 —— 那两个名字很稳定。

#### 离线测试怎么「只加载不执行」

bootstrap 顶层会跑自足检查（会联网）⇒ 测试侧先设 `VFLOW_BOOTSTRAP_DISABLED = true`：

```javascript
// bootstrap.js 末尾
if (typeof VFLOW_BOOTSTRAP_DISABLED === "undefined" || !VFLOW_BOOTSTRAP_DISABLED) {
    var VFLOW_MAIN_CODE = vflowBootstrapLoad();   // 自足检查 + 读主脚本
    eval(VFLOW_MAIN_CODE);                        // ⚠️ 必须在顶层（约束 1）
}
```

⚠️ 语义与上一版的 `VFLOW_UPDATE_ENABLED` **相反**（那个是「设 true 才跑」）——
bootstrap 是**入口**，默认就跑；更新逻辑是**被调用的**。

## 8. 静默失效点清单

| # | 风险 | 表现 | 防法 |
|---|---|---|---|
| 1 | **半截文件** | 下载中断 ⇒ 覆盖出不完整脚本 ⇒ **下次触发整个工作流崩** | 写 `.tmp` → 校验 → `renameTo`（§5.3） |
| 2 | **拉失败把旧的删了** | 更新失败 ⇒ 功能没了（比不更新更糟） | 只在 `.tmp` 上写，**原文件在 rename 前完好** |
| 3 | **404 返回 HTML 被当脚本** | 下次触发语法错误 | 校验长度 + 特征串（§5.5）；**HTTP 模块对 404 不抛异常**，必须自己判 `status_code` |
| 4 | **版本号没更新** | 用户不知道更没更新 | 打「`0.3.0 → 0.4.0`」或「已是最新（`0.3.0`）」（§4.3） |
| 5 | **规则库与脚本版本错配** | 新脚本读旧规则格式 ⇒ 静默识别不出 | 主脚本与两份 JSON **整组一起更新**；`version` **最后写**（§4.2） |
| 6 | ⚠️⚠️ **改了 `src/` 忘了重跑 `npm run build` 再提交** | `dist/` 入库后，仓库里的产物是**旧的** ⇒ 用户更新到旧脚本，**而两边都看不出来** | **必须加断言**：`test/` 里比「`dist/` 的内容」与「重跑一次 generate 的输出」是否一致。⚠️ 这是 `dist/` 入库**新引入**的风险 |
| 7 | **用户手改过 `config.json`** | 合并时被重写，注释丢失、键序重排 | 版本闸（§5.1）：只有 `CONFIG_VERSION` 变了才写盘 |
| 8 | **`ensureRules()` 判据弱化** | 文件在但内容为空 ⇒ 静默识别不出 | `exists()` + 长度下界（§5.4） |
| 9 | **更新期间剪贴板触发被丢** | 用户复制了东西没反应 | `block_new` 的既有行为；更新耗时短（秒级），**接受**（§6.3） |
| 10 | **网络慢导致 HTTP 超时** | 更新失败，用户以为功能坏了 | `timeout` 调到 30 秒；失败时**显式报错**（不静默） |
| 11 | ⚠️⚠️ **工作流脚本过旧**（用户导入的是老 `fluid-cloud.json`） | 点了「检查更新」什么都没发生 | §7.4 的 `typeof vflowUpdateRun !== "function"` 检查 + **显式弹错**（不能只写日志） |
| 12 | **`eval(主脚本)` 被放进函数里** | 主脚本的全局出不去 ⇒ 「加载了但什么都没发生」（静默） | §7.4 约束 1：eval 必须在**顶层**；离线有断言（`bootstrap.js` 末尾不是裸调用 / 顶层 eval） |
| 13 | ⚠️⚠️ **首次自足失败**（无网 / 代理不通） | 工作流跑不起来 | §4.0：**显式弹错并中止**（不 eval 半份脚本）；提示里给出「手动放文件」的出路 |

---

## 9. 实施清单（**改哪些文件**）—— ✅ 已于 2026-10-09 完成

| # | 文件 | 改动 |
|---|---|---|
| 1 | `.gitignore` | 移除 `dist/` |
| 2 | `.gitattributes` | 加 `dist/*.js -text` / `dist/*.json -text` / `version -text` |
| 3 | `src/bootstrap.js` | ⭐ **更新逻辑在这里**（首次自足 + 拉取 + 校验 + 原子写 + 合并 + 提示）。末尾是 `VFLOW_BOOTSTRAP_DISABLED` 闸 + **顶层** `eval(主脚本)` |
| 4 | `src/generate.js` | **删掉**第二输出（不再产 `dist/update.js`）；仍只产 `dist/vflow-fluid-cloud.js` |
| 5 | `src/core.js` | ① `showManualActionsUI()` 加「检查更新」一项 + 返回哨兵；② 顶层分派**调 `vflowUpdateRun()`**（函数缺失时显式弹错） |
| 6 | `src/adapter.js` | ① `ensureRules()` 改 `exists()` + 长度下界；② `ensureConfig()` 加版本闸 + 合并 |
| 7 | `test/run.js` | `[12]` 更新机制（合并 / 校验 / 原子写 / 版本闸 / `status_code`）、`[13]` 产物与源一致、`[14]` **首次自足**（缺什么拉什么 / 齐全不联网 / 坏脚本自愈 / 失败中止） |
| 8 | `test/workflow.js` | script == `src/bootstrap.js` 全文（逐字节） |
| 9 | `docs/DESIGN.md` | §3.4 改为**指向本文档**；§3.4.2 / §3.4.6 的旧决策标注「已推翻」 |
| 10 | `README.md` / `AGENTS.md` | 更新「脚本更新机制」一节 + 未决项 1 + 部署步骤（**全新设备只要「导入工作流 + 跑一次」**） |

⚠️ **改完 `src/` 必须**：`npm run check` +
（改了 `bootstrap.js` 时）`python tools/build-workflow.py` + **重新导入工作流** +
（因为 `dist/` 入库了）**提交 `dist/`**。

---

## 10. 待核实（**实施前必须去 vFlow 仓库 / 真机逐条确认**）

| # | 待核实项 | 怎么核实 |
|---|---|---|
| 1 | `/sdcard` 上 `File.renameTo` 是否原子、能否覆盖已存在文件 | 真机：`ls -i` 前后对比；写大文件时中断观察 |
| 2 | 从 JS 调 `vflow.network.http_request` 的**参数名与返回结构** | 已核 `getInputs` / `getOutputs`（`url` / `method` / `timeout` / `proxy_mode`；返回 `response_body` / `status_code`）。⚠️ **但 JS→模块的桥接未在真机验过这个模块**（`core.js` 目前只用了 `toast` / `set_clipboard` / `shell_command`） |
| 3 | 大响应体（148 KB）经 JS 桥接是否有截断 | 真机：拉一次主脚本，比对长度 |
| 4 | `HttpRequestModule` 的 `timeout` 上限 / 单位 | 已核：秒，`callTimeout`（`HttpRequestModule.kt:243`）。**默认 10 秒** ⇒ 要显式传 30 |
| 5 | 更新期间工作流线程被占，会不会影响**岛/浮窗** | 真机：更新时观察已有通知是否正常 |
| 6 | ⚠️ **`eval(主脚本)` 后主脚本能否看到 bootstrap 的全局**（§7.4） | 离线 harness（Node `vm`）与 Rhino **可能行为不同**。要在真机上验：`eval` 之后，`core.js` 里能否直接调到 `vflowUpdateRun()`。判据是「点了检查更新有没有反应」，不是「有没有报错」 |
| 7 | ⚠️ **首次执行联网下载的耗时 / 是否阻塞** | 真机：清空设备目录 → 跑一次 → 看耗时与是否有 ANR；`timeout` 30 秒是否够 |
| 8 | ⚠️ **工作流 JSON 变大（script 约 20 KB）后导入是否正常** | 真机：`tools/deploy-workflow.py` 导入，看有无截断/报错 |

---

## 11. 与 `DESIGN.md` §3.4 的关系

**本文档取代 `DESIGN.md` §3.4**（那一节写于 2026-10-07，含若干条已推翻的决策）。
`DESIGN.md` §3.4 改为一句指针 + 「已推翻」的标注，细节全部以本文档为准。

⚠️ **保留 §3.4.1（上游 `update.js` 的做法）** —— 它是来历对照（本方案就是从它那儿推出来的）。
