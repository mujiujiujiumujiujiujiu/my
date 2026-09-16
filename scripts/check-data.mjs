import { readFile } from 'node:fs/promises';

const units = JSON.parse(await readFile(new URL('../data/units.json', import.meta.url), 'utf8'));
const levels = JSON.parse(await readFile(new URL('../data/levels.json', import.meta.url), 'utf8'));

if (!Array.isArray(units.units) || units.units.length < 10) throw new Error('units.json: units 太少');
if (!Array.isArray(levels.levels) || levels.levels.length < 10) throw new Error('levels.json: 至少需要 10 关');

const ids = new Set(units.units.map((unit) => unit.id));
const levelIds = new Set();
for (const unit of units.units) {
  for (const key of ['id', 'name', 'role', 'color', 'accent']) {
    if (!unit[key]) throw new Error(`units.json: ${unit.id ?? 'unknown'} 缺少 ${key}`);
  }
  if (!Number.isFinite(unit.hp) || !Number.isFinite(unit.price) || !Number.isFinite(unit.radius)) {
    throw new Error(`units.json: ${unit.id} 数值不完整`);
  }
  if (unit.moveMultiplier !== undefined && (!Number.isFinite(unit.moveMultiplier) || unit.moveMultiplier <= 0)) {
    throw new Error(`units.json: ${unit.id} moveMultiplier 必须为正数`);
  }
}
for (const level of levels.levels) {
  if (levelIds.has(level.id)) throw new Error(`levels.json: 重复关卡 id ${level.id}`);
  levelIds.add(level.id);
  if (!Number.isFinite(level.budget) || !Array.isArray(level.enemies) || level.enemies.length === 0) {
    throw new Error(`levels.json: ${level.id} 结构不完整`);
  }
  if ('waves' in level) throw new Error(`levels.json: ${level.id} 不应再包含波次数据`);
  for (const entry of level.enemies) {
    if (!ids.has(entry.unitId) || !Number.isFinite(entry.count) || entry.count < 1) {
      throw new Error(`levels.json: ${level.id} 敌方单位不完整`);
    }
  }
}

const playable = units.units.filter((unit) => !unit.enemyOnly);
const prices = playable.map((unit) => unit.price);
if (Math.max(...prices) !== 500 || Math.min(...prices) !== 20) throw new Error('units.json: 价格范围不符合设计');
console.log(`data ok: ${playable.length} playable units, ${levels.levels.length} levels`);
