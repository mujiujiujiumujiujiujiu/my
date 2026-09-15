import { readFile, stat } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const simSource = await readFile(new URL('../src/sim.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mobileTexturePath = new URL('../assets/units-handdrawn-atlas-mobile.webp', import.meta.url);

try {
  const mobileTexture = await stat(mobileTexturePath);
  if (!mobileTexture.isFile() || mobileTexture.size <= 0) throw new Error('empty file');
} catch {
  throw new Error('assets/units-handdrawn-atlas-mobile.webp: 缺少默认移动端清晰图集');
}

if (mainSource.includes("await this.renderer.loadTexture('./assets/units-handdrawn-atlas.png')")) {
  throw new Error('main.js: 可选纹理不能阻塞进入准备阶段');
}
if (!mainSource.includes('this.renderer.loadTexture(UNIT_TEXTURE_URL)') || !mainSource.includes('.catch(() =>')) {
  throw new Error('main.js: 缺少纹理失败回退处理');
}
if (!mainSource.includes("window.location.protocol === 'file:'") || !mainSource.includes('syncFileSpriteFallback')) {
  throw new Error('main.js: 缺少 file:// 美术回退层，直接双击入口会丢失角色图');
}
if (!mainSource.includes('isDeploymentPositionFree') || !mainSource.includes('getUnitFootprintRadius')) {
  throw new Error('main.js: 缺少部署阶段的不重叠判定');
}
if (!mainSource.includes('startScrollLeft') || !mainSource.includes('cardPointer.scrolling')) {
  throw new Error('main.js: 缺少虚拟横屏卡栏的手势分流滚动');
}
if (!simSource.includes('COLLISION_ITERATIONS') || !simSource.includes('getMinimumSeparation')) {
  throw new Error('sim.js: 缺少战斗阶段的多轮不重叠碰撞求解');
}
if (!stylesSource.includes('html.is-virtual-landscape .unit-card') || !stylesSource.includes('touch-action: none')) {
  throw new Error('styles.css: 缺少虚拟横屏卡栏触控手势接管');
}
if (!mainSource.includes('this.renderer.isMobile') || !mainSource.includes('1800')) {
  throw new Error('main.js: 手机纹理必须延后加载，避免抢占首屏带宽');
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
if (!indexHtml.includes("window.MEME_WAR_TEXTURE_URL = './assets/units-handdrawn-atlas-mobile.webp'")) {
  throw new Error('index.html: 缺少移动端清晰图集路径');
}
if (!indexHtml.includes('id="worldSprites"')) {
  throw new Error('index.html: 缺少直接打开入口的角色美术回退层');
}
if (indexHtml.includes('data:image/png;base64,')) {
  throw new Error('index.html: 不应把大图集转成 base64 阻塞手机首屏');
}

console.log('static runtime guard ok: embedded runtime/data, delayed external texture, and file:// art fallback');
