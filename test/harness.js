#!/usr/bin/env node
/**
 * 离线测试：用 Node 模拟 Rhino + Android 环境，跑整份 dist/vflow-fluid-cloud.js。
 *
 * ## 为什么需要它
 *
 * 当前没有设备（`adb devices` 为空），而这份脚本**必须在真机上才能验证** ——
 * 但真机上失败时，「是规则没匹配上」还是「是 Android API 调不通」是**分不开的**。
 * 这个 harness 把两者切开：用假的 Android 环境跑，**只验纯 JS 那一半**
 *（规则匹配 / 链接识别 / 变量提取 / 条件判定 / 岛参数 JSON 生成）。
 *
 * ⚠️ **它不能替代真机验证**。它证明不了：
 *   - `vflow.*` 模块真的能调通（这里是假的）
 *   - 岛通知真的会被系统渲染（这里只记下 `notify` 的参数）
 *   - 小窗的 `service call 138` 真的有效
 *
 * ## 覆盖范围
 *
 * | 能测 | 不能测 |
 * |---|---|
 * | `RecognitionMain` 链接识别全链路 | 任何真的 Android API |
 * | `matchRules` 规则匹配 + `【变量】` 提取 | 权限、SELinux、UID 差异 |
 * | `buildIslandParams` 的 JSON 结构 | 岛参数是否被 SystemUI 接受 |
 * | 补丁产物能否在 Rhino 风格的环境下**跑起来**（无 ReferenceError） | 性能 / 阻塞行为 |
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 调用记录 —— 断言用
// ---------------------------------------------------------------------------
const calls = {
    toast: [],
    clipboard: [],
    shell: [],
    notify: [],
    // 每次 `NotificationManager.cancel(id)` 记一条
    // （2026-10-08 起「点击回传要收掉通知」是契约的一部分）
    cancelNotification: [],
    startActivity: [],
    // 每次 `PendingIntent.getActivity/getBroadcast` 记一条
    // （2026-10-07 起 `requestCode` 是契约的一部分，必须能断言）
    pending: [],
    log: [],
    // 自绘 UI（`showsettingsui` / `showFileEditorUI` / `showOptionsDialog`）里
    // 每个 `TextView.setText` 的文本，按出现顺序。
    // ⚠️ 它是**离线验证「弹的是哪个界面」的唯一手段** —— 那几个界面全走
    //    `WindowManager.addView`，没有任何返回值、也没有日志。
    uiText: [],
    // 每次 `WindowManager.addView` 记一条 `{ view, params }`
    uiRoots: []
};

function resetCalls() {
    for (const k of Object.keys(calls)) calls[k] = [];
    uiListenerBox.list = [];
    // ⚠️ 只清**请求记录**，**不清 `responses`** —— 用例要先配好响应再 run()，
    //    清了就没法配了（run() 内部会调 resetCalls）。
    httpBox.requests = [];
}

/**
 * HTTP 模块的假实现（`vflow.network.http_request`）。
 *
 * ⚠️ 默认**未配置的 url 返回 404**（不是 200）—— 逼用例**显式**配响应。
 *    若默认给 200，那「忘了配」就会静默变成「拉到了空内容」，用例通过但什么也没测。
 *    HTTP 模块**对 404 不抛异常**（任何状态码都 Success，见 UPDATE.md §5.5），
 *    所以这条默认值正好能测出「实现有没有自己判 status_code」。
 *
 * `responses[url]` 可以是对象（浅合并到默认 200 响应上）或函数（拿到 args，返回响应）。
 */
const httpBox = { requests: [], responses: {} };

/**
 * 自绘界面里注册过的点击监听器，**按注册顺序**。
 *
 * ⚠️ 为什么必须记：`showOptionsDialog` / `showsettingsui` / `showFileEditorUI` 三个界面
 *    是**阻塞轮询**等用户点击的（`while (result === null) { Thread.sleep(150); }`）。
 *    离线测试里没人点 ⇒ 那个循环**永远出不来**，撞上 `Thread.sleep` 的保险后报
 *    「等待循环转了 10 万次仍未退出」—— 那是**环境**问题，不是脚本问题。
 *    ⇒ 测试里用 `autoDismiss` 模拟「用户点了最后那个按钮」（见 `addView`）。
 */
const uiListenerBox = { list: [] };

/**
 * `Thread.sleep` 自旋计数器。
 *
 * ⚠️ 必须是**模块级可变对象**而不是 `installJava` 里的局部 `let` ——
 *    每个用例都会重新 `installJava`，局部变量会把计数重置，
 *    于是「上个用例转了 9999 次、这个用例再转 2 次」不会触发上限，
 *    而反过来「同一个用例内部转了 10 万次」才触发 —— 上限形同虚设。
 */
const spinsBox = { value: 0 };
const MAX_SPINS = 100000;

// ---------------------------------------------------------------------------
// Java / Android 的最小 stub
//
// ⚠️ 一律「宽进」：不认识的方法返回一个**可调用的空对象**，而不是抛异常。
//    这样「走到没 stub 的分支」不会中断整条链路，而是记一笔 ——
//    否则测出来的失败是「harness 不全」而不是「脚本有问题」，反而更难用。
// ---------------------------------------------------------------------------
function anyObject(name, overrides) {
    const target = function () { return anyObject(name, overrides); };
    target.__stubName = name;
    return new Proxy(target, {
        get(_t, prop) {
            if (prop === '__stubName') return name;
            if (prop === 'toString') return () => `[stub ${name}]`;
            if (prop === Symbol.toPrimitive) return () => `[stub ${name}]`;
            if (overrides && prop in overrides) {
                const v = overrides[prop];
                return typeof v === 'function' ? v : v;
            }
            if (prop === 'length') return 0;
            // 未定义成员：返回一个「万能」stub，继续宽进
            return anyObject(`${name}.${String(prop)}`);
        },
        construct() { return anyObject(name, overrides); },
        apply() { return anyObject(name, overrides); }
    });
}

/** 造一个可当作「Java 对象」用的普通 JS 对象（值可读、方法可调）。 */
function javaLike(props) {
    return Object.assign({}, props);
}

/**
 * 「宽进」的 View stub 工厂。
 *
 * ⚠️ **为什么不用手写方法清单**：自绘界面（`showsettingsui` / `showFileEditorUI` /
 *    `showOptionsDialog`）动用的 View API 有几十个（`setBackgroundColor` / `setTypeface` /
 *    `setLayoutParams` / `setFillViewport` …），手写清单会变成**打地鼠** ——
 *    漏一个就抛 `TypeError: xxx is not a function`，而那几个界面的 `catch` 是
 *    **吞异常**的（上游原样）⇒ 表现是「界面静默弹不出来」，排查成本极高（实际踩过）。
 *
 * ⇒ 这里让**未知成员一律返回一个万能 stub**（`anyObject`，可调用、可赋值、可继续取属性），
 *    与 `anyObject` 的「宽进」原则一致。`overrides` 里放需要**真实现**的那几个
 *    （`setText` 要记进 `calls.uiText`；`setOnClickListener` 要记进 `uiListenerBox`）。
 *
 * @param {object} [overrides] 需要真实现的方法（`this` 绑到实例）。
 */
function looseViewClass(overrides) {
    return class {
        constructor() {
            const self = this;
            return new Proxy(this, {
                get(target, prop) {
                    if (typeof prop === 'symbol') return Reflect.get(target, prop);
                    if (overrides && Object.prototype.hasOwnProperty.call(overrides, prop)) {
                        return overrides[prop].bind(self);
                    }
                    if (prop in target) return Reflect.get(target, prop);
                    return anyObject(`View.${String(prop)}`);
                }
            });
        }
    };
}

/**
 * Rhino 的 importClass / importPackage。
 *
 * ⚠️⚠️ **不能做成 no-op** —— `importClass(android.content.Context)` 在 Rhino 里会把
 *    `Context` 这个**短名**注册成全局符号，脚本随后写 `Context.WINDOW_SERVICE`。
 *    做成 no-op 的话那句就是 `ReferenceError: Context is not defined`，
 *    而报错位置是**使用处**（`var windowManager = context.getSystemService(Context.WINDOW_SERVICE)`），
 *    看不出是 importClass 的问题 —— 实测踩过一次。
 *
 * ⚠️ JS 里拿不到「传进来的表达式叫什么」，故**先扫源码**取出所有 `importClass(X)` 的
 *    点分路径，再逐个解析成短名挂到沙箱上。
 *    （`Packages.tornaco.apps.shortx...` 那 3 行在**移植时**就已从 `src/core.js` 里删掉，
 *      见 DESIGN.md §3.5 —— 所以正常路径下这里扫不到 `Packages.` 开头的。）
 */
function installRhinoGlobals(sandbox, scriptText) {
    sandbox.importClass = function () {};
    sandbox.importPackage = function () {};
    sandbox.Packages = new Proxy({}, { get: () => anyObject('Packages') });

    sandbox.org = {
        json: {
            JSONArray: class { constructor() { this._a = []; } },
            JSONObject: class { constructor() { this._o = {}; } },
            JSONTokener: class {}
        }
    };

    // 从源码里取所有 importClass 的点分路径
    const names = new Set();
    const re = /importClass\(([A-Za-z0-9_$.]+)\)/g;
    let m;
    while ((m = re.exec(scriptText)) !== null) names.add(m[1]);

    for (const dotted of names) {
        if (dotted.startsWith('Packages.')) continue; // 已删除的 ShortX 类
        const parts = dotted.split('.');
        const shortName = parts[parts.length - 1];

        // 逐级解析
        let cur = sandbox;
        let ok = true;
        for (const p of parts) {
            if (cur === null || cur === undefined || !(p in cur)) { ok = false; break; }
            cur = cur[p];
        }
        if (!ok || cur === undefined) {
            // 不抛 —— 记为「未 stub」，脚本跑到那里才会失败（此时能看出是哪一类）
            sandbox[shortName] = anyObject(`importClass:${dotted}`);
            continue;
        }
        sandbox[shortName] = cur;
    }

    // importPackage(android.view / android.widget / android.content / android.graphics)
    // Rhino 里它把包内所有**类**都注册成短名。这里只补脚本真正用到的那些。
    const pkgShortNames = {
        LinearLayout: 'android.widget.LinearLayout',
        TextView: 'android.widget.TextView',
        Button: 'android.widget.Button',
        ScrollView: 'android.widget.ScrollView',
        EditText: 'android.widget.EditText',
        FrameLayout: 'android.widget.FrameLayout',
        ImageView: 'android.widget.ImageView',
        // ⚠️ `View` 是 `importPackage(android.view)` 带进来的短名 ——
        //    core.js 里 6 处 `new View.OnClickListener({…})` 全靠它。
        View: 'android.view.View',
        Intent: 'android.content.Intent',
        IntentFilter: 'android.content.IntentFilter',
        BroadcastReceiver: 'android.content.BroadcastReceiver',
        Color: 'android.graphics.Color',
        Canvas: 'android.graphics.Canvas',
        Bitmap: 'android.graphics.Bitmap',
        GradientDrawable: 'android.graphics.drawable.GradientDrawable'
    };
    for (const [shortName, dotted] of Object.entries(pkgShortNames)) {
        const parts = dotted.split('.');
        let cur = sandbox;
        for (const p of parts) {
            if (cur === null || cur === undefined || !(p in cur)) { cur = undefined; break; }
            cur = cur[p];
        }
        if (cur !== undefined) sandbox[shortName] = cur;
    }
}

/**
 * 把脚本里的 Android 路径映射到本机真实路径。
 *
 * ⚠️ 脚本写的是 `/sdcard/vFlow/fluid-cloud`，而 Windows 上 `fs` 会把它解析成
 *    `D:\sdcard\vFlow\fluid-cloud`（当前盘符 + 相对路径）—— **可能真的存在**，
 *    于是测试会读到上一次跑剩下的文件，用例之间互相污染且**看不出来**。
 *    统一映射到 `os.tmpdir()/vflow-fluid-cloud-test`，每次跑前清空。
 */
const TEST_STORAGE_ROOT = path.join(require('os').tmpdir(), 'vflow-fluid-cloud-test');

function mapPath(p) {
    const s = String(p);
    if (s.startsWith('/sdcard/')) {
        return path.join(TEST_STORAGE_ROOT, s.slice('/sdcard/'.length));
    }
    return s;
}

/** 清空测试存储目录（每次跑测试前调一次）。 */
function resetStorage() {
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_STORAGE_ROOT, { recursive: true });
}

/** Java List 的最小实现 —— 脚本到处在用 `.size()` / `.get(i)`，不是 JS 数组。 */
function javaList(items) {
    const arr = (items || []).slice();
    return {
        size: () => arr.length,
        get: (i) => arr[i],
        add: (x) => { arr.push(x); return true; },
        contains: (x) => arr.includes(x),
        isEmpty: () => arr.length === 0,
        toArray: () => arr.slice()
    };
}

/** Java 标准库的最小实现（只实现脚本真正用到的那几处）。 */
function installJava(sandbox) {
    class JFile {
        constructor(p) { this.raw = String(p); this.path = mapPath(p); }
        exists() { return fs.existsSync(this.path); }
        isDirectory() { try { return fs.statSync(this.path).isDirectory(); } catch { return false; } }
        // ⚠️ `length()` 是 `ensureRules()` 的新判据的一部分（exists() + length() > 0，
        //    见 UPDATE.md §5.4）—— 文件不存在时返回 0（与真 Java 一致）。
        length() { try { return fs.statSync(this.path).size; } catch { return 0; } }
        // ⚠️ **必须真实现**（不能 no-op）—— 更新器的原子写靠它（UPDATE.md §5.3）。
        //    no-op 的话「renameTo 之后目标有没有被换成新内容」永远看不出来。
        renameTo(other) {
            try { fs.renameSync(this.path, other.path); return true; } catch { return false; }
        }
        getAbsolutePath() { return this.raw; }
        getName() { return path.basename(this.path); }
        getParentFile() { return new JFile(path.dirname(this.raw)); }
        mkdirs() { fs.mkdirSync(this.path, { recursive: true }); return true; }
        delete() { try { fs.unlinkSync(this.path); return true; } catch { return false; } }
        listFiles() {
            try {
                return fs.readdirSync(this.path).map((n) => new JFile(path.join(this.raw, n)));
            } catch { return null; }
        }
    }

    class JScanner {
        constructor(file, _charset) {
            this._text = fs.readFileSync(file.path, 'utf8');
            this._pos = 0;
            this._delim = null;
        }
        useDelimiter(d) { this._delim = d; return this; }
        hasNext() {
            if (this._delim === '\\Z') return this._pos === 0;
            return false;
        }
        next() { this._pos = this._text.length; return this._text; }
        close() {}
    }

    class JFileWriter {
        // ⚠️ 参数可能是**字符串**（core.js 的 `writeConfigToFile(path, …)` 传的是字符串）
        //    也可能是 JFile 对象。只处理后者会抛「配置保存失败」——
        //    而那是个**假的**失败提示（toast 被记进 calls，让用例断言莫名多一条）。
        constructor(file) {
            this.raw = typeof file === 'string' ? file : file.raw;
            this._path = mapPath(this.raw);
            this._buf = '';
        }
        write(s) { this._buf += String(s); return this; }
        close() {
            fs.mkdirSync(path.dirname(this._path), { recursive: true });
            fs.writeFileSync(this._path, this._buf, 'utf8');
        }
    }

    class JStringBuilder {
        constructor() { this._s = ''; }
        append(s) { this._s += String(s); return this; }
        toString() { return this._s; }
    }

    // ⚠️ `WeakReference` 在 **`java.lang.ref`** 下，不是 `java.lang` 下 ——
    //    core.js 写的是 `java.lang.ref.WeakReference`。少一级 `ref` 的话
    //    报错是「Cannot read properties of undefined (reading 'WeakReference')」，
    //    而位置在 `showIslandNotification` 里，看起来像脚本的问题（实测踩过）。
    const WeakReference = class {
        constructor(o) { this._o = o; }
        get() { return this._o; }
    };

    /**
     * ⚠️⚠️ `Thread` 的 stub **故意改变了时序语义**，这是本 harness 最需要标注的一处。
     *
     * core.js 的 `showIslandNotification` 是这样等用户点击的：
     *
     * ```javascript
     * new Thread(function () { Thread.sleep(timeout); result = "取消"; … }).start();
     * while (result === null) { Thread.sleep(150); }   // ← 阻塞轮询
     * return result;
     * ```
     *
     * 在测试里：
     *   - `sleep` 是 **no-op**（真睡 3 秒 × 每个用例会让测试跑几十秒）
     *   - `start()` **同步执行** run（这样「超时」分支立刻把 `result` 置为超时值）
     *   ⇒ `while` 循环第一轮就退出，函数正常返回。
     *
     * ⚠️ **代价（必须知道）**：测试**完全覆盖不到**「阻塞轮询」这一段 ——
     *    而在真机上，这段会让 `vflow.system.js` 的调用**阻塞 `Fluid_Cloud_timeout` 毫秒**
     *    （默认 3000ms），且**阻塞期间无法被中断**（见 DESIGN.md §6-5）。
     *    这是 P0 上真机必须实测的头号风险，**离线测试给不出任何结论**。
     */
    /**
     * ⚠️⚠️ `Thread.sleep` 的 no-op **必须带「转不出去就抛」的保险**。
     *
     * 脚本里的等待循环是 `while (result === null) { Thread.sleep(150); }` ——
     * 一旦「谁来把 result 置上」这条路断了（比如 `Runnable` 的 stub 没接住回调），
     * no-op 的 sleep 会让它**转成死循环**，测试进程**直接挂住**：
     * 表现是「跑到某一条就不动了」，而不是「某条用例失败」。
     *
     * ⇒ 转够 [MAX_SPINS] 次就抛。**把挂死变成断言失败** ——
     *   这正是本仓库对「死循环」的一贯处理（见 `JsTimeoutTest` 的独立线程做法）。
     */
    const JThread = class {
        constructor(r) { this._r = r; }
        start() {
            // 同步执行 —— 让超时分支立刻生效（见上）
            if (this._r && typeof this._r.run === 'function') this._r.run();
        }
    };
    JThread.sleep = function () {
        if (++spinsBox.value > MAX_SPINS) {
            throw new Error(
                `等待循环转了 ${MAX_SPINS} 次仍未退出 —— 脚本里的 \`while (result === null)\` 没被唤醒。\n` +
                `  常见原因：Thread 里那个回调没跑起来（Runnable 的 stub 没接住 / Thread 的 stub 没执行 run）。`
            );
        }
    };

    const javaLang = {
        String: { valueOf: String },
        StringBuilder: JStringBuilder,
        System: { currentTimeMillis: () => Date.now() },
        Thread: JThread,
        Class: { forName: () => anyObject('Class') },
        // ⚠️ Rhino 里脚本写的是 `new Runnable({ run: fn })` —— 是个**对象**不是函数。
        //    做成 `function () {}` 的话 `new` 出来是空对象，`this._r.run` 是 undefined
        //    ⇒ Thread 里那个回调**永远不跑** ⇒ 等待循环死转（实测挂住过一次）。
        Runnable: class { constructor(o) { if (o) Object.assign(this, o); } },
        ref: { WeakReference }
    };

    sandbox.java = {
        lang: javaLang,
        io: {
            File: JFile,
            /**
             * ⚠️ **必须真的读文件** —— core.js 的 `readJsonFile` 用
             * `new BufferedReader(new FileReader(path))` + `readLine()` 循环读配置。
             * 返回 null 的 stub 会让它读到空串 → `JSON.parse("")` 抛
             * 「配置文件读取失败」—— 而那是**测试环境的假失败**，
             * 看起来像「脚本读不到配置」，实际是 harness 不全（实测踩过）。
             */
            FileReader: class {
                constructor(f) {
                    this.path = typeof f === 'string' ? mapPath(f) : f.path;
                    this._text = fs.existsSync(this.path) ? fs.readFileSync(this.path, 'utf8') : null;
                }
            },
            /**
             * ⚠️ 必须真实现 —— bootstrap 的 `vflowUpdateReadLocal` 用
             * `new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"))`
             * 读主脚本（**不用 `Scanner`**：真机上 `Scanner` + `useDelimiter("\\Z")`
             * 读 148 KB 会截断，见 src/bootstrap.js 里那段注释）。
             */
            FileInputStream: class {
                constructor(f) {
                    this.path = typeof f === 'string' ? mapPath(f) : f.path;
                    if (!fs.existsSync(this.path)) {
                        throw new Error(`FileNotFoundException: ${this.path}`);
                    }
                }
            },
            InputStreamReader: class {
                constructor(fis, _charset) {
                    this.path = fis.path;
                    this._text = fs.readFileSync(this.path, 'utf8');
                }
            },
            BufferedReader: class {
                constructor(reader) {
                    if (reader._text === null || reader._text === undefined) {
                        // 与真 Java 一致：文件不存在时构造 FileReader 就抛
                        throw new Error(`FileNotFoundException: ${reader.path}`);
                    }
                    this._lines = reader._text.split(/\r?\n/);
                    this._i = 0;
                }
                readLine() { return this._i < this._lines.length ? this._lines[this._i++] : null; }
                close() {}
            },
            FileWriter: JFileWriter,
            BufferedWriter: class {
                constructor(w) { this._w = w; }
                write(s) { this._w.write(s); return this; }
                close() { this._w.close(); }
            }
        },
        util: {
            Scanner: JScanner,
            concurrent: { CountDownLatch: class { constructor() {} await() {} countDown() {} } }
        },
        net: { URL: class { constructor(u) { this.url = u; } openConnection() { return anyObject('URLConnection'); } } }
    };
}

// ---------------------------------------------------------------------------
// Android stub
// ---------------------------------------------------------------------------
function installAndroid(sandbox, opts) {
    const browserPkg = opts.browserPackage || 'com.android.chrome';

    /**
     * 假的 PackageManager。
     *
     * ⚠️ 列表类 API 一律返回 **Java List**（有 `.size()` / `.get(i)`）——
     *    脚本写的是 `for (var i = 0; i < apps.size(); i++)`，给 JS 数组会
     *    在 `.size` 上得到 undefined（实测踩过）。
     */
    const packageManager = {
        resolveActivity: () => ({ activityInfo: { packageName: browserPkg, name: 'Main' } }),
        getApplicationInfoAsUser: () => ({ packageName: browserPkg }),
        getApplicationLabel: () => ({ toString: () => 'Chrome' }),
        getApplicationIcon: () => anyObject('Drawable'),
        getInstalledApplications: () => javaList([{ packageName: browserPkg }]),
        getInstalledApplicationsAsUser: () => javaList([{ packageName: browserPkg }]),
        getInstalledPackages: () => javaList([]),
        queryIntentActivitiesAsUser: () => javaList([]),
        queryIntentActivities: () => javaList([])
    };

    /**
     * IPackageManager（脚本经 `ServiceManager.getService("package")` 拿它）。
     *
     * ⚠️ **按 URL 区分返回**：`pkgCheck` 会同时查「目标 scheme」与
     *    「http://example.com / https://example.com」来算「假浏览器」集合
     *    （`fakebrowserapp`）。若对所有 URL 返回同一份列表，那个集合会等于全集 ⇒
     *    `result.result` 为空 ⇒ `pass=false` ⇒ **所有 url 类型规则都被跳过**
     *    （表现是「规则库非空但一条都不命中」）。这里让 example.com 只返回默认浏览器，
     *    其余 URL 多返回一个「目标 App」。
     */
    const ipm = {
        queryIntentActivities(intent) {
            const url = intent && intent.getData ? String(intent.getData()) : '';
            const pkgs = url.includes('example.com')
                ? [browserPkg]
                : [browserPkg, opts.targetApp || 'com.fluid.target'];
            return {
                getList: () => javaList(pkgs.map((p) => ({ activityInfo: { packageName: p } })))
            };
        }
    };

    const intent = function (action, uri) {
        return {
            _action: action, _data: uri, _package: null, _class: null, _flags: 0,
            setData(u) { this._data = u; return this; },
            getData() { return this._data; },
            setPackage(p) { this._package = p; return this; },
            getPackage() { return this._package; },
            setClassName(p, c) { this._class = `${p}/${c}`; return this; },
            getComponent() { return this._class ? { getPackageName: () => this._package } : null; },
            addFlags(f) { this._flags |= f; return this; },
            getFlags() { return this._flags; },
            addCategory() { return this; },
            resolveActivity() { return { activityInfo: { name: 'Main' } }; },
            getExtras() { return null; }
        };
    };

    /**
     * ⚠️⚠️ **必须真实现** —— 不能 no-op。
     *
     * 它是 2026-10-07「点击交给工作流」那批改动新引入的（`buildClickPayload`）：
     * 把链接编码进广播的 `data` URI。链接里**本来就有 `?` 与 `&`**，
     * 不编码会被 URI 解析器吃掉 ⇒ 工作流侧拿到的 URL 是**截断的**。
     *
     * 若把它 stub 成恒等函数，测试里「编码了没有」永远看不出来
     * （编码前后都是同一个字符串）—— 而那正是本改动最容易悄悄写错的地方。
     */
    const uriStub = {
        parse: (s) => ({
            _s: String(s),
            toString: () => String(s),
            getScheme: () => String(s).split(':')[0],
            getHost: () => (String(s).split('//')[1] || '').split('?')[0],
            getQuery: () => (String(s).split('?')[1] || null),
        })
    };

    const notificationManager = {
        createNotificationChannel() {},
        notify(id, n) { calls.notify.push({ id, notification: n }); },
        cancel(id) { calls.cancelNotification.push(id); }
    };

    /**
     * ⚠️ `addView` **必须真实现** —— 自绘界面（`showsettingsui` / `showFileEditorUI`）
     *    全靠它。no-op 的话那些界面在离线测试里与「没弹」**不可区分**。
     */
    const windowManager = {
        getDefaultDisplay: () => ({ getMetrics() {}, getRealSize() {}, getRotation: () => 0 }),
        addView(view, params) {
            calls.uiRoots.push({ view, params });
            // ⚠️ **自动点掉**：自绘界面在 `while (result === null)` 里等用户点击，
            //    离线测试里没人点 ⇒ 死转（撞 `Thread.sleep` 的保险后报「等待循环转了
            //    10 万次仍未退出」，看着像脚本坏了，其实是没人点）。
            //    这里同步「点」最后一个注册的监听器（= 「确定」/「取消」，都是**收尾**
            //    那个按钮），让循环能退出。
            //    ⇒ 代价：**测不到「点了中间某个按钮会怎样」**（那需要人点或更细的驱动）。
            if (uiListenerBox.autoDismiss && uiListenerBox.list.length) {
                // 默认点**最后一个**（「取消」/「确定」这类收尾按钮）。
                // `__androidOpts.autoDismissIndex` 可指定点第几个 —— 用它测
                // 「点了「设置指令」会弹出设置界面」这条链路。
                const idx = uiListenerBox.autoDismissIndex < 0
                    ? uiListenerBox.list.length - 1
                    : uiListenerBox.autoDismissIndex;
                const l = uiListenerBox.list[idx];
                if (l && typeof l.onClick === 'function') l.onClick();
            }
        },
        removeView() {},
        updateViewLayout() {}
    };

    const context = {
        getSystemService(name) {
            const n = String(name);
            if (n === 'notification' || n === 'notification_service') return notificationManager;
            if (n === 'window') return windowManager;
            if (n === 'activity' || n === 'activity_service') {
                // ⚠️ 必须返回 **Java List**（有 `.size()`），不是 JS 数组 ——
                //    core.js 写的是 `for (var i = 0; i < runningAppProcesses.size(); i++)`，
                //    给数组的话 `.size` 是 undefined ⇒ `undefined is not a function`。
                return {
                    getRunningAppProcesses: () => javaList([]),
                    getRunningTasks: () => javaList([])
                };
            }
            if (n === 'user') return { getUsers: () => javaList([{ id: 0 }]), isUserUnlocked: () => true };
            return anyObject(`Service(${n})`);
        },
        getPackageManager: () => packageManager,
        // ⚠️ 2026-10-07 起必须真实现（不能落到 `anyObject` 万能 stub）——
        //    广播回传用 `context.getPackageName()` 给 `intent.setPackage(...)` 精确寻址，
        //    返回一个万能 stub 的话「有没有设对包名」测不出来。
        getPackageName: () => 'com.chaomixian.vflow',
        createPackageContextAsUser: () => ({ getPackageManager: () => packageManager }),
        // ⚠️ `showsettingsui` / `showOptionsDialog` 要读夜间模式与屏幕尺寸
        //    （`getResources().getConfiguration().uiMode` / `getDisplayMetrics()`），
        //    `showFileEditorUI` 还要 `getDisplayMetrics().density`（dip2px）。
        //    不给的话那三个界面在离线测试里直接抛，测不到「弹的是哪一个」。
        getResources: () => ({
            getConfiguration: () => ({ uiMode: 0 }),
            getDisplayMetrics: () => displayMetrics()
        }),
        startActivity(i) { calls.startActivity.push(i); },
        startActivityAsUser(i) { calls.startActivity.push(i); },
        registerReceiver() {},
        unregisterReceiver() {},
        getClassLoader: () => null,
        getContentResolver: () => anyObject('ContentResolver'),
        getApplicationContext() { return this; }
    };

    const displayMetrics = function () {
        return { widthPixels: 1080, heightPixels: 2400, density: 3 };
    };

    // ⚠️ `context` 是 vFlow 的 `JsExecutor` 注入的全局符号（`JsExecutor.kt:72-76`），
    //    core.js 在**顶层**就用它（`context.getSystemService(...)`）——
    //    不注入的话脚本连加载都过不去。
    sandbox.context = context;

    /**
     * Bundle —— 脚本用它装岛参数（`extras.putString` / `putParcelable` / `putBundle`）。
     *
     * ⚠️ 真 `Bundle` 有 `putString` 等方法，**不是普通 JS 对象** ——
     *    `notification.extras` 若给成 `{}`，`putString` 就是 undefined
     *    （报错「not a function」，位置在岛通知里，看着像脚本的问题）。
     */
    function makeBundle() {
        const m = {};
        return {
            _m: m,
            putString(k, v) { m[k] = v; return this; },
            putParcelable(k, v) { m[k] = v; return this; },
            putBundle(k, v) { m[k] = v; return this; },
            getString(k) { return m[k]; },
            containsKey(k) { return k in m; },
            keySet() { return Object.keys(m); },
            getExtras() { return m; }
        };
    }

    sandbox.android = {
        content: {
            Context: {
                WINDOW_SERVICE: 'window', ACTIVITY_SERVICE: 'activity', NOTIFICATION_SERVICE: 'notification',
                USER_SERVICE: 'user'
            },
            Intent: Object.assign(intent, {
                ACTION_VIEW: 'android.intent.action.VIEW',
                CATEGORY_BROWSABLE: 'android.intent.category.BROWSABLE',
                FLAG_ACTIVITY_NEW_TASK: 0x10000000,
                FLAG_ACTIVITY_REORDER_TO_FRONT: 0x00004000,
                FLAG_ACTIVITY_MULTIPLE_TASK: 0x08000000,
                parseUri: () => intent('android.intent.action.VIEW', null)
            }),
            IntentFilter: class { addAction() { return this; } },
            // ⚠️ 路径是 `android.content.res.Configuration`（core.js 写的是全路径）
            res: { Configuration: { UI_MODE_NIGHT_MASK: 0x30, UI_MODE_NIGHT_YES: 0x20 } },
            BroadcastReceiver: class { constructor(o) { Object.assign(this, o); } },
            pm: {
                PackageManager: { MATCH_DEFAULT_ONLY: 65536, MATCH_ALL: 131072, GET_META_DATA: 128 },
                IPackageManager$Stub: { asInterface: () => ipm }
            }
        },
        app: {
            Notification: {
                Builder: class {
                    constructor() { this._extras = makeBundle(); }
                    setContentTitle(t) { this._title = t; return this; }
                    setContentText(t) { this._text = t; return this; }
                    setSmallIcon(i) { this._icon = i; return this; }
                    setContentIntent(i) { this._contentIntent = i; return this; }
                    // ⚠️ 2026-10-08 起必须真实现 + 记录 —— 它是**通知能否自动消失**的唯一机制
                    //    （上游完全依赖脚本自己开线程 cancel，本次改动删了那段）。
                    //    不记录的话「有没有设、设成多少」测不出来。
                    setTimeoutAfter(ms) { this._timeoutAfter = ms; return this; }
                    setWhen() { return this; }
                    setShowWhen() { return this; }
                    addExtras(b) {
                        const src = b && b._m ? b._m : b || {};
                        Object.keys(src).forEach((k) => this._extras.putParcelable(k, src[k]));
                        return this;
                    }
                    build() {
                        return {
                            extras: this._extras,
                            _title: this._title,
                            _text: this._text,
                            _timeoutAfter: this._timeoutAfter
                        };
                    }
                },
                Action: { Builder: class { constructor() {} build() { return {}; } } }
            },
            NotificationManager: { IMPORTANCE_HIGH: 4, IMPORTANCE_DEFAULT: 3 },
            NotificationChannel: class { constructor(id, name, imp) { this.id = id; } },
            PendingIntent: {
                // ⚠️ **必须记录 `(requestCode, intent)`** —— 2026-10-07 的改动里
                //    `requestCode` 是**契约的一部分**（固定 action 后靠它区分每条通知，
                //    见 `createClickBroadcastIntent` 的注释）。不记录就测不出它。
                getActivity: (ctx, rc, intent) => {
                    calls.pending.push({ kind: 'activity', requestCode: rc, intent });
                    return { __pending: 'activity', requestCode: rc, intent };
                },
                getBroadcast: (ctx, rc, intent) => {
                    calls.pending.push({ kind: 'broadcast', requestCode: rc, intent });
                    return { __pending: 'broadcast', requestCode: rc, intent };
                },
                FLAG_UPDATE_CURRENT: 1, FLAG_IMMUTABLE: 2
            },
            ActivityManager: { RunningAppProcessInfo: { IMPORTANCE_FOREGROUND: 100 } },
            ActivityOptions: { makeBasic: () => ({ setLaunchWindowingMode() {}, setLaunchBounds() {}, toBundle: () => ({}) }) },
            ActivityThread: { currentApplication: () => ({ getApplicationContext: () => context }) }
        },
        os: {
            Build: { VERSION: { SDK_INT: 34 } },
            Bundle: class {
                constructor() { this._m = {}; }
                putString(k, v) { this._m[k] = v; return this; }
                putParcelable(k, v) { this._m[k] = v; return this; }
                putBundle(k, v) { this._m[k] = v; return this; }
                getString(k) { return this._m[k]; }
                containsKey(k) { return k in this._m; }
                getExtras() { return this._m; }
            },
            Handler: class { constructor() {} post(r) { if (r && r.run) r.run(); } },
            Looper: { getMainLooper: () => ({}) },
            UserHandle: { of: () => ({}) },
            ServiceManager: { getService: () => anyObject('IBinder') },
            SystemProperties: { getBoolean: () => false },
            Parcel: {}
        },
        view: {
            WindowManager: {
                // ⚠️ `WRAP_CONTENT` / `MATCH_PARENT` 是**静态常量**（core.js 直接取用）
                LayoutParams: class { constructor(...a) { Object.assign(this, { args: a }); } static WRAP_CONTENT = -2; static MATCH_PARENT = -1; }
            },
            Gravity: { TOP: 0x30, BOTTOM: 0x50, CENTER: 0x11, LEFT: 0x03 },
            Surface: { ROTATION_0: 0, ROTATION_180: 2 },
            MotionEvent: {},
            // ⚠️ 嵌套接口必须挂在 `View` 上 —— core.js 写的是 `new View.OnClickListener({…})`，
            //    这是**接口**（Rhino 里走 Proxy 实现，不是子类化；见 DESIGN.md §4.6）。
            //    离线侧只需一个「接住对象」的壳。
            View: Object.assign(
                class { setOnClickListener() {} setOnTouchListener() {} setBackgroundDrawable() {} setBackground() {} setEnabled() {} setText() {} setVisibility() {} setPadding() {} setLayoutParams() {} },
                {
                    OnClickListener: class { constructor(o) { if (o) Object.assign(this, o); } },
                    OnTouchListener: class { constructor(o) { if (o) Object.assign(this, o); } }
                }
            ),
            ViewGroup: class {}
        },
        widget: {
            // ⚠️ 这几个 View stub 里**只有 `setText` 是真实现**（记进 `calls.uiText`）——
            //    它是离线验证「自绘界面弹出来了、弹的是哪一个」的唯一手段。
            //    其余（addView / setPadding …）保持 no-op：它们不影响可断言的行为。
            // ⚠️ 这几个 View stub 走 `looseViewClass`（未知方法一律宽进）——
            //    自绘界面动用的 View API 太多，手写清单必然漏（漏一个就抛，
            //    而那几个界面的 catch 是吞异常的 ⇒ 界面静默弹不出来）。
            //    这里只列**需要真实现**的方法：
            //      `setText` → 记进 `calls.uiText`（离线验证「弹的是哪个界面」的唯一手段）
            //      `setOnClickListener` → 记进 `uiListenerBox`（自动点掉阻塞的界面）
            LinearLayout: Object.assign(
                looseViewClass({
                    setText(t) { calls.uiText.push(String(t)); },
                    setOnClickListener(l) { uiListenerBox.list.push(l); }
                }),
                {
                    // `LinearLayout.LayoutParams` 是**嵌套静态类**，core.js 里用得很密
                    // （`new LinearLayout.LayoutParams(0, -2, 1)` + `setMargins`）。
                    // 不挂上去的话 `showsettingsui` 会抛 `is not a constructor`。
                    LayoutParams: class { constructor() {} setMargins() {} static MATCH_PARENT = -1; static WRAP_CONTENT = -2; }
                }
            ),
            FrameLayout: Object.assign(
                looseViewClass({
                    setText(t) { calls.uiText.push(String(t)); },
                    setOnClickListener(l) { uiListenerBox.list.push(l); }
                }),
                { LayoutParams: class { constructor() {} static MATCH_PARENT = -1; static WRAP_CONTENT = -2; } }
            ),
            ScrollView: Object.assign(
                looseViewClass({
                    setText(t) { calls.uiText.push(String(t)); },
                    // `post` 同步跑 —— 自绘界面用它做「量完尺寸再调」与「去掉 FLAG_NOT_FOCUSABLE」
                    post(r) { if (r && r.run) r.run(); }
                }),
                { LayoutParams: class { constructor() {} static MATCH_PARENT = -1; static WRAP_CONTENT = -2; } }
            ),
            TextView: looseViewClass({
                setText(t) { calls.uiText.push(String(t)); },
                setOnClickListener(l) { uiListenerBox.list.push(l); }
            }),
            Button: looseViewClass({
                setText(t) { calls.uiText.push(String(t)); },
                setOnClickListener(l) { uiListenerBox.list.push(l); }
            }),
            EditText: looseViewClass({
                setText(t) { calls.uiText.push(String(t)); },
                setOnClickListener(l) { uiListenerBox.list.push(l); },
                getText() { return ''; }
            }),
            ImageView: looseViewClass({})
        },
        graphics: {
            Color: { WHITE: -1, BLACK: -16777216, DKGRAY: -12303292, TRANSPARENT: 0, parseColor: () => 0 },
            GradientDrawable: class { setColor() {} setCornerRadius() {} setStroke() {} },
            PixelFormat: { TRANSLUCENT: -3 },
            Bitmap: { createBitmap: () => ({ isRecycled: () => false, getWidth: () => 1, getHeight: () => 1 }), Config: { ARGB_8888: 1 } },
            Canvas: class { constructor() {} getWidth() { return 1; } getHeight() { return 1; } },
            Rect: class { constructor(l, t, r, b) { this.left = l; this.top = t; this.right = r; this.bottom = b; } },
            // `showsettingsui` / `showOptionsDialog` 用 `Typeface.BOLD` 给标题加粗
            Typeface: { BOLD: 1, NORMAL: 0 },
            Point: class { constructor() { this.x = 0; this.y = 0; } },
            drawable: {
                GradientDrawable: class { setColor() {} setCornerRadius() {} setStroke() {} },
                BitmapDrawable: class {},
                Icon: { createWithBitmap: () => ({ __icon: 'bitmap' }) }
            },
            Icon: { createWithBitmap: () => ({ __icon: 'bitmap' }) }
        },
        util: { DisplayMetrics: displayMetrics },
        net: { Uri: uriStub },
        text: { InputType: { TYPE_CLASS_TEXT: 1, TYPE_TEXT_FLAG_MULTI_LINE: 0x2000 } },
        'view.inputmethod': {}
    };
}

// ---------------------------------------------------------------------------
// vFlow 模块树 stub（只 stub 脚本真正调的那几个）
// ---------------------------------------------------------------------------
function installVFlow(sandbox) {
    const vflow = {
        device: {
            toast: (args) => { calls.toast.push(args && args.message); return { success: true }; }
        },
        system: {
            set_clipboard: (args) => { calls.clipboard.push(args && args.content); return { success: true }; },
            get_clipboard: () => ({ text_content: '' })
        },
        shizuku: {
            shell_command: (args) => {
                calls.shell.push(args && args.command);
                return { result: '', success: true, exit_code: 0 };
            }
        },
        network: {
            // ⚠️ 返回结构照 `JsExecutor.kt:363-372`（Success 时把 outputs Map 转成 JS 对象）
            //    + `HttpRequestModule.kt` 的输出 id：`response_body` / `status_code`。
            http_request: (args) => {
                const url = args && args.url;
                httpBox.requests.push(args);
                const configured = Object.prototype.hasOwnProperty.call(httpBox.responses, url)
                    ? httpBox.responses[url]
                    : null;
                let resp;
                if (typeof configured === 'function') resp = configured(args);
                else if (configured) resp = configured;
                else resp = { response_body: '', status_code: 404 }; // 默认 404（见 httpBox 注释）
                return {
                    response_body: resp.response_body !== undefined ? resp.response_body : '',
                    status_code: resp.status_code !== undefined ? resp.status_code : 200
                };
            }
        }
    };
    sandbox.vflow = vflow;
}

// ---------------------------------------------------------------------------
// 跑一份脚本
// ---------------------------------------------------------------------------
/**
 * @param {string} scriptText 脚本全文
 * @param {object} ctxVars     额外的沙箱变量（inputs / vars / console …）
 */
function runScript(scriptText, ctxVars) {
    resetCalls();
    spinsBox.value = 0;
    // ⚠️ 自绘界面是**阻塞**等点击的（`while (result === null)`）⇒ 离线测试里必须
    //    「自动点掉」，否则转成死循环（撞 `Thread.sleep` 的保险后报成脚本问题）。
    //    `__androidOpts.autoDismiss === false` 可关掉（给将来要测「点了会怎样」的用例）。
    uiListenerBox.autoDismiss = !(ctxVars.__androidOpts && ctxVars.__androidOpts.autoDismiss === false);
    uiListenerBox.autoDismissIndex = (ctxVars.__androidOpts && typeof ctxVars.__androidOpts.autoDismissIndex === 'number')
        ? ctxVars.__androidOpts.autoDismissIndex
        : -1;

    const sandbox = Object.assign({}, ctxVars);
    sandbox.globalThis = sandbox;

    // console：vFlow 的 JsConsole 会把输出写进工作流日志，这里收进 calls
    sandbox.console = {
        log: (m) => { calls.log.push(String(m)); },
        info: (m) => { calls.log.push(String(m)); },
        warn: (m) => { calls.log.push('[warn] ' + m); },
        error: (m) => { calls.log.push('[error] ' + m); },
        debug: (m) => { calls.log.push(String(m)); }
    };

    installJava(sandbox);
    installAndroid(sandbox, ctxVars.__androidOpts || {});
    installVFlow(sandbox);
    installRhinoGlobals(sandbox, scriptText);

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptText, context, { filename: 'vflow-fluid-cloud.js' });
    // ⚠️ `context` 是**追加**字段（向后兼容：调用方全是解构 `{ sandbox }` / `{ calls }`）。
    //    更新器的离线用例要它 —— 在**同一个沙箱**里 `vm.runInContext(updateText, context)`
    //    才能复现「eval 进主脚本作用域」那个形态（UPDATE.md §7.4 约束 2）。
    return { sandbox, calls, context };
}

module.exports = {
    runScript, calls, resetCalls, ROOT, resetStorage, TEST_STORAGE_ROOT, mapPath,
    // 更新器用例用：请求记录 + 响应配置
    httpBox
};
