const { BattleSimulation, WORLD } = window.MemeWarSim;
const { NativeWebGLRenderer } = window.MemeWarWebGL;

const UNIT_TEXTURE_URL = window.MEME_WAR_TEXTURE_URL || window.MEME_WAR_TEXTURE_DATA || './assets/units-handdrawn-atlas-mobile.webp';
const MAX_DEPLOYMENTS = 24;
const MIN_ZOOM = 0.24;
const MAX_ZOOM = 1.45;
const PLAYER_ZONE_RIGHT = 760;
const PLAYER_SAFE_MARGIN = 48;
const DEPLOYMENT_GAP = 6;
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const getUnitFootprintRadius = (unit) => Math.max((Number(unit?.radius) || 0) * 1.5, 35);
const normalize = (x, y) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};
const formatClock = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
};
const getViewportSize = () => {
  const viewport = window.visualViewport;
  return {
    width: Math.round((viewport?.width || window.innerWidth || document.documentElement.clientWidth) * 10) / 10,
    height: Math.round((viewport?.height || window.innerHeight || document.documentElement.clientHeight) * 10) / 10,
  };
};

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
    this.worldSprites = $('#worldSprites');
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
    this.suppressCardClick = false;
    this.suppressCardClickTimer = null;
    this.hoverWorld = null;
    this.cameraDrag = null;
    this.slowInput = false;
    this.paused = false;
    this.speed = 1;
    this.renderTime = 0;
    this.lastFrameTime = 0;
    this.lastLabelUpdate = -Infinity;
    this.resultShown = false;
    this.labelNodes = new Map();
    this.effectLabelNodes = new Map();
    this.spriteNodes = new Map();
    this.textureLoadPromise = null;

    this.camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 0.72 };
    this.elements = {
      app: $('#app'),
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
      waveReadout: $('#waveReadout'),
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
      orientationGate: $('#orientationGate'),
      orientationButton: $('#orientationButton'),
    };
    this.toastTimer = null;
  }

  async init() {
    this.populateLevelPicker();
    this.populateUnitDock();
    this.bindEvents();
    this.updateLevelUi();

    try {
      this.renderer = new NativeWebGLRenderer(this.canvas);
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
      this.syncOrientationUi();
      if (!this.renderer) return;
      this.renderer.resize();
      this.fitCamera();
      this.render();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    document.addEventListener('fullscreenchange', handleViewportChange);
    this.elements.loading.classList.add('hidden');
    this.logEvent({ text: '战场加载完成。挑一张卡，然后把它放进左半场。', tone: 'info' });
    this.syncUi();
    this.syncOrientationUi();
    if (this.isPortraitPhone()) {
      window.setTimeout(() => this.tryLockLandscape({ requestFullscreen: false }), 0);
    }
    const loadTexture = () => this.loadUnitTexture();
    if (this.renderer.isMobile) window.setTimeout(loadTexture, 1800);
    else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(loadTexture, { timeout: 1200 });
    else window.setTimeout(loadTexture, 120);
    window.requestAnimationFrame((time) => this.frame(time));
  }

  loadUnitTexture() {
    if (this.textureLoadPromise) return this.textureLoadPromise;
    if (!this.renderer) return Promise.resolve();
    this.textureLoadPromise = this.renderer.loadTexture(UNIT_TEXTURE_URL)
      .then(() => this.syncUnitCardTextures())
      .catch(() => {
        if (!IS_FILE_PROTOCOL) this.showToast('手绘角色纹理加载失败，将使用几何占位。');
      });
    return this.textureLoadPromise;
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
      const rangeText = unit.range > 100 ? `射程 ${unit.range}` : '近战';
      card.setAttribute('aria-label', `${unit.name}，${unit.price} 金，${unit.roleLabel}，移速 ${Math.round(unit.spd)}，${rangeText}，可拖到左侧战场部署`);

      const top = makeElement('div', 'card-top');
      const glyph = makeElement('span', 'unit-glyph', unit.name.slice(0, 1));
      glyph.style.background = unit.color;
      if (Number.isInteger(unit.spriteIndex)) {
        glyph.dataset.spriteIndex = String(unit.spriteIndex);
      }
      const price = makeElement('span', 'unit-price', `${unit.price} 金`);
      top.append(glyph, price);

      const name = makeElement('div', 'unit-name', unit.name);
      const role = makeElement('div', 'unit-role', unit.roleLabel);
      const stats = makeElement('div', 'unit-stats');
      const hp = makeElement('span', '', `❤${unit.hp}`);
      const atk = makeElement('b', '', unit.role === 'deployable' ? '路障' : `⚔ ${unit.atk}`);
      const speed = makeElement('span', '', `↔${Math.round(unit.spd)}`);
      const range = makeElement('span', '', unit.range > 100 ? `射程${unit.range}` : '近战');
      stats.append(hp, atk, speed, range);
      card.append(top, name, role, stats);
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
    this.syncUnitCardTextures();
    this.updateUnitCards();
  }

  syncUnitCardTextures() {
    const textureReady = Boolean(this.renderer?.spriteReady);
    const textureAvailable = textureReady || IS_FILE_PROTOCOL;
    for (const card of this.elements.unitList.children) {
      const unit = this.unitsById[card.dataset.unitId];
      const glyph = card.querySelector('.unit-glyph');
      if (!unit || !glyph) continue;
      glyph.style.background = unit.color;
      if (textureAvailable && Number.isInteger(unit.spriteIndex)) {
        const spriteColumn = unit.spriteIndex % 4;
        const spriteRow = Math.floor(unit.spriteIndex / 4);
        glyph.textContent = '';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.style.backgroundImage = `url("${UNIT_TEXTURE_URL}")`;
        glyph.style.backgroundSize = '400% 400%';
        glyph.style.backgroundPosition = `${spriteColumn * (100 / 3)}% ${spriteRow * (100 / 3)}%`;
      } else {
        glyph.textContent = unit.name.slice(0, 1);
        glyph.removeAttribute('aria-hidden');
        glyph.style.backgroundImage = 'none';
        glyph.style.backgroundSize = '';
        glyph.style.backgroundPosition = '';
      }
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
    this.elements.orientationButton?.addEventListener('click', () => this.tryLockLandscape());

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
    window.addEventListener('pointerdown', () => {
      this.audio.unlock();
      this.loadUnitTexture();
    }, { once: true });
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
    this.suppressCardClick = false;
    window.clearTimeout(this.suppressCardClickTimer);
    this.suppressCardClickTimer = null;
    this.cameraDrag = null;
    this.hoverWorld = null;
    this.simulation = null;
    this.paused = false;
    this.resultShown = false;
    this.camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 0.72 };
    this.fitCamera();
    this.elements.app.classList.remove('phase-battle', 'phase-result');
    this.elements.app.classList.add('phase-prep');
    this.elements.app.classList.remove('is-dragging-unit', 'drag-valid', 'is-dragging-deployment');
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
        const column = order % 3;
        const row = Math.floor(order / 3);
        result.push({
          id: `enemy-preview-${order}`,
          side: 'enemy',
          data,
          x: 1120 + column * 122 + (row % 2) * 36,
          y: 190 + row * 150 + (column % 2) * 28,
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
    this.audio.blip(460, 0.12, 'triangle', 0.035);
    this.syncUi();
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

  isPortraitPhone() {
    const { width, height } = getViewportSize();
    const shortEdge = Math.min(width, height);
    const hasTouchInput = navigator.maxTouchPoints > 0 || Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    return height > width && shortEdge <= 1024 && (hasTouchInput || shortEdge <= 600);
  }

  async tryLockLandscape({ requestFullscreen = true } = {}) {
    if (requestFullscreen) this.audio.unlock();
    if (requestFullscreen && !document.fullscreenElement && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (error) {
        console.info('浏览器未允许进入全屏，将继续尝试方向锁定。', error);
      }
    }
    try {
      if (window.screen?.orientation?.lock) await window.screen.orientation.lock('landscape');
    } catch (error) {
      console.info('浏览器未允许自动锁定横屏，请手动旋转设备。', error);
    }
    this.syncOrientationUi();
  }

  syncOrientationUi() {
    const { width, height } = getViewportSize();
    const isPortrait = height > width;
    const isPhoneLike = Math.min(width, height) <= 1024 && (navigator.maxTouchPoints > 0 || Boolean(window.matchMedia?.('(pointer: coarse)').matches) || Math.min(width, height) <= 600);
    const shouldVirtualize = isPortrait && isPhoneLike;
    document.documentElement.classList.toggle('is-virtual-landscape', shouldVirtualize);
    document.documentElement.classList.remove('is-portrait-phone');
    document.documentElement.dataset.orientation = shouldVirtualize ? 'virtual-landscape' : 'landscape';
    if (this.elements.orientationGate) this.elements.orientationGate.setAttribute('aria-hidden', 'true');
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
      startScrollLeft: this.elements.unitList.scrollLeft,
      scrolling: false,
    };
  }

  onGlobalPointerMove(event) {
    if (this.cardPointer?.pointerId !== event.pointerId && this.draggedUnit?.pointerId !== event.pointerId) return;
    if (this.phase !== 'prep') {
      this.cardPointer = null;
      this.finishUnitCardDrag();
      return;
    }

    if (this.cardPointer?.scrolling) {
      const scrollDelta = this.isVirtualLandscape()
        ? event.clientY - this.cardPointer.startY
        : event.clientX - this.cardPointer.startX;
      const maxScroll = Math.max(0, this.elements.unitList.scrollWidth - this.elements.unitList.clientWidth);
      this.elements.unitList.scrollLeft = clamp(this.cardPointer.startScrollLeft - scrollDelta, 0, maxScroll);
      event.preventDefault();
      return;
    }

    if (!this.draggedUnit) {
      const startPoint = this.getInputPoint({
        clientX: this.cardPointer.startX,
        clientY: this.cardPointer.startY,
      });
      const currentPoint = this.getInputPoint(event);
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      if (Math.hypot(dx, dy) < 10) return;
      const stillInCardList = this.isPointInside(this.elements.unitList, event);
      const physicalScrollDelta = this.isVirtualLandscape()
        ? event.clientY - this.cardPointer.startY
        : event.clientX - this.cardPointer.startX;
      const physicalCrossDelta = this.isVirtualLandscape()
        ? event.clientX - this.cardPointer.startX
        : event.clientY - this.cardPointer.startY;
      if (event.pointerType === 'touch' && this.isVirtualLandscape() && stillInCardList && Math.abs(physicalScrollDelta) >= Math.abs(physicalCrossDelta)) {
        this.cardPointer.scrolling = true;
        const maxScroll = Math.max(0, this.elements.unitList.scrollWidth - this.elements.unitList.clientWidth);
        this.elements.unitList.scrollLeft = clamp(this.cardPointer.startScrollLeft - physicalScrollDelta, 0, maxScroll);
        event.preventDefault();
        return;
      }
      if (event.pointerType === 'touch' && !this.isVirtualLandscape() && stillInCardList && Math.abs(dx) > Math.abs(dy)) return;
      const unit = this.unitsById[this.cardPointer.unitId];
      if (!unit || this.budgetRemaining < unit.price) {
        this.cardPointer = null;
        return;
      }
      this.draggedUnit = { ...this.cardPointer };
      this.cardPointer = null;
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
      this.elements.app.classList.toggle('drag-valid', this.isValidPlacement(this.hoverWorld.x, this.hoverWorld.y, this.unitsById[this.draggedUnit.unitId]));
    } else {
      this.hoverWorld = null;
      this.elements.app.classList.remove('drag-valid');
    }
  }

  onGlobalPointerUp(event) {
    if (this.cardPointer?.pointerId === event.pointerId) {
      const wasScrolling = this.cardPointer.scrolling;
      this.cardPointer = null;
      if (wasScrolling) {
        this.suppressCardClick = true;
        window.clearTimeout(this.suppressCardClickTimer);
        this.suppressCardClickTimer = window.setTimeout(() => {
          this.suppressCardClick = false;
        }, 250);
        event.preventDefault();
      }
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
    this.hoverWorld = null;
    this.elements.app.classList.remove('is-dragging-unit', 'drag-valid');
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
          lastValidX: existing.x,
          lastValidY: existing.y,
          blocked: false,
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
      const point = this.getInputPoint(event);
      this.cameraDrag = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
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
      if (!this.isPointInside(this.canvas, event)) {
        this.hoverWorld = null;
        this.elements.app.classList.remove('drag-valid');
        return;
      }
      const world = this.pointerToWorld(event);
      const deployment = this.draggedDeployment.deployment;
      const data = this.unitsById[deployment.unitId];
      this.hoverWorld = world;
      const footprint = getUnitFootprintRadius(data);
      const minX = WORLD.minX + Math.max(PLAYER_SAFE_MARGIN, footprint);
      const maxX = PLAYER_ZONE_RIGHT - footprint;
      const minY = WORLD.minY + Math.max(PLAYER_SAFE_MARGIN, footprint);
      const maxY = WORLD.maxY - Math.max(PLAYER_SAFE_MARGIN, footprint);
      const nextX = clamp(world.x, minX, maxX);
      const nextY = clamp(world.y, minY, maxY);
      const valid = this.isValidPlacement(nextX, nextY, data, deployment);
      this.draggedDeployment.blocked = !valid;
      this.elements.app.classList.toggle('drag-valid', valid);
      if (valid) {
        deployment.x = nextX;
        deployment.y = nextY;
        this.draggedDeployment.lastValidX = nextX;
        this.draggedDeployment.lastValidY = nextY;
      }
      return;
    }
    const world = this.pointerToWorld(event);
    this.hoverWorld = world;
    if (this.cameraDrag?.pointerId === event.pointerId) {
      const point = this.getInputPoint(event);
      const dx = (point.x - this.cameraDrag.startX) / this.camera.zoom;
      const dy = (point.y - this.cameraDrag.startY) / this.camera.zoom;
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
      } else if (drag.blocked) {
        drag.deployment.x = drag.lastValidX;
        drag.deployment.y = drag.lastValidY;
      }
      this.draggedDeployment = null;
      this.hoverWorld = null;
      this.elements.app.classList.remove('is-dragging-deployment');
      this.elements.app.classList.remove('drag-valid');
      this.updateDragDropUi();
      if (overCard && event.type !== 'pointercancel') {
        const data = this.unitsById[drag.deployment.unitId];
        this.removeDeployment(drag.deployment);
        this.showToast(`${data.name} 已撤销，${data.price} 金已退回。`);
        this.audio.blip(190, 0.06, 'square', 0.018);
      } else if (drag.blocked && event.type !== 'pointercancel') {
        this.showToast('这个位置太挤了，已保持上一个有效位置。');
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
    this.camera.zoom = clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.pointerToWorld(event);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }

  pointerToWorld(event) {
    const point = this.getInputPoint(event);
    const rect = this.isVirtualLandscape() ? this.getLayoutRect(this.canvas) : this.canvas.getBoundingClientRect();
    return this.renderer
      ? this.renderer.screenToWorld(point.x - rect.left, point.y - rect.top)
      : { x: WORLD.width / 2, y: WORLD.height / 2 };
  }

  isPointInside(element, event) {
    if (!element || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const point = this.getInputPoint(event);
    const rect = this.isVirtualLandscape() ? this.getLayoutRect(element) : element.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  isVirtualLandscape() {
    return document.documentElement.classList.contains('is-virtual-landscape');
  }

  getInputPoint(event) {
    if (!this.isVirtualLandscape()) return { x: event.clientX, y: event.clientY };
    const { width, height } = getViewportSize();
    if (height <= width) return { x: event.clientX, y: event.clientY };
    return { x: event.clientY, y: width - event.clientX };
  }

  getLayoutRect(element) {
    let left = 0;
    let top = 0;
    let node = element;
    while (node instanceof HTMLElement) {
      left += node.offsetLeft;
      top += node.offsetTop;
      node = node.offsetParent;
    }
    return {
      left,
      top,
      right: left + (element.offsetWidth || 0),
      bottom: top + (element.offsetHeight || 0),
    };
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

  fitCamera() {
    if (!this.renderer) return;
    this.camera.x = WORLD.width / 2;
    this.camera.y = WORLD.height / 2;
    this.camera.zoom = clamp(
      Math.min((this.renderer.width - 20) / WORLD.width, (this.renderer.height - 20) / WORLD.height),
      MIN_ZOOM,
      MAX_ZOOM,
    );
  }

  placeSelectedUnit(x, y) {
    const unit = this.unitsById[this.selectedUnitId];
    if (!unit) return;
    if (this.deployments.length >= MAX_DEPLOYMENTS) {
      this.showToast(`最多部署 ${MAX_DEPLOYMENTS} 个单位。`);
      return;
    }
    const footprint = getUnitFootprintRadius(unit);
    const minX = WORLD.minX + Math.max(PLAYER_SAFE_MARGIN, footprint);
    const maxX = PLAYER_ZONE_RIGHT - footprint;
    const minY = WORLD.minY + Math.max(PLAYER_SAFE_MARGIN, footprint);
    const maxY = WORLD.maxY - Math.max(PLAYER_SAFE_MARGIN, footprint);
    if (x > maxX || x < minX || y < minY || y > maxY) {
      this.showToast('只能放在左侧部署区内。');
      return;
    }
    if (this.budgetRemaining < unit.price) {
      this.showToast('预算不够了，换一张更便宜的卡。');
      return;
    }
    const placementX = clamp(x, minX, maxX);
    const placementY = clamp(y, minY, maxY);
    if (!this.isDeploymentPositionFree(placementX, placementY, unit)) {
      this.showToast('这个位置太挤了，请把单位之间拉开。');
      return;
    }
    const deployment = {
      id: `deployment-${this.nextDeploymentId++}`,
      unitId: unit.id,
      data: unit,
      x: placementX,
      y: placementY,
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
      if (currentDistance <= getUnitFootprintRadius(data) + 14 && currentDistance < closestDistance) {
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
      ? `完成 ${this.simulation.totalWaves} 波战斗，战场留下了 ${this.simulation.playerCount} 名己方单位。`
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
    const waveCount = this.simulation?.totalWaves ?? this.level.waves?.length ?? 1;
    const waveNumber = this.simulation ? Math.min(this.simulation.waveIndex + 1, waveCount) : 0;
    this.elements.waveReadout.textContent = isPrep ? `共 ${waveCount} 波` : `第 ${waveNumber} / ${waveCount} 波`;
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
    const labelInterval = this.renderer.isMobile ? 0.08 : 0.033;
    if (this.renderTime - this.lastLabelUpdate >= labelInterval) {
      this.lastLabelUpdate = this.renderTime;
      this.updateWorldLabels();
    }
  }

  drawArena() {
    const renderer = this.renderer;
    renderer.drawRect(WORLD.width / 2, WORLD.height / 2, WORLD.width, WORLD.height, '#102832');
    renderer.drawRect(400, WORLD.height / 2, 720, 700, '#173b3b', 0.72);
    renderer.drawRect(1200, WORLD.height / 2, 720, 700, '#3a2632', 0.66);
    renderer.drawRect(WORLD.width / 2, WORLD.height / 2, 86, 700, '#133c4b', 0.9);
    renderer.drawLine(800, WORLD.minY, 800, WORLD.maxY, 2, '#63e0cb', 0.22);

    for (let x = 40; x <= WORLD.width - 40; x += 80) renderer.drawLine(x, WORLD.minY, x, WORLD.maxY, 1, '#91c6bb', 0.08);
    for (let y = 40; y <= WORLD.height - 40; y += 80) renderer.drawLine(WORLD.minX, y, WORLD.maxX, y, 1, '#91c6bb', 0.08);
    renderer.drawLine(WORLD.minX, WORLD.minY, WORLD.maxX, WORLD.minY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.maxX, WORLD.minY, WORLD.maxX, WORLD.maxY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.maxX, WORLD.maxY, WORLD.minX, WORLD.maxY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(WORLD.minX, WORLD.maxY, WORLD.minX, WORLD.minY, 3, '#a5dbd0', 0.2);
    renderer.drawLine(PLAYER_ZONE_RIGHT, WORLD.minY + 6, PLAYER_ZONE_RIGHT, WORLD.maxY - 6, 2, '#63e0cb', 0.15);
    renderer.drawLine(840, WORLD.minY + 6, 840, WORLD.maxY - 6, 2, '#ff796a', 0.12);

    if (this.phase === 'prep' && this.selectedUnitId) {
      const unit = this.unitsById[this.selectedUnitId];
      const ignoreDeployment = this.draggedDeployment?.deployment ?? null;
      const valid = this.hoverWorld && this.isValidPlacement(this.hoverWorld.x, this.hoverWorld.y, unit, ignoreDeployment);
      if (valid) {
        renderer.drawCircle(this.hoverWorld.x, this.hoverWorld.y, unit.radius, unit.color, 24, 0.28);
        renderer.drawRing(this.hoverWorld.x, this.hoverWorld.y, getUnitFootprintRadius(unit) + 6, 3, '#63e0cb', 24, 0.8);
      } else if (this.hoverWorld && (this.draggedUnit || this.draggedDeployment)) {
        renderer.drawRing(this.hoverWorld.x, this.hoverWorld.y, getUnitFootprintRadius(unit) + 6, 4, '#ff796a', 24, 0.86);
      }
    }
  }

  isValidPlacement(x, y, unit, ignoreDeployment = null) {
    const availableBudget = this.budgetRemaining + (ignoreDeployment?.unitId === unit?.id ? unit.price : 0);
    if (!unit || availableBudget < unit.price) return false;
    const footprint = getUnitFootprintRadius(unit);
    const minX = WORLD.minX + Math.max(PLAYER_SAFE_MARGIN, footprint);
    const maxX = PLAYER_ZONE_RIGHT - footprint;
    const minY = WORLD.minY + Math.max(PLAYER_SAFE_MARGIN, footprint);
    const maxY = WORLD.maxY - Math.max(PLAYER_SAFE_MARGIN, footprint);
    return x >= minX && x <= maxX && y >= minY && y <= maxY && this.isDeploymentPositionFree(x, y, unit, ignoreDeployment);
  }

  isDeploymentPositionFree(x, y, unit, ignoreDeployment = null) {
    if (!unit) return false;
    const footprint = getUnitFootprintRadius(unit);
    return this.deployments.every((deployment) => {
      if (deployment === ignoreDeployment) return true;
      const other = this.unitsById[deployment.unitId];
      if (!other) return true;
      const minimum = footprint + getUnitFootprintRadius(other) + DEPLOYMENT_GAP;
      return Math.hypot(deployment.x - x, deployment.y - y) >= minimum;
    });
  }

  drawUnitsAndEffects() {
    const units = this.battleUnits;
    for (const unit of units) {
      if (!unit.data) continue;
      this.drawUnit(unit);
    }
    if (!this.simulation || this.phase === 'prep') return;
    for (const projectile of this.simulation.projectiles) {
      this.renderer.drawLine(projectile.x - 8, projectile.y - 8, projectile.x + 8, projectile.y + 8, 4, projectile.color, 0.88);
      this.renderer.drawCircle(projectile.x, projectile.y, 5, projectile.color, 12, 0.95);
    }
    for (const effect of this.simulation.effects) this.drawEffect(effect);
  }

  drawEffect(effect) {
    const renderer = this.renderer;
    const progress = clamp(effect.life / Math.max(0.05, effect.duration), 0, 1);
    const elapsed = 1 - progress;
    const fade = clamp(progress * 1.2, 0, 1);
    const radius = effect.radius * (0.76 + elapsed * 0.42);
    const pulse = 0.5 + 0.5 * Math.sin(this.renderTime * 8 + effect.id);
    const color = effect.color;
    const drawRing = (ringRadius, thickness = 4, alpha = fade) => renderer.drawRing(effect.x, effect.y, ringRadius, thickness, color, 28, alpha);

    if (effect.type === 'waveSpawn') {
      for (let index = 0; index < 3; index += 1) {
        const ringProgress = (elapsed + index * 0.18) % 1;
        renderer.drawRing(effect.x, effect.y, effect.radius * (0.24 + ringProgress * 0.84), 5 - index, color, 28, fade * (0.72 - index * 0.14) * (1 - ringProgress * 0.55));
      }
      renderer.drawLine(effect.x, effect.y - effect.radius * 0.72, effect.x, effect.y + effect.radius * 0.72, 3, color, fade * 0.3);
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4 + this.renderTime * 0.8;
        const orbit = effect.radius * (0.28 + elapsed * 0.38);
        renderer.drawCircle(effect.x + Math.cos(angle) * orbit, effect.y + Math.sin(angle) * orbit, 5, color, 12, fade * 0.7);
      }
      return;
    }

    if (effect.type === 'spawn') {
      drawRing(radius, 4, fade * 0.9);
      renderer.drawCircle(effect.x, effect.y, Math.max(3, radius * 0.16), color, 16, fade * 0.18);
      for (let index = 0; index < 6; index += 1) {
        const angle = index * Math.PI / 3 - elapsed * 3.5;
        const orbit = radius * (0.58 + pulse * 0.12);
        renderer.drawCircle(effect.x + Math.cos(angle) * orbit, effect.y + Math.sin(angle) * orbit, 4, color, 12, fade * 0.68);
      }
      return;
    }

    if (effect.type === 'teleport') {
      if (Number.isFinite(effect.fromX) && Number.isFinite(effect.fromY)) {
        renderer.drawLine(effect.fromX, effect.fromY, effect.x, effect.y, 3, color, fade * 0.36);
      }
      if (effect.phase === 'out') {
        drawRing(effect.radius * (0.62 + elapsed * 0.7), 5, fade * 0.9);
        renderer.drawCircle(effect.x, effect.y, Math.max(2, effect.radius * 0.32 * progress), color, 16, fade * 0.28);
      } else {
        drawRing(effect.radius * (1.22 - elapsed * 0.4), 6, fade * 0.9);
        drawRing(effect.radius * (0.46 + elapsed * 0.22), 3, fade * 0.62);
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4 + 0.18;
          const inner = effect.radius * 0.36;
          const outer = effect.radius * (0.66 + (index % 2) * 0.14);
          renderer.drawLine(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner, effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer, 3, color, fade * 0.66);
        }
      }
      return;
    }

    if (effect.type === 'charge') {
      if (Number.isFinite(effect.fromX) && Number.isFinite(effect.fromY)) {
        const direction = normalize(effect.x - effect.fromX, effect.y - effect.fromY);
        renderer.drawLine(effect.fromX, effect.fromY, effect.x, effect.y, 5, color, fade * 0.32);
        renderer.drawLine(effect.x, effect.y, effect.x - direction.x * 30 - direction.y * 15, effect.y - direction.y * 30 + direction.x * 15, 5, color, fade * 0.8);
        renderer.drawLine(effect.x, effect.y, effect.x - direction.x * 30 + direction.y * 15, effect.y - direction.y * 30 - direction.x * 15, 5, color, fade * 0.8);
      }
      drawRing(radius * (0.9 + pulse * 0.12), 5, fade * 0.9);
      drawRing(radius * 0.48, 3, fade * 0.65);
      return;
    }

    if (effect.type === 'summon') {
      drawRing(radius * (0.92 + pulse * 0.16), 6, fade * 0.92);
      drawRing(radius * 0.5, 3, fade * 0.76);
      renderer.drawCircle(effect.x, effect.y, radius * 0.18, color, 16, fade * 0.22);
      const count = Math.max(2, Math.min(4, effect.count ?? 2));
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + this.renderTime * 1.4;
        const orbit = radius * 0.72;
        renderer.drawLine(effect.x, effect.y, effect.x + Math.cos(angle) * orbit, effect.y + Math.sin(angle) * orbit, 2, color, fade * 0.32);
        renderer.drawCircle(effect.x + Math.cos(angle) * orbit, effect.y + Math.sin(angle) * orbit, 6, color, 14, fade * 0.8);
      }
      return;
    }

    if (effect.type === 'shield') {
      drawRing(radius * 0.9, 5, fade * 0.8);
      const points = 6;
      for (let index = 0; index < points; index += 1) {
        const firstAngle = index * Math.PI * 2 / points - Math.PI / 2;
        const secondAngle = (index + 1) * Math.PI * 2 / points - Math.PI / 2;
        renderer.drawLine(effect.x + Math.cos(firstAngle) * radius * 0.72, effect.y + Math.sin(firstAngle) * radius * 0.72, effect.x + Math.cos(secondAngle) * radius * 0.72, effect.y + Math.sin(secondAngle) * radius * 0.72, 3, color, fade * 0.78);
      }
      return;
    }

    if (effect.type === 'taunt') {
      drawRing(radius * (0.7 + elapsed * 0.5), 5, fade * 0.9);
      drawRing(radius * (0.38 + elapsed * 0.26), 3, fade * 0.62);
      for (let index = 0; index < 6; index += 1) {
        const angle = index * Math.PI / 3;
        renderer.drawLine(effect.x + Math.cos(angle) * radius * 0.55, effect.y + Math.sin(angle) * radius * 0.55, effect.x + Math.cos(angle) * radius * 0.84, effect.y + Math.sin(angle) * radius * 0.84, 3, color, fade * 0.65);
      }
      return;
    }

    if (effect.type === 'telegraph') {
      const segments = 12;
      const telegraphRadius = effect.radius * (0.9 + progress * 0.2);
      for (let index = 0; index < segments; index += 2) {
        const firstAngle = index * Math.PI * 2 / segments;
        const secondAngle = (index + 1) * Math.PI * 2 / segments;
        renderer.drawLine(effect.x + Math.cos(firstAngle) * telegraphRadius, effect.y + Math.sin(firstAngle) * telegraphRadius, effect.x + Math.cos(secondAngle) * telegraphRadius, effect.y + Math.sin(secondAngle) * telegraphRadius, 3, color, fade * 0.9);
      }
      renderer.drawLine(effect.x - 12, effect.y, effect.x + 12, effect.y, 3, color, fade * 0.75);
      renderer.drawLine(effect.x, effect.y - 12, effect.x, effect.y + 12, 3, color, fade * 0.75);
      return;
    }

    if (effect.type === 'burst') {
      renderer.drawCircle(effect.x, effect.y, radius * 0.2 * progress, color, 16, fade * 0.34);
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4 + elapsed * 0.45;
        renderer.drawLine(effect.x + Math.cos(angle) * radius * 0.2, effect.y + Math.sin(angle) * radius * 0.2, effect.x + Math.cos(angle) * radius * (0.7 + elapsed * 0.35), effect.y + Math.sin(angle) * radius * (0.7 + elapsed * 0.35), 4, color, fade * 0.76);
      }
      return;
    }

    if (effect.type === 'death') {
      renderer.drawRing(effect.x, effect.y, radius * (1.5 - progress * 0.4), 7, color, 28, progress * 0.66);
      renderer.drawCircle(effect.x, effect.y, radius * 0.5 * progress, color, 20, progress * 0.22);
      return;
    }

    if (effect.type === 'heal') {
      renderer.drawRing(effect.x, effect.y, radius, 5, '#9cf6a6', 28, progress * 0.85);
      renderer.drawLine(effect.x - radius * 0.35, effect.y, effect.x + radius * 0.35, effect.y, 4, '#9cf6a6', progress);
      renderer.drawLine(effect.x, effect.y - radius * 0.35, effect.x, effect.y + radius * 0.35, 4, '#9cf6a6', progress);
      return;
    }

    if (effect.type === 'buff') {
      drawRing(radius * (0.78 + pulse * 0.14), 6, fade * 0.92);
      drawRing(radius * 0.45, 3, fade * 0.72);
      for (let index = 0; index < 6; index += 1) {
        const angle = index * Math.PI / 3 + this.renderTime * 0.9;
        const inner = radius * 0.56;
        const outer = radius * (0.78 + pulse * 0.08);
        renderer.drawLine(
          effect.x + Math.cos(angle) * inner,
          effect.y + Math.sin(angle) * inner,
          effect.x + Math.cos(angle) * outer,
          effect.y + Math.sin(angle) * outer,
          4,
          color,
          fade * 0.7,
        );
      }
      return;
    }

    if (effect.type === 'mark' || effect.type === 'skill') {
      drawRing(radius, effect.type === 'mark' ? 3 : 5, fade * 0.85);
      renderer.drawCircle(effect.x, effect.y, Math.max(2, radius * 0.22), color, 20, fade * 0.12);
      return;
    }

    drawRing(radius, 5, fade * 0.8);
    renderer.drawCircle(effect.x, effect.y, Math.max(2, radius * 0.22), color, 20, fade * 0.12);
  }

  drawUnit(unit) {
    const data = unit.data;
    const alive = unit.alive !== false;
    const deathProgress = alive ? 1 : clamp(1 - (unit.deadFor ?? 0) / 3, 0, 1);
    if (deathProgress <= 0) return;
    const radius = data.radius * (alive ? 1 : 0.78);
    const factionColor = unit.side === 'player' ? '#63e0cb' : '#ff796a';
    const isSelected = this.phase === 'prep' && this.selectedUnitId === data.id;
    const pulse = alive && unit.pulse > 0 ? 1 + Math.sin(this.renderTime * 36) * 0.08 : 1;
    const drawRadius = radius * pulse;

    this.renderer.drawCircle(unit.x + 5, unit.y + 7, drawRadius + 3, '#030b12', 24, 0.34 * deathProgress);
    if (this.renderer.spriteReady && Number.isInteger(data.spriteIndex)) {
      const spriteSize = Math.max(data.radius * 3.0, 70) * (alive ? pulse : 0.9);
      this.renderer.drawCircle(unit.x, unit.y, Math.max(5, drawRadius * 0.52), data.accent, 20, deathProgress * 0.2);
      this.renderer.drawSprite(unit.x, unit.y - data.radius * 0.22, spriteSize, spriteSize, data.spriteIndex, (alive ? 0.98 : 0.44) * deathProgress, '#ffffff', unit.side === 'enemy');
    } else {
      this.renderer.drawCircle(unit.x, unit.y, drawRadius, data.color, 24, (alive ? 0.94 : 0.42) * deathProgress);
    }
    this.renderer.drawRing(unit.x, unit.y, drawRadius + 4, isSelected ? 5 : 3, isSelected ? '#f4c66a' : factionColor, 24, deathProgress * 0.9);
    if (!this.renderer.spriteReady || !Number.isInteger(data.spriteIndex)) {
      this.renderer.drawCircle(unit.x, unit.y, Math.max(4, drawRadius * 0.28), data.accent, 16, deathProgress * 0.9);
    }

    if (alive) {
      const facing = Number.isFinite(unit.facing) ? unit.facing : (unit.side === 'player' ? 0 : Math.PI);
      this.renderer.drawLine(unit.x, unit.y, unit.x + Math.cos(facing) * (drawRadius + 10), unit.y + Math.sin(facing) * (drawRadius + 10), 3, data.accent, 0.75);
      const hpRatio = clamp((unit.hp ?? data.hp) / Math.max(1, unit.maxHp ?? data.hp), 0, 1);
      const barWidth = Math.max(34, drawRadius * 2.3);
      this.renderer.drawRect(unit.x, unit.y - drawRadius - 12, barWidth, 5, '#09151d', 0.88);
      this.renderer.drawRect(unit.x - (barWidth * (1 - hpRatio)) / 2, unit.y - drawRadius - 12, barWidth * hpRatio, 5, hpRatio > 0.35 ? factionColor : '#ffb06a', 0.94);
      if (unit.status?.stun > 0) this.renderer.drawRing(unit.x, unit.y, drawRadius + 10, 2, '#f4c66a', 14, 0.92);
      if (unit.status?.taunt > 0) this.renderer.drawRing(unit.x, unit.y, drawRadius + 13, 2, '#ff796a', 14, 0.8);
      if (unit.status?.guard > 0) this.renderer.drawRing(unit.x, unit.y, drawRadius + 9, 3, '#edf2f4', 24, 0.76);
      if (unit.status?.supportUntil > (this.simulation?.time ?? 0)) this.renderer.drawRing(unit.x, unit.y, drawRadius + 16, 3, '#9cf6a6', 18, 0.9);
    }
  }

  updateWorldLabels() {
    const visibleUnits = this.battleUnits;
    this.syncFileSpriteFallback(visibleUnits);
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
      const isSupported = this.phase === 'battle' && unit.alive !== false && unit.status?.supportUntil > (this.simulation?.time ?? 0);
      label.className = `world-label${unit.side === 'enemy' ? ' enemy' : ''}${isRetreating ? ' retreat' : ''}${isSupported ? ' support' : ''}`;
      const hpText = this.phase === 'prep' ? '' : ` · ${Math.max(0, Math.ceil(unit.hp ?? 0))}`;
      label.textContent = `${unit.data.name}${isRetreating ? ' · 后撤' : ''}${isSupported ? ' · 增益' : ''}${hpText}`;
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
  }

  syncFileSpriteFallback(visibleUnits) {
    const shouldShow = IS_FILE_PROTOCOL && !this.renderer?.spriteReady && Boolean(this.worldSprites);
    const activeIds = new Set();
    if (shouldShow) {
      for (const unit of visibleUnits) {
        if (!unit.data || !Number.isInteger(unit.data.spriteIndex) || (unit.alive === false && (unit.deadFor ?? 0) > 3)) continue;
        const id = unit.id ?? `${unit.side}-${unit.data.id}-${unit.x}-${unit.y}`;
        activeIds.add(id);
        let sprite = this.spriteNodes.get(id);
        if (!sprite) {
          sprite = makeElement('div', 'world-sprite');
          this.spriteNodes.set(id, sprite);
          this.worldSprites.append(sprite);
        }
        const data = unit.data;
        const alive = unit.alive !== false;
        const deathProgress = alive ? 1 : clamp(1 - (unit.deadFor ?? 0) / 3, 0, 1);
        const pulse = alive && unit.pulse > 0 ? 1 + Math.sin(this.renderTime * 36) * 0.08 : 1;
        const size = Math.max(data.radius * 3.0, 70) * (alive ? pulse : 0.9) * this.renderer.camera.zoom;
        const screen = this.renderer.worldToScreen(unit.x, unit.y - data.radius * 0.22);
        const column = data.spriteIndex % 4;
        const row = Math.floor(data.spriteIndex / 4);
        sprite.style.left = `${screen.x}px`;
        sprite.style.top = `${screen.y}px`;
        sprite.style.width = `${size}px`;
        sprite.style.height = `${size}px`;
        sprite.style.opacity = String((alive ? 0.98 : 0.44) * deathProgress);
        sprite.style.backgroundImage = `url("${UNIT_TEXTURE_URL}")`;
        sprite.style.backgroundPosition = `${column * (100 / 3)}% ${row * (100 / 3)}%`;
      }
    }
    for (const [id, node] of this.spriteNodes.entries()) {
      if (!activeIds.has(id)) {
        node.remove();
        this.spriteNodes.delete(id);
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
