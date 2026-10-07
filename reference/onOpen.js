importClass(org.json.JSONArray);
importClass(org.json.JSONObject);
importClass(org.json.JSONTokener);
importClass(android.os.Handler);
importClass(android.os.Looper);
importPackage(android.view);
importPackage(android.widget);
importPackage(android.content);
importPackage(android.graphics);
importClass(android.graphics.drawable.GradientDrawable);
importClass(android.graphics.PixelFormat);
importClass(android.view.WindowManager);
importClass(java.lang.Runnable);
importClass(java.lang.Thread);
importClass(android.app.ActivityOptions);
importClass(android.graphics.Rect);
importClass(android.graphics.Point);
importClass(android.view.Surface);
importClass(android.app.ActivityManager);
importClass(android.content.pm.PackageManager);
importClass(android.os.UserHandle);
importClass(android.net.Uri);
importClass(Packages.tornaco.apps.shortx.core.proto.action.ShellCommand);
importClass(Packages.tornaco.apps.shortx.core.proto.action.WriteClipboard);
importClass(android.view.Gravity);
importClass(android.view.MotionEvent);
importClass(android.util.DisplayMetrics);
importClass(android.content.Context); importClass(java.io.FileReader);
importClass(java.io.BufferedReader);
importPackage(java.net);
importPackage(java.io);
importPackage(java.lang);
importPackage(java.util.concurrent);
importClass(Packages.tornaco.apps.shortx.core.proto.action.ShowToast);

// GitHub仓库信息全局变量
var GITHUB_OWNER = "nightking8342";
var GITHUB_REPO = "shortx-Fluid_Cloud_Island";
var GITHUB_BRANCH = "main";

function showToast(text) {
    action = ShowToast.newBuilder().setMessage(text).build();
    shortx.executeAction(action);
}

function showCountdownDialogBox(title, text, time) {
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }

    var uiClosed = false;

    runOnUiThread(function () {
        var windowManager = context.getSystemService(Context.WINDOW_SERVICE);
        var metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        var screenWidth = metrics.widthPixels;
        var screenHeight = metrics.heightPixels;

        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.TRANSPARENT);
        var backgroundDrawable = new android.graphics.drawable.GradientDrawable();
        backgroundDrawable.setColor(Color.WHITE);
        backgroundDrawable.setCornerRadius(50);
        layout.setBackground(backgroundDrawable);
        layout.setPadding(40, 40, 40, 40);

        var layoutParams = new WindowManager.LayoutParams(
            parseInt(screenWidth * 0.9),
            parseInt(screenHeight * 0.8),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.CENTER;

        var titleView = new TextView(context);
        titleView.setText(title);
        titleView.setTextSize(22);
        titleView.setTextColor(Color.BLACK);
        titleView.setGravity(Gravity.CENTER);
        titleView.setPadding(0, 0, 0, 20);
        layout.addView(titleView);

        var scrollView = new ScrollView(context);
        var scrollParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1
        );
        scrollView.setLayoutParams(scrollParams);

        var textView = new TextView(context);
        textView.setText(text);
        textView.setTextSize(18);
        textView.setTextColor(Color.DKGRAY);
        textView.setGravity(Gravity.LEFT);
        scrollView.addView(textView);
        layout.addView(scrollView);

        var buttonLayout = new LinearLayout(context);
        buttonLayout.setOrientation(LinearLayout.HORIZONTAL);
        buttonLayout.setGravity(Gravity.CENTER);
        buttonLayout.setPadding(0, 30, 0, 0);
        layout.addView(buttonLayout);

        var closeButton = new Button(context);
        closeButton.setText("下一步");
        closeButton.setTextColor(Color.WHITE);
        closeButton.setEnabled(true);

        function createRoundedDrawable(color) {
            var drawable = new android.graphics.drawable.GradientDrawable();
            drawable.setColor(color);
            drawable.setCornerRadius(30);
            return drawable;
        }
        closeButton.setBackgroundDrawable(createRoundedDrawable(Color.parseColor("#08C661")));

        buttonLayout.addView(closeButton);

        closeButton.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                var writeLocalVar = Packages.tornaco.apps.shortx.core.proto.action.WriteLocalVar.newBuilder()
                    .setVarName("next")
                    .setValueAsString("true")
                    .build();
                shortx.executeAction(writeLocalVar);
                try {
                    windowManager.removeView(layout);
                } catch (e) { }
                uiClosed = true;
            }
        }));

        try {
            windowManager.addView(layout, layoutParams);
        } catch (e) {
            console.log("添加视图失败：" + e);
            uiClosed = true;
        }
    });

    while (!uiClosed) {
        Thread.sleep(200);
    }
}

function httpGet(urlStr) {
    function readStreamAsString(inputStream) {
        var reader = new BufferedReader(new InputStreamReader(inputStream, "UTF-8"));
        var sb = new StringBuilder();
        var line;
        while ((line = reader.readLine()) != null) {
            sb.append(line).append("\n");
        }
        reader.close();
        return sb.toString().trim();
    }

    try {
        var url = new URL(urlStr);
        var conn = url.openConnection();
        conn.setRequestProperty("User-Agent", "Rhino-Script/1.0");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        var code = conn.getResponseCode();
        if (code >= 400) {
            var errStream = conn.getErrorStream();
            var msg = errStream ? readStreamAsString(errStream) : "HTTP " + code;
            throw new Error("HTTP " + code + ": " + msg);
        }
        return readStreamAsString(conn.getInputStream());
    } catch (e) {
        throw new Error("请求失败: " + urlStr + " -> " + (e.javaException ? e.javaException.getMessage() : e));
    }
}

function downloadAndExecuteUpdate() {
    try {
        var updateUrl = "https://raw.githubusercontent.com/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/" + GITHUB_BRANCH + "/update.js";
        var updateScript = httpGet(updateUrl);
        // 创建一个包装函数，将变量显式赋给全局对象
        var wrappedScript =
            "(function() {" +
            updateScript +
            "}).call(this);"; // 使用 call(this) 确保在全局作用域执行
        eval(wrappedScript);
        return true;
    } catch (e) {
        console.log("下载或执行update.js失败: " + e);
        showCountdownDialogBox(
            "无法执行更新脚本",
            "错误: " + e.message,
            3
        );
        return false;
    }
}
// 主执行逻辑
showCountdownDialogBox(
    "使用说明",
    `    0.此指令为自定义UI指令，稳定性与兼容性远不及预制动作制作的指令，如若出现软重启，死机等问题说明你的系统与指令不适配，为确保您的数据安全，请立即停止使用。更新指令与shortx时可能会清理配置，如有自定义的配置，请在更新前做好配置备份，如更新后因配置文件被清理而无法使用，重新开关指令会重新创建默认配置，同时欢迎提交用于各个app的规则（前往简介处GitHub仓库提交pr）
    
    1.小窗打开功能需要没有中转层才可正常使用（如：空浏览,UrlCheck,其他浏览器打开等），部分应用可能强制挣脱小窗需求，ColorOS无法使用始终全屏打开时需在指令参数出将小窗参数的值从5改为100(coloros识别机制为oplus应用低版本coloros下可能不存在)，如你正在使用请在设置中手动配置浏览器
    
    2.选中提取功能可能需要手动重命名并选择一下上下文菜单触发器
    
    3.流体云单击全屏打开，点击按钮使用小窗打开，顶部时上滑关闭下滑进菜单，底部时上滑进菜单，下滑关闭
    
    4.配置文件解释：见配置文件内顶部区域
    
    5.点击指令的图标，点击执行动作进入图形化配置页面
    
    6.安装附加插件实现点击链接交由指令分发
    
    7.配置文件目录：/data/system/shortx*/data/Fluid_Cloud_Island
    8.点击下一步后将从GitHub获取在线规则，请确保网络环境可正常连接到GitHub，重新开启指令可更新云端规则`,
    5
);

// 尝试下载并执行update.js
downloadAndExecuteUpdate();