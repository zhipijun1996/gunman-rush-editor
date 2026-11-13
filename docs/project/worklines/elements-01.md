# 统一关卡要素工具

用户授权主游戏与编辑器共同实施定义、实例化、连接、状态及区域视觉。基线22f7809，分支codex/unified-elements；依赖主游戏codex/terrain-material-system／PR156。接口单写者Codex。

主游戏elements与surface_styles目录为唯一行为／外观权威。编辑器已接定义和组合放置、参数／路径、类型信号、状态范围、危险附着和选皮、材质笔刷；复制重映射内部稳定ID，移动／删除带组合和附着物，未知版本、断引用、循环、重复信号及不贴合宿主拒绝。失败或取消不写草稿，撤销使用原事务历史；旧存档无需兼容，编辑器本地草稿仍按原三方更新流程保护。

实际验证：npm run check通过28项测试和生产构建；同版309房／409连接／44已编写房导入无问题。scripts/elements-browser-check.mjs在Chromium1440×1000和390×844操作放置、复制、删除、附着和选材，无页面错误或alert。截图在build/elements-editor-{desktop,phone}.png。实际事务生成45实体房间含门／载台／建筑组合、复制、附着刺和材质覆盖，通过主游戏WorldRoomDocument装载器。主游戏另完成44房往返、186项编辑运行时、112项机关、544项地形、工作台隔离与真实PCK验证。

源码经[PR2](https://github.com/zhipijun1996/gunman-rush-editor/pull/2)交付，与主游戏[PR156](https://github.com/zhipijun1996/gunman-rush/pull/156)配套；不合并、不部署、不覆盖在线草稿，不包含游戏素材、用户项目JSON或凭据。原生APK、实体设备性能与商店发行沿原任务另验。后续扩展先在主游戏登记行为与定义，再导入同版目录和运行包；不在编辑器另写一套玩法。
