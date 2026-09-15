# 梗战争模拟器交接记录

- 阶段：Prototype
- 玩家结果：在预算内买兵并部署，开战后观看多波自动战斗；波次无缝衔接，不再有战后整备或中途操作，清空整关后进入结算并可前往下一关，用剩余预算获得评级。
- 当前状态：原生 WebGL2 可玩切片已接入《How Many Dudes?》式连续波次自动战斗节奏，并按需求收敛为纯排兵布阵流程；10 关、13 个可部署单位、数据驱动兵种、部署/撤回、拖拽、自动战斗、技能、连续波次、镜头、暂停/倍速和结算已经接通。准备阶段支持“兵种卡拖到左半场直接部署”，已部署单位拖回任意兵种卡会撤销并全额退款。
- 移动与辅助：远程/召唤/辅助单位使用数据中的守距、后撤距离与后撤倍率；近战追击远程或辅助目标时使用追击倍率，避免双方移速相近时近战永远摸不到后排。卡面显示生命、攻击、移速和射程/近战。辅助技能统一支持移速、伤害/攻速、减伤等可计算增益；绿色光环、落点脉冲、头顶增益环、短标签和事件播报会反馈效果，治疗技能在满血目标上也可触发增益。
- 移动端入口：手机方向使用 `visualViewport` 宽高识别，按短边与触控能力判断手机类视口；竖屏时显示横屏门并隐藏战场交互。入口包含 `height=device-height`、横屏 meta、`manifest.webmanifest` 的 `orientation: landscape`；支持的浏览器会在初始尝试和用户点击后调用全屏/`screen.orientation.lock('landscape')`，不支持时保留手动旋转兜底。`resize`、`orientationchange`、`fullscreenchange` 和 `visualViewport.resize` 都会重新适配画布与相机。
- 手机性能：首屏不再等待 2 MB PNG 图集；`index.html` 内嵌数据、样式和运行代码，图集改为 `./assets/units-handdrawn-atlas.png` 的低优先级异步加载，纹理失败会回退颜色/文字与几何占位。移动 WebGL 使用低功耗、关闭抗锯齿、DPR 上限 1.25、较少圆环细分，并降低世界标签 DOM 更新频率。
- 静态发布：`index.html` 不依赖外部脚本、样式或 JSON，可直接双击或部署到 GitHub Pages；完整仓库仍需提交 `assets/units-handdrawn-atlas.png` 与 `manifest.webmanifest`，缺图集时游戏仍可进入但使用占位表现。
- 重要文件：`index.html`、`manifest.webmanifest`、`package.json`、`src/main.js`、`src/sim.js`、`src/webgl.js`、`data/units.json`、`data/levels.json`、`assets/units-handdrawn-atlas.png`、`scripts/check-data.mjs`、`scripts/check-balance.mjs`、`scripts/build-static.mjs`、`scripts/check-static-runtime.mjs`、`scripts/server.mjs`、`scripts/launch.mjs`、`PLAY_GAME.cmd`。
- 验证：`npm run build` 成功；`npm run check` 通过，确认 13 个可部署单位与 10 个关卡数据完整；固定种子基准编队 10/10 关完整清场；远程追击回归确认前排在 14.8 秒追上远程目标；辅助回归确认 4 个技能能施加可计算增益；静态检查确认入口无外部脚本/样式、无 base64 图集且纹理为懒加载相对路径。Playwright 响应式回归确认 844×390 横屏为战场 640×220、侧栏 204px、卡栏 116px、卡片 104×68、无页面溢出；390×844 竖屏会显示横屏门并隐藏应用；准备界面可部署后进入自动战斗，console 无 error/warning。当前生成入口约 146 KB，PNG 图集约 2 MB，不再阻塞首屏 HTML。
- 当前风险：所有阵容的公平性仍需真实试玩；WebGL2 不可用时只有提示，没有 Canvas 2D 降级；浏览器不能在没有用户手势/全屏权限时保证物理屏幕自动旋转，manifest 横屏声明主要对安装到主屏的 PWA 生效；真机 GPU、触控手感、安全区、GitHub Pages 缓存与带宽尚未在本轮复测。
- 下一项最安全任务：先在一台真实手机上通过 GitHub Pages 横屏打开，记录首次可操作时间、图集出现时间、旋转门行为和 10 关中实际卡关点；再根据真实数据微调单位移速/守距/辅助持续时间，不先扩大技能系统。
