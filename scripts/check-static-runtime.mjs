import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

if (mainSource.includes("await this.renderer.loadTexture('./assets/units-handdrawn-atlas.png')")) {
  throw new Error('main.js: 可选纹理不能阻塞进入准备阶段');
}
if (!mainSource.includes('this.renderer.loadTexture(UNIT_TEXTURE_URL)') || !mainSource.includes('.catch(() =>')) {
  throw new Error('main.js: 缺少纹理失败回退处理');
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
if (!indexHtml.includes('window.MEME_WAR_TEXTURE_URL')) {
  throw new Error('index.html: 缺少可选图集路径');
}
if (indexHtml.includes('data:image/png;base64,')) {
  throw new Error('index.html: 不应把大图集转成 base64 阻塞手机首屏');
}

console.log('static runtime guard ok: index.html has embedded runtime/data and delayed external texture');
