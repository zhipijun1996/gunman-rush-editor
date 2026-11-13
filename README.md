# 失序之钟 · 世界工坊

面向手机的整世界关卡编辑器，配套 [gunman-rush](https://github.com/zhipijun1996/gunman-rush)。世界与房内通路、能力锁、实例、收集物及房间评分使用稳定身份；AI先生成候选，由用户比较和采用。

开发先读 [AGENTS.md](AGENTS.md)、[设计](docs/design/editor.md)与[任务表](docs/project/tasks.md)。主游戏拥有组件行为和正式数据，本仓库不分发游戏素材或用户草稿。

开发：Node 24，执行 `npm ci && npm run check`。未导入游戏时可在界面导入schema 2项目。

配套游戏先运行世界编译、锁定Godot的 `tools/world/export_editor_documents.gd` 和 `tools/export_editor_native.py`，再在本仓库运行：

```sh
npm run import:game -- --game ../gunman-rush
npm run dev
```

Android使用主游戏锁定的Android模板、JDK17及SDK36；设定 `GUNMAN_ANDROID_SOURCE`、Android SDK环境变量后运行 `npm run android`。布局修改发送JSON给驻留的真实Godot预览，不重新构建APK。完整首次安装含运行资源，体积较大；后续相同行为版本复用本地包。更新行为或引擎分别下载匹配运行包／更新APK。

打开地图后可双指缩放、拖动画布，选择房间进入细节；“移动对象”拖动实例，“新增空间”绘制占地。门对在两端共同编辑；房内分区与路线配置能力锁。管理页分别记录开发状态、人工初审和三项评分。AI页通过APK系统浏览器授权ChatGPT，候选可比较／试玩／采用；不会直接更改草稿。

草稿保存在本机，建议定期导出完整工作区。游戏更新先比较并处理冲突。定稿可导出选区包，由 `scripts/submit-game.mjs` 建PR；APK也提供GitHub连接和选区提交。主游戏须先合入配套协议及工作流并发布运行通道，在线导入才能完整执行；不会自动合main。GitHub令牌只在设备内填写，不发到聊天或仓库。

现有在线关卡平台不受此仓库影响。逻辑可达与地图预览不代表通关验证；设备性能、ChatGPT实际授权与端到端PR流程的覆盖见当前交接。MIT适用于本仓库编辑器代码，不扩展至配套游戏素材、第三方引擎或用户草稿。
