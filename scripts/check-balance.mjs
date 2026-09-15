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
  while (simulation.phase === 'battle' && ticks < 1800) {
    simulation.update(0.05);
    ticks += 1;
  }
  const clear = simulation.outcome === 'win' && simulation.enemyCount === 0;
  return { clear, time: Number(simulation.time.toFixed(1)), spent, players: simulation.playerCount, enemies: simulation.enemyCount };
}

for (const level of levels) {
  const formation = baselineFormations[level.id];
  if (!formation) throw new Error(`缺少关卡 ${level.id} 的平衡烟测编队`);
  const result = run(level, formation);
  if (!result.clear) throw new Error(`关卡 ${level.id} ${level.name} 烟测未清场：${JSON.stringify(result)}`);
  console.log(`balance ok: ${level.id} ${level.name} · ${result.time}s · ${result.spent}/${level.budget} 金 · ${result.players} survivors`);
}
