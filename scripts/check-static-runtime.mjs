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
if (!mainSource.includes('this.renderer.loadTexture(UNIT_TEXTURE_URL)') || !mainSource.includes('Promise.allSettled')) {
  throw new Error('main.js: 缺少渐进高清纹理加载与失败回退处理');
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
if (!mainSource.includes('scheduleProgressiveAssets') || !webglSource.includes('qualityTier') || !webglSource.includes('qualitySegments')) {
  throw new Error('渐进画质回归检查失败');
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
if (!webglSource.includes('generateMipmap') || !webglSource.includes('return this.qualityTier === \'low\' ? 1 : this.qualityTier === \'medium\' ? 1.75 : 2.4')) {
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
if (!indexHtml.includes('window.MEME_WAR_TEXTURE_DATA')) {
  throw new Error('index.html: 缺少静态内嵌图集');
}
if (!indexHtml.includes('window.MEME_WAR_BACKGROUND_DATA')) {
  throw new Error('index.html: 缺少静态内嵌战场底图');
}
if (indexHtml.includes('orientationNotice') || indexHtml.includes('请横屏使用') || indexHtml.includes('is-phone-portrait')) {
  throw new Error('index.html: 入口不应依赖横屏提醒，必须自动逻辑横屏渲染');
}
if (!indexHtml.includes('上下滑动浏览')) {
  throw new Error('index.html: 缺少左侧纵向部署栏文案');
}

console.log('static runtime guard ok: self-contained one-roster battle, automatic landscape portrait rendering and high-DPR full-board mobile layout are wired');
