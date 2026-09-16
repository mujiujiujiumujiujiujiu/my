import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const simSource = await readFile(new URL('../src/sim.js', import.meta.url), 'utf8');
const webglSource = await readFile(new URL('../src/webgl.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const levels = JSON.parse(await readFile(new URL('../data/levels.json', import.meta.url), 'utf8')).levels;
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

if (mainSource.includes("await this.renderer.loadTexture('./assets/units-handdrawn-atlas.png')")) {
  throw new Error('main.js: 可选纹理不能阻塞进入准备阶段');
}
if (!mainSource.includes('loadTextureStage') || !mainSource.includes('TEXTURE_STAGES') || !mainSource.includes('Promise.allSettled')) {
  throw new Error('main.js: 缺少四档纹理渐进加载与失败回退处理');
}
if (!mainSource.includes('floatingTextNodes')) {
  throw new Error('main.js: 缺少战斗伤害数字渲染层');
}
if (!simSource.includes('beginAction') || !simSource.includes("this.addEffect('impact'")) {
  throw new Error('sim.js: 缺少统一攻击动作与命中反馈链');
}
if (mainSource.includes('drawRing(renderX') || mainSource.includes('drawCircle(renderX')) {
  throw new Error('main.js: 角色本体不能恢复永久圆环或圆形底座');
}
if (!mainSource.includes("style === 'basketball'") || !simSource.includes('projectileStyle')) {
  throw new Error('篮球远程攻击回归检查失败');
}
if (!mainSource.includes('larger world Y') || !mainSource.includes('sort((first, second)')) {
  throw new Error('main.js: 缺少按纵向位置执行的战场遮挡排序');
}
if (!mainSource.includes('scheduleProgressiveAssets') || !mainSource.includes("tier: 'blur'") || !mainSource.includes("tier: 'high'") || !webglSource.includes('qualityTier') || !webglSource.includes('qualitySegments')) {
  throw new Error('四档渐进画质回归检查失败');
}
if (!mainSource.includes('units-handdrawn-atlas-medium.png')
  || !mainSource.includes('battlefield-watercolor-bg-medium.jpg')
  || !mainSource.includes('battlefield-watercolor-bg-high.jpg')) {
  throw new Error('四档渐进画质缺少正常档或高清档资源');
}
if (!mainSource.includes('mobileViewport') || !mainSource.includes('stayLight')) {
  throw new Error('手机首帧必须先使用轻量资源，并保留受限设备的低画质保护');
}
if (!mainSource.includes('const stayLight = constrained || memoryLimited;') || !mainSource.includes('mobileViewport ? 1800 : 1200')) {
  throw new Error('手机轻量首帧之后必须允许普通设备渐进升级高清纹理');
}
if (!mainSource.includes('getViewportMetrics') || !mainSource.includes('isAutoLandscape') || !mainSource.includes('ResizeObserver')) {
  throw new Error('移动端长边方向与布局尺寸观察回归检查失败');
}
if (!mainSource.includes('pointerStillInDock') || !mainSource.includes('getPointerDelta') || !mainSource.includes('getMinimumZoom')) {
  throw new Error('移动端拖卡手势与全场相机缩放回归检查失败');
}
if (!mainSource.includes('getDeploymentBounds') || !mainSource.includes('PLAYER_DEPLOY_BOTTOM')) {
  throw new Error('部署区可见范围回归检查失败');
}
if (!webglSource.includes('generateMipmap') || !webglSource.includes('mobileViewport ? 2 : 1') || !webglSource.includes('this.qualityTier === \'medium\' ? 1.75 : 2.4')) {
  throw new Error('移动端高清纹理与 DPR 回归检查失败');
}
if (!stylesSource.includes('#app.phase-battle, #app.phase-result { grid-template-rows: 64px minmax(0, 1fr) 0;') || !stylesSource.includes('#battlefieldShell { inset: 0; }')) {
  throw new Error('移动端战斗态必须释放部署栏并使用全宽战场');
}
if (!stylesSource.includes('#unitDock {\n  grid-column: 1;') || !stylesSource.includes('overflow-x: hidden; overflow-y: auto;') || !stylesSource.includes('touch-action: pan-y')) {
  throw new Error('部署栏必须位于左侧并支持上下滚动');
}
if (/(wavePlans|waveIndex|totalWaves|spawnWave|advanceWave|waveSpawn)/.test(simSource + mainSource)) {
  throw new Error('战斗运行时代码仍残留波次推进逻辑');
}
if (levels.some((level) => 'waves' in level)) {
  throw new Error('关卡数据仍残留 waves 字段');
}
if (!simSource.includes('getMoveSpeed') || !simSource.includes('moveMultiplier')) {
  throw new Error('近战移动速度必须由数据驱动');
}
if (!mainSource.includes("loading.classList.add('hidden')")) {
  throw new Error('main.js: 初始化失败时必须退出加载遮罩');
}
if (!indexHtml.includes('window.MEME_WAR_EMBEDDED_DATA')) {
  throw new Error('index.html: 缺少静态内嵌数据');
}
if (/<script\s+src=/i.test(indexHtml)) {
  throw new Error('index.html: 直接打开入口不能依赖外部脚本');
}
if (/<link\s+rel=["']stylesheet["']/i.test(indexHtml)) {
  throw new Error('index.html: 直接打开入口不能依赖外部样式表');
}
if (!indexHtml.includes('window.MEME_WAR_TEXTURE_BLUR_DATA')) {
  throw new Error('index.html: 缺少静态内嵌模糊档图集');
}
if (!indexHtml.includes('window.MEME_WAR_BACKGROUND_BLUR_DATA')) {
  throw new Error('index.html: 缺少静态内嵌模糊档战场底图');
}
if (indexHtml.includes('orientationNotice') || indexHtml.includes('请横屏使用') || indexHtml.includes('is-phone-portrait')) {
  throw new Error('index.html: 入口不应依赖横屏提醒，必须自动逻辑横屏渲染');
}
if (!indexHtml.includes('上下滑动浏览')) {
  throw new Error('index.html: 缺少左侧纵向部署栏文案');
}
if (!indexHtml.includes('top-speed-controls') || !stylesSource.includes('.top-speed-controls')) {
  throw new Error('速度控制必须位于标题栏右侧');
}
if (!stylesSource.includes('#sidePanel { display: none !important; }')) {
  throw new Error('右侧任务 UI 必须从可视布局移除');
}
if (!stylesSource.includes('#topbar .budget-stat {\n    display: flex !important;')) {
  throw new Error('手机顶栏必须保留紧凑的剩余预算');
}
if (!stylesSource.includes('/* 手机结算页：自动横屏的物理宽度只有短边，卡片高度必须回到短边内。 */')
  || !stylesSource.includes('.result-actions .button { flex: 1;')) {
  throw new Error('手机结算页必须压缩卡片并保留可点击的下一关/重试按钮');
}

console.log('static runtime guard ok: full-board HUD, automatic landscape rendering, mobile light assets and adaptive texture quality are wired');
