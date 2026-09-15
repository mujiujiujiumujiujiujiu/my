import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
await import('../src/sim.js');

const units = JSON.parse(await readFile(new URL('../data/units.json', import.meta.url), 'utf8')).units;
const levels = JSON.parse(await readFile(new URL('../data/levels.json', import.meta.url), 'utf8')).levels;
const unitsById = Object.fromEntries(units.map((unit) => [unit.id, unit]));

// These are intentionally readable, role-based smoke formations rather than an AI solver.
// They prove every level has at least one budget-valid, full-clear route after data edits.
const baselineFormations = {
  1: ['gazi', 'naima', 'couqie'],
  2: ['gazi', 'dayun', 'couqie', 'couqie'],
  3: ['gazi', 'dayun', 'naima', 'couqie'],
  4: ['gazi', 'dayun', 'caixukun', 'naima'],
  5: ['gazi', 'dayun', 'caixukun', 'naima', 'miaocuijiao', 'couqie'],
  6: ['gazi', 'dayun', 'caixukun', 'naima', 'miaocuijiao', 'couqie', 'gugugaga', 'huangsedashu'],
  7: ['gugugaga', 'miaocuijiao', 'miaocuijiao', 'caixukun', 'dayun', 'dagou', 'dayun'],
  8: ['gazi', 'dayun', 'naima', 'caixukun', 'caixukun', 'gugugaga', 'dagou', 'miaocuijiao', 'couqie', 'couqie'],
  9: ['gazi', 'dagou', 'dayun', 'naima', 'naima', 'caixukun', 'huaqiang', 'couqie', 'couqie'],
  10: ['gazi', 'dayun', 'naima', 'caixukun', 'caixukun', 'gugugaga', 'dagou', 'miaocuijiao', 'couqie', 'couqie'],
};

function makeDeployments(level, ids) {
  const deployments = [];
  let spent = 0;
  for (const id of ids) {
    const data = unitsById[id];
    if (!data || data.enemyOnly || spent + data.price > level.budget || deployments.length >= 24) continue;
    const index = deployments.length;
    deployments.push({ unitId: id, x: 150 + (index % 6) * 92, y: 150 + Math.floor(index / 6) * 135 });
    spent += data.price;
  }
  return { deployments, spent };
}

function run(level, ids) {
  const { deployments, spent } = makeDeployments(level, ids);
  const simulation = new window.MemeWarSim.BattleSimulation(unitsById, level, deployments);
  simulation.start();
  let ticks = 0;
  while (simulation.phase === 'battle' && ticks < 2500) {
    simulation.update(0.05);
    assertNoOverlaps(simulation, `关卡 ${level.id}`);
    ticks += 1;
  }
  const clear = simulation.outcome === 'win' && simulation.enemyCount === 0;
  return { clear, time: Number(simulation.time.toFixed(1)), spent, players: simulation.playerCount, enemies: simulation.enemyCount };
}

function assertNoOverlaps(simulation, label) {
  const alive = simulation.aliveUnits;
  for (let firstIndex = 0; firstIndex < alive.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < alive.length; secondIndex += 1) {
      const first = alive[firstIndex];
      const second = alive[secondIndex];
      const actual = Math.hypot(first.x - second.x, first.y - second.y);
      const minimum = simulation.getSeparationRadius(first) + simulation.getSeparationRadius(second);
      if (actual + 0.05 < minimum) {
        throw new Error(`${label} 角色重叠：${first.data.id}/${second.data.id} ${actual.toFixed(2)} < ${minimum.toFixed(2)}`);
      }
    }
  }
}

for (const level of levels) {
  const formation = baselineFormations[level.id];
  if (!formation) throw new Error(`缺少关卡 ${level.id} 的平衡烟测编队`);
  const result = run(level, formation);
  if (!result.clear) throw new Error(`关卡 ${level.id} ${level.name} 烟测未清场：${JSON.stringify(result)}`);
  console.log(`balance ok: ${level.id} ${level.name} · ${result.time}s · ${result.spent}/${level.budget} 金 · ${result.players} survivors`);
}

if (!(unitsById.caixukun.spd < unitsById.gazi.spd && unitsById.gazi.spd < unitsById.miaocuijiao.spd)) {
  throw new Error('movement balance: 远程、前排、刺客的速度梯度不成立');
}

const pursuitLevel = {
  id: 99,
  name: '移速回归',
  enemies: [{ unitId: 'caixukun', count: 1, overrides: { skills: [], atk: 1, as: 0.3 } }],
  waves: [[{ unitId: 'caixukun', count: 1, overrides: { skills: [], atk: 1, as: 0.3 } }]],
};
const pursuitUnit = { ...unitsById.gazi, hp: 600, skills: [] };
const pursuitSimulation = new window.MemeWarSim.BattleSimulation(unitsById, pursuitLevel, [
  { unitId: 'gazi', data: pursuitUnit, x: 150, y: 410 },
]);
let pursuitContactAt = null;
for (let ticks = 0; ticks < 900 && pursuitSimulation.phase === 'battle'; ticks += 1) {
  pursuitSimulation.update(0.05);
  if (pursuitContactAt === null && pursuitSimulation.units.some((unit) => unit.side === 'player' && unit.attackCount > 0)) {
    pursuitContactAt = pursuitSimulation.time;
  }
}
if (pursuitContactAt === null) throw new Error('movement balance: 前排单位无法追上远程单位');
console.log(`movement ok: 前排在 ${pursuitContactAt.toFixed(1)}s 追上远程目标`);

const supportLevel = {
  id: 100,
  name: '辅助回归',
  enemies: [{ unitId: 'melonboss', count: 1 }],
  waves: [[{ unitId: 'melonboss', count: 1 }]],
};
const supportSimulation = new window.MemeWarSim.BattleSimulation(unitsById, supportLevel, [
  { unitId: 'gazi', x: 180, y: 410 },
  { unitId: 'naima', x: 280, y: 410 },
]);
const supportCaster = supportSimulation.units.find((unit) => unit.data.id === 'naima');
const supportTarget = supportSimulation.units.find((unit) => unit.data.id === 'gazi');
supportSimulation.useSkill(supportCaster, null, unitsById.naima.skills[0], 0);
if (supportTarget.status.supportUntil <= 0 || supportTarget.status.supportHaste <= 0 || supportTarget.status.supportDamageReduction <= 0) {
  throw new Error('support balance: 治疗辅助没有留下可计算的增益状态');
}
const buffSkillCount = units
  .filter((unit) => ['support', 'healer'].includes(unit.role))
  .flatMap((unit) => unit.skills ?? [])
  .filter((skill) => ['haste', 'damageBonus', 'damageReduction'].some((key) => Number(skill[key]) > 0)).length;
if (buffSkillCount < 4) throw new Error('support balance: 可见辅助增益技能覆盖不足');
console.log(`support ok: ${buffSkillCount} 个辅助技能可施加可计算增益`);
