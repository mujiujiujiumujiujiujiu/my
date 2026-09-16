const { BattleSimulation, WORLD } = window.MemeWarSim;
const { NativeWebGLRenderer } = window.MemeWarWebGL;

const UNIT_TEXTURE_URL = window.MEME_WAR_TEXTURE_DATA || './assets/units-handdrawn-atlas.png';
const BACKGROUND_TEXTURE_URL = window.MEME_WAR_BACKGROUND_DATA || './assets/battlefield-watercolor-bg-high.jpg';
const UNIT_TEXTURE_BLUR_URL = window.MEME_WAR_TEXTURE_BLUR_DATA || './assets/units-handdrawn-atlas-blur.png';
const BACKGROUND_TEXTURE_BLUR_URL = window.MEME_WAR_BACKGROUND_BLUR_DATA || './assets/battlefield-watercolor-bg-blur.jpg';
const UNIT_TEXTURE_LOW_URL = './assets/units-handdrawn-atlas-low.png';
const BACKGROUND_TEXTURE_LOW_URL = './assets/battlefield-watercolor-bg-low.jpg';
const UNIT_TEXTURE_MEDIUM_URL = './assets/units-handdrawn-atlas-medium.png';
const BACKGROUND_TEXTURE_MEDIUM_URL = './assets/battlefield-watercolor-bg-medium.jpg';
const TEXTURE_STAGES = Object.freeze([
  { tier: 'blur', unit: UNIT_TEXTURE_BLUR_URL, background: BACKGROUND_TEXTURE_BLUR_URL },
  { tier: 'low', unit: UNIT_TEXTURE_LOW_URL, background: BACKGROUND_TEXTURE_LOW_URL },
  { tier: 'medium', unit: UNIT_TEXTURE_MEDIUM_URL, background: BACKGROUND_TEXTURE_MEDIUM_URL },
  { tier: 'high', unit: UNIT_TEXTURE_URL, background: BACKGROUND_TEXTURE_URL },
]);
const MAX_DEPLOYMENTS = 24;
const MIN_ZOOM = 0.42;
const MOBILE_MIN_ZOOM = 0.22;
const MAX_ZOOM = 1.45;
const PLAYER_ZONE_RIGHT = 760;
const PLAYER_SAFE_MARGIN = 48;
const PLAYER_DEPLOY_TOP = 120;
const PLAYER_DEPLOY_BOTTOM = 610;
const SKILL_TYPE_ICONS = Object.freeze({
  dash: '↗',
  execute: '✦',
  cone: '◒',
  pulse: '◎',
  charge: '➤',
  slowPulse: '≋',
  guard: '◇',
  taunt: '!',
  fear: '◉',
  aoe: '✹',
  summon: '✚',
  aoeSlow: '≋',
  aoeDebuff: '≋',
  heal: '＋',
  delayed: '◌',
  aura: '◍',
  blink: '✧',
  mark: '◆',
});

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalize = (x, y) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};
const formatClock = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

function getViewportMetrics() {
  const width = Math.max(1, Number(window.visualViewport?.width) || window.innerWidth || 1);
  const height = Math.max(1, Number(window.visualViewport?.height) || window.innerHeight || 1);
  return {
    width,
    height,
    longEdge: Math.max(width, height),
    shortEdge: Math.min(width, height),
    isLandscape: width >= height,
  };
}

function isConstrainedDevice() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData) || ['slow-2g', '2g'].includes(connection?.effectiveType);
}

function getInitialQualityTier() {
  const memoryLimited = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 2;
  const { shortEdge } = getViewportMetrics();
  if (isConstrainedDevice() || memoryLimited || shortEdge < 600) return 'blur';
  return 'low';
}

function makeElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

class TinyAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.enabled) return;
    this.userGesture = true;
    try {
      if (!this.context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          this.enabled = false;
          return;
        }
        this.context = new AudioContextClass();
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch (error) {
      this.enabled = false;
      this.context = null;
    }
  }

  blip(frequency = 360, duration = 0.07, type = 'sine', volume = 0.025) {
    if (!this.userGesture) return;
    this.unlock();
    if (!this.context) return;
    try {
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.72), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch (error) {
      this.enabled = false;
      this.context = null;
    }
  }

  event(tone) {
    if (!this.userGesture) return;
    const sounds = {
      skill: [620, 0.12, 'triangle', 0.035],
      reward: [780, 0.18, 'sine', 0.04],
      danger: [150, 0.16, 'sawtooth', 0.026],
      combat: [250, 0.04, 'square', 0.012],
      result: [510, 0.16, 'triangle', 0.03],
      info: [320, 0.05, 'sine', 0.014],
    };
    const [frequency, duration, type, volume] = sounds[tone] ?? sounds.info;
    this.blip(frequency, duration, type, volume);
  }
}

class MemeWarApp {
  constructor(unitsData, levelsData) {
    this.units = unitsData.units;
    this.unitsById = Object.fromEntries(this.units.map((unit) => [unit.id, unit]));
    this.levels = levelsData.levels;
    this.audio = new TinyAudio();
    this.canvas = $('#gameCanvas');
    this.worldLabels = $('#worldLabels');
    this.renderer = null;
    this.simulation = null;
    this.phase = 'prep';
    this.levelIndex = 0;
    this.level = this.levels[0];
    this.deployments = [];
    this.spent = 0;
    this.nextDeploymentId = 1;
    this.selectedUnitId = null;
    this.draggedDeployment = null;
    this.cardPointer = null;
    this.draggedUnit = null;
    this.dockScrollDrag = null;
    this.suppressCardClick = false;
    this.suppressCardClickTimer = null;
    this.hoverWorld = null;
    this.cameraDrag = null;
    this.slowInput = false;
    this.paused = false;
    this.speed = 1;
    this.viewport = getViewportMetrics();
    this.layoutResizeObserver = null;
    this.panelCollapsed = false;
    this.initialQualityTier = getInitialQualityTier();
    this.unitTextureUrl = null;
    this.renderTime = 0;
    this.lastFrameTime = 0;
    this.resultShown = false;
    this.labelNodes = new Map();
    this.effectLabelNodes = new Map();
    this.floatingTextNodes = new Map();

    this.camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 0.72 };
    this.elements = {
      app: $('#app'),
      battlefieldShell: $('#battlefieldShell'),
      panelToggle: $('#panelToggle'),
      phaseLabel: $('#phaseLabel'),
      budgetLabel: $('#budgetLabel'),
      levelSelect: $('#levelSelect'),
      pauseButton: $('#pauseButton'),
      startButton: $('#startButton'),
      resetButton: $('#resetButton'),
      prepGuide: $('#prepGuide'),
      battleGuide: $('#battleGuide'),
      levelTitle: $('#levelTitle'),
      levelSubtitle: $('#levelSubtitle'),
      levelNumber: $('#levelNumber'),
      levelTip: $('#levelTip'),
      enemyReadout: $('#enemyReadout'),
      battleClock: $('#battleClock'),
      playerCount: $('#playerCount'),
      enemyCount: $('#enemyCount'),
      battleProgress: $('#battleProgress'),
      eventLog: $('#eventLog'),
      speedReadout: $('#speedReadout'),
      unitList: $('#unitList'),
      deployedCount: $('#deployedCount'),
      resultOverlay: $('#resultOverlay'),
      resultCard: $('.result-card'),
      resultStamp: $('#resultStamp'),
      resultLevelName: $('#resultLevelName'),
      resultTitle: $('#resultTitle'),
      resultSummary: $('#resultSummary'),
      resultInitial: $('#resultInitial'),
      resultSpent: $('#resultSpent'),
      resultBonus: $('#resultBonus'),
      resultRemaining: $('#resultRemaining'),
      resultRating: $('#resultRating'),
      resultRatio: $('#resultRatio'),
      retryButton: $('#retryButton'),
      nextButton: $('#nextButton'),
      toast: $('#toast'),
      loading: $('#loading'),
      webglFallback: $('#webglFallback'),
    };
    this.toastTimer = null;
  }

  async init() {
    this.updateViewportState();
    this.setInfoPanelCollapsed(false);
    this.populateLevelPicker();
    this.populateUnitDock();
    this.bindEvents();
    this.updateLevelUi();

    try {
      this.renderer = new NativeWebGLRenderer(this.canvas);
      this.renderer.setQuality(this.initialQualityTier);
      this.fitCamera();
    } catch (error) {
      console.error(error);
      this.elements.webglFallback.classList.remove('hidden');
      this.elements.loading.classList.add('hidden');
      this.elements.startButton.disabled = true;
      this.showToast('无法初始化 WebGL2，请打开浏览器硬件加速后刷新。');
      return;
    }

    const handleViewportChange = () => {
      this.updateViewportState();
      this.syncRendererToLayout({ preserveFocus: this.phase !== 'prep' });
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    if (window.ResizeObserver && this.elements.battlefieldShell) {
      this.layoutResizeObserver = new ResizeObserver(() => {
        this.syncRendererToLayout({ preserveFocus: this.phase !== 'prep' });
      });
      this.layoutResizeObserver.observe(this.elements.battlefieldShell);
    }
    this.elements.loading.classList.add('hidden');
    this.logEvent({ text: '战场加载完成。挑一张卡，然后把它放进左半场。', tone: 'info' });
    this.syncUi();
    this.render();
    this.scheduleProgressiveAssets();
    window.requestAnimationFrame((time) => this.frame(time));
  }

  scheduleProgressiveAssets() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const constrained = Boolean(connection?.saveData) || ['slow-2g', '2g'].includes(connection?.effectiveType);
    const viewport = getViewportMetrics();
    const mobileViewport = viewport.shortEdge <= 600;
    const memoryLimited = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 2;
    // 先用内嵌模糊档保证首帧；普通设备随后逐档换清晰，省流量/慢网或低内存设备停在安全档。
    const stayLight = constrained || memoryLimited;
    const idleTimeout = mobileViewport ? 1800 : 1200;
    const schedule = window.requestIdleCallback
      ? (callback) => window.requestIdleCallback(callback, { timeout: idleTimeout })
      : (callback) => window.setTimeout(callback, mobileViewport ? 450 : 90);

    const loadTextureStage = async (stage) => {
      if (!this.renderer) return;
      const textureResults = await Promise.allSettled([
        this.renderer.loadTexture(stage.unit),
        this.renderer.loadBackgroundTexture(stage.background),
      ]);
      if (textureResults[0]?.status === 'fulfilled') {
        this.unitTextureUrl = stage.unit;
        this.applyUnitGlyphTextures();
      }
      if (textureResults.some((result) => result.status === 'fulfilled')) this.renderer.setQuality(stage.tier);
      if (textureResults.some((result) => result.status === 'rejected') && stage.tier === 'high') {
        this.showToast('高清素材加载失败，已保留当前可用画质。');
      }
      this.render();
      return textureResults;
    };

    // 最小档在首帧后立即解码；后续档位串行加载，避免同时抢占手机网络与解码内存。
    const blurTask = loadTextureStage(TEXTURE_STAGES[0]);
    schedule(async () => {
      await blurTask;
      const finalStageIndex = stayLight ? 2 : TEXTURE_STAGES.length;
      for (const stage of TEXTURE_STAGES.slice(1, finalStageIndex)) {
        await loadTextureStage(stage);
        // 每档之间让出一帧，避免升级纹理时阻塞拖卡与战斗输入。
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    });
  }

  updateViewportState() {
    const nextViewport = getViewportMetrics();
    const isPhoneViewport = nextViewport.shortEdge <= 600 && nextViewport.longEdge <= 1400;
    const shouldAutoLandscape = isPhoneViewport && !nextViewport.isLandscape;
    this.viewport = nextViewport;
    document.documentElement.style.setProperty('--viewport-long-edge', `${nextViewport.longEdge}px`);
    document.documentElement.style.setProperty('--viewport-short-edge', `${nextViewport.shortEdge}px`);
    this.elements.app.classList.toggle('is-auto-landscape', shouldAutoLandscape);
  }

  get isCompactLandscape() {
    return Boolean(this.viewport?.isLandscape && this.viewport.shortEdge <= 600 && this.viewport.longEdge <= 1400);
  }

  get isAutoLandscape() {
    return Boolean(this.viewport && !this.viewport.isLandscape && this.viewport.shortEdge <= 600 && this.viewport.longEdge <= 1400);
  }

  getMinimumZoom() {
    return this.isCompactLandscape || this.isAutoLandscape ? MOBILE_MIN_ZOOM : MIN_ZOOM;
  }

  setInfoPanelCollapsed(collapsed) {
    this.panelCollapsed = Boolean(collapsed);
    this.elements.app.classList.toggle('is-panel-collapsed', this.panelCollapsed);
    if (this.elements.panelToggle) {
      this.elements.panelToggle.textContent = this.panelCollapsed ? '展开' : '收起';
      this.elements.panelToggle.setAttribute('aria-expanded', String(!this.panelCollapsed));
    }
  }

  toggleInfoPanel() {
    this.setInfoPanelCollapsed(!this.panelCollapsed);
  }

  syncRendererToLayout({ preserveFocus = false } = {}) {
    if (!this.renderer) return;
    this.renderer.resize();
    this.fitCamera({ preserveFocus });
    this.render();
  }

  populateLevelPicker() {
    this.elements.levelSelect.replaceChildren();
    for (const [index, level] of this.levels.entries()) {
      const option = makeElement('option', '', `第 ${String(level.id).padStart(2, '0')} · ${level.name}`);
      option.value = String(index);
      this.elements.levelSelect.append(option);
    }
  }

  populateUnitDock() {
    const playableUnits = this.units
      .filter((unit) => !unit.enemyOnly)
      .sort((first, second) => second.price - first.price || first.name.localeCompare(second.name, 'zh'));
    this.elements.unitList.replaceChildren();
    for (const unit of playableUnits) {
      const card = makeElement('button', 'unit-card');
      card.type = 'button';
      card.dataset.unitId = unit.id;
      const skillSummary = (unit.skills ?? []).map((skill) => `${SKILL_TYPE_ICONS[skill.type] ?? '·'} ${skill.name}`).join(' · ') || '基础攻击';
      card.setAttribute('aria-label', `${unit.name}，${unit.price} 金，${unit.roleLabel}，技能：${skillSummary}，可拖到左侧战场部署`);

      const top = makeElement('div', 'card-top');
      const glyph = makeElement('span', 'unit-glyph', unit.name.slice(0, 1));
      glyph.style.background = unit.color;
      if (Number.isInteger(unit.spriteIndex)) {
        const spriteColumn = unit.spriteIndex % 4;
        const spriteRow = Math.floor(unit.spriteIndex / 4);
        glyph.textContent = '';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.dataset.spriteIndex = String(unit.spriteIndex);
        glyph.style.backgroundSize = '400% 400%';
        glyph.style.backgroundPosition = `${spriteColumn * (100 / 3)}% ${spriteRow * (100 / 3)}%`;
      }
      const price = makeElement('span', 'unit-price', `${unit.price} 金`);
      top.append(glyph, price);

      const name = makeElement('div', 'unit-name', unit.name);
      const role = makeElement('div', 'unit-role', unit.roleLabel);
      const skillLine = makeElement('div', 'unit-skill-line', skillSummary);
      skillLine.title = `技能：${skillSummary}`;
      const stats = makeElement('div', 'unit-stats');
      const hp = makeElement('span', '', `❤ ${unit.hp}`);
      const atk = makeElement('b', '', unit.role === 'deployable' ? '路障' : `⚔ ${unit.atk}`);
      stats.append(hp, atk);
      card.append(top, name, role, skillLine, stats);
      card.addEventListener('pointerdown', (event) => this.onUnitCardPointerDown(event, unit.id));
      card.addEventListener('click', () => {
        if (this.suppressCardClick) {
          this.suppressCardClick = false;
          window.clearTimeout(this.suppressCardClickTimer);
          return;
        }
        this.selectUnit(unit.id);
      });
      this.elements.unitList.append(card);
    }
    this.updateUnitCards();
    this.applyUnitGlyphTextures();
  }

  applyUnitGlyphTextures() {
    for (const glyph of this.elements.unitList.querySelectorAll('.unit-glyph[data-sprite-index]')) {
      glyph.style.backgroundImage = this.unitTextureUrl ? `url("${this.unitTextureUrl}")` : 'none';
    }
  }

  bindEvents() {
    this.elements.startButton.addEventListener('click', () => this.startBattle());
    this.elements.pauseButton.addEventListener('click', () => this.togglePause());
    this.elements.resetButton.addEventListener('click', () => this.resetLevel(this.levelIndex));
    this.elements.retryButton.addEventListener('click', () => this.resetLevel(this.levelIndex));
    this.elements.nextButton.addEventListener('click', () => {
      if (this.levelIndex < this.levels.length - 1) this.resetLevel(this.levelIndex + 1);
      else this.resetLevel(this.levelIndex);
    });
    this.elements.levelSelect.addEventListener('change', (event) => {
      const index = Number.parseInt(event.target.value, 10);
      if (Number.isFinite(index)) this.resetLevel(index);
    });
    for (const button of document.querySelectorAll('.speed-button')) {
      button.addEventListener('click', () => this.setSpeed(Number(button.dataset.speed)));
    }
    this.elements.unitList.addEventListener('pointerdown', (event) => this.onUnitListPointerDown(event));
    this.elements.panelToggle?.addEventListener('click', () => this.toggleInfoPanel());

    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (this.phase !== 'prep') return;
      const world = this.pointerToWorld(event);
      const deployment = this.findDeploymentAt(world.x, world.y);
      if (deployment) {
        this.removeDeployment(deployment);
        this.audio.blip(190, 0.06, 'square', 0.018);
      }
    });
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    window.addEventListener('pointermove', (event) => this.onGlobalPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onGlobalPointerUp(event));
    window.addEventListener('pointercancel', (event) => this.onGlobalPointerUp(event));

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        this.togglePause();
      }
      if (event.key === 'g' || event.key === 'G') this.slowInput = true;
      if (event.key === '1' || event.key === '2' || event.key === '4') this.setSpeed(Number(event.key));
      if (event.key === 'Escape') this.selectedUnitId = null;
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === 'g' || event.key === 'G') this.slowInput = false;
    });
    window.addEventListener('blur', () => {
      this.slowInput = false;
      this.cameraDrag = null;
      this.cardPointer = null;
      this.finishUnitCardDrag();
      this.elements.app.classList.remove('is-dragging-deployment');
      this.updateDragDropUi();
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
  }

  resetLevel(index = this.levelIndex) {
    this.levelIndex = clamp(index, 0, this.levels.length - 1);
    this.level = this.levels[this.levelIndex];
    this.phase = 'prep';
    this.deployments = [];
    this.spent = 0;
    this.nextDeploymentId = 1;
    this.selectedUnitId = null;
    this.draggedDeployment = null;
    this.cardPointer = null;
    this.draggedUnit = null;
    this.dockScrollDrag = null;
    this.suppressCardClick = false;
    window.clearTimeout(this.suppressCardClickTimer);
    this.suppressCardClickTimer = null;
    this.cameraDrag = null;
    this.hoverWorld = null;
    this.simulation = null;
    this.paused = false;
    this.resultShown = false;
    this.camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 0.72 };
    this.elements.app.classList.remove('phase-battle', 'phase-result');
    this.elements.app.classList.add('phase-prep');
    this.setInfoPanelCollapsed(false);
    this.elements.app.classList.remove('is-dragging-unit', 'drag-valid', 'is-dragging-deployment');
    this.syncRendererToLayout();
    this.updateDragDropUi();
    this.elements.resultOverlay.classList.add('hidden');
    this.elements.levelSelect.value = String(this.levelIndex);
    this.elements.eventLog.replaceChildren();
    this.updateLevelUi();
    this.logEvent({ text: `第 ${this.level.id} 关已重置，等待你的解法。`, tone: 'info' });
    this.syncUi();
    this.audio.blip(280, 0.06, 'sine', 0.018);
  }

  updateLevelUi() {
    const level = this.level;
    this.elements.levelTitle.textContent = level.name;
    this.elements.levelSubtitle.textContent = level.subtitle;
    this.elements.levelNumber.textContent = String(level.id).padStart(2, '0');
    this.elements.levelTip.textContent = level.tip;
    this.elements.resultLevelName.textContent = level.name;
  }

  selectUnit(unitId) {
    if (this.phase !== 'prep') return;
    const unit = this.unitsById[unitId];
    if (!unit) return;
    if (this.budgetRemaining < unit.price) {
      this.showToast('预算不够了，换一张更便宜的卡。');
      this.audio.blip(150, 0.06, 'square', 0.018);
      return;
    }
    this.selectedUnitId = this.selectedUnitId === unitId ? null : unitId;
    this.updateUnitCards();
    this.audio.blip(this.selectedUnitId ? 500 : 230, 0.06, 'triangle', 0.02);
  }

  get budgetRemaining() {
    return Math.max(0, this.level.budget - this.spent);
  }

  get enemyPreviewUnits() {
    const result = [];
    let order = 0;
    for (const entry of this.level.enemies) {
      for (let index = 0; index < entry.count; index += 1) {
        const data = { ...this.unitsById[entry.unitId], ...(entry.overrides ?? {}) };
        const column = order % 4;
        const row = Math.floor(order / 4);
        result.push({
          id: `enemy-preview-${order}`,
          side: 'enemy',
          data,
          x: 1050 + column * 115 + (row % 2) * 28,
          y: 190 + row * 145 + (column % 2) * 28,
          hp: data.hp,
          maxHp: data.hp,
          alive: true,
          facing: Math.PI,
          status: {},
        });
        order += 1;
      }
    }
    return result;
  }

  startBattle() {
    if (this.phase !== 'prep') return;
    if (this.deployments.length === 0) {
      this.showToast('至少部署一个单位，再按开始战斗。');
      return;
    }
    this.phase = 'battle';
    this.paused = false;
    this.selectedUnitId = null;
    this.cardPointer = null;
    this.draggedUnit = null;
    this.dockScrollDrag = null;
    this.draggedDeployment = null;
    this.suppressCardClick = false;
    window.clearTimeout(this.suppressCardClickTimer);
    this.suppressCardClickTimer = null;
    this.elements.app.classList.remove('is-dragging-unit', 'drag-valid', 'is-dragging-deployment');
    this.updateDragDropUi();
    this.simulation = new BattleSimulation(this.unitsById, this.level, this.deployments, (event) => this.logEvent(event));
    this.simulation.start();
    this.elements.app.classList.remove('phase-prep');
    this.elements.app.classList.add('phase-battle');
    this.setInfoPanelCollapsed(true);
    this.audio.blip(460, 0.12, 'triangle', 0.035);
    this.syncUi();
    this.syncRendererToLayout({ preserveFocus: true });
  }

  togglePause() {
    if (this.phase !== 'battle') return;
    this.paused = !this.paused;
    this.syncUi();
    this.audio.blip(this.paused ? 220 : 540, 0.07, 'sine', 0.02);
  }

  setSpeed(speed) {
    if (![1, 2, 4].includes(speed)) return;
    this.speed = speed;
    for (const button of document.querySelectorAll('.speed-button')) {
      button.classList.toggle('active', Number(button.dataset.speed) === speed);
    }
    this.syncUi();
  }

  onUnitCardPointerDown(event, unitId) {
    if (this.phase !== 'prep' || event.button !== 0) return;
    const unit = this.unitsById[unitId];
    if (!unit || this.budgetRemaining < unit.price) return;
    this.cardPointer = {
      unitId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cardElement: event.currentTarget,
    };
  }

  onUnitListPointerDown(event) {
    if (this.phase !== 'prep' || event.button !== 0) return;
    this.dockScrollDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: this.elements.unitList.scrollLeft,
      startScrollTop: this.elements.unitList.scrollTop,
      moved: false,
    };
  }

  onGlobalPointerMove(event) {
    const isDockPointer = this.dockScrollDrag?.pointerId === event.pointerId;
    if (!isDockPointer && this.cardPointer?.pointerId !== event.pointerId && this.draggedUnit?.pointerId !== event.pointerId) return;
    if (this.phase !== 'prep') {
      this.cardPointer = null;
      this.finishUnitCardDrag();
      return;
    }

    if (isDockPointer && !this.draggedUnit) {
      const { dx: dockDx, dy: dockDy } = this.getPointerDelta(event, this.dockScrollDrag.startX, this.dockScrollDrag.startY);
      const pointerStillInDock = this.isPointInside(this.elements.unitList, event);
      if (this.dockScrollDrag.moved && !pointerStillInDock && this.cardPointer) {
        this.dockScrollDrag.moved = false;
        this.elements.unitList.classList.remove('is-dock-dragging');
      }
      const verticalRail = this.isVerticalUnitRail;
      const scrollDelta = verticalRail ? dockDy : dockDx;
      const crossDelta = verticalRail ? dockDx : dockDy;
      if (!this.dockScrollDrag.moved && Math.hypot(dockDx, dockDy) >= 10 && Math.abs(scrollDelta) > Math.abs(crossDelta) && (event.pointerType !== 'touch' || pointerStillInDock)) {
        this.dockScrollDrag.moved = true;
        this.suppressCardClick = true;
        window.clearTimeout(this.suppressCardClickTimer);
        this.suppressCardClickTimer = window.setTimeout(() => { this.suppressCardClick = false; }, 700);
        this.elements.unitList.classList.add('is-dock-dragging');
      }
      if (this.dockScrollDrag.moved && pointerStillInDock) {
        if (verticalRail) {
          this.elements.unitList.scrollTop = this.dockScrollDrag.startScrollTop - dockDy;
        } else {
          this.elements.unitList.scrollLeft = this.dockScrollDrag.startScrollLeft - dockDx;
        }
        event.preventDefault();
        return;
      }
    }

    if (!this.cardPointer && !this.draggedUnit) return;

    if (!this.draggedUnit) {
      const { dx, dy } = this.getPointerDelta(event, this.cardPointer.startX, this.cardPointer.startY);
      if (Math.hypot(dx, dy) < 10) return;
      const verticalRail = this.isVerticalUnitRail;
      const cardDragDelta = verticalRail ? dx : dy;
      const cardScrollDelta = verticalRail ? dy : dx;
      if (event.pointerType === 'touch' && Math.abs(cardScrollDelta) > Math.abs(cardDragDelta)) return;
      const unit = this.unitsById[this.cardPointer.unitId];
      if (!unit || this.budgetRemaining < unit.price) {
        this.cardPointer = null;
        return;
      }
      this.draggedUnit = { ...this.cardPointer };
      this.cardPointer = null;
      this.draggedUnit.cardElement?.setPointerCapture?.(event.pointerId);
      this.selectedUnitId = unit.id;
      this.suppressCardClick = true;
      window.clearTimeout(this.suppressCardClickTimer);
      this.suppressCardClickTimer = window.setTimeout(() => {
        this.suppressCardClick = false;
      }, 700);
      this.elements.app.classList.add('is-dragging-unit');
      this.audio.unlock();
    }

    if (this.draggedUnit.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (this.isPointInside(this.canvas, event)) {
      this.hoverWorld = this.pointerToWorld(event);
      const dragUnit = this.unitsById[this.draggedUnit.unitId];
      const dragBounds = this.getDeploymentBounds(dragUnit);
      const safeHoverY = clamp(this.hoverWorld.y, dragBounds.minY, dragBounds.maxY);
      this.elements.app.classList.toggle('drag-valid', this.isValidPlacement(this.hoverWorld.x, safeHoverY, dragUnit));
    } else {
      this.hoverWorld = null;
      this.elements.app.classList.remove('drag-valid');
    }
  }

  onGlobalPointerUp(event) {
    if (this.dockScrollDrag?.pointerId === event.pointerId && this.dockScrollDrag.moved && !this.draggedUnit) {
      this.dockScrollDrag = null;
      this.cardPointer = null;
      this.elements.unitList.classList.remove('is-dock-dragging');
      this.suppressCardClick = false;
      window.clearTimeout(this.suppressCardClickTimer);
      this.suppressCardClickTimer = null;
      event.preventDefault();
      return;
    }
    if (this.cardPointer?.pointerId === event.pointerId) {
      this.cardPointer = null;
      this.dockScrollDrag = null;
      return;
    }
    if (this.draggedUnit?.pointerId !== event.pointerId) return;

    const unitId = this.draggedUnit.unitId;
    const overCanvas = this.isPointInside(this.canvas, event);
    if (overCanvas) {
      const world = this.pointerToWorld(event);
      this.selectedUnitId = unitId;
      this.placeSelectedUnit(world.x, world.y);
    } else {
      this.showToast('拖到战场左侧部署区，才会买下这名单位。');
    }
    this.finishUnitCardDrag();
    event.preventDefault();
  }

  finishUnitCardDrag() {
    this.cardPointer = null;
    this.draggedUnit = null;
    this.dockScrollDrag = null;
    this.hoverWorld = null;
    this.elements.app.classList.remove('is-dragging-unit', 'drag-valid');
    this.elements.unitList.classList.remove('is-dock-dragging');
    this.updateUnitCards();
  }

  onPointerDown(event) {
    this.audio.unlock();
    const world = this.pointerToWorld(event);
    if (this.phase === 'prep') {
      const existing = this.findDeploymentAt(world.x, world.y);
      if (existing) {
        this.draggedDeployment = {
          deployment: existing,
          pointerId: event.pointerId,
          originX: existing.x,
          originY: existing.y,
          overCard: false,
          targetCardId: null,
        };
        this.selectedUnitId = existing.unitId;
        this.hoverWorld = null;
        this.elements.app.classList.add('is-dragging-deployment');
        this.canvas.setPointerCapture?.(event.pointerId);
        this.updateUnitCards();
        return;
      }
      if (event.button === 0 && this.selectedUnitId) this.placeSelectedUnit(world.x, world.y);
      return;
    }

    if (this.phase === 'battle' || this.phase === 'result') {
      this.slowInput = event.button === 0 && this.phase === 'battle';
      this.cameraDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        cameraX: this.camera.x,
        cameraY: this.camera.y,
      };
      this.canvas.setPointerCapture?.(event.pointerId);
    }
  }

  onPointerMove(event) {
    if (this.phase === 'prep' && this.draggedDeployment?.pointerId === event.pointerId) {
      const targetCard = this.getUnitCardAtPoint(event);
      this.draggedDeployment.overCard = Boolean(targetCard);
      this.draggedDeployment.targetCardId = targetCard?.dataset.unitId ?? null;
      this.updateDragDropUi();
      if (!this.isPointInside(this.canvas, event)) return;
      const world = this.pointerToWorld(event);
      const deployment = this.draggedDeployment.deployment;
      const data = this.unitsById[deployment.unitId];
      const bounds = this.getDeploymentBounds(data);
      deployment.x = clamp(world.x, WORLD.minX + PLAYER_SAFE_MARGIN, PLAYER_ZONE_RIGHT - data.radius);
      deployment.y = clamp(world.y, bounds.minY, bounds.maxY);
      return;
    }
    const world = this.pointerToWorld(event);
    this.hoverWorld = world;
    if (this.cameraDrag?.pointerId === event.pointerId) {
      const { dx: pointerDx, dy: pointerDy } = this.getPointerDelta(event, this.cameraDrag.startX, this.cameraDrag.startY);
      const dx = pointerDx / this.camera.zoom;
      const dy = pointerDy / this.camera.zoom;
      this.camera.x = this.cameraDrag.cameraX - dx;
      this.camera.y = this.cameraDrag.cameraY - dy;
      this.clampCamera();
    }
  }

  onPointerUp(event) {
    if (this.draggedDeployment?.pointerId === event.pointerId) {
      const drag = this.draggedDeployment;
      const targetCard = this.getUnitCardAtPoint(event);
      const overCard = Boolean(targetCard || drag.overCard);
      if (event.type === 'pointercancel') {
        drag.deployment.x = drag.originX;
        drag.deployment.y = drag.originY;
      }
      this.draggedDeployment = null;
      this.elements.app.classList.remove('is-dragging-deployment');
      this.updateDragDropUi();
      if (overCard && event.type !== 'pointercancel') {
        const data = this.unitsById[drag.deployment.unitId];
        this.removeDeployment(drag.deployment);
        this.showToast(`${data.name} 已撤销，${data.price} 金已退回。`);
        this.audio.blip(190, 0.06, 'square', 0.018);
      }
      return;
    }
    if (this.cameraDrag?.pointerId === event.pointerId) {
      this.cameraDrag = null;
    }
    if (event.button === 0) this.slowInput = false;
  }

  onWheel(event) {
    event.preventDefault();
    if (!this.renderer) return;
    const before = this.pointerToWorld(event);
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    this.camera.zoom = clamp(this.camera.zoom * factor, this.getMinimumZoom(), MAX_ZOOM);
    const after = this.pointerToWorld(event);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }

  pointerToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = this.isAutoLandscape ? event.clientY - rect.top : event.clientX - rect.left;
    const screenY = this.isAutoLandscape ? rect.right - event.clientX : event.clientY - rect.top;
    return this.renderer
      ? this.renderer.screenToWorld(screenX, screenY)
      : { x: WORLD.width / 2, y: WORLD.height / 2 };
  }

  getPointerDelta(event, startX, startY) {
    const physicalDx = event.clientX - startX;
    const physicalDy = event.clientY - startY;
    return this.isAutoLandscape
      ? { dx: physicalDy, dy: -physicalDx }
      : { dx: physicalDx, dy: physicalDy };
  }

  get isVerticalUnitRail() {
    return getComputedStyle(this.elements.unitList).flexDirection === 'column';
  }

  isPointInside(element, event) {
    if (!element || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const rect = element.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  getUnitCardAtPoint(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element?.closest?.('.unit-card') ?? null;
  }

  updateDragDropUi() {
    const targetCardId = this.draggedDeployment?.targetCardId ?? null;
    this.elements.unitList.classList.toggle('is-drop-target', Boolean(targetCardId));
    for (const card of this.elements.unitList.children) {
      card.classList.toggle('drop-target', Boolean(targetCardId) && card.dataset.unitId === targetCardId);
    }
  }

  clampCamera() {
    if (!this.renderer) return;
    const halfWorldWidth = this.renderer.width / (2 * this.camera.zoom);
    const halfWorldHeight = this.renderer.height / (2 * this.camera.zoom);
    const minCameraX = halfWorldWidth >= WORLD.width / 2 ? WORLD.width / 2 : halfWorldWidth;
    const maxCameraX = halfWorldWidth >= WORLD.width / 2 ? WORLD.width / 2 : WORLD.width - halfWorldWidth;
    const minCameraY = halfWorldHeight >= WORLD.height / 2 ? WORLD.height / 2 : halfWorldHeight;
    const maxCameraY = halfWorldHeight >= WORLD.height / 2 ? WORLD.height / 2 : WORLD.height - halfWorldHeight;
    this.camera.x = clamp(this.camera.x, minCameraX, maxCameraX);
    this.camera.y = clamp(this.camera.y, minCameraY, maxCameraY);
  }

  fitCamera({ preserveFocus = false } = {}) {
    if (!this.renderer) return;
    if (!preserveFocus) {
      this.camera.x = WORLD.width / 2;
      this.camera.y = this.isCompactLandscape || this.isAutoLandscape ? WORLD.height * 0.44 : WORLD.height / 2;
    }
    this.camera.zoom = clamp(
      Math.min((this.renderer.width - 20) / WORLD.width, (this.renderer.height - 20) / WORLD.height),
      this.getMinimumZoom(),
      MAX_ZOOM,
    );
    this.clampCamera();
  }

  getDeploymentBounds(unit) {
    const radius = unit?.radius ?? 24;
    let minY = Math.max(WORLD.minY + PLAYER_SAFE_MARGIN, PLAYER_DEPLOY_TOP);
    let maxY = Math.min(WORLD.maxY - PLAYER_SAFE_MARGIN, PLAYER_DEPLOY_BOTTOM);
    if (this.renderer && this.camera.zoom > 0) {
      const halfViewportHeight = this.renderer.height / (2 * this.camera.zoom);
      minY = Math.max(minY, this.camera.y - halfViewportHeight + Math.max(34, radius * 1.6));
      maxY = Math.min(maxY, this.camera.y + halfViewportHeight - Math.max(76, radius * 2.6));
    }
    if (minY > maxY) {
      const midpoint = (minY + maxY) / 2;
      minY = midpoint;
      maxY = midpoint;
    }
    return { minY, maxY };
  }

  placeSelectedUnit(x, y) {
    const unit = this.unitsById[this.selectedUnitId];
    if (!unit) return;
    if (this.deployments.length >= MAX_DEPLOYMENTS) {
      this.showToast(`最多部署 ${MAX_DEPLOYMENTS} 个单位。`);
      return;
    }
    if (x > PLAYER_ZONE_RIGHT - unit.radius || x < WORLD.minX + PLAYER_SAFE_MARGIN) {
      this.showToast('只能放在左侧部署区内。');
      return;
    }
    if (this.budgetRemaining < unit.price) {
      this.showToast('预算不够了，换一张更便宜的卡。');
      return;
    }
    const bounds = this.getDeploymentBounds(unit);
    const deployment = {
      id: `deployment-${this.nextDeploymentId++}`,
      unitId: unit.id,
      data: unit,
      x: clamp(x, WORLD.minX + PLAYER_SAFE_MARGIN, PLAYER_ZONE_RIGHT - unit.radius),
      y: clamp(y, bounds.minY, bounds.maxY),
    };
    this.deployments.push(deployment);
    this.spent += unit.price;
    this.audio.blip(610, 0.055, 'triangle', 0.018);
    this.syncUi();
  }

  findDeploymentAt(x, y) {
    let closest = null;
    let closestDistance = Infinity;
    for (const deployment of this.deployments) {
      const data = this.unitsById[deployment.unitId];
      const currentDistance = Math.hypot(deployment.x - x, deployment.y - y);
      if (currentDistance <= data.radius + 14 && currentDistance < closestDistance) {
        closest = deployment;
        closestDistance = currentDistance;
      }
    }
    return closest;
  }

  removeDeployment(deployment) {
    const data = this.unitsById[deployment.unitId];
    const index = this.deployments.indexOf(deployment);
    if (index < 0) return;
    this.deployments.splice(index, 1);
    this.spent = Math.max(0, this.spent - data.price);
    if (this.selectedUnitId === deployment.unitId) this.selectedUnitId = null;
    this.syncUi();
  }

  get battleUnits() {
    if (this.phase === 'prep') {
      const players = this.deployments.map((deployment) => {
        const data = this.unitsById[deployment.unitId];
        return {
          ...deployment,
          side: 'player',
          data,
          hp: data.hp,
          maxHp: data.hp,
          alive: true,
          facing: 0,
          status: {},
        };
      });
      return [...players, ...this.enemyPreviewUnits];
    }
    return this.simulation?.units ?? [];
  }

  logEvent(event) {
    if (!event?.text) return;
    const line = makeElement('div', `event ${event.tone ?? 'info'}`, event.text);
    this.elements.eventLog.prepend(line);
    while (this.elements.eventLog.children.length > 8) this.elements.eventLog.lastElementChild.remove();
    this.audio.event(event.tone);
  }

  showToast(text) {
    this.elements.toast.textContent = text;
    this.elements.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.elements.toast.classList.remove('show'), 1900);
  }

  finishBattle() {
    if (this.resultShown || !this.simulation || this.simulation.phase !== 'result') return;
    this.resultShown = true;
    this.phase = 'result';
    this.paused = false;
    const won = this.simulation.outcome === 'win';
    const remaining = Math.max(0, this.level.budget - this.spent + this.simulation.goldBonus);
    const ratio = this.level.budget > 0 ? remaining / this.level.budget : 0;
    const rating = ratio >= 0.5 ? 'S' : ratio >= 0.35 ? 'A' : ratio >= 0.2 ? 'B' : ratio >= 0.05 ? 'C' : 'D';
    this.elements.resultCard.classList.toggle('lose', !won);
    this.elements.resultStamp.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.elements.resultTitle.textContent = won ? '胜利' : '失败';
    this.elements.resultSummary.textContent = won
      ? `敌方 ${this.simulation.enemyRosterCount} 名单位已全部击破，战场留下了 ${this.simulation.playerCount} 名己方单位。`
      : '你的编队被清空了。换一个克制思路，再把部署点拉开一点。';
    this.elements.resultInitial.textContent = String(this.level.budget);
    this.elements.resultSpent.textContent = String(this.spent);
    this.elements.resultBonus.textContent = `+${this.simulation.goldBonus}`;
    this.elements.resultRemaining.textContent = String(remaining);
    this.elements.resultRating.textContent = won ? rating : '—';
    this.elements.resultRatio.textContent = won ? `${Math.round(ratio * 100)}% 预算留存` : '本局未完成';
    this.elements.nextButton.textContent = this.levelIndex < this.levels.length - 1 ? '下一关' : '再试一次';
    this.elements.resultOverlay.classList.remove('hidden');
    this.elements.app.classList.remove('phase-battle');
    this.elements.app.classList.add('phase-result');
    this.audio.event(won ? 'reward' : 'danger');
    this.syncUi();
  }

  syncUi() {
    const isPrep = this.phase === 'prep';
    const isBattle = this.phase === 'battle';
    const isResult = this.phase === 'result';
    const available = isPrep ? this.budgetRemaining : Math.max(0, this.level.budget - this.spent + (this.simulation?.goldBonus ?? 0));
    this.elements.phaseLabel.textContent = isPrep ? '准备部署' : isBattle ? (this.paused ? '战斗暂停' : '自动战斗') : '战斗结算';
    this.elements.budgetLabel.textContent = String(available);
    this.elements.startButton.classList.toggle('hidden', !isPrep);
    this.elements.pauseButton.classList.toggle('hidden', !isBattle);
    this.elements.pauseButton.textContent = this.paused ? '继续' : '暂停';
    this.elements.resetButton.textContent = isPrep ? '清空重摆' : '重新部署';
    this.elements.resetButton.disabled = false;
    this.elements.levelSelect.disabled = isBattle;
    this.elements.app.classList.toggle('phase-prep', isPrep);
    this.elements.app.classList.toggle('phase-battle', isBattle);
    this.elements.app.classList.toggle('phase-result', isResult);
    this.elements.prepGuide.classList.toggle('hidden', !isPrep);
    this.elements.battleGuide.classList.toggle('hidden', !isBattle);
    this.elements.deployedCount.textContent = String(isPrep ? this.deployments.length : this.simulation?.playerCount ?? 0);
    const playerCount = isPrep ? this.deployments.length : this.simulation?.playerCount ?? 0;
    const enemyCount = isPrep ? this.enemyPreviewUnits.length : this.simulation?.enemyCount ?? 0;
    this.elements.playerCount.textContent = String(playerCount);
    this.elements.enemyCount.textContent = String(enemyCount);
    const total = playerCount + enemyCount;
    this.elements.battleProgress.style.width = `${total ? Math.round((playerCount / total) * 100) : 0}%`;
    this.elements.enemyReadout.textContent = isPrep ? `${enemyCount} 名敌人待命` : `${enemyCount} 名敌人`;
    this.elements.battleClock.textContent = formatClock(this.simulation?.time ?? 0);
    this.elements.speedReadout.textContent = `${this.speed}×${this.slowInput ? ' · 慢' : ''}`;
    this.updateUnitCards();
    if (isResult) this.elements.resultOverlay.classList.remove('hidden');
  }

  updateUnitCards() {
    for (const card of this.elements.unitList.children) {
      const unit = this.unitsById[card.dataset.unitId];
      card.classList.toggle('selected', this.phase === 'prep' && this.selectedUnitId === unit.id);
      card.classList.toggle('disabled', this.phase !== 'prep' || this.budgetRemaining < unit.price);
      const mark = card.querySelector('.selected-mark');
      if (this.phase === 'prep' && this.selectedUnitId === unit.id) {
        if (!mark) card.append(makeElement('span', 'selected-mark', '●'));
      } else if (mark) {
        mark.remove();
      }
    }
  }

  frame(now) {
    const elapsed = this.lastFrameTime ? Math.min(0.05, (now - this.lastFrameTime) / 1000) : 0;
    this.lastFrameTime = now;
    this.renderTime += elapsed;
    if (this.phase === 'battle' && this.simulation && !this.paused) {
      const timeScale = this.slowInput ? 0.2 : this.speed;
      this.simulation.update(elapsed * timeScale);
      this.finishBattle();
      this.syncUi();
    }
    this.render();
    window.requestAnimationFrame((time) => this.frame(time));
  }

  render() {
    if (!this.renderer) return;
    this.clampCamera();
    this.renderer.begin(this.camera);
    this.drawArena();
    this.drawUnitsAndEffects();
    this.renderer.end();
    this.updateWorldLabels();
  }

  drawArena() {
    const renderer = this.renderer;
    if (renderer.backgroundReady && renderer.backgroundTexture) {
      const viewportWorldWidth = renderer.width / this.camera.zoom;
      const viewportWorldHeight = renderer.height / this.camera.zoom;
      renderer.drawTextureRect(this.camera.x, this.camera.y, viewportWorldWidth, viewportWorldHeight, renderer.backgroundTexture, 0, 1, 0, 1, 0.32, '#102832');
      renderer.drawTextureRect(WORLD.width / 2, WORLD.height / 2, WORLD.width, WORLD.height, renderer.backgroundTexture, 0, 1, 0, 1, 0.98, '#ffffff');
      renderer.drawRect(400, WORLD.height / 2, 720, 700, '#173b3b', 0.11);
      renderer.drawRect(1200, WORLD.height / 2, 720, 700, '#3a2632', 0.11);
      renderer.drawRect(WORLD.width / 2, WORLD.height / 2, 86, 700, '#133c4b', 0.16);
    } else {
      renderer.drawRect(WORLD.width / 2, WORLD.height / 2, WORLD.width, WORLD.height, '#102832');
      renderer.drawRect(400, WORLD.height / 2, 720, 700, '#173b3b', 0.72);
      renderer.drawRect(1200, WORLD.height / 2, 720, 700, '#3a2632', 0.66);
      renderer.drawRect(WORLD.width / 2, WORLD.height / 2, 86, 700, '#133c4b', 0.9);
    }
    renderer.drawLine(800, WORLD.minY, 800, WORLD.maxY, 2, '#63e0cb', 0.22);

    const gridStep = ['blur', 'low'].includes(renderer.qualityTier) ? 160 : 80;
    for (let x = 40; x <= WORLD.width - 40; x += gridStep) renderer.drawLine(x, WORLD.minY, x, WORLD.maxY, 1, '#91c6bb', 0.08);
    for (let y = 40; y <= WORLD.height - 40; y += gridStep) renderer.drawLine(WORLD.minX, y, WORLD.maxX, y, 1, '#91c6bb', 0.08);
    renderer.drawLine(WORLD.minX, WORLD.minY, WORLD.maxX, WORLD.minY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.maxX, WORLD.minY, WORLD.maxX, WORLD.maxY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.maxX, WORLD.maxY, WORLD.minX, WORLD.maxY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.minX, WORLD.maxY, WORLD.minX, WORLD.minY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(PLAYER_ZONE_RIGHT, WORLD.minY + 6, PLAYER_ZONE_RIGHT, WORLD.maxY - 6, 2, '#63e0cb', 0.15);
    renderer.drawLine(840, WORLD.minY + 6, 840, WORLD.maxY - 6, 2, '#ff796a', 0.12);

    if (this.phase === 'prep') {
      const activeUnit = this.selectedUnitId ? this.unitsById[this.selectedUnitId] : null;
      const bounds = this.getDeploymentBounds(activeUnit);
      renderer.drawLine(WORLD.minX + 18, bounds.minY, PLAYER_ZONE_RIGHT - 18, bounds.minY, 1, '#63e0cb', 0.1);
      renderer.drawLine(WORLD.minX + 18, bounds.maxY, PLAYER_ZONE_RIGHT - 18, bounds.maxY, 1, '#63e0cb', 0.1);
      if (this.hoverWorld && activeUnit) {
        const previewY = clamp(this.hoverWorld.y, bounds.minY, bounds.maxY);
        if (this.isValidPlacement(this.hoverWorld.x, previewY, activeUnit)) {
          const previewSize = activeUnit.radius * 1.8;
          const left = this.hoverWorld.x - previewSize / 2;
          const right = this.hoverWorld.x + previewSize / 2;
          const top = previewY - previewSize / 2;
          const bottom = previewY + previewSize / 2;
          renderer.drawRect(this.hoverWorld.x, previewY, previewSize, previewSize, activeUnit.color, 0.14);
          renderer.drawLine(left, top, right, top, 2, '#63e0cb', 0.72);
          renderer.drawLine(right, top, right, bottom, 2, '#63e0cb', 0.72);
          renderer.drawLine(right, bottom, left, bottom, 2, '#63e0cb', 0.72);
          renderer.drawLine(left, bottom, left, top, 2, '#63e0cb', 0.72);
        }
      }
    }
  }

  isValidPlacement(x, y, unit) {
    const bounds = this.getDeploymentBounds(unit);
    return Boolean(unit) && x >= WORLD.minX + PLAYER_SAFE_MARGIN && x <= PLAYER_ZONE_RIGHT - unit.radius && y >= bounds.minY && y <= bounds.maxY && this.budgetRemaining >= unit.price;
  }

  drawUnitsAndEffects() {
    // Painter's order follows battlefield depth: larger world Y is closer to the camera.
    const units = [...this.battleUnits].sort((first, second) => {
      const depth = (first.y ?? 0) - (second.y ?? 0);
      return depth || (first.x ?? 0) - (second.x ?? 0) || String(first.id ?? '').localeCompare(String(second.id ?? ''));
    });
    for (const unit of units) {
      if (!unit.data) continue;
      this.drawUnit(unit);
    }
    if (!this.simulation || this.phase === 'prep') return;
    for (const projectile of this.simulation.projectiles) {
      const target = this.simulation.findUnit(projectile.targetId);
      const projectileDirection = target ? normalize(target.x - projectile.x, target.y - projectile.y) : { x: 1, y: 0 };
      const perpendicular = { x: -projectileDirection.y, y: projectileDirection.x };
      const style = projectile.style ?? 'spark';
      const color = projectile.color ?? '#f4c66a';
      const secondaryColor = projectile.secondaryColor ?? '#fff1e6';
      if (style === 'basketball') {
        this.renderer.drawLine(projectile.x - projectileDirection.x * 22, projectile.y - projectileDirection.y * 22, projectile.x - projectileDirection.x * 8, projectile.y - projectileDirection.y * 8, 3, color, 0.26);
        this.renderer.drawCircle(projectile.x, projectile.y, 11, '#e98b43', 18, 0.98);
        this.renderer.drawRing(projectile.x, projectile.y, 11, 2, '#2a1b18', 20, 0.9);
        this.renderer.drawLine(projectile.x - perpendicular.x * 10, projectile.y - perpendicular.y * 10, projectile.x + perpendicular.x * 10, projectile.y + perpendicular.y * 10, 2, '#2a1b18', 0.88);
        this.renderer.drawLine(projectile.x - projectileDirection.x * 8, projectile.y - projectileDirection.y * 8, projectile.x + projectileDirection.x * 8, projectile.y + projectileDirection.y * 8, 2, '#2a1b18', 0.88);
      } else if (style === 'watermelon') {
        this.renderer.drawCircle(projectile.x, projectile.y, 12, '#4f9a55', 18, 0.98);
        this.renderer.drawRing(projectile.x, projectile.y, 11, 3, '#cce58b', 20, 0.9);
        this.renderer.drawLine(projectile.x - perpendicular.x * 7, projectile.y - perpendicular.y * 7, projectile.x + perpendicular.x * 7, projectile.y + perpendicular.y * 7, 2, secondaryColor, 0.9);
      } else if (style === 'milkBubble') {
        this.renderer.drawCircle(projectile.x, projectile.y, 9, '#f7f1d1', 16, 0.94);
        this.renderer.drawRing(projectile.x, projectile.y, 10, 2, color, 18, 0.76);
        this.renderer.drawCircle(projectile.x - perpendicular.x * 9, projectile.y - perpendicular.y * 9, 3, '#ffffff', 12, 0.76);
      } else if (style === 'delivery') {
        this.renderer.drawRect(projectile.x, projectile.y, 15, 11, '#ef964d', 0.94);
        this.renderer.drawLine(projectile.x - projectileDirection.x * 17, projectile.y - projectileDirection.y * 17, projectile.x + projectileDirection.x * 5, projectile.y + projectileDirection.y * 5, 3, color, 0.56);
        this.renderer.drawLine(projectile.x - 5, projectile.y, projectile.x + 5, projectile.y, 2, '#fff0b3', 0.84);
      } else if (style === 'sniper') {
        this.renderer.drawLine(projectile.x - projectileDirection.x * 38, projectile.y - projectileDirection.y * 38, projectile.x + projectileDirection.x * 9, projectile.y + projectileDirection.y * 9, 3, '#efff8f', 0.8);
        this.renderer.drawCircle(projectile.x, projectile.y, 4, color, 12, 0.98);
      } else if (style === 'penguin') {
        this.renderer.drawLine(projectile.x - projectileDirection.x * 18, projectile.y - projectileDirection.y * 18, projectile.x, projectile.y, 3, '#d7e9f2', 0.28);
        this.renderer.drawCircle(projectile.x, projectile.y, 9, '#1b263b', 16, 0.96);
        this.renderer.drawCircle(projectile.x, projectile.y + 2, 5, '#f1f4f6', 14, 0.9);
        this.renderer.drawCircle(projectile.x + projectileDirection.x * 8, projectile.y + projectileDirection.y * 8, 2.5, '#f9c74f', 12, 0.98);
      } else if (style === 'shotgun') {
        this.renderer.drawLine(projectile.x - projectileDirection.x * 28, projectile.y - projectileDirection.y * 28, projectile.x + projectileDirection.x * 9, projectile.y + projectileDirection.y * 9, 6, color, 0.84);
        this.renderer.drawCircle(projectile.x + perpendicular.x * 8, projectile.y + perpendicular.y * 8, 4, color, 12, 0.88);
        this.renderer.drawCircle(projectile.x - perpendicular.x * 8, projectile.y - perpendicular.y * 8, 4, color, 12, 0.88);
      } else {
        this.renderer.drawLine(projectile.x - projectileDirection.x * 19, projectile.y - projectileDirection.y * 19, projectile.x + projectileDirection.x * 7, projectile.y + projectileDirection.y * 7, 4, color, 0.88);
        this.renderer.drawCircle(projectile.x, projectile.y, 5, color, 12, 0.95);
      }
    }
    const effectLimit = this.renderer.qualityTier === 'blur' ? 20 : this.renderer.qualityTier === 'low' ? 28 : this.renderer.qualityTier === 'medium' ? 52 : 84;
    for (const effect of this.simulation.effects.slice(-effectLimit)) this.drawEffect(effect);
  }

  drawEffect(effect) {
    const renderer = this.renderer;
    const progress = clamp(effect.life / Math.max(0.05, effect.duration), 0, 1);
    const elapsed = 1 - progress;
    const fade = clamp(progress * 1.2, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(this.renderTime * 8 + effect.id);
    const radius = effect.radius * (0.62 + elapsed * 0.46);
    const style = effect.style ?? 'spark';
    const angle = Number.isFinite(effect.angle) ? effect.angle : Math.atan2(effect.directionY ?? 0, effect.directionX ?? 1);
    const direction = normalize(Math.cos(angle), Math.sin(angle));
    const perpendicular = { x: -direction.y, y: direction.x };
    const segments = (base) => renderer.qualitySegments(base);
    const line = (x1, y1, x2, y2, thickness, tone = effect.color, alpha = fade) => renderer.drawLine(x1, y1, x2, y2, thickness, tone, alpha);
    const ring = (x, y, ringRadius, thickness, tone = effect.color, alpha = fade) => renderer.drawRing(x, y, ringRadius, thickness, tone, segments(28), alpha);
    const circle = (x, y, circleRadius, tone = effect.color, alpha = fade, detail = 18) => renderer.drawCircle(x, y, circleRadius, tone, segments(detail), alpha);
    const polygon = (points, tone = effect.color, alpha = fade) => renderer.drawPolygon(points, tone, alpha);
    const pointAlong = (distanceFromOrigin) => ({
      x: effect.x + direction.x * distanceFromOrigin,
      y: effect.y + direction.y * distanceFromOrigin,
    });
    const burst = (count, inner, outer, thickness, tone = effect.color, alpha = fade, offset = 0) => {
      for (let index = 0; index < count; index += 1) {
        const rayAngle = offset + index * Math.PI * 2 / count;
        line(
          effect.x + Math.cos(rayAngle) * inner,
          effect.y + Math.sin(rayAngle) * inner,
          effect.x + Math.cos(rayAngle) * outer,
          effect.y + Math.sin(rayAngle) * outer,
          thickness,
          tone,
          alpha,
        );
      }
    };
    const arc = (x, y, arcRadius, start, end, thickness, tone = effect.color, alpha = fade) => {
      const count = segments(Math.max(7, Math.ceil(Math.abs(end - start) * 11)));
      for (let index = 0; index < count; index += 1) {
        const first = start + (end - start) * index / count;
        const second = start + (end - start) * (index + 1) / count;
        line(
          x + Math.cos(first) * arcRadius,
          y + Math.sin(first) * arcRadius,
          x + Math.cos(second) * arcRadius,
          y + Math.sin(second) * arcRadius,
          thickness,
          tone,
          alpha,
        );
      }
    };
    const diamond = (x, y, size, rotation, tone = effect.color, alpha = fade) => {
      const points = [];
      for (let index = 0; index < 4; index += 1) {
        const pointAngle = rotation + index * Math.PI / 2;
        points.push({ x: x + Math.cos(pointAngle) * size, y: y + Math.sin(pointAngle) * size });
      }
      polygon(points, tone, alpha);
    };
    const triangle = (x, y, size, rotation, tone = effect.color, alpha = fade) => renderer.drawTriangle(x, y, size, rotation, tone, alpha);
    const drawBasketball = (x, y, size, rotation, alpha = fade) => {
      circle(x, y, size, '#e98b43', alpha, 18);
      renderer.drawRing(x, y, size, Math.max(1.5, size * 0.16), '#2a1b18', segments(20), alpha * 0.92);
      line(x - perpendicular.x * size * 0.86, y - perpendicular.y * size * 0.86, x + perpendicular.x * size * 0.86, y + perpendicular.y * size * 0.86, 1.8, '#2a1b18', alpha * 0.85);
      line(x - Math.cos(rotation) * size * 0.86, y - Math.sin(rotation) * size * 0.86, x + Math.cos(rotation) * size * 0.86, y + Math.sin(rotation) * size * 0.86, 1.8, '#2a1b18', alpha * 0.85);
      circle(x - size * 0.28, y - size * 0.28, Math.max(1.5, size * 0.16), '#ffd8a8', alpha * 0.78, 12);
    };
    const drawBubble = (x, y, size, alpha = fade) => {
      circle(x, y, size, '#f7f1d1', alpha * 0.82, 16);
      renderer.drawRing(x, y, size, Math.max(1.5, size * 0.14), '#90be6d', segments(18), alpha * 0.7);
      circle(x - size * 0.34, y - size * 0.36, Math.max(1.5, size * 0.2), '#ffffff', alpha * 0.78, 12);
    };
    const drawPackage = (x, y, size, rotation, alpha = fade) => {
      diamond(x, y, size, rotation + Math.PI / 4, '#ef964d', alpha * 0.94);
      line(x - Math.cos(rotation) * size * 0.72, y - Math.sin(rotation) * size * 0.72, x + Math.cos(rotation) * size * 0.72, y + Math.sin(rotation) * size * 0.72, 2, '#fff0b3', alpha * 0.9);
      line(x - perpendicular.x * size * 0.72, y - perpendicular.y * size * 0.72, x + perpendicular.x * size * 0.72, y + perpendicular.y * size * 0.72, 1.5, '#b95d35', alpha * 0.78);
    };
    const drawW = (x, y, size, alpha = fade) => {
      const jaw = size * 0.86;
      line(x - jaw, y - size * 0.24, x - jaw * 0.42, y + size * 0.52, 4, '#6d3f39', alpha);
      line(x - jaw * 0.42, y + size * 0.52, x, y - size * 0.02, 4, '#6d3f39', alpha);
      line(x, y - size * 0.02, x + jaw * 0.42, y + size * 0.52, 4, '#6d3f39', alpha);
      line(x + jaw * 0.42, y + size * 0.52, x + jaw, y - size * 0.24, 4, '#6d3f39', alpha);
      triangle(x - size * 0.38, y + size * 0.23, size * 0.13, Math.PI, '#fff4dc', alpha * 0.95);
      triangle(x + size * 0.38, y + size * 0.23, size * 0.13, Math.PI, '#fff4dc', alpha * 0.95);
    };
    const drawClaws = (x, y, size, rotation, alpha = fade) => {
      for (let index = -1; index <= 1; index += 1) {
        const shift = index * size * 0.28;
        const start = { x: x - Math.cos(rotation) * size * 0.8 + perpendicular.x * shift, y: y - Math.sin(rotation) * size * 0.8 + perpendicular.y * shift };
        const end = { x: x + Math.cos(rotation) * size * 0.82 + perpendicular.x * shift * 0.55, y: y + Math.sin(rotation) * size * 0.82 + perpendicular.y * shift * 0.55 };
        line(start.x, start.y, end.x, end.y, 4 - Math.abs(index), '#ff595e', alpha * (0.82 - Math.abs(index) * 0.12));
      }
    };
    const drawLightning = (x, y, size, rotation, alpha = fade) => {
      const along = { x: Math.cos(rotation), y: Math.sin(rotation) };
      const across = { x: -along.y, y: along.x };
      const points = [
        { x: x - along.x * size * 0.82, y: y - along.y * size * 0.82 },
        { x: x - along.x * size * 0.28 + across.x * size * 0.36, y: y - along.y * size * 0.28 + across.y * size * 0.36 },
        { x: x + along.x * size * 0.08 - across.x * size * 0.28, y: y + along.y * size * 0.08 - across.y * size * 0.28 },
        { x: x + along.x * size * 0.84 + across.x * size * 0.08, y: y + along.y * size * 0.84 + across.y * size * 0.08 },
      ];
      for (let index = 0; index < points.length - 1; index += 1) line(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y, 3, '#f2e86d', alpha);
    };
    const drawBeat = (x, y, size, rotation, alpha = fade) => {
      const beatColor = '#f3d6ff';
      diamond(x - perpendicular.x * size * 0.62, y - perpendicular.y * size * 0.62, size * 0.2, rotation + Math.PI / 4, beatColor, alpha * 0.86);
      diamond(x + perpendicular.x * size * 0.62, y + perpendicular.y * size * 0.62, size * 0.2, rotation + Math.PI / 4, '#7f8cff', alpha * 0.86);
      line(x - Math.cos(rotation) * size * 0.86, y - Math.sin(rotation) * size * 0.86, x + Math.cos(rotation) * size * 0.86, y + Math.sin(rotation) * size * 0.86, 2, beatColor, alpha * 0.72);
      line(x - Math.cos(rotation + Math.PI / 2) * size * 0.6, y - Math.sin(rotation + Math.PI / 2) * size * 0.6, x + Math.cos(rotation + Math.PI / 2) * size * 0.6, y + Math.sin(rotation + Math.PI / 2) * size * 0.6, 2, '#7f8cff', alpha * 0.65);
    };
    const drawRam = (x, y, size, rotation, alpha = fade) => {
      const along = { x: Math.cos(rotation), y: Math.sin(rotation) };
      const across = { x: -along.y, y: along.x };
      for (let index = 0; index < 3; index += 1) {
        const distanceFromPoint = size * (0.28 + index * 0.24);
        const tip = { x: x + along.x * distanceFromPoint, y: y + along.y * distanceFromPoint };
        line(tip.x - along.x * size * 0.33 - across.x * size * 0.28, tip.y - along.y * size * 0.33 - across.y * size * 0.28, tip.x, tip.y, 5 - index, index === 0 ? '#ed6a5a' : '#f6bd60', alpha * (0.92 - index * 0.16));
        line(tip.x - along.x * size * 0.33 + across.x * size * 0.28, tip.y - along.y * size * 0.33 + across.y * size * 0.28, tip.x, tip.y, 5 - index, index === 0 ? '#ed6a5a' : '#f6bd60', alpha * (0.92 - index * 0.16));
      }
      circle(x - along.x * size * 0.46, y - along.y * size * 0.46, size * 0.12, '#d8a25b', alpha * 0.68, 12);
    };
    const drawShield = (x, y, size, rotation, alpha = fade) => {
      const points = [];
      for (let index = 0; index < 6; index += 1) {
        const pointAngle = rotation - Math.PI / 2 + index * Math.PI / 3;
        points.push({ x: x + Math.cos(pointAngle) * size, y: y + Math.sin(pointAngle) * size });
      }
      polygon(points, '#edf2f4', alpha * 0.14);
      for (let index = 0; index < points.length; index += 1) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        line(first.x, first.y, second.x, second.y, 3, '#edf2f4', alpha * 0.9);
      }
      line(x - Math.cos(rotation) * size * 0.55, y - Math.sin(rotation) * size * 0.55, x + Math.cos(rotation) * size * 0.55, y + Math.sin(rotation) * size * 0.55, 2, '#9fb2bd', alpha * 0.76);
    };
    const drawMagic = (x, y, size, rotation, alpha = fade) => {
      arc(x, y, size * 0.78, rotation - 1.8, rotation - 0.35, 3, '#a98bff', alpha * 0.75);
      arc(x, y, size * 0.58, rotation + 0.3, rotation + 1.7, 2, '#f1faee', alpha * 0.76);
      const moteCount = renderer.qualityTier === 'blur' ? 3 : renderer.qualityTier === 'low' ? 4 : 7;
      for (let index = 0; index < moteCount; index += 1) {
        const moteAngle = rotation + index * Math.PI * 2 / moteCount + this.renderTime * 0.7;
        const moteRadius = size * (0.34 + (index % 2) * 0.25);
        diamond(x + Math.cos(moteAngle) * moteRadius, y + Math.sin(moteAngle) * moteRadius, size * 0.08, moteAngle, index % 2 ? '#f1faee' : '#a98bff', alpha * 0.88);
      }
    };
    const drawMelon = (x, y, size, rotation, alpha = fade) => {
      const along = { x: Math.cos(rotation), y: Math.sin(rotation) };
      const across = { x: -along.y, y: along.x };
      polygon([
        { x, y },
        { x: x + along.x * size * 1.05 + across.x * size * 0.58, y: y + along.y * size * 1.05 + across.y * size * 0.58 },
        { x: x + along.x * size * 0.38, y: y + along.y * size * 0.38 },
        { x: x + along.x * size * 1.05 - across.x * size * 0.58, y: y + along.y * size * 1.05 - across.y * size * 0.58 },
      ], '#4f9a55', alpha * 0.92);
      line(x + along.x * size * 0.28 - across.x * size * 0.38, y + along.y * size * 0.28 - across.y * size * 0.38, x + along.x * size * 0.28 + across.x * size * 0.38, y + along.y * size * 0.28 + across.y * size * 0.38, 3, '#cce58b', alpha * 0.84);
      for (let index = 0; index < 3; index += 1) {
        const seedDistance = size * (0.52 + index * 0.2);
        circle(x + along.x * seedDistance, y + along.y * seedDistance + (index - 1) * size * 0.16, size * 0.065, '#2a1b18', alpha * 0.85, 10);
      }
    };
    const drawPenguin = (x, y, size, rotation, alpha = fade) => {
      circle(x, y, size, '#1b263b', alpha * 0.95, 16);
      circle(x + perpendicular.x * size * 0.12, y + perpendicular.y * size * 0.12, size * 0.56, '#f1f4f6', alpha * 0.88, 16);
      triangle(x + Math.cos(rotation) * size * 0.72, y + Math.sin(rotation) * size * 0.72, size * 0.22, rotation, '#f9c74f', alpha * 0.96);
      line(x - perpendicular.x * size * 0.92, y - perpendicular.y * size * 0.92, x - perpendicular.x * size * 1.3, y - perpendicular.y * size * 1.3, 2, '#f9c74f', alpha * 0.7);
      line(x + perpendicular.x * size * 0.92, y + perpendicular.y * size * 0.92, x + perpendicular.x * size * 1.3, y + perpendicular.y * size * 1.3, 2, '#f9c74f', alpha * 0.7);
    };
    const drawDelivery = (x, y, size, rotation, alpha = fade) => {
      drawPackage(x, y, size * 0.62, rotation, alpha);
      line(x - Math.cos(rotation) * size * 1.35, y - Math.sin(rotation) * size * 1.35, x - Math.cos(rotation) * size * 0.72, y - Math.sin(rotation) * size * 0.72, 3, '#ee964b', alpha * 0.68);
      line(x - Math.cos(rotation) * size * 1.35 + perpendicular.x * size * 0.2, y - Math.sin(rotation) * size * 1.35 + perpendicular.y * size * 0.2, x - Math.cos(rotation) * size * 0.72 + perpendicular.x * size * 0.2, y - Math.sin(rotation) * size * 0.72 + perpendicular.y * size * 0.2, 2, '#f9c74f', alpha * 0.58);
    };
    const drawStyleAttack = (ranged) => {
      const actionProgress = clamp(elapsed / 0.72, 0, 1);
      const length = effect.radius * (0.34 + actionProgress * 0.95);
      const origin = pointAlong(-6);
      const head = pointAlong(length);
      if (ranged) {
        if (style === 'shotgun') {
          line(origin.x, origin.y, head.x, head.y, 5, '#ff8b5c', fade * 0.7);
          line(origin.x + perpendicular.x * 7, origin.y + perpendicular.y * 7, head.x + perpendicular.x * 12, head.y + perpendicular.y * 12, 2, '#ffd166', fade * 0.66);
          line(origin.x - perpendicular.x * 7, origin.y - perpendicular.y * 7, head.x - perpendicular.x * 12, head.y - perpendicular.y * 12, 2, '#ffd166', fade * 0.66);
          triangle(effect.x + direction.x * 17, effect.y + direction.y * 17, 8, angle, '#fff1e6', fade * 0.78);
          circle(head.x + perpendicular.x * 12, head.y + perpendicular.y * 12, 4, '#ff8b5c', fade * 0.82, 12);
          circle(head.x - perpendicular.x * 12, head.y - perpendicular.y * 12, 4, '#ff8b5c', fade * 0.82, 12);
        } else if (style === 'basketball') {
          line(origin.x, origin.y, head.x, head.y, 2.5, '#c7b8ff', fade * 0.42);
          drawBasketball(head.x, head.y, 10 + actionProgress * 3, angle + actionProgress * 3.5, fade * 0.94);
        } else if (style === 'rhythm') {
          drawBeat(effect.x + direction.x * length * 0.58, effect.y + direction.y * length * 0.58, 18 + actionProgress * 8, angle + this.renderTime, fade * 0.84);
          line(origin.x, origin.y, head.x, head.y, 2, '#7f8cff', fade * 0.48);
        } else if (style === 'sniper') {
          line(origin.x, origin.y, head.x, head.y, 3, '#efff8f', fade * 0.86);
          diamond(head.x, head.y, 6, angle + Math.PI / 4, '#efff8f', fade * 0.9);
          line(effect.x - perpendicular.x * 14, effect.y - perpendicular.y * 14, effect.x + perpendicular.x * 14, effect.y + perpendicular.y * 14, 2, '#4ecdc4', fade * 0.5);
        } else if (style === 'watermelon' || style === 'melon') {
          drawMelon(head.x, head.y, 11, angle, fade * 0.92);
          line(origin.x, origin.y, head.x, head.y, 2, '#f7c873', fade * 0.36);
        } else if (style === 'milkBubble') {
          drawBubble(head.x, head.y, 9 + actionProgress * 2, fade * 0.9);
          line(origin.x, origin.y, head.x, head.y, 2, '#90be6d', fade * 0.28);
        } else if (style === 'delivery') {
          drawDelivery(head.x, head.y, 15, angle, fade * 0.92);
        } else if (style === 'penguin') {
          drawPenguin(head.x, head.y, 10, angle, fade * 0.92);
        } else {
          drawLightning(head.x, head.y, 18, angle, fade * 0.9);
        }
        return;
      }

      const targetX = Number.isFinite(effect.toX) ? effect.toX : head.x;
      const targetY = Number.isFinite(effect.toY) ? effect.toY : head.y;
      if (style === 'claw') {
        const sweep = angle - 1.0 + actionProgress * 2;
        drawClaws(targetX, targetY, effect.radius * (0.5 + actionProgress * 0.5), sweep, fade * 0.92);
      } else if (style === 'poke') {
        line(effect.x, effect.y, targetX, targetY, 3, '#a8dadc', fade * 0.45);
        triangle(targetX, targetY, effect.radius * (0.2 + actionProgress * 0.16), angle, '#a8dadc', fade * 0.92);
        line(targetX - perpendicular.x * 14, targetY - perpendicular.y * 14, targetX + perpendicular.x * 14, targetY + perpendicular.y * 14, 2, '#f1faee', fade * 0.72);
      } else if (style === 'ram' || style === 'heavy') {
        drawRam(effect.x, effect.y, effect.radius * (0.72 + actionProgress * 0.4), angle, fade * 0.92);
      } else if (style === 'bark') {
        drawLightning(targetX, targetY, effect.radius * 0.72, angle, fade * 0.9);
        arc(targetX, targetY, effect.radius * 0.58, angle - 0.7, angle + 0.7, 3, '#ffcf70', fade * 0.72);
      } else if (style === 'hiss') {
        drawW(targetX, targetY, effect.radius * (0.58 + actionProgress * 0.26), fade * 0.95);
      } else if (style === 'shield') {
        drawShield(targetX, targetY, effect.radius * (0.55 + actionProgress * 0.18), angle, fade * 0.86);
      } else if (style === 'melon') {
        drawMelon(targetX, targetY, effect.radius * 0.62, angle, fade * 0.9);
      } else if (style === 'magic') {
        drawMagic(targetX, targetY, effect.radius * 0.7, angle, fade * 0.82);
      } else if (style === 'delivery') {
        drawPackage(targetX, targetY, effect.radius * 0.5, angle, fade * 0.9);
      } else if (style === 'penguin') {
        drawPenguin(targetX, targetY, effect.radius * 0.34, angle, fade * 0.84);
      } else if (style === 'sniper') {
        line(effect.x, effect.y, targetX, targetY, 2, '#efff8f', fade * 0.78);
        diamond(targetX, targetY, effect.radius * 0.3, angle, '#efff8f', fade * 0.92);
      } else {
        drawLightning(targetX, targetY, effect.radius * 0.72, angle, fade * 0.86);
      }
    };
    const drawStyleImpact = (scale = radius, alpha = fade) => {
      if (style === 'shotgun') {
        burst(5, scale * 0.18, scale * 0.9, 3, '#ff8b5c', alpha * 0.85, angle - 0.4);
        circle(effect.x + perpendicular.x * scale * 0.42, effect.y + perpendicular.y * scale * 0.42, scale * 0.13, '#ffd166', alpha * 0.9, 12);
        circle(effect.x - perpendicular.x * scale * 0.42, effect.y - perpendicular.y * scale * 0.42, scale * 0.13, '#ffd166', alpha * 0.9, 12);
      } else if (style === 'basketball' || style === 'rhythm') {
        drawBeat(effect.x, effect.y, scale * 0.85, angle + this.renderTime * 1.4, alpha);
        for (let index = 0; index < 3; index += 1) diamond(effect.x + perpendicular.x * (index - 1) * scale * 0.32, effect.y + perpendicular.y * (index - 1) * scale * 0.32, scale * 0.1, angle + index, '#f3d6ff', alpha * 0.72);
      } else if (style === 'ram' || style === 'heavy') {
        drawRam(effect.x, effect.y, scale, angle, alpha);
        burst(5, scale * 0.3, scale * 1.12, 4, '#f6bd60', alpha * 0.68, angle - 0.45);
      } else if (style === 'sniper') {
        line(effect.x - perpendicular.x * scale, effect.y - perpendicular.y * scale, effect.x + perpendicular.x * scale, effect.y + perpendicular.y * scale, 3, '#efff8f', alpha * 0.92);
        line(effect.x - direction.x * scale * 0.72, effect.y - direction.y * scale * 0.72, effect.x + direction.x * scale * 0.72, effect.y + direction.y * scale * 0.72, 2, '#4ecdc4', alpha * 0.72);
        diamond(effect.x, effect.y, scale * 0.34, angle + Math.PI / 4, '#efff8f', alpha * 0.9);
      } else if (style === 'bark') {
        drawLightning(effect.x, effect.y, scale * 1.2, angle, alpha);
        arc(effect.x, effect.y, scale * 0.64, angle - 1.15, angle + 1.15, 3, '#ffcf70', alpha * 0.72);
      } else if (style === 'hiss') {
        drawW(effect.x, effect.y, scale * 0.95, alpha);
        burst(4, scale * 0.25, scale * 0.9, 2, '#f1faee', alpha * 0.72, -0.35);
      } else if (style === 'magic') {
        drawMagic(effect.x, effect.y, scale, angle + elapsed, alpha);
      } else if (style === 'blink') {
        for (let index = 0; index < 4; index += 1) diamond(effect.x + Math.cos(index * Math.PI / 2) * scale * 0.62, effect.y + Math.sin(index * Math.PI / 2) * scale * 0.62, scale * 0.18, index * Math.PI / 2, '#ff595e', alpha * 0.82);
      } else if (style === 'claw') {
        drawClaws(effect.x, effect.y, scale * 0.92, angle - 0.65 + elapsed * 1.4, alpha);
      } else if (style === 'milkBubble') {
        drawBubble(effect.x, effect.y, scale * 0.48, alpha);
        drawBubble(effect.x + perpendicular.x * scale * 0.55, effect.y + perpendicular.y * scale * 0.55, scale * 0.2, alpha * 0.72);
      } else if (style === 'delivery') {
        drawDelivery(effect.x, effect.y, scale, angle, alpha);
        burst(4, scale * 0.18, scale * 0.92, 2, '#f9c74f', alpha * 0.7, 0.2);
      } else if (style === 'penguin') {
        drawPenguin(effect.x, effect.y, scale * 0.45, angle, alpha);
        line(effect.x - scale * 0.7, effect.y + scale * 0.72, effect.x - scale * 0.4, effect.y + scale * 0.72, 3, '#f9c74f', alpha * 0.7);
        line(effect.x + scale * 0.4, effect.y + scale * 0.72, effect.x + scale * 0.7, effect.y + scale * 0.72, 3, '#f9c74f', alpha * 0.7);
      } else if (style === 'shield') {
        drawShield(effect.x, effect.y, scale * 0.9, angle, alpha);
      } else if (style === 'poke') {
        line(effect.x - direction.x * scale, effect.y - direction.y * scale, effect.x + direction.x * scale, effect.y + direction.y * scale, 4, '#a8dadc', alpha * 0.9);
        triangle(effect.x + direction.x * scale * 0.9, effect.y + direction.y * scale * 0.9, scale * 0.25, angle, '#f1faee', alpha * 0.86);
      } else if (style === 'melon' || style === 'watermelon') {
        drawMelon(effect.x, effect.y, scale * 0.88, angle, alpha);
        burst(4, scale * 0.32, scale * 1.05, 2, '#cce58b', alpha * 0.72, angle);
      } else {
        drawLightning(effect.x, effect.y, scale, angle, alpha);
      }
    };
    const drawSpawn = () => {
      if (style === 'magic') {
        drawMagic(effect.x, effect.y, radius, this.renderTime * 0.8, fade * 0.9);
        diamond(effect.x, effect.y, radius * 0.22, this.renderTime, '#f1faee', fade * 0.7);
      } else if (style === 'heavy' || style === 'ram') {
        drawRam(effect.x, effect.y, radius * 0.72, this.renderTime * 0.22, fade * 0.78);
        burst(5, radius * 0.32, radius * 0.82, 3, '#f6bd60', fade * 0.58);
      } else if (style === 'penguin') {
        drawPenguin(effect.x, effect.y, radius * 0.38, 0, fade * 0.82);
        line(effect.x - radius * 0.72, effect.y + radius * 0.56, effect.x - radius * 0.42, effect.y + radius * 0.56, 2, '#f9c74f', fade * 0.62);
        line(effect.x + radius * 0.42, effect.y + radius * 0.56, effect.x + radius * 0.72, effect.y + radius * 0.56, 2, '#f9c74f', fade * 0.62);
      } else if (style === 'melon') {
        drawMelon(effect.x, effect.y, radius * 0.58, 0, fade * 0.85);
      } else if (style === 'delivery') {
        drawPackage(effect.x, effect.y, radius * 0.52, -elapsed, fade * 0.86);
      } else {
        drawLightning(effect.x, effect.y, radius * 0.72, this.renderTime, fade * 0.78);
      }
    };

    if (effect.type === 'attack') {
      drawStyleAttack(effect.mode === 'ranged');
      return;
    }

    if (effect.type === 'impact') {
      drawStyleImpact(effect.radius * (0.55 + elapsed * 0.9), fade * (1 - elapsed * 0.12));
      if (effect.knockback > 50) {
        const pushLength = Math.min(60, effect.knockback * 0.22) * (0.45 + elapsed * 0.55);
        line(effect.x - direction.x * 9, effect.y - direction.y * 9, effect.x + direction.x * pushLength, effect.y + direction.y * pushLength, 4, '#f4c66a', fade * 0.72);
        triangle(effect.x + direction.x * pushLength, effect.y + direction.y * pushLength, 7, angle, '#f4c66a', fade * 0.72);
      }
      return;
    }

    if (effect.type === 'spawn') {
      drawSpawn();
      return;
    }

    if (effect.type === 'teleport') {
      if (Number.isFinite(effect.fromX) && Number.isFinite(effect.fromY)) {
        line(effect.fromX, effect.fromY, effect.x, effect.y, 2, '#a98bff', fade * 0.28);
      }
      const portalScale = effect.radius * (effect.phase === 'out' ? 0.7 + elapsed * 0.55 : 1.05 - elapsed * 0.25);
      for (let index = 0; index < 4; index += 1) {
        const portalAngle = index * Math.PI / 2 + this.renderTime * 0.4;
        diamond(effect.x + Math.cos(portalAngle) * portalScale * 0.58, effect.y + Math.sin(portalAngle) * portalScale * 0.58, portalScale * 0.16, portalAngle, '#a98bff', fade * 0.82);
      }
      arc(effect.x, effect.y, portalScale * 0.72, -1.8 + elapsed, -0.45 + elapsed, 4, '#f1faee', fade * 0.76);
      arc(effect.x, effect.y, portalScale * 0.72, 0.5 + elapsed, 1.85 + elapsed, 4, '#a98bff', fade * 0.7);
      return;
    }

    if (effect.type === 'charge') {
      if (Number.isFinite(effect.fromX) && Number.isFinite(effect.fromY)) {
        const chargeDirection = normalize(effect.x - effect.fromX, effect.y - effect.fromY);
        line(effect.fromX, effect.fromY, effect.x, effect.y, 4, '#ed6a5a', fade * 0.38);
        drawRam(effect.x, effect.y, radius, Math.atan2(chargeDirection.y, chargeDirection.x), fade * 0.92);
      } else {
        drawRam(effect.x, effect.y, radius, angle, fade * 0.88);
      }
      return;
    }

    if (effect.type === 'summon') {
      drawMagic(effect.x, effect.y, radius, this.renderTime * 0.7, fade * 0.92);
      return;
    }

    if (effect.type === 'shield') {
      drawShield(effect.x, effect.y, radius, angle, fade * 0.92);
      return;
    }

    if (effect.type === 'taunt') {
      drawLightning(effect.x, effect.y, radius * 0.9, 0, fade * 0.82);
      arc(effect.x, effect.y, radius * 0.72, -1.1, 1.1, 4, '#ffcf70', fade * 0.78);
      burst(6, radius * 0.72, radius * 0.95, 3, '#ffcf70', fade * 0.72, Math.PI / 6);
      return;
    }

    if (effect.type === 'telegraph') {
      if (style === 'delivery') {
        drawPackage(effect.x, effect.y, radius * 0.58, 0, fade * 0.88);
        for (let index = 0; index < 4; index += 1) {
          const start = index * Math.PI / 2 + elapsed * 0.8;
          line(effect.x + Math.cos(start) * radius * 0.72, effect.y + Math.sin(start) * radius * 0.72, effect.x + Math.cos(start + 0.58) * radius * 0.72, effect.y + Math.sin(start + 0.58) * radius * 0.72, 3, '#f9c74f', fade * 0.74);
        }
      } else if (style === 'hiss') {
        drawW(effect.x, effect.y, radius * 0.8, fade * 0.92);
      } else if (style === 'melon') {
        drawMelon(effect.x, effect.y, radius * 0.62, elapsed, fade * 0.84);
      } else {
        diamond(effect.x, effect.y, radius * 0.28, elapsed, color, fade * 0.72);
        line(effect.x - radius * 0.58, effect.y, effect.x + radius * 0.58, effect.y, 2, color, fade * 0.62);
        line(effect.x, effect.y - radius * 0.58, effect.x, effect.y + radius * 0.58, 2, color, fade * 0.62);
      }
      return;
    }

    if (effect.type === 'burst' || effect.type === 'death') {
      drawStyleImpact(radius * (effect.type === 'death' ? 1.15 : 0.9), fade);
      return;
    }

    if (effect.type === 'heal') {
      if (style === 'delivery') {
        drawDelivery(effect.x, effect.y, radius * 0.9, -0.2, fade * 0.9);
      } else {
        drawBubble(effect.x - radius * 0.22, effect.y + radius * 0.08, radius * 0.42, fade * 0.82);
        drawBubble(effect.x + radius * 0.27, effect.y - radius * 0.18, radius * 0.3, fade * 0.76);
      }
      line(effect.x - radius * 0.34, effect.y, effect.x + radius * 0.34, effect.y, 4, '#9cf6a6', fade * 0.88);
      line(effect.x, effect.y - radius * 0.34, effect.x, effect.y + radius * 0.34, 4, '#9cf6a6', fade * 0.88);
      return;
    }

    if (effect.type === 'mark') {
      if (style === 'claw') drawClaws(effect.x, effect.y, radius * 0.9, angle - 0.5 + elapsed * 1.3, fade * 0.88);
      else if (style === 'delivery') drawPackage(effect.x, effect.y, radius * 0.62, angle, fade * 0.84);
      else diamond(effect.x, effect.y, radius * 0.42, angle, color, fade * 0.82);
      return;
    }

    if (effect.type === 'skill') {
      if (style === 'magic') drawMagic(effect.x, effect.y, radius, angle + elapsed, fade * 0.9);
      else if (style === 'rhythm' || style === 'basketball') drawBeat(effect.x, effect.y, radius, angle + this.renderTime, fade * 0.9);
      else if (style === 'hiss') drawW(effect.x, effect.y, radius * 0.82, fade * 0.92);
      else if (style === 'blink') drawClaws(effect.x, effect.y, radius * 0.9, angle + elapsed, fade * 0.86);
      else drawStyleImpact(radius * 0.82, fade * 0.84);
    }
  }

  drawUnit(unit) {
    const data = unit.data;
    const alive = unit.alive !== false;
    const deathProgress = alive ? 1 : clamp(1 - (unit.deadFor ?? 0) / 3, 0, 1);
    if (deathProgress <= 0) return;
    const radius = data.radius * (alive ? 1 : 0.78);
    const factionColor = unit.side === 'player' ? '#63e0cb' : '#ff796a';
    const pulse = alive && unit.pulse > 0 ? 1 + Math.sin(this.renderTime * 36) * 0.08 : 1;
    const facing = Number.isFinite(unit.facing) ? unit.facing : (unit.side === 'player' ? 0 : Math.PI);
    const spriteFacing = data.spriteFacing;
    const horizontalFacing = Math.cos(facing);
    const desiredFacing = Math.abs(horizontalFacing) < 0.18
      ? (unit.side === 'player' ? 'right' : 'left')
      : (horizontalFacing >= 0 ? 'right' : 'left');
    const spriteFlipX = (spriteFacing === 'left' || spriteFacing === 'right') && desiredFacing !== spriteFacing;
    const actionDuration = Math.max(0.001, unit.actionDuration ?? 0);
    const actionProgress = actionDuration > 0 ? clamp(1 - (unit.actionLife ?? 0) / actionDuration, 0, 1) : 0;
    const actionPulse = Math.sin(Math.PI * actionProgress);
    const actionDirectionX = Number.isFinite(unit.actionDirectionX) ? unit.actionDirectionX : Math.cos(facing);
    const actionDirectionY = Number.isFinite(unit.actionDirectionY) ? unit.actionDirectionY : Math.sin(facing);
    const actionDistance = unit.actionType === 'meleeAttack' ? 14
      : unit.actionType === 'rangedAttack' ? -6
        : unit.actionType === 'skill' ? 5
          : unit.actionType === 'death' ? -8 : 0;
    const hurtDuration = Math.max(0.001, unit.hurtDuration ?? 0);
    const hurtRatio = hurtDuration > 0 ? clamp((unit.hurtLife ?? 0) / hurtDuration, 0, 1) : 0;
    const hurtPulse = Math.sin(Math.PI * (1 - hurtRatio));
    const hurtDirectionX = Number.isFinite(unit.hurtDirectionX) ? unit.hurtDirectionX : 0;
    const hurtDirectionY = Number.isFinite(unit.hurtDirectionY) ? unit.hurtDirectionY : 0;
    const hurtShake = hurtPulse * Math.sin(this.renderTime * 90 + (unit.id?.length ?? 0)) * Math.min(7, radius * 0.24);
    const renderX = unit.x + actionDirectionX * actionDistance * actionPulse - hurtDirectionX * hurtPulse * 4 - hurtDirectionY * hurtShake;
    const renderY = unit.y + actionDirectionY * actionDistance * actionPulse - hurtDirectionY * hurtPulse * 4 + hurtDirectionX * hurtShake;
    const actionScale = 1 + actionPulse * (unit.actionType === 'meleeAttack' ? 0.1 : 0.045);
    const hurtScale = 1 + hurtPulse * 0.075;
    const drawRadius = radius * pulse * actionScale * hurtScale;
    const hitTint = unit.hitFlash > 0 ? '#ffc1b7' : '#ffffff';

    this.renderer.drawRect(renderX + 5, renderY + drawRadius * 0.82, drawRadius * 1.35, 5, '#030b12', 0.24 * deathProgress);
    if (this.renderer.spriteReady && Number.isInteger(data.spriteIndex)) {
      const spriteSize = Math.max(data.radius * 3.0, 70) * (alive ? pulse : 0.9);
      this.renderer.drawSprite(renderX, renderY - data.radius * 0.22, spriteSize * actionScale * hurtScale, spriteSize * actionScale * hurtScale, data.spriteIndex, (alive ? 0.98 : 0.44) * deathProgress, hitTint, spriteFlipX);
    } else {
      this.renderer.drawRect(renderX, renderY, drawRadius * 1.55, drawRadius * 1.55, hitTint === '#ffffff' ? data.color : '#ff8b7e', (alive ? 0.94 : 0.42) * deathProgress);
    }

    if (alive) {
      const maxHp = Math.max(1, unit.maxHp ?? data.hp);
      const hpRatio = clamp((unit.hp ?? data.hp) / maxHp, 0, 1);
      const delayedHpRatio = clamp(Math.max(hpRatio, (unit.barHp ?? unit.hp ?? data.hp) / maxHp), hpRatio, 1);
      const barWidth = Math.max(34, drawRadius * 2.3);
      const barY = renderY - drawRadius - 12;
      const barLeft = renderX - barWidth / 2;
      this.renderer.drawRect(renderX, barY, barWidth, 5, '#09151d', 0.88);
      if (delayedHpRatio > hpRatio + 0.005) {
        const delayedWidth = barWidth * (delayedHpRatio - hpRatio);
        this.renderer.drawRect(barLeft + barWidth * hpRatio + delayedWidth / 2, barY, delayedWidth, 5, '#bd5261', 0.76);
      }
      if (hpRatio > 0) this.renderer.drawRect(barLeft + barWidth * hpRatio / 2, barY, barWidth * hpRatio, 5, hpRatio > 0.35 ? factionColor : '#ffb06a', 0.94);
      if (hurtPulse > 0.04) {
        const hitX = unit.hitPointX ?? renderX;
        const hitY = unit.hitPointY ?? renderY;
        const hitDirection = normalize(hitX - renderX, hitY - renderY);
        const hitPerpendicular = { x: -hitDirection.y, y: hitDirection.x };
        const hitLength = 8 + hurtPulse * 8;
        this.renderer.drawLine(hitX - hitPerpendicular.x * hitLength, hitY - hitPerpendicular.y * hitLength, hitX + hitPerpendicular.x * hitLength, hitY + hitPerpendicular.y * hitLength, 3, '#ff9b8d', hurtPulse * 0.82);
        this.renderer.drawLine(hitX - hitDirection.x * hitLength * 0.8, hitY - hitDirection.y * hitLength * 0.8, hitX + hitDirection.x * hitLength * 0.8, hitY + hitDirection.y * hitLength * 0.8, 2, '#fff1e6', hurtPulse * 0.7);
      }
      if (unit.status?.stun > 0) this.renderer.drawRect(renderX, barY - 7, 12, 3, '#f4c66a', 0.86);
      if (unit.status?.taunt > 0) this.renderer.drawRect(renderX, barY - 12, 10, 3, '#ff796a', 0.8);
      if (unit.status?.guard > 0) {
        this.renderer.drawLine(renderX - 8, renderY - drawRadius - 7, renderX, renderY - drawRadius - 13, 2, '#edf2f4', 0.82);
        this.renderer.drawLine(renderX, renderY - drawRadius - 13, renderX + 8, renderY - drawRadius - 7, 2, '#edf2f4', 0.82);
      }
    }
  }

  updateWorldLabels() {
    const visibleUnits = this.battleUnits;
    const activeIds = new Set();
    for (const unit of visibleUnits) {
      if (!unit.data || unit.alive === false && (unit.deadFor ?? 0) > 3) continue;
      const id = unit.id ?? `${unit.side}-${unit.data.id}-${unit.x}-${unit.y}`;
      activeIds.add(id);
      let label = this.labelNodes.get(id);
      if (!label) {
        label = makeElement('div', 'world-label');
        this.labelNodes.set(id, label);
        this.worldLabels.append(label);
      }
      const isRetreating = this.phase === 'battle' && unit.alive !== false && unit.intent === 'retreat';
      label.className = `world-label${unit.side === 'enemy' ? ' enemy' : ''}${isRetreating ? ' retreat' : ''}`;
      const hpText = this.phase === 'prep' ? '' : ` · ${Math.max(0, Math.ceil(unit.hp ?? 0))}`;
      label.textContent = `${unit.data.name}${isRetreating ? ' · 后撤' : ''}${hpText}`;
      const screen = this.renderer.worldToScreen(unit.x, unit.y - unit.data.radius - 30);
      label.style.left = `${screen.x}px`;
      label.style.top = `${screen.y}px`;
      label.style.opacity = this.isScreenVisible(screen.x, screen.y) ? String(unit.alive === false ? 0.35 : 1) : '0';
    }
    for (const [id, node] of this.labelNodes.entries()) {
      if (!activeIds.has(id)) {
        node.remove();
        this.labelNodes.delete(id);
      }
    }

    const activeEffectIds = new Set();
    if (this.simulation && this.phase !== 'prep') {
      for (const effect of this.simulation.effects) {
        if (!effect.label) continue;
        const id = `effect-${effect.id}`;
        activeEffectIds.add(id);
        let label = this.effectLabelNodes.get(id);
        if (!label) {
          label = makeElement('div', 'effect-label');
          this.effectLabelNodes.set(id, label);
          this.worldLabels.append(label);
        }
        label.className = `effect-label effect-${effect.type}`;
        label.textContent = effect.label;
        label.style.setProperty('--effect-color', effect.color ?? '#f4c66a');
        const offset = Math.min(Math.max(effect.radius * 0.22, 18), 56) + 22;
        const screen = this.renderer.worldToScreen(effect.x, effect.y - offset);
        label.style.left = `${screen.x}px`;
        label.style.top = `${screen.y}px`;
        label.style.opacity = this.isScreenVisible(screen.x, screen.y) ? String(clamp(effect.life / 0.18, 0, 1)) : '0';
      }
    }
    for (const [id, node] of this.effectLabelNodes.entries()) {
      if (!activeEffectIds.has(id)) {
        node.remove();
        this.effectLabelNodes.delete(id);
      }
    }

    const activeFloatingTextIds = new Set();
    if (this.simulation && this.phase !== 'prep') {
      for (const text of this.simulation.floatingTexts) {
        const id = text.id ?? `floating-${text.x}-${text.y}-${text.text}`;
        activeFloatingTextIds.add(id);
        let label = this.floatingTextNodes.get(id);
        if (!label) {
          label = makeElement('div', 'floating-text');
          this.floatingTextNodes.set(id, label);
          this.worldLabels.append(label);
        }
        const lifeRatio = clamp(text.life / Math.max(0.2, text.maxLife ?? 0.82), 0, 1);
        const kind = text.kind === 'heal' ? 'heal' : 'damage';
        label.className = `floating-text ${kind}${text.critical ? ' critical' : ''}`;
        label.textContent = text.text;
        label.style.setProperty('--float-color', text.color ?? (kind === 'heal' ? '#9cf6a6' : '#fff1e6'));
        const screen = this.renderer.worldToScreen(text.x, text.y);
        label.style.left = `${screen.x}px`;
        label.style.top = `${screen.y}px`;
        label.style.transform = `translate(-50%, -50%) translate(${text.offsetX ?? 0}px, 0) scale(${0.82 + (1 - lifeRatio) * 0.18})`;
        label.style.opacity = this.isScreenVisible(screen.x, screen.y) ? String(clamp(lifeRatio * 1.7, 0, 1)) : '0';
      }
    }
    for (const [id, node] of this.floatingTextNodes.entries()) {
      if (!activeFloatingTextIds.has(id)) {
        node.remove();
        this.floatingTextNodes.delete(id);
      }
    }
  }

  isScreenVisible(x, y) {
    return x > -90 && y > -35 && x < this.renderer.width + 90 && y < this.renderer.height + 35;
  }
}

async function loadJson(path) {
  const embedded = window.MEME_WAR_EMBEDDED_DATA?.[path];
  if (embedded) return embedded;
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`加载 ${path} 失败：${response.status}`);
  return response.json();
}

async function bootstrap() {
  try {
    const [unitsData, levelsData] = await Promise.all([loadJson('./data/units.json'), loadJson('./data/levels.json')]);
    const app = new MemeWarApp(unitsData, levelsData);
    await app.init();
    window.memeWarApp = app;
  } catch (error) {
    console.error(error);
    const loading = $('#loading');
    if (loading) {
      loading.classList.add('hidden');
    }
    const toast = $('#toast');
    if (toast) toast.textContent = '战场初始化失败，请刷新页面后重试。';
  }
}

bootstrap();
