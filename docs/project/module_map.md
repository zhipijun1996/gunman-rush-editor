# 模块与验证入口

| 内容 | 所有者 | 验证 |
| --- | --- | --- |
| 世界协议、逻辑可达、事务与候选 | packages/core | npm test |
| 可交互元素、组合、信号与附着编辑 | packages/core/elements.mjs、ElementsPanel.jsx、Canvas.jsx；读取主游戏目录 | npm test；scripts/elements-browser-check.mjs；主游戏文档装载器 |
| 地图与手机操作、离线数据 | apps/editor | npm run build；浏览器操作检查 |
| 套餐授权与原生宿主 | apps/android | Android单元测试、APK构建；设备授权另验 |
| Godot房间装载、目录和正式行为 | 主游戏仓库 | 主游戏专项与同版本运行验证 |

长期行为归[编辑器设计](../design/editor.md)，任务状态归[任务表](tasks.md)，实际证据归当前交接。
