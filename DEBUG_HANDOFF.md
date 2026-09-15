# 调试交接记录

## 本轮错误现象

- 手机端首屏加载慢，纹理图集与页面启动互相拖慢。
- 手机浏览器默认竖屏打开，战场布局不可用。
- 远程单位与近战单位基础移速过于接近，近战可能长期追不上后排；辅助技能的数值变化缺少可见反馈。
- 早期直接双击入口曾停留在“正在加载战场数据…”，Console 报告 `file://` 外部脚本被 CORS 拦截。

## 根因与修复

- 首屏根因：原构建把约 2 MB PNG 图集转成 base64 放入 HTML，并在初始化路径等待纹理。现在 `scripts/build-static.mjs` 只内嵌数据、CSS 和运行时代码，纹理改为 `./assets/units-handdrawn-atlas.png`；`src/main.js` 先隐藏加载层并启动准备界面，手机端延后约 1.8 秒或在首次触控时加载图集，桌面端使用 `requestIdleCallback`/定时器，卡片和战场都有占位回退。
- 横屏根因：网页没有可靠权限强制旋转物理屏幕。现在入口同步设置横屏 meta，并在首屏脚本与 CSS 中按视口宽高识别竖屏手机；`src/main.js` 监听 `visualViewport`、`resize`、`orientationchange`、`fullscreenchange`，竖屏显示横屏门、隐藏战场。用户点击按钮后依次尝试全屏和 `screen.orientation.lock('landscape')`；浏览器拒绝时仍可手动旋转。
- 移速根因：所有单位只使用一个 `spd`，追击和后撤没有行为差异。现在 `data/units.json` 为远程/辅助配置守距与后撤距离，为近战配置追击倍率；`src/sim.js` 在寻路时区分保持距离、后撤和近战追击，战斗回归确认嘎子能追上蔡徐坤。
- 辅助反馈根因：辅助只改变生命或控制，无法判断增益是否生效。现在支持 `haste`、`damageBonus`、`damageReduction`、`duration`、`buffLabel` 等数据字段；模拟器把它们应用到移动、攻击和承伤计算，并生成绿色增益环、短标签、浮动文字与事件效果。奶蛙即使治疗满血目标，也会优先施加护佑。

## 已尝试修法与证据

- 已将 JSON、CSS 和运行时代码内嵌到 `index.html`；静态入口不含外部 `<script src>`、外部 stylesheet 或 base64 PNG。
- 已将图集改成懒加载；静态运行时检查确认包含 `window.MEME_WAR_TEXTURE_URL`，且不包含 `data:image/png;base64,`。
- 已加入 `manifest.webmanifest`，声明 `display: fullscreen` 与 `orientation: landscape`，并在 `index.html` 增加 `height=device-height`、横屏 meta 和首屏方向检测脚本。
- 已通过 `npm run check`：Node 语法检查、数据检查、10 关固定种子平衡烟测、移速追击回归、辅助增益回归、静态入口检查与构建过期检查均通过。
- 已通过 Playwright 响应式回归：844×390 横屏得到 `54px / 220px / 116px` 行高，战场 640×220、侧栏 204px、卡片底部 389px，不再被卡栏裁切；390×844 竖屏得到横屏门 `display:grid`、`#app visibility:hidden`、文档无溢出。首次 HTML DOMContentLoaded 约 37ms、传输约 146 KB，手机图集请求在约 1.84s 后才开始，之后仍能进入战斗。

## 本轮可重复验证

1. 在 `C:\Users\Asus\Desktop\a\meme-war-sim` 运行 `npm run check`。
2. 运行 `npm run start`，打开 `http://127.0.0.1:4173/`。
3. 横屏准备阶段确认卡面先出现颜色/首字占位，稍后才替换为图集；断开/改名 PNG 时仍应能进入战斗并看到几何占位。
4. 在触控或 DevTools 移动视口中切到竖屏，确认只看到旋转门；切回横屏后确认战场恢复。点击“尝试自动横屏”时，支持的设备应进入全屏/锁定流程，不支持的设备应保持手动旋转提示。
5. 部署嘎子/华强与蔡徐坤，确认近战能追击；部署奶蛙或圆头耄耋，确认绿色增益环、增益标签与攻击/移速变化出现。

## 当前风险

- 真实手机的屏幕旋转权限、GPU、触控坐标、安全区和网络缓存尚未在本轮实际设备验证。
- GitHub Pages 尚未替用户仓库实际发布，首次/二次加载耗时需要用目标手机与目标网络测量。
- WebGL2 不可用时只有可见错误提示，没有 Canvas 2D 降级。
- 纹理失败回退保证可玩性，但视觉上会退回几何/文字占位；完整仓库必须提交 `assets/units-handdrawn-atlas.png`。

## UI 审计

- Readable：8/10
- UX：8/10
- Accessibility：7/10
- Commercial：9/10
- Retention：8/10
- Google Play Risk：4/10

尚未测试：真实手机横屏 GPU/触控、安全区、GitHub Pages 首次网络加载。
