# 梗战争模拟器交接记录

- 阶段：Prototype
- 玩家结果：在预算内买兵并部署，开战后观看多波自动战斗；波次无缝衔接，不再有战后整备或中途操作，清空整关后进入结算并可前往下一关，用剩余预算获得 S/D 等级。
- 当前状态：原生 WebGL2 可玩切片已接入《How Many Dudes?》式连续波次自动战斗节奏，并按需求收敛为纯排兵布阵流程；6 关、数据驱动兵种、部署/撤回、拖拽、自动战斗、技能、连续波次、镜头、暂停/倍速和结算已经接通。13 个可部署角色与敌方瓜摊老板均已接入原创手绘图集，卡面与战斗内角色保持一一对应。`index.html` 现在是自包含静态发布入口：`scripts/build-static.mjs` 会将数据、样式、运行代码和图集内嵌，可直接双击或部署到 GitHub Pages，不再依赖 `file://` 外部脚本加载。
- 重要文件：`index.html`、`package.json`、`src/main.js`、`src/sim.js`、`src/webgl.js`、`data/units.json`、`data/levels.json`、`assets/units-handdrawn-atlas.png`、`assets/ASSET_NOTES.md`、`scripts/check-data.mjs`、`scripts/build-static.mjs`、`scripts/check-static-runtime.mjs`、`scripts/server.mjs`、`scripts/launch.mjs`、`PLAY_GAME.cmd`。
- 验证：`npm run build` 成功；`npm run check` 通过，并确认 `index.html` 无外部脚本/样式表、包含内嵌数据与图集，以及“可选纹理不得阻塞启动”的回归检查；单文件构建后本地 HTTP 静态入口真实浏览器已进入“准备部署”界面且控制台无错误；此前真实浏览器已验证第 1 关“部署 → 第 1 波自动战斗 → 第 2 波无缝入场 → 胜利结算”，过程没有整备弹窗；固定模拟烟测确认 6 关均存在预算内可通关编队；远程单位贴近时会主动后撤，召唤物保持 150 射程；`PLAY_GAME.cmd` 已实测启动服务器并打开页面；浏览器截图确认卡面、己方单位、召唤物和敌方瓜摊老板均来自手绘图集。
- 当前风险：波次敌群与各单位数值仍是原型平衡；完整 roguelike 商店、遗物池、持久进度和大规模敌群尚未实现；WebGL2 不可用时只有提示，没有 Canvas 2D 降级；完整角色动画/音频、移动端设备证据尚未纳入；本轮自动化工具禁止访问本机 `file://`，所以未取得“双击文件”的真实浏览器证据，需用户在本机手动双击 `index.html` 最终确认；GitHub Pages 尚未替用户仓库实际发布。
- 下一项最安全任务：用户手动双击 `index.html` 做一次 `file://` 验证；若仍失败，打开浏览器开发者工具提供第一条 Console 错误，再按错误继续处理。
