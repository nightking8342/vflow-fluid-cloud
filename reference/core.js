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
importClass(android.content.Context);
importClass(java.io.FileReader);
importClass(java.io.BufferedReader);
importClass(Packages.tornaco.apps.shortx.core.proto.action.ShowToast);
importClass(android.os.ServiceManager);
importClass(android.content.pm.IPackageManager$Stub);
var windowManager = context.getSystemService(Context.WINDOW_SERVICE);
var metrics = new DisplayMetrics();
windowManager.getDefaultDisplay().getMetrics(metrics);
var screenWidth = metrics.widthPixels;
var screenHeight = metrics.heightPixels;

/**
 * 获取屏幕真实尺寸（自然方向）
 * @returns {String} 格式为"宽X高"的屏幕尺寸字符串
 */
function getNaturalScreenSize() {
    try {
        var context = android.app.ActivityThread.currentApplication().getApplicationContext();
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var display = wm.getDefaultDisplay();
        var point = new Point();
        display.getRealSize(point);
        
        // 获取物理尺寸，不受旋转影响（取宽高的最小值作为宽，最大值作为高）
        var naturalWidth = Math.min(point.x, point.y);
        var naturalHeight = Math.max(point.x, point.y);
        
        return naturalWidth + "X" + naturalHeight;
    } catch (e) {
        // 异常情况下返回默认值
        return "1080X1920";
    }
}


function getForegroundAppPackageName() {
    var am = context.getSystemService(Context.ACTIVITY_SERVICE);
    var runningAppProcesses = am.getRunningAppProcesses();
    if (runningAppProcesses != null) {
        for (var i = 0; i < runningAppProcesses.size(); i++) {
            var processInfo = runningAppProcesses.get(i);
            if (processInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return String(processInfo.pkgList[0]);
            }
        }
    }
    return null;
}

function ToBoolean(str) {
    return String(str).toLowerCase() === "true";
}
function showToast(text) {
    if (show_toast) {
        action = ShowToast.newBuilder().setMessage(text).build();
        shortx.executeAction(action);
    }
}





function readJsonFile(filePath) {
    try {
        var reader = new BufferedReader(new FileReader(filePath));
        var sb = new java.lang.StringBuilder();
        var line;
        var start = false;

        while ((line = reader.readLine()) != null) {
            var trimmed = line.trim();
            if (!start) {
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    start = true;
                } else {
                    continue;
                }
            }
            sb.append(line);
        }
        reader.close();

        var jsonText = String(sb.toString());
        return JSON.parse(jsonText);
    } catch (e) {
        throw new Error("配置文件读取失败：" + e.message);
    }
}


var config = readJsonFile(ShortX_Path + "/data/Fluid_Cloud_Island/config.json")


function writeConfigToFile(filePath, config, Remarks) {
    try {
        var writer = new java.io.FileWriter(filePath);
        var bufferedWriter = new java.io.BufferedWriter(writer);
        var jsonString = JSON.stringify(config, null, 2);
        bufferedWriter.write(Remarks + jsonString);

        bufferedWriter.close();
    } catch (e) { showToast("配置保存失败") }
}


function showStringListEditor(defaultValues, listname, callback) {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 40, 40, 40);
        layout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));
        var title = new TextView(context);
        title.setText(listname);
        title.setTextColor(android.graphics.Color.WHITE);
        title.setTextSize(20);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 30);
        layout.addView(title);
        var scrollView = new ScrollView(context);
        var scrollParams = new LinearLayout.LayoutParams(-1, dip2px(400));
        scrollView.setLayoutParams(scrollParams);
        var container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(0, 10, 0, 10);
        scrollView.addView(container);
        layout.addView(scrollView);
        var inputItems = [];
        function addInputItem(text) {
            var itemLayout = new LinearLayout(context);
            itemLayout.setOrientation(LinearLayout.HORIZONTAL);
            itemLayout.setPadding(0, 10, 0, 10);
            var et = new EditText(context);
            et.setText(text || "");
            et.setTextColor(android.graphics.Color.WHITE);
            et.setHintTextColor(android.graphics.Color.GRAY);
            et.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
            et.setPadding(20, 20, 20, 20);
            et.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            et.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
            var delBtn = new TextView(context);
            delBtn.setText("✕");
            delBtn.setTextSize(18);
            delBtn.setTextColor(android.graphics.Color.LTGRAY);
            delBtn.setPadding(30, 20, 30, 20);
            delBtn.setGravity(android.view.Gravity.CENTER);

            delBtn.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    container.removeView(itemLayout);
                    inputItems = inputItems.filter(function (item) {
                        return item !== et;
                    });
                }
            }));
            itemLayout.addView(et);
            itemLayout.addView(delBtn);
            container.addView(itemLayout);
            inputItems.push(et);
        }
        for (var i = 0; i < defaultValues.length; i++) {
            addInputItem(defaultValues[i]);
        }
        var addBtn = new TextView(context);
        addBtn.setText("＋ 新建");
        addBtn.setTextSize(16);
        addBtn.setTextColor(android.graphics.Color.WHITE);
        addBtn.setPadding(20, 20, 20, 20);
        addBtn.setGravity(android.view.Gravity.CENTER);
        var addBg = new android.graphics.drawable.GradientDrawable();
        addBg.setColor(android.graphics.Color.parseColor("#3344FF44"));
        addBg.setCornerRadius(20);
        addBtn.setBackground(addBg);
        var addParams = new LinearLayout.LayoutParams(-1, -2);
        addParams.setMargins(0, 30, 0, 10);
        addBtn.setLayoutParams(addParams);
        addBtn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                addInputItem("");
            }
        }));
        layout.addView(addBtn);
        var confirmBtn = new TextView(context);
        confirmBtn.setText("✔ 确认");
        confirmBtn.setTextSize(16);
        confirmBtn.setTextColor(android.graphics.Color.WHITE);
        confirmBtn.setPadding(30, 20, 30, 20);
        confirmBtn.setGravity(android.view.Gravity.CENTER);

        var confirmBg = new android.graphics.drawable.GradientDrawable();
        confirmBg.setColor(android.graphics.Color.parseColor("#4466CCFF"));
        confirmBg.setCornerRadius(30);
        confirmBtn.setBackground(confirmBg);
        var confirmParams = new LinearLayout.LayoutParams(-1, -2);
        confirmParams.setMargins(0, 10, 0, 0);
        confirmBtn.setLayoutParams(confirmParams);
        confirmBtn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = [];
                for (var i = 0; i < inputItems.length; i++) {
                    result.push(String(inputItems[i].getText()));
                }
                try { wm.removeView(layout); } catch (e) { }
                if (callback) {
                    callback(result);
                }
            }
        }));
        layout.addView(confirmBtn);
        var params = new android.view.WindowManager.LayoutParams(
            dip2px(360), -2,
            android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = android.view.Gravity.TOP;
        wm.addView(layout, params);
        layout.post(function () {
            params.flags = params.flags & ~android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            wm.updateViewLayout(layout, params);

            if (inputItems.length > 0) {
                inputItems[0].requestFocus();
                var imm = context.getSystemService(Context.INPUT_METHOD_SERVICE);
                imm.showSoftInput(inputItems[0], android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
            }
        });
    });
    function dip2px(dp) {
        var scale = context.getResources().getDisplayMetrics().density;
        return Math.floor(dp * scale + 0.7);
    }
}
function getScreenWidth(context) {
    var metrics = new DisplayMetrics();
    var wm = context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getMetrics(metrics);
    return String(metrics.widthPixels);
}
function showsettingsui() {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        try {
            wm = context.getSystemService(Context.WINDOW_SERVICE);
            var outerLayout = new LinearLayout(context);
            outerLayout.setOrientation(LinearLayout.VERTICAL);
            outerLayout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));
            outerLayout.setPadding(40, 40, 40, 40);
            var titleView = new TextView(context);
            titleView.setText("指令设置");
            titleView.setTextSize(20);
            titleView.setTypeface(null, android.graphics.Typeface.BOLD);
            titleView.setTextColor(android.graphics.Color.WHITE);
            titleView.setGravity(android.view.Gravity.CENTER);
            titleView.setPadding(0, 0, 0, 30);
            outerLayout.addView(titleView);
            var scrollView = new ScrollView(context);
            scrollView.setFillViewport(true);
            scrollView.setLayoutParams(new LinearLayout.LayoutParams(-1, 0, 1));
            var scrollContent = new LinearLayout(context);
            scrollContent.setOrientation(LinearLayout.VERTICAL);
            scrollContent.setPadding(0, 0, 0, 0);
            scrollView.addView(scrollContent);
            outerLayout.addView(scrollView);
            var menuTitles = [
                "编辑顶级域名列表",
                "编辑电子邮箱列表",
                "编辑仅HTTPS可用列表",
                "编辑提取码关键词列表",
                "编辑黑名单关键词列表",
                "浏览器黑名单列表"
            ];

            for (var i = 0; i < menuTitles.length; i++) {
                var menuLayout = new LinearLayout(context);
                menuLayout.setOrientation(LinearLayout.HORIZONTAL);
                menuLayout.setGravity(android.view.Gravity.CENTER_VERTICAL);

                var menuText = new TextView(context);
                menuText.setText(menuTitles[i]);
                menuText.setTextSize(16);
                menuText.setTextColor(android.graphics.Color.WHITE);
                menuText.setTypeface(null, android.graphics.Typeface.BOLD);
                menuText.setPadding(20, 20, 20, 20);
                menuText.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
                var arrow = new TextView(context);
                arrow.setText("＞");
                arrow.setTextSize(20);
                arrow.setTextColor(android.graphics.Color.LTGRAY);
                arrow.setPadding(0, 20, 20, 20);
                menuLayout.addView(menuText);
                menuLayout.addView(arrow);
                var menuBg = new android.graphics.drawable.GradientDrawable();
                menuBg.setColor(android.graphics.Color.parseColor("#33FFFFFF"));
                menuBg.setCornerRadius(20);
                menuLayout.setBackground(menuBg);
                var menuParams = new LinearLayout.LayoutParams(-1, -2);
                menuParams.setMargins(0, 10, 0, 10);
                menuLayout.setLayoutParams(menuParams);
                scrollContent.addView(menuLayout);
                (function (index) {
                    menuLayout.setOnClickListener(new View.OnClickListener({
                        onClick: function () {
                            try { wm.removeView(outerLayout); } catch (e) { }
                            var listData = [
                                config.Top_Level_Domain,
                                config.Email_Keyword_List,
                                config.Use_https_keyword_list,
                                config.Extractioncode_Keyword_list,
                                config.link_blacklist_keywords,
                                config.Browser_PackageName_BlackList
                            ];
                            new Handler(Looper.getMainLooper()).post(new Runnable({
                                run: function () {
                                    showStringListEditor(listData[index], menuTitles[index], function (res) {
                                        if (index === 0) config.Top_Level_Domain = res;
                                        else if (index === 1) config.Email_Keyword_List = res;
                                        else if (index === 2) config.Use_https_keyword_list = res;
                                        else if (index === 3) config.Extractioncode_Keyword_list = res;
                                        else if (index === 4) config.link_blacklist_keywords = res;
                                        else if (index === 5) config.Browser_PackageName_BlackList = res;
                                        showsettingsui();
                                    });
                                }
                            }));
                        }
                    }));
                })(i);
            }
            var inputs = [];
            var messagelist = [
                "小窗配置：\n竖屏高度",
                "横屏高度",
                "宽高比",
                "竖屏左侧留空",
                "横屏左侧留空",
                "竖屏上侧留空",
                "横屏上侧留空",
                "小窗参数",
                "流体云配置：\n流体云位置(顶部/底部)",
                "流体云位置偏移(上减下加)",
                "流体云显示超时(ms)",
                "其他：\n浏览器(自动/包名)",
                "允许出现在链接中的字符",
                "显示多用户",
                "显示吐司提示",
                "附加插件动作(询问/小窗打开/全屏打开)",
                "使用超级岛通知(true/false)",
                "开启下拉小窗(true/false)"
            ];
            // 获取当前屏幕尺寸配置
            var screenSize = getNaturalScreenSize();
            var windowConfig = [1200, 1100, 0.6, 200, 150, 400, 80]; // 默认配置
            
            // 确保Window_Configuration是对象格式
            if (typeof config.Window_Configuration !== 'object' || config.Window_Configuration === null || Array.isArray(config.Window_Configuration)) {
                config.Window_Configuration = {};
            } else {
                // 尝试获取当前屏幕尺寸的配置
                if (config.Window_Configuration[screenSize] && Array.isArray(config.Window_Configuration[screenSize]) && config.Window_Configuration[screenSize].length === 7) {
                    windowConfig = config.Window_Configuration[screenSize];
                }
            }
            
            var defaultValues = windowConfig.concat([config.Launch_Windowing_Mode, config.Fluid_Cloud_Position, config.Fluid_Cloud_Position_Offset, config.Fluid_Cloud_timeout, config.browser, config.allowChar, config.show_Multiple_users, config.show_toast, config.extra_default_action, config.use_islandNotification || true, config.pull_small_window || true]);
            var firstInput = null;

            for (var i = 0; i < messagelist.length; i++) {
                var label = new TextView(context);
                label.setText(messagelist[i]);
                label.setTextColor(android.graphics.Color.LTGRAY);
                label.setPadding(10, 15, 10, 5);
                scrollContent.addView(label);
                var et = new EditText(context);
                et.setHint("请输入内容");
                et.setText(String(defaultValues[i]));
                et.setTextColor(android.graphics.Color.WHITE);
                et.setHintTextColor(android.graphics.Color.GRAY);
                et.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
                et.setPadding(20, 20, 20, 20);
                et.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
                et.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
                scrollContent.addView(et);
                inputs.push(et);
                if (i === 0) firstInput = et;
            }
            var confirmBtn = new TextView(context);
            confirmBtn.setText("确定");
            confirmBtn.setTextSize(16);
            confirmBtn.setTextColor(android.graphics.Color.WHITE);
            confirmBtn.setGravity(android.view.Gravity.CENTER);
            confirmBtn.setPadding(30, 20, 30, 20);
            var btnBg = new android.graphics.drawable.GradientDrawable();
            btnBg.setColor(android.graphics.Color.parseColor("#44FFFFFF"));
            btnBg.setCornerRadius(30);
            confirmBtn.setBackground(btnBg);
            var btnParams = new LinearLayout.LayoutParams(-2, -2);
            btnParams.gravity = android.view.Gravity.END;
            btnParams.setMargins(0, 30, 0, 0);
            confirmBtn.setLayoutParams(btnParams);
            outerLayout.addView(confirmBtn);
            confirmBtn.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    result = [];
                    for (var i = 0; i < inputs.length; i++) {
                        result.push(String(inputs[i].getText()));
                    }
                    // 获取当前屏幕尺寸
                    var screenSize = getNaturalScreenSize();
                    
                    // 确保Window_Configuration是对象格式
                    if (typeof config.Window_Configuration !== 'object' || config.Window_Configuration === null || Array.isArray(config.Window_Configuration)) {
                        config.Window_Configuration = {};
                    }
                    
                    // 保存当前屏幕尺寸的配置
                    config.Window_Configuration[screenSize] = [
                        parseInt(result[0]),
                        parseInt(result[1]),
                        parseFloat(result[2]),
                        parseInt(result[3]),
                        parseInt(result[4]),
                        parseInt(result[5]),
                        parseInt(result[6])];
                    config.Launch_Windowing_Mode = parseInt(result[7]);
                    config.Fluid_Cloud_Position = result[8];
                    config.Fluid_Cloud_Position_Offset = parseInt(result[9]);
                    config.Fluid_Cloud_timeout = parseInt(result[10]);
                    config.browser = result[11];
                    config.allowChar = result[12];
                    config.show_Multiple_users = ToBoolean(result[13]);
                    config.show_toast = ToBoolean(result[14]);
                    config.extra_default_action = result[15];
                    config.use_islandNotification = ToBoolean(result[16]);
                    config.pull_small_window = ToBoolean(result[17]);
                    var configPath = ShortX_Path + "/data/Fluid_Cloud_Island/config.json";
                    writeConfigToFile(configPath, config, "一.配置版本：\n1.5\n二.字段解释：\nTop_Level_Domain：顶级域名列表\nEmail_Keyword_List：邮箱关键词列表\nExtractioncode_Keyword_list：提取码关键词列表\nUse_https_keyword_list：仅https可用的链接关键词列表（链接无请求头时使用）\nlink_blacklist_keywords：链接黑名单关键词列表(注意是链接内的关键词，不是包名)\nWindow_Configuration:小窗的大小与位置配置，从左到右依次为竖屏高度 横屏高度 宽高比 竖屏左侧留空 横屏左侧留空 竖屏上侧留空 横屏上侧留空\nLaunch_Windowing_Mode：可触发小窗的Windowsmode值，coloros为100(会自动识别，旧版本可能不能识别需要修改为100)，米，类原生为5\nFluid_Cloud_Position：流体云显示位置（顶部，底部）\nFluid_Cloud_Position_Offset:流体云位置偏移(向上偏移减小值向下偏移增加值)\nFluid_Cloud_timeout：流体云显示超时时长，超过设定毫秒数无动作浮窗消失\nbrowser:浏览器包名(填自动表示自动识别)\nBrowser_PackageName_BlackList：浏览器黑名单，识别到的默认浏览器在黑名单内时会重新寻找其他的浏览器\nallowChar:允许出现在链接中的字符\nshow_Multiple_users:显示多用户应用（true 开启/false 关闭）\nshow_toast:是否显示吐司提示(true 显示/false 不显示)\n\n三.配置：\n");
                    try { wm.removeView(outerLayout); } catch (e) { }
                }
            }));
            var params = new android.view.WindowManager.LayoutParams(
                parseInt(screenWidth * 0.9), parseInt(screenHeight * 0.6),
                android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                android.graphics.PixelFormat.TRANSLUCENT
            );
            params.gravity = android.view.Gravity.TOP;
            wm.addView(outerLayout, params);
        } catch (e) { }
    });
}
function showFileEditorUI(filePath) {
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);

        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 40, 40, 40);
        layout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));

        var title = new TextView(context);
        title.setText("规则编辑器(规则在下面)");
        title.setTextSize(20);
        title.setTextColor(android.graphics.Color.WHITE);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 30);
        layout.addView(title);
        var scrollView = new ScrollView(context);
        var scrollParams = new LinearLayout.LayoutParams(-1, dip2px(400));
        scrollView.setLayoutParams(scrollParams);
        var input = new EditText(context);
        input.setTextColor(android.graphics.Color.WHITE);
        input.setHint("请输入内容...");
        input.setHintTextColor(android.graphics.Color.GRAY);
        input.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
        input.setPadding(20, 20, 20, 20);
        input.setMinHeight(dip2px(300));
        input.setGravity(android.view.Gravity.TOP);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setSingleLine(false);
        input.setHorizontallyScrolling(false);
        try {
            var f = new java.io.File(filePath);
            if (f.exists()) {
                var br = new java.io.BufferedReader(new java.io.FileReader(f));
                var sb = new java.lang.StringBuilder();
                var line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                br.close();
                input.setText(sb.toString());
            }
        } catch (e) {
            input.setText("");
        }
        scrollView.addView(input);
        layout.addView(scrollView);
        var btnLayout = new LinearLayout(context);
        btnLayout.setOrientation(LinearLayout.HORIZONTAL);
        btnLayout.setGravity(android.view.Gravity.END);
        function makeBtn(text, bgColor, callback) {
            var btn = new TextView(context);
            btn.setText(text);
            btn.setTextColor(android.graphics.Color.WHITE);
            btn.setTextSize(16);
            btn.setPadding(40, 20, 40, 20);
            btn.setGravity(android.view.Gravity.CENTER);
            var bg = new android.graphics.drawable.GradientDrawable();
            bg.setColor(android.graphics.Color.parseColor(bgColor));
            bg.setCornerRadius(20);
            btn.setBackground(bg);
            btn.setOnClickListener(new View.OnClickListener({ onClick: callback }));
            var params = new LinearLayout.LayoutParams(-2, -2);
            params.setMargins(20, 40, 0, 0);
            btn.setLayoutParams(params);
            return btn;
        }
        var cancelBtn = makeBtn("取消", "#FF555555", function () {
            try { wm.removeView(layout); } catch (e) { }
        });
        var saveBtn = makeBtn("保存", "#FF3399FF", function () {
            try {
                var writer = new java.io.FileWriter(filePath, false);
                writer.write(String(input.getText()));
                writer.close();
            } catch (e) { showToast("保存失败") }
            try { wm.removeView(layout); } catch (e) { console.log("移除识图时出现错误：" + e.message) }
        });
        btnLayout.addView(cancelBtn);
        btnLayout.addView(saveBtn);
        layout.addView(btnLayout);
        var params = new android.view.WindowManager.LayoutParams(
            dip2px(360), -2,
            android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = android.view.Gravity.TOP;
        wm.addView(layout, params);
        layout.post(function () {
            params.flags = params.flags & ~android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            wm.updateViewLayout(layout, params);
            input.requestFocus();
            var imm = context.getSystemService(Context.INPUT_METHOD_SERVICE);
            imm.showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });
    });
    function dip2px(dp) {
        var scale = context.getResources().getDisplayMetrics().density;
        return Math.floor(dp * scale + 0.5);
    }
}


function getOpenApps(url, userId) {
    var intent = new Intent(Intent.ACTION_VIEW);
    intent.setData(Uri.parse(url));
    var type = null;
    var flags = PackageManager.MATCH_DEFAULT_ONLY;
    try {
        var binder = ServiceManager.getService("package");
        var iPm = IPackageManager$Stub.asInterface(binder);
        var resolveListSlice = iPm.queryIntentActivities(intent, type, flags, userId);
        var resolveList = resolveListSlice.getList();
        var packages = [];
        for (var i = 0; i < resolveList.size(); i++) {
            var resolveInfo = resolveList.get(i);
            if (resolveInfo.activityInfo != null) {
                var pkg = resolveInfo.activityInfo.packageName;
                if (pkg !== RealDefaultBrowser) {
                    packages.push(String(pkg));
                }
            }
        }
        if (packages.length === 0 && RealDefaultBrowser != null) {
            packages.push(String(defaultBrowser));
        }
        return packages;
    } catch (e) {
        console.log("获取用户 " + userId + " 的可打开应用失败: " + e);
        return [String(defaultBrowser)];
    }
}

function getScreenWidth(context) {
    var metrics = new DisplayMetrics();
    var wm = context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getMetrics(metrics);
    return String(metrics.widthPixels);
}

function findbrowser() {
    var pm = context.getPackageManager();
    var apps = pm.getInstalledApplications(0);
    var testUri = Uri.parse("http://www.example.com");
    for (var i = 0; i < apps.size(); i++) {
        var pkg = apps.get(i).packageName;
        var intent = new Intent(Intent.ACTION_VIEW, testUri);
        intent.setPackage(pkg);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        var resolvedActivity = pm.resolveActivity(intent, 0);

        if (resolvedActivity != null && resolvedActivity.activityInfo != null && !Browser_PackageName_BlackList.includes(String(pkg))) {
            return String(pkg);
        }
    }
    return false;
}

function getDefaultBrowserPackageName(context) {
    var intent = new Intent(Intent.ACTION_VIEW);
    intent.setData(Uri.parse("http://"));
    var pm = context.getPackageManager();
    var resolveInfo = pm.resolveActivity(intent, 65536);

    if (resolveInfo != null && resolveInfo.activityInfo != null) {
        var browserPackageName = String(resolveInfo.activityInfo.packageName);
        if (Browser_PackageName_BlackList.includes(browserPackageName)) {
            browserPackageName = findbrowser();
            if (browserPackageName === false) {
                throw new Error("默认浏览器未设置且未找到浏览器，请前往设置中设置默认浏览器");
            } else {
                return browserPackageName;
            }
        } else {
            return browserPackageName;
        }
    } else {
        var browserPackageName = findbrowser();
        if (browserPackageName === false) {
            throw new Error("默认浏览器未设置且未找到浏览器，请前往设置中设置默认浏览器");
        } else {
            return browserPackageName;
        }
    }
}


function showFloatingPrompt(opts) {
    var result = null;
    var timeout = opts.timeout || 3000;

    var useNotification = config.use_islandNotification || false;

    if (useNotification) {
        return showIslandNotification(opts, result, timeout);
    } else {
        // 否则显示浮窗提示
       return showFluidCloud(opts, result, timeout);
    }
}

function showFluidCloud(opts, result, timeout) {
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var pm = context.getPackageManager();
        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setPadding(30, 30, 30, 30);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        var bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#DD1F1F1F"));
        bg.setCornerRadius(60);
        layout.setBackground(bg);
        var iconView = new ImageView(context);
        var iconSize = 130;
        var iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
        iconParams.setMargins(0, 0, 30, 0);
        iconView.setLayoutParams(iconParams);
        try {
            var userId = opts.userId || 0;
            var userHandle = UserHandle.of(userId);
            var userContext = context.createPackageContextAsUser(opts.pkg, 0, userHandle);
            var userPm = userContext.getPackageManager();
            var icon = userPm.getApplicationIcon(opts.pkg);
            iconView.setImageDrawable(icon);
        } catch (e) {
            console.log("获取图标失败: " + e);
            iconView.setImageResource(android.R.drawable.sym_def_app_icon);
        }
        layout.addView(iconView);
        var textLayout = new LinearLayout(context);
        textLayout.setOrientation(LinearLayout.VERTICAL);
        textLayout.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        var title = new TextView(context);
        title.setText(opts.title || "打开应用");
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setTextColor(Color.WHITE);
        var subtitle = new TextView(context);
        subtitle.setText(opts.subtitle || "");
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.LTGRAY);
        textLayout.addView(title);
        textLayout.addView(subtitle);
        layout.addView(textLayout);
        var btn = new TextView(context);
        btn.setText(opts.buttonText || "浮窗打开");
        btn.setTextSize(14);
        btn.setTextColor(Color.WHITE);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(30, 20, 30, 20);
        var btnBg = new GradientDrawable();
        btnBg.setColor(Color.parseColor("#44FFFFFF"));
        btnBg.setCornerRadius(60);
        btn.setBackground(btnBg);
        var btnParams = new LinearLayout.LayoutParams(-2, -2);
        btnParams.setMargins(30, 0, 0, 0);
        btn.setLayoutParams(btnParams);
        layout.addView(btn);
        layout.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = opts.resultOnClick || "click";
                try { wm.removeView(layout); } catch (e) { }
            }
        }));
        btn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = opts.resultOnButton || "button";
                try { wm.removeView(layout); } catch (e) { }
            }
        }));
        var downY = 0;
        layout.setOnTouchListener(new View.OnTouchListener({
            onTouch: function (v, event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downY = event.getRawY();
                        return false;
                    case MotionEvent.ACTION_UP:
                        var upY = event.getRawY();
                        if (downY - upY > 100) {
                            result = opts.resultOnSwipe || "swipe_close";
                            try { wm.removeView(layout); } catch (e) { }
                            return true;
                        } else if (upY - downY > 100) {
                            result = opts.resultOnSwipeDown || "swipe_down";
                            try { wm.removeView(layout); } catch (e) { }
                            return true;
                        }
                        return false;
                }
                return false;
            }
        }));
        var params = new WindowManager.LayoutParams(
            parseInt(getScreenWidth(context) * 0.9), -2,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = opts.gravity || (Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        params.x = opts.x || 0;
        params.y = opts.y || 150;
        wm.addView(layout, params);

        new Thread(new Runnable({
            run: function () {
                Thread.sleep(timeout);
                runOnUiThread(function () {
                    if (result === null) {
                        result = opts.resultOnTimeout || "timeout";
                        try { wm.removeView(layout); } catch (e) { }
                    }
                });
            }
        })).start();
    });
    while (result === null) {
        Thread.sleep(150);
    }
    return result;
}


function showOptionsDialog(options, titleText) {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var pm = context.getPackageManager();
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var layout = new FrameLayout(context);
        var isDarkMode = (context.getResources().getConfiguration().uiMode
            & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
            === android.content.res.Configuration.UI_MODE_NIGHT_YES;
        var shape = new GradientDrawable();
        var backgroundColor = isDarkMode ? "#343434" : "#FAFAFA";
        var textColor = isDarkMode ? Color.WHITE : Color.BLACK;
        shape.setColor(Color.parseColor(backgroundColor));
        shape.setCornerRadius(30);
        if (!isDarkMode) shape.setStroke(2, Color.parseColor("#22000000"));
        layout.setBackground(shape);
        var displayMetrics = context.getResources().getDisplayMetrics();
        var maxWidth = displayMetrics.widthPixels * 0.8;
        var maxHeight = displayMetrics.heightPixels * 0.6;
        var params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.CENTER;
        params.width = maxWidth;
        var scrollView = new ScrollView(context);
        var scrollParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        scrollView.setLayoutParams(scrollParams);
        var container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        var titleView = new TextView(context);
        titleView.setText(titleText || "请选择");
        titleView.setTextSize(20);
        titleView.setTextColor(textColor);
        titleView.setGravity(Gravity.CENTER);
        titleView.setTypeface(null, android.graphics.Typeface.BOLD);
        titleView.setPadding(40, 40, 40, 20);
        container.addView(titleView);

        scrollView.addView(container);
        layout.addView(scrollView);

        scrollView.post(new Runnable({
            run: function () {
                if (scrollView.getHeight() > maxHeight) {
                    var newParams = scrollView.getLayoutParams();
                    newParams.height = maxHeight;
                    scrollView.setLayoutParams(newParams);
                }
            }
        }));
        function makeOptionView(item) {
            if (typeof item === "string") {
                var simpleLayout = new LinearLayout(context);
                simpleLayout.setOrientation(LinearLayout.VERTICAL);
                simpleLayout.setPadding(30, 30, 30, 30);
                var labelView = new TextView(context);
                labelView.setText(item);
                labelView.setTextSize(16);
                labelView.setTextColor(textColor);
                simpleLayout.addView(labelView);

                simpleLayout.setOnClickListener(new View.OnClickListener({
                    onClick: function () {
                        result = item;
                        try { wm.removeView(layout); } catch (e) { }
                    }
                }));
                return simpleLayout;
            }
            var itemLayout = new LinearLayout(context);
            itemLayout.setOrientation(LinearLayout.HORIZONTAL);
            itemLayout.setPadding(30, 30, 30, 30);
            itemLayout.setGravity(Gravity.CENTER_VERTICAL);

            var iconView = new ImageView(context);
            var iconSize = 96;
            var iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
            iconParams.setMargins(0, 0, 30, 0);
            iconView.setLayoutParams(iconParams);
            if (item.pkg) {
                try {
                    var userId = item.userId || 0;
                    var userHandle = UserHandle.of(userId);
                    var userContext = context.createPackageContextAsUser(item.pkg, 0, userHandle);
                    var userPm = userContext.getPackageManager();
                    var icon = userPm.getApplicationIcon(item.pkg);
                    iconView.setImageDrawable(icon);
                } catch (e) {
                    console.log("获取图标失败: " + e);
                    iconView.setImageResource(android.R.drawable.sym_def_app_icon);
                }
                itemLayout.addView(iconView);
            } else if (item.icon) {
                var emoji = new TextView(context);
                emoji.setText(item.icon);
                emoji.setTextSize(20);
                emoji.setLayoutParams(iconParams);
                itemLayout.addView(emoji);
            } else {
                iconView.setImageResource(android.R.drawable.sym_def_app_icon);
                itemLayout.addView(iconView);
            }

            var textLayout = new LinearLayout(context);
            textLayout.setOrientation(LinearLayout.VERTICAL);

            var title = new TextView(context);
            title.setText(item.label || item.value || "未命名");
            title.setTextSize(16);
            title.setTextColor(textColor);
            var desc = new TextView(context);
            desc.setText(item.desc || "");
            desc.setTextSize(13);
            desc.setTextColor(isDarkMode ? Color.LTGRAY : Color.DKGRAY);

            textLayout.addView(title);
            textLayout.addView(desc);
            itemLayout.addView(textLayout);

            itemLayout.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    result = item.value;
                    try { wm.removeView(layout); } catch (e) { }
                }
            }));
            return itemLayout;
        }
        for (var i = 0; i < options.length; i++) {
            container.addView(makeOptionView(options[i]));
        }
        try {
            wm.addView(layout, params);
        } catch (e) {
            result = null;
        }
    });
    while (result === null) {
        Thread.sleep(150);
    }
    return result;
}


function RecordCopiedText(CopiedText) {
    writeConfigToFile(ShortX_Path + "/data/Fluid_Cloud_Island/recordcopy.json", { "CopiedText": CopiedText }, "");
}


function removeRequestHead(link) {
    var r = link.replace("http://", "").replace("https://", "");
    r = r.split(" ")[0];
    return r;
}


function Compare(a, output) {
    for (var i = 0; i < output.length; i++) {
        if (removeRequestHead(output[i]) === removeRequestHead(a)) {
            return false;
        }
    }
    return true;
}


function where(list, value_to_find) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
        if (removeRequestHead(list[i]) === removeRequestHead(value_to_find)) {
            result.push(i);
        }
    }
    return result;
}


function RollBackToFind(list, value_to_find, list_to_find, cleanCode) {
    var indices = where(list, value_to_find);
    for (var i = 0; i < indices.length; i++) {
        var pos = indices[i];
        for (var j = pos - 1; j >= 0; j--) {
            if (!Compare(list[j], list_to_find)) {
                if (list[j].split(" ").length < 2) {
                    var ExtractionCode = cleanCode;
                    if (!ExtractionCode || ExtractionCode === "") {
                        ExtractionCode = list[pos + 1].replace(/[^a-zA-Z0-9]/g, "");
                    }
                    var outputIndices = where(list_to_find, list[j]);
                    if (outputIndices.length > 0) {
                        if (!list_to_find[outputIndices[0]].includes("提取码:")) {
                            list_to_find[outputIndices[0]] = list[j] + " 提取码:" + ExtractionCode;
                        } else {
                            list_to_find.push(String(list[j] + " 提取码:" + ExtractionCode));
                        }
                        break;
                    }
                }
            }
        }
    }
}


function removeDisallowedChar(text, allowchar) {
    var escapedAllowChar = allowchar.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
    var allowRegex = new RegExp('[^' + escapedAllowChar.split('').join('') + ']', 'g');
    for (var i = 0; i < Extractioncode_Keyword_list.length; i++) {
        text = text.replace(new RegExp(Extractioncode_Keyword_list[i], "g"), " Extractioncode:");
    }
    text = text.replace(/\[[^\]]*\]/g, "").trim();
    text = text.replace(allowRegex, '');
    return text.trim();
}


function ScreeningParagraphs(a) {
    a = a.replace(/http:\/\//g, " http://").replace(/https:\/\//g, " https://");
    var Paragraph = a.split(/\n|,|，|；|;|\s+/);
    Paragraph = Paragraph.filter(function (token) { return token.trim() !== ""; });
    var output = [];
    var candidateLinks = [];
    var withExtractionCode = false;
    var ExtractionCodeList = [];
    if (a.includes("Extractioncode:")) {
        withExtractionCode = true;
        for (var i = 0; i < Paragraph.length; i++) {
            if (Paragraph[i].includes("Extractioncode:")) {
                var raw = Paragraph[i];
                var match = Paragraph[i].match(/Extractioncode:([A-Za-z0-9]+)/);
                var clean = match ? match[1] : "";
                ExtractionCodeList.push({ raw: raw, clean: clean });
            }
        }
    }
    for (var i = 0; i < Top_Level_Domain.length; i++) {
        for (var j = 0; j < Paragraph.length; j++) {
            if (Paragraph[j].includes("." + Top_Level_Domain[i] + "/") && Paragraph[j].length > Top_Level_Domain[i].length + 2) {
                if (Compare(Paragraph[j], output)) {
                    output.push(Paragraph[j]);
                }
            } else if (Compare(Paragraph[j], candidateLinks)) {
                candidateLinks.push(Paragraph[j]);
            }
        }
    }
    for (var i = 0; i < Top_Level_Domain.length; i++) {
        for (var j = 0; j < candidateLinks.length; j++) {
            if (candidateLinks[j].includes("." + Top_Level_Domain[i]) && candidateLinks[j].length > Top_Level_Domain[i].length + 1) {
                var suffix = "." + Top_Level_Domain[i];
                if (candidateLinks[j].substr(candidateLinks[j].length - suffix.length) === suffix) {
                    if (Compare(candidateLinks[j], output)) {
                        var isEmail = false;
                        for (var w = 0; w < Email_Keyword_List.length; w++) {
                            if (candidateLinks[j].includes("@" + Email_Keyword_List[w])) {
                                isEmail = true;
                                break;
                            }
                        }
                        if (!isEmail) {
                            output.push(candidateLinks[j]);
                        }
                    }
                }
            } else if ((candidateLinks[j].includes("http://") || candidateLinks[j].includes("https://")) && candidateLinks[j].length > 8 && candidateLinks[j].includes(".")) {
                if (Compare(candidateLinks[j], output)) {
                    output.push(candidateLinks[j]);
                }
            }
        }
    }
    if (withExtractionCode) {
        for (var i = 0; i < ExtractionCodeList.length; i++) {
            RollBackToFind(Paragraph, ExtractionCodeList[i].raw, output, ExtractionCodeList[i].clean);
        }
    }
    return output;
}


function AddRequestHead(linkList) {
    var output = [];
    for (var i = 0; i < linkList.length; i++) {
        var link = linkList[i];
        if (!link.includes("http://") && !link.includes("https://")) {
            var httpLink = "http://" + link;
            var httpsLink = "https://" + link;
            if (!output.includes(httpLink) && !output.includes(httpsLink)) {
                var useHttps = false;
                for (var j = 0; j < Use_https_keyword_list.length; j++) {
                    if (link.includes(Use_https_keyword_list[j])) {
                        useHttps = true;
                        break;
                    }
                }
                output.push(useHttps ? String(httpsLink) : String(httpLink));
            }
        } else if (!output.includes(link)) {
            output.push(String(link));
        }
    }
    return output;
}


function cleanLinksInBlackList(linkList) {
    for (var i = 0; i < link_blacklist_keywords.length; i++) {
        for (var j = 0; j < linkList.length; j++) {
            if (linkList[j].includes(link_blacklist_keywords[i])) {
                linkList.splice(j, 1);
                j--;
            }
        }
    }
    return linkList;
}


function RecognitionMain(a) {
    return cleanLinksInBlackList(AddRequestHead(ScreeningParagraphs(removeDisallowedChar(a, allowChar + " \n"))));
}


function getAppName(packageName, userId) {
    var pm = context.getPackageManager();
    try {
        var appInfo = pm.getApplicationInfoAsUser(packageName, 0, userId);
        var appName = pm.getApplicationLabel(appInfo).toString();
        if (userId !== 0) {
            return appName + "(" + userId + ")"
        }
        return appName;
    } catch (e) {
        console.log("获取应用名失败: " + e);
        return "****";
    }
}



var APPList_cache = {};
function getAppList(userId) {
    var cachelist = Object.keys(APPList_cache);
    if (cachelist == undefined) cachelist = [];
    if (cachelist.includes(userId)) {
        return APPList_cache[userId];
    }
    var pm = context.getPackageManager();
    var result = [];
    try {
        var apps = pm.getInstalledApplicationsAsUser(PackageManager.GET_META_DATA, userId);
        for (var i = 0; i < apps.size(); i++) {
            result.push(String(apps.get(i).packageName));
        }
    } catch (e) {
        console.log("获取包名列表失败: " + e);
    }
    APPList_cache[userId] = result;
    return result;
}

function getAllUserIds() {
    if (show_Multiple_users) {
        try {
            var userManager = context.getSystemService("user");
            var users = userManager.getUsers();
            var result = [];
            for (var i = 0; i < users.size(); i++) {
                var userInfo = users.get(i);
                result.push(parseInt(userInfo.id));
            }
            return result;
        } catch (e) {
            console.log("获取用户列表失败: " + e);
            return [0];
        }
    } else {
        return [0];
    }
}


function isAppinstall(pkgName, UserId) {
    return getAppList(UserId).includes(pkgName);
}


function isKeyInOblist(objectlist, key, value) {
    var qvc = objectlist.some(function (item) {
        return item[key] === value;
    }); return qvc;
}

function isKeyPairInOblist(objectlist, key1, value1, key2, value2) {
    var result = objectlist.some(function (item) {
        return item[key1] === value1 && item[key2] === value2;
    });
    return result;
}


function getAppOpenActivities(url, targetPackage, userId) {
    try {
        var intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        var resolvedType = null;
        var flags = PackageManager.MATCH_DEFAULT_ONLY;
        var binder = ServiceManager.getService("package");
        var iPm = IPackageManager$Stub.asInterface(binder);
        var resolveSlice = iPm.queryIntentActivities(intent, resolvedType, flags, userId);
        var resolveInfos = resolveSlice.getList();

        for (var i = 0; i < resolveInfos.size(); i++) {
            var ri = resolveInfos.get(i);
            if (ri.activityInfo != null && String(ri.activityInfo.packageName) === targetPackage) {
                return String(ri.activityInfo.name);
            }
        }
    } catch (e) {
        console.log("查询用户 " + userId + " 的 activity 失败: " + e);
    }

    return null;
}

function pkgCheck(pkg) {
    var result = { pass: false, result: [] };
    if (pkg.includes("://")) {
        for (var i = 0; i < UserIds.length; i++) {
            var Apps = getOpenApps(pkg, UserIds[i]);
            var fakebrowserapp = getOpenApps("http://example.com", UserIds[i]).concat(getOpenApps("https://example.com", UserIds[i]));
            if (!Apps.includes(defaultBrowser)) {
                for (var j = 0; j < Apps.length; j++) {
                    var fakebrowserappcheckpass = true;
                    for (var z = 0; z < fakebrowserapp.length; z++) {

                        if (Apps[j].includes(String(fakebrowserapp[z]))) {

                            fakebrowserappcheckpass = false;
                        }
                    }
                    if (fakebrowserappcheckpass == true) {
                        result["result"].push({ packageName: Apps[j], UserId: UserIds[i] });
                    }
                }
                if (result.result.length != 0) result["pass"] = true;
            }
        }
    } else {
        for (var i = 0; i < UserIds.length; i++) {
            if (isAppinstall(pkg, UserIds[i])) {
                result["pass"] = true;
                result["result"].push({ packageName: pkg, UserId: UserIds[i] });
            }
        }
    }
    return result;
}
function findVariable(text) {
    if (text == undefined) return [];
    var results = [];
    var start = -1;
    var depth = 0;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === "【") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "】") {
            depth--;
            if (depth === 0 && start !== -1) {
                var inner = text.substring(start + 1, i);
                results.push(inner);
                start = -1;
            }
        }
    }
    return results;
}
var regexCache = {};

function getRegex(pattern, flags) {
    var key = pattern + "/" + (flags || "");
    if (!regexCache[key]) {
        regexCache[key] = new RegExp(pattern, flags);
    }
    return regexCache[key];
}


function containsMatch(text, pattern) {
    return getRegex(pattern, "i").test(text);
}


function replaceAll(text, target, replacement) {
    return text.replace(getRegex(target, "g"), replacement);
}


function buildKeyValueMap(list, key) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
        map[list[i][key]] = list[i];
    }
    return map;
}


function buildValueSet(list, key) {
    var set = {};
    for (var i = 0; i < list.length; i++) {
        set[list[i][key]] = true;
    }
    return set;
}

function islistinstr(str, strlist) {
    for (var i = 0; i < strlist.length; i++) {
        if (containsMatch(str, strlist[i])) {
            return true;
        }
    }
    return false;
}


function findObjectByKeyValue(list, key, value) {
    return list.find(function (item) {
        return item[key] === value;
    });
}

function getValuesFromObjectArray(objArray, key) {
    var result = objArray.map(function (item) {
        return item[key];
    });
    return result;
}

function SynthesisRule(VariableList, inputvalue) {
    var output = inputvalue;
    if (output === undefined) return null;
    var variableNames = buildValueSet(VariableList, "name");

    var Variables = findVariable(output);
    for (var j = 0; j < Variables.length; j++) {
        if (variableNames[Variables[j]]) {
            output = replaceAll(output, "【" + Variables[j] + "】", findObjectByKeyValue(VariableList, "name", Variables[j]).value);
            findObjectByKeyValue(VariableList, "name", Variables[j]).count++;
        }
    }

    return output;
}


function getVariablevalues(text, VariableList, object) {
    var results = findVariable(text);
    if (results === undefined) return VariableList;
    var variableNames = buildValueSet(VariableList, "name");

    for (var i = 0; i < results.length; i++) {
        if (!variableNames[results[i]]) {
            if (results[i]) {
                var Variableobject = findObjectByKeyValue(object.Custom_variable, "name", results[i]);
                if (!Variableobject) {
                    showToast("规则错误：自定义变量：" + results[i] + "未定义");
                    continue;
                }
            }
            var issuccess = true;
            if (typeof Variableobject.action === "string") {
                var action = Variableobject.action;
            } else {
                var action = "match";
            }
            if (action !== "splicing") {
                var sourse_text = Variableobject.text;
                if (!variableNames[sourse_text]) {
                    VariableList = getVariablevalues("【" + sourse_text + "】", VariableList, object);
                }
            }
            if (action === "match") {
                var a = findObjectByKeyValue(VariableList, "name", sourse_text).value.match(getRegex(Variableobject.pattern));
                if (a !== null) {
                    if (typeof Variableobject.index !== "number") Variableobject.index = 1;
                    VariableList.push({ name: results[i], value: a[Variableobject.index], count: 0 });
                } else {
                    issuccess = false;
                }
            } else if (action === "replace") {
                VariableList.push({ name: results[i], value: replaceAll(findObjectByKeyValue(VariableList, "name", sourse_text).value, Variableobject.pattern, Variableobject.replacement), count: 0 });
            } else if (action === "splicing") {
                var valuetext = Variableobject.valuetext;
                VariableList.push({ name: results[i], value: SynthesisRule(getVariablevalues(valuetext, VariableList, object), valuetext), count: 0 });
            }

            if (!issuccess) {
                VariableList.push({ name: results[i], value: "", count: 0 });
                showToast(object.name + "规则" + results[i] + "字段匹配失败,规则可能已过期");
            }
        }
    }
    return VariableList;
}





function isconditionpass(condition, withcode, VariableList) {
    var condition_type = condition.condition_type;
    if (condition_type === "withcode") return withcode;
    else if (condition_type === "withoutcode") return !withcode;
    else if (condition_type === "contains") {
        return containsMatch(findObjectByKeyValue(VariableList, "name", condition.condition_text).value, condition.condition_pattern);
    } else if (condition_type === "notcontains") {
        return !containsMatch(findObjectByKeyValue(VariableList, "name", condition.condition_text).value, condition.condition_pattern);
    } else return true;
}


function istopconditionpass(condition, VariableList, withcode) {
    var condition_tactic = condition.many_condition_tactic || "Any";
    var conditionlist = condition.condition;
    var condition_pass = false;

    if (condition_tactic === "All") {
        condition_pass = conditionlist.every(function (cond) {
            return isconditionpass(cond, withcode, VariableList);
        });
    } else if (condition_tactic === "Any") {
        condition_pass = conditionlist.some(function (cond) {
            return isconditionpass(cond, withcode, VariableList);
        });
    } else if (condition_tactic === "None") {
        condition_pass = conditionlist.every(function (cond) {
            return !isconditionpass(cond, withcode, VariableList);
        });
    } else {
        showToast("规则错误：置顶条件未知的多条件策略" + condition_tactic);
    }

    return condition_pass;
}


function chooseRules(object, VariableList, withcode) {
    var max_condition_num = 0;
    var max_condition_index = 0;
    var ruleobjectlist = object.rule;

    for (var i = 0; i < ruleobjectlist.length; i++) {
        var conditionlist = ruleobjectlist[i].condition;
        if (!conditionlist || conditionlist.length === 0) {
            if (max_condition_num === 0) {
                max_condition_index = i;
            }
            continue;
        }
        var condition_tactic = ruleobjectlist[i].many_condition_tactic || "All";
        var condition_pass = false;

        if (condition_tactic === "All") {
            condition_pass = conditionlist.every(function (cond) {
                return isconditionpass(cond, withcode, VariableList);
            });
        } else if (condition_tactic === "Any") {
            condition_pass = conditionlist.some(function (cond) {
                return isconditionpass(cond, withcode, VariableList);
            });
        } else if (condition_tactic === "None") {
            condition_pass = conditionlist.every(function (cond) {
                return !isconditionpass(cond, withcode, VariableList);
            });
        } else {
            showToast("规则错误：" + object.name + "规则，未知的多条件策略" + condition_tactic);
            continue;
        }

        if (condition_pass && conditionlist.length > max_condition_num) {
            max_condition_num = conditionlist.length;
            max_condition_index = i;
        }
    }

    var ruletext = ruleobjectlist[max_condition_index].rule_text;
    var output = SynthesisRule(getVariablevalues(ruletext, VariableList, object), ruletext);
    var codeobject = findObjectByKeyValue(VariableList, "name", "code");
    if (withcode && codeobject.count === 0) copy = codeobject.value;
    return output;

}


function matchRules(linkall, isnolink) {
    var link, ExtractionCode, RULES, withExtractionCode;
    if (!isnolink) {
        var linkparts = linkall.split(" 提取码:");
        link = String(linkparts[0]);
        if (linkparts.length === 2) {
            ExtractionCode = linkparts[1];
        }
        RULES = readJsonFile(ShortX_Path + "/data/Fluid_Cloud_Island/rules.json");
        withExtractionCode = true;
    } else {
        link = linkall;
        RULES = readJsonFile(ShortX_Path + "/data/Fluid_Cloud_Island/nolinkrules.json");
        withExtractionCode = false;
    }

    var results = [];
    for (var i = 0; i < RULES.length; i++) {
        var addToFirst = false;

        if (islistinstr(link, RULES[i].tigger)) {
            var VariableList = [
                { name: "input", value: input, count: 0 }
            ];
            if (["url", "intent"].includes(RULES[i].type)) {
                var OpenApps = pkgCheck(RULES[i].check);
                if (!OpenApps.pass) continue;
                if (!isnolink) {
                    VariableList.push({ name: "link", value: link });
                    if (typeof ExtractionCode !== "undefined" && ExtractionCode !== null) {
                        VariableList.push({ name: "code", value: ExtractionCode, count: 0 });
                    } else {
                        withExtractionCode = false;
                        VariableList.push({ name: "code", value: "", count: 0 });
                        var ExtractionCode = "";
                    }
                }

                var copy = "";
                var output = chooseRules(RULES[i], VariableList, withExtractionCode);
                if (typeof RULES[i].topcondition === "object") {
                    if (istopconditionpass(RULES[i].topcondition, VariableList, withExtractionCode)) {
                        addToFirst = true;
                    }
                }

                var urlpkgn = OpenApps.result;
                if (addToFirst) urlpkgn.reverse();

                for (var k = 0; k < urlpkgn.length; k++) {
                    if (!isKeyPairInOblist(results, "pkg", urlpkgn[k].packageName, "UserId", urlpkgn[k].UserId)) {
                        var titletext = SynthesisRule(getVariablevalues(RULES[i].title, VariableList, RULES[i]), RULES[i].title);
                        var messagetext = SynthesisRule(getVariablevalues(RULES[i].message, VariableList, RULES[i]), RULES[i].message);

                        if (!addToFirst) {
                            results.push({
                            type: RULES[i].type,
                            pkg: urlpkgn[k].packageName,
                            urlsharme: output,
                            activity: null,
                            copy: copy,
                            title: titletext,
                            message: messagetext,
                            UserId: urlpkgn[k].UserId,
                            icon: RULES[i].icon,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        } else {
                            results.unshift({
                            type: RULES[i].type,
                            pkg: urlpkgn[k].packageName,
                            urlsharme: output,
                            activity: null,
                            copy: copy,
                            title: titletext,
                            message: messagetext,
                            UserId: urlpkgn[k].UserId,
                            icon: RULES[i].icon,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        }
                    }
                }
            } else if (!isnolink && RULES[i].type === "pkg") {
                var OpenApps = pkgCheck(RULES[i].pkg);
                var packageName = OpenApps.result;
                if (!OpenApps.pass) continue;

                if (addToFirst) packageName.reverse();
                for (var k = 0; k < OpenApps.result.length; k++) {
                    var activityname = null;
                    if (RULES[i].pkg.includes("://")) {
                        activityname = getAppOpenActivities(RULES[i].pkg, packageName[k].packageName, packageName[k].UserId);
                    } else if (RULES[i].activityname !== undefined && RULES[i].activityname !== null) {
                        activityname = RULES[i].activityname;
                    }

                    if (!isKeyPairInOblist(results, "pkg", packageName[k].packageName, "UserId", packageName[k].UserId)) {
                        if (!addToFirst) {
                            results.push({
                            type: "pkg",
                            link: link,
                            pkg: packageName[k].packageName,
                            activity: activityname,
                            copy: ExtractionCode,
                            UserId: packageName[k].UserId,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        } else {
                            results.unshift({
                            type: "pkg",
                            link: link,
                            pkg: packageName[k].packageName,
                            activity: activityname,
                            copy: ExtractionCode,
                            UserId: packageName[k].UserId,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        }
                    }
                }
            } else if (isnolink && RULES[i].type == "rein") {
                var text = RecognitionMain(chooseRules(RULES[i], VariableList, false));
                if (text.length > 0) {
                    OpenMain(text, true);
                } else {
                    nolinkMain(text, true);
                }
                return "rein";
            }

            else {
                throw new Error("规则错误，未知的type：" + RULES[i].type);
            }
        }
    }

    if (!isnolink) {
        var AdaptiveAPP = pkgCheck(link);
        if (AdaptiveAPP.pass) {
            for (var i = 0; i < AdaptiveAPP.result.length; i++) {
                if (
                    !isKeyPairInOblist(results, "pkg", AdaptiveAPP.result[i].packageName, "UserId", AdaptiveAPP.result[i].UserId) &&
                    !Browser_PackageName_BlackList.includes(AdaptiveAPP.result[i].packageName)
                ) {
                    results.push({
                    type: "pkg",
                    link: link,
                    pkg: AdaptiveAPP.result[i].packageName,
                    activity: null,
                    copy: ExtractionCode,
                    UserId: AdaptiveAPP.result[i].UserId,
                    clearClipboard: false
                });
                }
            }
        }

        if (!isKeyInOblist(results, "pkg", defaultBrowser)) {
            results.push({
                type: "pkg",
                link: link,
                pkg: defaultBrowser,
                activity: null,
                copy: ExtractionCode,
                UserId: 0,
                clearClipboard: false
            });
        }
    }

    return results.length !== 0 ? results : false;
}




function launchWithMode(launchType, input, config, freeformMode, mode, packageName, activityName, userId) {
    try {
        var Intent = android.content.Intent;
        var Uri = android.net.Uri;
        var Point = android.graphics.Point;
        var Surface = android.view.Surface;
        var Rect = android.graphics.Rect;
        var ActivityOptions = android.app.ActivityOptions;
        var context = android.app.ActivityThread.currentApplication().getApplicationContext();
        var PackageManager = android.content.pm.PackageManager;

        var intent;
        if (launchType === "intent") {
            intent = Intent.parseUri(input, 0);
        } else {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(input));
        }

        if (packageName && packageName.trim() !== "") {
            intent.setPackage(packageName);
            if (!activityName || activityName.trim() === "") {
                var pm = context.getPackageManager();
                var resolveInfo = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
                if (resolveInfo != null && resolveInfo.activityInfo != null) {
                    activityName = resolveInfo.activityInfo.name;
                } else {
                    throw new Error("未找到可启动的 Activity");
                }
            }
            if (activityName && activityName.trim() !== "") {
                intent.setClassName(packageName, activityName);
            }
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        var userHandle = (userId != null && typeof userId === "number")
            ? android.os.UserHandle.of(userId)
            : android.os.UserHandle.of(0);
        if (mode === "fullscreen") {
            var pm = context.getPackageManager();
            var cmp = intent.resolveActivity(pm);
            if (cmp == null) {
                throw new Error("全屏启动失败：Intent 无法解析到任何 Activity");
            }
            context.startActivityAsUser(intent, null, userHandle);
            return "已全屏启动：" + (launchType === "intent" ? "Intent URI" : input);
        }
        var useMode = isAppinstall("oplus", 0) ? 100 : freeformMode;
        var wm = context.getSystemService("window");
        var display = wm.getDefaultDisplay();
        var point = new Point();
        display.getRealSize(point);
        
        // 获取屏幕真实尺寸（自然方向）
        var screenSize = getNaturalScreenSize();
        
        // 确保config是对象格式，并根据屏幕尺寸获取对应的配置
        var configArray = [1200, 1100, 0.6, 200, 150, 400, 80]; // 默认配置
        
        if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
            // 尝试根据屏幕尺寸获取对应的配置
            if (config[screenSize] && Array.isArray(config[screenSize]) && config[screenSize].length === 7) {
                configArray = config[screenSize];
            }
        }
        
        var rotation = display.getRotation();
        var isPortrait = (rotation === Surface.ROTATION_0 || rotation === Surface.ROTATION_180);
        var width = isPortrait ? parseInt(configArray[0]) : parseInt(configArray[1]);
        var height = parseInt(width / parseFloat(configArray[2]));
        var left = isPortrait ? parseInt(configArray[3]) : parseInt(configArray[4]);
        var top = isPortrait ? parseInt(configArray[5]) : parseInt(configArray[6]);
        var right = left + width;
        var bottom = top + height;
        var options = ActivityOptions.makeBasic();
        options.setLaunchWindowingMode(useMode);
        options.setLaunchBounds(new Rect(left, top, right, bottom));
        if (launchType === "intent") {
            context.startActivityAsUser(intent, options.toBundle(), userHandle);
        } else {
            context.startActivity(intent, options.toBundle());
        }
        return "已小窗启动：" + (launchType === "intent" ? "Intent URI" : input);
    } catch (e) {
        if (e.message && e.message.includes("No Activity found")) {
            throw new Error("在目标应用中未找到可以打开链接的活动");
        } else {
            throw e;
        }
    }
}


function CopyText(text) {
    var action = WriteClipboard.newBuilder()
        .setText(text)
        .build();
    shortx.executeAction(action);
}
function Recognizeagain() {
    var ModeA = "常规识别模式";
    var ModeB = "加料的复杂单链接(需确保链接前后无允许字符干扰)";
    var ModeC = "未加料的含有非法字符的链接(如中文域名)";
    var ModeD = "强制使用无链接模式";
    var Recognition_Mode = showOptionsDialog([ModeA, ModeB, ModeC, ModeD, "取消"], "识别模式");

    if (Recognition_Mode == ModeA) {
        var text = RecognitionMain(input);
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeB) {
        var text = AddRequestHead(ScreeningParagraphs(removeDisallowedChar(input, allowChar + "\n")));
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeC) {
        var text = AddRequestHead(ScreeningParagraphs(input));
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeD) {
        nolinkMain(input, false);
    }
}
function nolinkMain(input, showfloat) {
    var Open_With_List = matchRules(input, true);

    if (Open_With_List == "rein" || Open_With_List == false || isKeyInOblist(Open_With_List, "pkg", getForegroundAppPackageName())) {
        return 1;
    }

    var DialogBoxOption = [];
    for (var i = 0; i < Open_With_List.length; i++) {
        if (typeof Open_With_List[i].icon === "string") {
            var icon = Open_With_List[i].icon;
        } else {
            var icon = Open_With_List[i].pkg;
        }
        DialogBoxOption.push({
            label: Open_With_List[i].title + "(全屏)",
            desc: Open_With_List[i].message,
            pkg: icon,
            userId: Open_With_List[i].UserId,
            value: ["fullscreen", Open_With_List[i]]
        });
        DialogBoxOption.push({
            label: Open_With_List[i].title + "(小窗)",
            desc: Open_With_List[i].message,
            pkg: icon,
            userId: Open_With_List[i].UserId,
            value: ["window", Open_With_List[i]]
        });
    }
    DialogBoxOption.push({ label: "重新识别", desc: "使用其他识别模式重新识别", icon: "⤴️", value: "重新识别" });
    DialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });

    var Fluid_Cloud_Message;
    if (typeof Open_With_List[0].icon === "string") {
        var icon = Open_With_List[0].icon;
    } else {
        var icon = Open_With_List[0].pkg;
    }
    if (Fluid_Cloud_Position == "顶部") {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: icon,
            userId: Open_With_List[0].UserId,
            title: Open_With_List[0].title,
            subtitle: Open_With_List[0].message,
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "取消",
            resultOnSwipeDown: "choose",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.TOP | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    } else {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: icon,
            userId: Open_With_List[0].UserId,
            title: Open_With_List[0].title,
            subtitle: Open_With_List[0].message,
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "choose",
            resultOnSwipeDown: "取消",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.BOTTOM | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    }

    var openWith;
    var Fluid_Cloud_choose_result = !showfloat ? "choose" : showFloatingPrompt(Fluid_Cloud_Message);

    if (Fluid_Cloud_choose_result === "choose") {
        var DialogBoxResult = showOptionsDialog(DialogBoxOption, "打开方式(可滚动)");
        if (!["取消", "重新识别"].includes(DialogBoxResult)) {
            openWith = DialogBoxResult[1];
            openWith.openact = DialogBoxResult[0];
        } else {
            if (DialogBoxResult == "取消") {
                return 1;
            } else if (DialogBoxResult == "重新识别") {
                Recognizeagain();
                return 1;
            }
        }
    } else if (["fullscreen", "window"].includes(Fluid_Cloud_choose_result)) {
        openWith = Open_With_List[0];
        openWith.openact = Fluid_Cloud_choose_result;
    } else {
        return 1;
    }

    if (["url", "intent"].includes(openWith.type)) {
        launchWithMode(openWith.type, openWith.urlsharme, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);
    } else {
        throw new Error("未知的type：" + openWith.type);
    }
}


function findAllBrowsers(link, userIds) {
    var pm = context.getPackageManager();
    var intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
    intent.addCategory(Intent.CATEGORY_BROWSABLE);
    var result = [];
    for (var j = 0; j < userIds.length; j++) {
        var userId = userIds[j];
        var list = null;
        list = pm.queryIntentActivitiesAsUser(intent, PackageManager.MATCH_ALL, userId);
        if (list && list.size() > 0) {
            var seen = {};
            for (var i = 0; i < list.size(); i++) {
                var resolveInfo = list.get(i);
                var pkg = resolveInfo.activityInfo.packageName;
                var key = userId + "@" + pkg;
                if (!seen[key]) {
                    seen[key] = true;
                    result.push({
                        type: "pkg",
                        pkg: pkg,
                        link: link,
                        UserId: userId,
                        activity: null,
                        copy: ""
                    });
                }
            }
        }
    }
    return result;
}
// 发送超级岛通知函数
function showIslandNotification(opts, result, timeout) {
        var NotificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE);
        var NotificationBuilder = android.app.Notification.Builder;
        var PendingIntent = android.app.PendingIntent;
        var Icon = android.graphics.drawable.Icon;
        var userId = opts.userId || 0;
        var pkg = opts.pkg;
        var pull_small_window = config.pull_small_window || true;
        var openWith = opts.openWith;
        var title = opts.title || "打开应用";
        var content = opts.subtitle || "";


        // 创建通知渠道
        var channelId = "fluid_cloud_channel";
        var channelName = "流体云通知";
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            var importance = android.app.NotificationManager.IMPORTANCE_HIGH;
            var channel = new android.app.NotificationChannel(channelId, channelName, importance);
            NotificationManager.createNotificationChannel(channel);
        }

        // 生成唯一通知ID
        var notificationId = java.lang.System.currentTimeMillis() & 0x7fffffff;


        // 定义广播动作
        const ACTION_CLICK_MAIN = "FLUID_CLOUD_CLICK_MAIN_" + notificationId;
        const ACTION_CLICK_BUTTON = "FLUID_CLOUD_CLICK_BUTTON_" + notificationId;

        // 导入WeakReference类
        var WeakReference = java.lang.ref.WeakReference;

        // 创建广播接收器
        var receiver = new BroadcastReceiver({
            onReceive: function(context, intent) {
                var action = intent.getAction();
                if (action == ACTION_CLICK_MAIN) {
                    result = opts.resultOnClick || "fullscreen";
                } else if (action == ACTION_CLICK_BUTTON) {
                    result = opts.resultOnButton || "window";
                }

                NotificationManager.cancel(notificationId);
                // 从WeakReference中获取并注销接收器
                var receiverRef = this.receiverRef;
                if (receiverRef && receiverRef.get()) {
                    try { 
                        context.unregisterReceiver(receiverRef.get()); 
                    } catch (e) {}
                }
            }
        });

        // 使用WeakReference持有接收器
        var receiverRef = new WeakReference(receiver);
        receiver.receiverRef = receiverRef;

        // 注册广播接收器
        var filter = new IntentFilter();
        filter.addAction(ACTION_CLICK_MAIN);
        filter.addAction(ACTION_CLICK_BUTTON);
        context.registerReceiver(receiver, filter);

        // 创建主体点击的 PendingIntent
        var mainIntent;
        var mainPendingIntent;
        if (pull_small_window && openWith) {
            mainIntent = createLaunchIntent(openWith);
            mainPendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            mainIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        } else {
            mainIntent = new Intent(ACTION_CLICK_MAIN);
            mainPendingIntent = PendingIntent.getBroadcast(context, 0, mainIntent, PendingIntent.FLAG_IMMUTABLE);
        }
        
        // 创建按钮点击的 PendingIntent
        var buttonIntent = new Intent(ACTION_CLICK_BUTTON);
        var buttonPendingIntent = PendingIntent.getBroadcast(context, 1, buttonIntent, PendingIntent.FLAG_IMMUTABLE);

        // 获取应用图标用于超级岛
        var appIcon = null;
        if (pkg) {
            try {
                var userHandle = android.os.UserHandle.of(userId);
                var userContext = context.createPackageContextAsUser(pkg, userId, userHandle);
                var userPm = userContext.getPackageManager();
                appIcon = userPm.getApplicationIcon(pkg);
            } catch (e) {
                console.log("获取应用图标失败: " + e);
            }
        }

        // 构建超级岛参数
        var islandParams = buildIslandParams(title, content, opts.buttonText || "查看");

        // 添加图片数据到通知extras
        var extras = new android.os.Bundle();

        var iconBitmap = null;
        var iconDrawable;

        // 添加应用图标到图片数据
        if (appIcon) {
            try {
                var picsBundle = new android.os.Bundle();
                iconBitmap = getBitmapFromDrawable(appIcon);
                if (iconBitmap != null && !iconBitmap.isRecycled()) {
                    iconDrawable = Icon.createWithBitmap(iconBitmap);
                    picsBundle.putParcelable("miui.focus.pic_app", iconDrawable);
                    extras.putBundle("miui.focus.pics", picsBundle);
                }
            } catch (e) {
                console.log("处理图标时出错: " + e);
            }
        }

        // 添加Action数据（打开应用的action）
        var actionsBundle = new android.os.Bundle();
        var openAction = new android.app.Notification.Action.Builder(
            null,null,
            buttonPendingIntent
        ).build();
        actionsBundle.putParcelable("miui.focus.action_open", openAction);
        extras.putBundle("miui.focus.actions", actionsBundle);

        // 构建基础通知
        var builder = new NotificationBuilder(context, channelId)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(iconDrawable)
            .setContentIntent(mainPendingIntent)
            .setWhen(java.lang.System.currentTimeMillis())
            .setShowWhen(true);


        builder.addExtras(extras);

        var notification = builder.build();

        // 添加超级岛参数到通知
        notification.extras.putString("miui.focus.param", islandParams);

        // 显示通知
        NotificationManager.notify(notificationId, notification);

        new Thread(new Runnable({
        run: function() {
            Thread.sleep(timeout);
            if (result === null) {
                result = opts.resultOnTimeout || "取消";
            }
            NotificationManager.cancel(notificationId);
            // 从WeakReference中获取并注销接收器
            if (receiverRef && receiverRef.get()) {
                try { 
                    context.unregisterReceiver(receiverRef.get()); 
                } catch (e) {}
            }
        }
    })).start();
    
    while (result === null) {
        Thread.sleep(150);
    }
    
    return result;

}

// 构建超级岛参数
function buildIslandParams(title, content, buttonText) {

    var islandParams = {
        "param_v2": {
            "protocol": 1,
            "business": "fluid_cloud", // 业务场景
            "enableFloat": true, // 允许展开
            "updatable": false, // 非持续性通知
            "timeout": 10, // 10分钟自动消失
            "islandFirstFloat": true,
            // 状态栏数据
            "ticker": title,
            "tickerPic": "miui.focus.pic_app",

            // 息屏AOD数据
            "aodTitle": title,
            "aodPic": "miui.focus.pic_app",

            // 岛数据
            "param_island": {
                "islandProperty": 1, // 信息展示为主
                "islandTimeout": 10, 

                // 大岛内容 - 使用基础信息模板
                "bigIslandArea": {
                    "imageTextInfoLeft": {
                        "type": 1,
                        "picInfo": {
                            "type": 1,
                            "pic": "miui.focus.pic_app"
                        }
                    },
                    "textInfo": {
                        "title": title,
                        "narrowFont": true,
                        "showHighlightColor": true
                    }
                },

                // 小岛内容
                "smallIslandArea": {
                    "picInfo": {
                        "type": 1,
                        "pic": "miui.focus.pic_app"
                    }
                }
            },

            // 焦点通知数据
            "iconTextInfo": {
                "title": title,
                "content": content,
                "animIconInfo": {
                    "type": 0,
                    "src": "miui.focus.pic_app"
                }
            },
            "actions": [
                {
                    "type": 2,
                    "actionTitle": buttonText,
                    "action": "miui.focus.action_open"
                }
            ]
        }
    };

    return JSON.stringify(islandParams);
}

// 检查是否支持超级岛功能
function isSupportIsland() {
    try {
        // 反射查询系统是否支持岛功能
        var clazz = java.lang.Class.forName("android.os.SystemProperties");
        var method = clazz.getDeclaredMethod("getBoolean",
            java.lang.Class.forName("java.lang.String"),
            java.lang.Boolean.TYPE);
        var result = method.invoke(null, "persist.sys.feature.island", false);
        return Boolean(result);
    } catch (e) {
        var errorMsg = "检查超级岛支持失败: " + e.toString(); // 使用 toString() 而不是直接拼接

        console.log(errorMsg); // 复制错误信息到剪切板

        return false;
    }
}

// 检查焦点通知权限
function hasFocusPermission() {
    try {
        var uri = android.net.Uri.parse("content://miui.statusbar.notification.public");
        var extras = new android.os.Bundle();
        extras.putString("package", context.getPackageName());
        var bundle = context.getContentResolver().call(uri, "canShowFocus", null, extras);
        return bundle.getBoolean("canShowFocus", false);
    } catch (e) {
        console.log("检查焦点通知权限失败: " + e);
        return false;
    }
}

// 检查焦点通知协议版本
function getFocusProtocolVersion() {
    try {
        return android.provider.Settings.System.getInt(
            context.getContentResolver(),
            "notification_focus_protocol", 0);
    } catch (e) {
        console.log("获取焦点通知协议版本失败: " + e);
        return 0;
    }
}

// 辅助函数：将Drawable转换为Bitmap
function getBitmapFromDrawable(drawable) {
    if (drawable instanceof android.graphics.drawable.BitmapDrawable) {
        return drawable.getBitmap();
    }

    var bitmap = android.graphics.Bitmap.createBitmap(
        drawable.getIntrinsicWidth(),
        drawable.getIntrinsicHeight(),
        android.graphics.Bitmap.Config.ARGB_8888
    );
    var canvas = new android.graphics.Canvas(bitmap);
    drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
    drawable.draw(canvas);

    return bitmap;
}


// 创建启动Intent
function createLaunchIntent(openWith) {
    try {
        var Intent = android.content.Intent;
        var Uri = android.net.Uri;

        var intent;
        var launchType = openWith.type;
        var link = openWith.link;
        if (launchType === "intent") {
            intent = Intent.parseUri(openWith.urlsharme, 0);
        } else if (launchType === "url") {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(openWith.urlsharme));
        } else if (launchType === "pkg") {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(link));
        }

        if (openWith.pkg && openWith.pkg.trim() !== "") {
            intent.setPackage(openWith.pkg);
            if (openWith.activity && openWith.activity.trim() !== "") {
                intent.setClassName(openWith.pkg, openWith.activity);
            }
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        // 设置用户
        if (openWith.UserId != null && typeof openWith.UserId === "number") {
            intent.addFlags(Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
            // 对于多用户，需要特殊处理
        }

        return intent;
    } catch (e) {
        console.log("创建启动Intent失败: " + e);
        return null;
    }
}


function OpenMain(AllLinks, showfloat) {

    if (AllLinks.length === 0) {
        return 1;
    }

    var link;
    var linkNum = AllLinks.length;
    var manylink = linkNum >= 2;

    if (manylink) {
        var ManyLink_Fluid_Cloud;
        if (Fluid_Cloud_Position == "顶部") {
            ManyLink_Fluid_Cloud = {
                pkg: defaultBrowser,
                userId: 0,
                title: "多个链接",
                subtitle: "点击选择链接",
                buttonText: "重新识别",
                resultOnClick: true,
                resultOnButton: "重新识别",
                resultOnTimeout: false,
                resultOnSwipe: false,
                resultOnSwipeDown: true,
                timeout: Fluid_Cloud_timeout,
                gravity: Gravity.TOP | Gravity.CENTER,
                x: 0,
                y: Fluid_Cloud_Position_Offset
            };
        } else {
            ManyLink_Fluid_Cloud = {
                pkg: defaultBrowser,
                userId: 0,
                title: "多个链接",
                subtitle: "点击选择链接",
                buttonText: "重新识别",
                resultOnClick: true,
                resultOnButton: "重新识别",
                resultOnTimeout: false,
                resultOnSwipe: true,
                resultOnSwipeDown: false,
                timeout: Fluid_Cloud_timeout,
                gravity: Gravity.BOTTOM | Gravity.CENTER,
                x: 0,
                y: Fluid_Cloud_Position_Offset
            };
        }

        var openWith;
        var goManyLinkChoose = !showfloat ? true : showFloatingPrompt(ManyLink_Fluid_Cloud);

        if (goManyLinkChoose == true) {
            AllLinks.push("取消");
            AllLinks.push("重新识别");
            link = String(showOptionsDialog(AllLinks, "选择链接"));
        } else if (goManyLinkChoose == "重新识别") {
            Recognizeagain();
            return 1;
        } else {
            return 1;
        }
    } else {
        link = String(AllLinks[0]);
    }

    if (link == "取消") {
        return 1;
    } else if (link == "重新识别") {
        Recognizeagain();
        return 1;
    }

    var Open_With_List = matchRules(link, false);
    if (!manylink && (Open_With_List.length < 2 || getForegroundAppPackageName() != defaultBrowser) &&
        isKeyInOblist(Open_With_List, "pkg", getForegroundAppPackageName())) {
        return 1;
    }
    if (Open_With_List.length < 2 && ["QQ", "微信"].includes(tiggerTag)) return 1;

    var DialogBoxOption = [];
    for (var i = 0; i < Open_With_List.length; i++) {
        DialogBoxOption.push({
            label: getAppName(Open_With_List[i].pkg, Open_With_List[i].UserId),
            desc: "全屏",
            pkg: Open_With_List[i].pkg,
            userId: Open_With_List[i].UserId,
            value: ["fullscreen", Open_With_List[i]]
        });
        DialogBoxOption.push({
            label: getAppName(Open_With_List[i].pkg, Open_With_List[i].UserId),
            desc: "小窗",
            pkg: Open_With_List[i].pkg,
            userId: Open_With_List[i].UserId,
            value: ["window", Open_With_List[i]]
        });
    }
    DialogBoxOption.push({ label: "其他应用打开", desc: "使用其他浏览器或应用打开", icon: "➡️", value: "其他应用打开" });
    DialogBoxOption.push({ label: "系统选择框", desc: "全屏", icon: "📱", value: "选择应用打开" });

    DialogBoxOption.push({ label: "复制链接", desc: "复制清理干净的链接和提取码", icon: "📋", value: "复制链接" });

    DialogBoxOption.push({ label: "重新识别", desc: "使用其他识别模式重新识别", icon: "⤴️", value: "重新识别" });

    DialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });


    var Fluid_Cloud_Message;

    if (Fluid_Cloud_Position == "顶部") {

        Fluid_Cloud_Message = {

            openWith: Open_With_List[0],

            pkg: Open_With_List[0].pkg,

            userId: Open_With_List[0].UserId,

            title: "打开" + getAppName(Open_With_List[0].pkg, 0),

            subtitle: "点击全屏打开" + getAppName(Open_With_List[0].pkg, 0),

            buttonText: "浮窗打开",

            resultOnClick: "fullscreen",

            resultOnButton: "window",

            resultOnTimeout: "取消",

            resultOnSwipe: "取消",

            resultOnSwipeDown: "choose",

            timeout: Fluid_Cloud_timeout,

            gravity: Gravity.TOP | Gravity.CENTER,

            x: 0,

            y: Fluid_Cloud_Position_Offset

        };

    } else {

        Fluid_Cloud_Message = {

            openWith: Open_With_List[0],

            pkg: Open_With_List[0].pkg,

            userId: Open_With_List[0].UserId,

            title: "打开" + getAppName(Open_With_List[0].pkg, 0),

            subtitle: "点击全屏打开" + getAppName(Open_With_List[0].pkg, 0),

            buttonText: "浮窗打开",

            resultOnClick: "fullscreen",

            resultOnButton: "window",

            resultOnTimeout: "取消",

            resultOnSwipe: "choose",

            resultOnSwipeDown: "取消",

            timeout: Fluid_Cloud_timeout,

            gravity: Gravity.BOTTOM | Gravity.CENTER,

            x: 0,

            y: Fluid_Cloud_Position_Offset

        };

    }


    var openWith;

    var Fluid_Cloud_choose_result = (manylink || !showfloat) ? "choose" : showFloatingPrompt(Fluid_Cloud_Message);


    if (Fluid_Cloud_choose_result === "choose" && (tiggerTag != "附加" || (tiggerTag == "附加" && extra_default_action == "询问"))) {

        var DialogBoxResult = showOptionsDialog(DialogBoxOption, "打开方式(可滚动)");

        if (!["取消", "复制链接", "其他应用打开", "选择应用打开", "重新识别"].includes(DialogBoxResult)) {

            openWith = DialogBoxResult[1];

            openWith.openact = DialogBoxResult[0];

        } else {

            if (DialogBoxResult == "取消") {

                return 1;

            } else if (DialogBoxResult == "重新识别") {

                Recognizeagain();

                return 1;

            }


            var clink = link.split(" 提取码:");

            if (clink[1] !== undefined) {

                CopyText(clink[1]);

                showToast("提取码已复制");

            } else if (openWith && openWith.clearClipboard && DialogBoxResult != "复制链接") {
                CopyText("");
            }


            var runIns = clink[0];

            if (DialogBoxResult == "复制链接") {

                RecordCopiedText(runIns);

                CopyText(runIns);

                showToast("链接已复制");

                return 1;

            } else if (DialogBoxResult == "选择应用打开") {

                var command = ShellCommand.newBuilder()

                    .setCommand("am start -d \"" + runIns + "\"").build();

                shortx.executeAction(command);

                return 1;

            } else if (DialogBoxResult == "其他应用打开") {

                var OtherAppOpenDialogBoxOption = [];

                var OtherAppsList = findAllBrowsers(runIns, UserIds);

                OtherAppOpenDialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });

                for (var i = 0; i < OtherAppsList.length; i++) {

                    OtherAppOpenDialogBoxOption.push({

                        label: getAppName(OtherAppsList[i].pkg, OtherAppsList[i].UserId),

                        desc: "全屏",

                        pkg: OtherAppsList[i].pkg,

                        userId: OtherAppsList[i].UserId,

                        value: ["fullscreen", OtherAppsList[i]]

                    });

                    OtherAppOpenDialogBoxOption.push({

                        label: getAppName(OtherAppsList[i].pkg, OtherAppsList[i].UserId),

                        desc: "小窗",

                        pkg: OtherAppsList[i].pkg,

                        userId: OtherAppsList[i].UserId,

                        value: ["window", OtherAppsList[i]]

                    })

                }

                var OtherAppDialogBoxResult = showOptionsDialog(OtherAppOpenDialogBoxOption, "其他打开方式(可滚动)");

                if (OtherAppDialogBoxResult !== "取消") {

                    openWith = OtherAppDialogBoxResult[1];

                    openWith.openact = OtherAppDialogBoxResult[0];

                } else {

                    return 1;

                }

            } else {

                return 1;

            }

        }

    } else if (tiggerTag == "附加" && extra_default_action != "询问") {

        if (extra_default_action == "全屏打开") {

            openWith = Open_With_List[0];

            openWith.openact = "fullscreen";

        } else if (extra_default_action == "小窗打开") {

            openWith = Open_With_List[0];

            openWith.openact = "window";

        }

    } else if (["fullscreen", "window"].includes(Fluid_Cloud_choose_result)) {

        openWith = Open_With_List[0];

        openWith.openact = Fluid_Cloud_choose_result;

    } else {

        return 1;

    }


    if (openWith.copy != "" && openWith.copy !== undefined) {

        CopyText(openWith.copy);

        showToast("提取码已复制");

    } else if (openWith.clearClipboard) {
        CopyText("");
    }


    if (["url", "intent"].includes(openWith.type)) {

        launchWithMode(openWith.type, openWith.urlsharme, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);

    } else if (openWith.type == "pkg") {

        launchWithMode("intent", openWith.link, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);

    } else {

        throw new Error("未知的type：" + openWith.type);

    }

}






if (DebugMode == false && isRunAction == true) {

    var setaction = showOptionsDialog(["设置指令", "编辑规则", "编辑无链接规则", "取消"], "选择操作");

    if (setaction == "设置指令") {

        showsettingsui();

    } else if (setaction == "编辑规则") {

        showFileEditorUI(ShortX_Path + "/data/Fluid_Cloud_Island/rules.json");

    } else if (setaction == "编辑无链接规则") {

        showFileEditorUI(ShortX_Path + "/data/Fluid_Cloud_Island/nolinkrules.json");

    }

} else {

    var showFloatingPrompts;

    if (DebugMode) {

        showFloatingPrompts = true;

    } else {

        showFloatingPrompts = ["选中", "附加"].includes(tiggerTag) ? false : true;

    }


    var config = readJsonFile(ShortX_Path + "/data/Fluid_Cloud_Island/config.json");

    var Top_Level_Domain = config.Top_Level_Domain;

    var Email_Keyword_List = config.Email_Keyword_List;

    var link_blacklist_keywords = config.link_blacklist_keywords;

    var Fluid_Cloud_Position = config.Fluid_Cloud_Position;

    var Fluid_Cloud_Position_Offset = config.Fluid_Cloud_Position_Offset;

    var Use_https_keyword_list = config.Use_https_keyword_list;

    var Extractioncode_Keyword_list = config.Extractioncode_Keyword_list;

    var Window_Configuration = config.Window_Configuration;

    var Launch_Windowing_Mode = config.Launch_Windowing_Mode;

    var Fluid_Cloud_timeout = config.Fluid_Cloud_timeout;

    var defaultBrowser = config.browser;

    var allowChar = config.allowChar;

    var Browser_PackageName_BlackList = config.Browser_PackageName_BlackList;

    var show_Multiple_users = config.show_Multiple_users;

    var show_toast = config.show_toast;

    var extra_default_action = config.extra_default_action;

    var UserIds = getAllUserIds();

    Browser_PackageName_BlackList.push("android");

    Browser_PackageName_BlackList.push("com.nyehueh.fluidcloud");


    var CopiedText = readJsonFile(ShortX_Path + "/data/Fluid_Cloud_Island/recordcopy.json").CopiedText;


    if (defaultBrowser == "自动" || isAppinstall(defaultBrowser, 0) == false) {

        defaultBrowser = getDefaultBrowserPackageName(context);

    }


    var RealDefaultBrowser = getDefaultBrowserPackageName(context);

    var LinkIdentified = RecognitionMain(input);


    if (CopiedText != false && LinkIdentified.length == 1 && LinkIdentified[0] == CopiedText) {

        RecordCopiedText(false);

    } else {

        RecordCopiedText(false);

        if (LinkIdentified.length > 0) {

            OpenMain(LinkIdentified, showFloatingPrompts);

        }

        else {

            nolinkMain(input, showFloatingPrompts);

        }

    }

}



