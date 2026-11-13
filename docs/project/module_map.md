# 模块与验证入口

| 内容 | 所有者 | 验证 |
| --- | --- | --- |
| 世界协议、逻辑可达、当前草稿事务与任务撤销 | packages/core；workspace.mjs／session.mjs | npm test |
| 可交互元素、组合、信号与附着编辑 | packages/core/elements.mjs、ElementsPanel.jsx、Canvas.jsx；读取主游戏目录 | npm test；scripts/elements-browser-check.mjs；主游戏文档装载器 |
| 手机分屏、真实空间／规划图、离线恢复 | apps/editor；Canvas.jsx／PlanningCanvas.jsx／Splitter.jsx | npm run build；scripts/browser-check.mjs（模拟桥接） |
| 套餐授权、模型恢复与原生宿主 | apps/android；ChatGPTAuth.kt唯一协议／PlanAuth.kt安卓适配；useAccount.js | Android真实本地HTTP／签名协议测试、APK构建；scripts/phone-entry-auth-check.mjs；真实授权及设备另验 |
| Godot房间装载、目录和正式行为 | 主游戏仓库 | 主游戏专项与同版本运行验证 |

长期行为归[编辑器设计](../design/editor.md)，任务状态归[任务表](tasks.md)，实际证据归当前交接。
