#!/usr/bin/env python3
"""把 `workflow/fluid-cloud.json` 送到设备上，并在 App 里**导入**它。

用法：
    python tools/deploy-workflow.py                 # 推文件 + 唤起导入
    python tools/deploy-workflow.py --push-only     # 只推，不唤起（自己在 App 里导入）
    python tools/deploy-workflow.py --no-build      # 跳过刷新步骤
    python tools/deploy-workflow.py --serial XXXX   # 指定设备

## 为什么工作流走「导入」而不是 API

vFlow 远程 API 的 `POST /api/v1/workflows` 用的是 `SimpleCreateWorkflowRequest`，
它**没有** `reentryBehavior` / `silentExecution` / `logLevel` / `cardIconRes` /
`cardThemeColor` 这些字段（`WorkflowModels.kt:47-60`）⇒ 建出来的工作流**永远差一截**，
而且差得**不报错**（表现是「卡片颜色不对」「静默执行没生效」）。

而**导出 / 导入**这条路字段是完整的 —— 2026-10-08 vFlow 侧把四条读写路径
收敛到 `WorkflowJsonCodec`（`core/workflow/WorkflowJsonCodec.kt`）之后，
导出是**反射派生**的（`gson.toJsonTree(workflow)`），模型加字段自动跟随。

⇒ 工作流的**产物 = 一份 JSON 文件**（`workflow/fluid-cloud.json`），
改工作流 = 改这份文件 + 导入回设备。API 那条路已废弃
（旧的 `tools/install-workflows.py` 已删除）。

## ⚠️ 导入会在 App 里弹「冲突」对话框（设计如此，不是 bug）

`ImportQueueProcessor` 发现**同 id 的工作流已存在**时，会弹三选一：
**保留两者 / 替换 / 跳过**。要走「更新」这条路就点**替换**。

⚠️ 这就是为什么本脚本**不能完全无人值守** —— 它把文件送到位并唤起导入，
最后一步（选「替换」）得人来点。刻意不绕过：那是 vFlow 的既有行为，
而绕过它意味着直接改 `SharedPreferences`，那会让 App 内存里的状态与磁盘不一致。

## ⚠️ 为什么用 `am start` 而不是让用户自己去点

`ShareReceiverActivity`（`ui/common/ShareReceiverActivity.kt`）的
`ACTION_VIEW` 分支就是「读 JSON → 导入」的入口，且它的 intent-filter 收
`application/json`。而 vFlow 的 `FileProvider` 暴露了 `/sdcard/vFlow/`
（`res/xml/provider_paths.xml` 的 `external-path name="vflow_storage"`）
⇒ 设备侧**不需要复制文件**，用 `content://` URI 直接指过去即可。

⚠️ `-n` 显式指定组件，不靠隐式匹配 —— 设备上可能有别的 App 也注册了
`application/json` 的 `ACTION_VIEW`，靠隐式匹配会**打开错的应用**。
"""

import argparse
import io
import pathlib
import subprocess
import sys

# ⚠️ Windows 控制台默认 GBK —— 中文会乱码甚至抛 UnicodeEncodeError。
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / "workflow" / "fluid-cloud.json"

# 设备侧路径 —— 与其它产物同处一个目录（规则库 / 完整脚本 / version）。
#
# ⚠️ 必须落在 `/sdcard/vFlow/` **里面** —— FileProvider 只暴露了那一个
#    external-path（`provider_paths.xml`），放到别处 `content://` 就指不过去。
DEVICE_DIR = "/sdcard/vFlow/fluid-cloud"
DEVICE_PATH = DEVICE_DIR + "/fluid-cloud.json"

# FileProvider authority 是 `${applicationId}.provider`（见 AndroidManifest.xml）。
CONTENT_URI = ("content://com.chaomixian.vflow.provider/"
               "vflow_storage/fluid-cloud/fluid-cloud.json")

PACKAGE = "com.chaomixian.vflow"
IMPORT_ACTIVITY = PACKAGE + "/.ui.common.ShareReceiverActivity"


def adb(args, serial=None, check=True):
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += args
    return subprocess.run(cmd, check=check, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", default=None, help="设备 serial（多设备时必须给）")
    ap.add_argument("--no-build", action="store_true",
                    help="不先跑 build-workflow.py（跳过 script/inputs 刷新）")
    ap.add_argument("--push-only", action="store_true",
                    help="只推到设备，不唤起导入")
    args = ap.parse_args()

    if not args.no_build:
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "build-workflow.py")],
                           text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            print("刷新工作流 JSON 失败，终止。", file=sys.stderr)
            sys.exit(r.returncode)

    if not WORKFLOW.exists():
        print("缺少 %s" % WORKFLOW, file=sys.stderr)
        sys.exit(1)

    # ⚠️ `-p` 只对目录有效，这里先建目录。
    adb(["shell", "mkdir", "-p", DEVICE_DIR], args.serial, check=False)

    # ⚠️ 不 `export MSYS_NO_PATHCONV` 的话，Git Bash 会把 `/sdcard/...`
    #    改写成 `D:/Git/sdcard/...`（本项目已实际踩过）。
    #    这里走 subprocess 而不是 shell，MSYS 不介入路径 —— 但仍留个心眼：
    #    `adb push` 的第二个参数是**设备路径**，别加盘符前缀。
    r = adb(["push", str(WORKFLOW), DEVICE_PATH], args.serial, check=False)
    out = (r.stdout or "") + (r.stderr or "")
    # ⚠️ 判据用**退出码**，不用输出文案 —— adb 的 push 文案逐版本在变
    #    （`1 file pushed, 0 skipped. …` / `1 file pushed. …`），
    #    拿文案当判据会在某个版本上突然假红。
    if r.returncode != 0:
        print("adb push 失败（退出码 %d）：\n%s" % (r.returncode, out), file=sys.stderr)
        sys.exit(1)
    print("✓ 已推送 → %s" % DEVICE_PATH)
    if "1 file pushed" not in out:
        # 不是失败，只是文案不认识 —— 打出来让人能核对。
        print("  （adb 输出：%s）" % out.strip().replace("\n", " | "))

    if args.push_only:
        print("\n现在在 vFlow 里导入它：")
        print("  工作流列表 → 右上角菜单 → 导入 → 选 %s" % DEVICE_PATH)
        print("  ⚠️ 提示「冲突」时点【替换】才是更新。")
        return

    # ⚠️ `-t` 必须给 `application/json` —— 否则走不到 `handleJsonFile`
    #    （它会先判 mimeType，不符就当普通分享处理，表现是「什么都没发生」）。
    r = adb(["shell", "am", "start",
             "-a", "android.intent.action.VIEW",
             "-d", CONTENT_URI,
             "-t", "application/json",
             "-n", IMPORT_ACTIVITY], args.serial, check=False)
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    if r.returncode != 0 or "Error" in out or "Exception" in out:
        print("唤起导入失败：\n%s" % out, file=sys.stderr)
        print("\n退回手动方式：在 vFlow 里导入 %s" % DEVICE_PATH, file=sys.stderr)
        sys.exit(1)

    print("✓ 已在设备上唤起导入（%s）" % IMPORT_ACTIVITY)
    print("  ⚠️ 设备上现在应该弹了「冲突」对话框 —— 点【替换】完成更新。")


if __name__ == "__main__":
    main()
