# 调试交接记录

## 本轮错误现象

- 手机端首屏加载慢，纹理图集与页面启动互相拖慢。
- 手机浏览器默认竖屏打开，战场布局不可用。
- 远程单位与近战单位基础移速过于接近，近战可能长期追不上后排；辅助技能的数值变化缺少可见反馈。
- 早期直接双击入口曾停留在“正在加载战场数据…”，Console 报告 `file://` 外部脚本被 CORS 拦截。

## 根因与修复

- 首屏根因：原构建把约 2 MB PNG 图集转成 base64 放入 HTML，并在初始化路径等待纹理。现在 `scripts/build-static.mjs` 只内嵌数据、CSS 和运行时代码，默认纹理改为约 112 KB 的 `./assets/units-handdrawn-atlas-low.webp`；`src/main.js` 先隐藏加载层并启动准备界面，手机端延后约 1.8 秒或在首次触控时加载图集，桌面端使用 `requestIdleCallback`/定时器，卡片和战场都有占位回退。
- 直接打开美术缺失根因：`file://` 下 PNG 请求本身成功，但浏览器把本地 `Image` 标记为 cross-origin，`WebGL2RenderingContext.texImage2D()` 拒绝上传，因此战场只剩几何圆形。现在 `src/webgl.js` 捕获纹理上传异常，`src/main.js` 在 `file:` 协议下通过 `#worldSprites` 使用同一张图集的 CSS 背景裁切；HTTP/GitHub Pages 继续使用 WebGL 纹理，不增加首屏内嵌体积。
- 横屏根因：网页没有可靠权限强制旋转物理屏幕，旧实现依赖横屏门，导致浏览器拒绝锁定时无法游玩。现在首屏脚本与 CSS 按视口 `x/y` 判断长边：`x > y` 使用普通横屏；`y > x` 加入 `is-virtual-landscape`，将 `#app` 旋转 90°并用 `100dvh × 100dvw` 填满视口。`src/main.js` 的 Canvas、相机、点击、兵卡拖拽和撤销命中测试均使用旋转后的逻辑坐标；`src/webgl.js` 用未变换的 offset 尺寸设置 backing buffer。物理全屏与 `screen.orientation.lock('landscape')` 仍会 best-effort 尝试，但失败不再显示阻塞门。
- 地图裁切根因：真实手机常见 `432×804` CSS 视口在虚拟横屏后只有约 `600×262` 的逻辑战场区域；旧 `MIN_ZOOM=0.42` 使世界宽度 `1600×0.42` 大于 Canvas 宽度，导致左右边界被裁掉。现在 `MIN_ZOOM=0.24`，`fitCamera()` 在 `0.295` 左右即可把世界四角完整放入小屏 Canvas。
- 移速根因：所有单位只使用一个 `spd`，追击和后撤没有行为差异。现在 `data/units.json` 为远程/辅助配置守距与后撤距离，为近战配置追击倍率；`src/sim.js` 在寻路时区分保持距离、后撤和近战追击，战斗回归确认嘎子能追上蔡徐坤。
- 辅助反馈根因：辅助只改变生命或控制，无法判断增益是否生效。现在支持 `haste`、`damageBonus`、`damageReduction`、`duration`、`buffLabel` 等数据字段；模拟器把它们应用到移动、攻击和承伤计算，并生成绿色增益环、短标签、浮动文字与事件效果。奶蛙即使治疗满血目标，也会优先施加护佑。

## 已尝试修法与证据

- 已将 JSON、CSS 和运行时代码内嵌到 `index.html`；静态入口不含外部 `<script src>`、外部 stylesheet 或 base64 PNG。
- 已将图集改成懒加载；静态运行时检查确认包含 `window.MEME_WAR_TEXTURE_URL`，且不包含 `data:image/png;base64,`。
- 已加入 `manifest.webmanifest`，声明 `display: fullscreen` 与 `orientation: landscape`，并在 `index.html` 增加 `height=device-height`、横屏 meta 和首屏方向检测脚本。
- 已通过 `npm run check`：Node 语法检查、数据检查、10 关固定种子平衡烟测、移速追击回归、辅助增益回归、静态入口检查与构建过期检查均通过。
- 已通过 Playwright 响应式回归：844×390 横屏得到 `54px / 220px / 116px` 行高，战场 640×220、侧栏 204px、卡片底部 389px，不再被卡栏裁切；390×844 竖屏得到 `virtual-landscape`，应用填满 `390×844` 视口，视觉 Canvas 为 `220×640`、WebGL backing 仍为 `640×220`，文档无溢出。竖屏点击部署、触控从兵卡拖入战场、拖回兵卡撤销和开始战斗均已回归。首次 HTML DOMContentLoaded 约 37ms、传输约 146 KB，手机图集请求在约 1.84s 后才开始，之后仍能进入战斗。
- 已通过 Playwright 美术回归：HTTP `spriteReady=true`、13 张卡面图集可见；直接 `file://` 下 `spriteReady=false` 但 2 个敌方预览角色通过 `#worldSprites` 显示手绘图，加载层隐藏、Toast 为空、Console error 为 0。`src/webgl.js` 的安全异常已被捕获，不再留下未处理事件异常。
- 已通过 Playwright 小屏回归：触控 `432×804` 视口进入 `virtual-landscape`，逻辑 Canvas `600×262`、相机 `0.295`，世界四角均在可视范围内；默认低清 WebP 请求约 112 KB，HTTP WebGL 加载成功。

## 本轮可重复验证

1. 在 `C:\Users\Asus\Desktop\a\meme-war-sim` 运行 `npm run check`。
2. 运行 `npm run start`，打开 `http://127.0.0.1:4173/`。
3. 横屏准备阶段确认卡面先出现颜色/首字占位，稍后才替换为图集；断开/改名 PNG 时仍应能进入战斗并看到几何占位。
4. 在触控或 DevTools 移动视口中分别测试 `x > y` 与 `y > x`：前者应保持普通横屏，后者应进入虚拟横屏且不出现阻塞门；确认长边作为游戏宽度、Canvas 与点击/拖拽位置一致。支持的设备点击“尝试自动横屏”时可进入全屏/锁定流程，不支持的设备仍应保持可玩的虚拟横屏。
5. 部署嘎子/华强与蔡徐坤，确认近战能追击；部署奶蛙或圆头耄耋，确认绿色增益环、增益标签与攻击/移速变化出现。

## 当前风险

- 真实手机的物理旋转权限、GPU、触控手感、旋转后的文字可读性、刘海/手势条安全区和网络缓存尚未在本轮实际设备验证；浏览器拒绝锁定时，竖直握持会看到旋转后的横向舞台，这是 Web 页面无法强制改变 OS 物理方向的边界。
- GitHub Pages 尚未替用户仓库实际发布，首次/二次加载耗时需要用目标手机与目标网络测量。
- WebGL2 不可用时只有可见错误提示，没有 Canvas 2D 降级。
- 纹理失败回退保证可玩性，但视觉上会退回几何/文字占位；完整仓库必须提交 `assets/units-handdrawn-atlas-low.webp`，高清 PNG 只是可选源文件。
- `file://` 的 DOM 美术回退只解决本地入口的 WebGL 安全策略；如果 GitHub 仓库漏提交 `assets/units-handdrawn-atlas-low.webp`，HTTP 和本地入口都无法显示默认手绘图，只会显示占位。

## UI 审计

- Readable：8/10
- UX：8/10
- Accessibility：7/10
- Commercial：9/10
- Retention：8/10
- Google Play Risk：4/10

尚未测试：真实手机横屏 GPU/触控、安全区、GitHub Pages 首次网络加载。
