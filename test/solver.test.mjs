// 求解器单元测试：node test/solver.test.mjs
// 先用 tsc 将 src/solver.ts 编译到临时目录，再运行断言。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'solver-test-'));
execFileSync('npx', ['tsc', 'src/solver.ts', '--outDir', outDir, '--module', 'ES2020', '--target', 'ES2020', '--moduleResolution', 'bundler', '--skipLibCheck'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
});
// tsc 输出为 ESM 但无 package.json 类型声明，改名为 .mjs 以便 import
const { renameSync } = await import('node:fs');
renameSync(join(outDir, 'solver.js'), join(outDir, 'solver.mjs'));
const solver = await import(pathToFileURL(join(outDir, 'solver.mjs')).href);

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const network = {
  nodes: ['S1', 'S2', 'N1', 'N2', 'N3', 'N4', 'A', 'B', 'C', 'D'],
  pipes: [
    { id: 'P1', from: 'A', to: 'N2' },
    { id: 'P2', from: 'C', to: 'N3' },
  ],
  valvedPipes: [
    { id: 'V01', from: 'S1', to: 'N1', open: true },
    { id: 'V02', from: 'S2', to: 'N4', open: true },
    { id: 'V03', from: 'N1', to: 'N2', open: true },
    { id: 'V04', from: 'N2', to: 'N3', open: true },
    { id: 'V05', from: 'N3', to: 'N4', open: true },
    { id: 'V06', from: 'N4', to: 'N1', open: true },
    { id: 'V07', from: 'D', to: 'N3', open: true },
    { id: 'V08', from: 'B', to: 'N1', open: true },
    { id: 'V09', from: 'B', to: 'N4', open: false },
  ],
};
const query = { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D'] };

console.log('基本求解：');
const r1 = solver.solve(network, query);
check('返回 ok', r1.status === 'ok');
check('最少关阀数为 2', r1.minClosed === 2);
check('唯一最优方案为 [V03, V04]', r1.solutions.length === 1 && r1.solutions[0].closed.join(',') === 'V03,V04');
check('漏点已隔离', r1.solutions[0].leakIsolated === true);
check('全部出口连通', r1.solutions[0].outletStatus.every((o) => o.connected));
check('出口 B 可达 S1', r1.solutions[0].outletStatus.find((o) => o.outlet === 'B').reachableSupplies.includes('S1'));

console.log('输入不被修改：');
const before = JSON.stringify(network);
solver.solve(network, query);
check('求解后 network 未变化', JSON.stringify(network) === before);

console.log('无需关阀（漏点本就隔离）：');
const r2 = solver.solve(network, { supplies: ['S1'], leak: 'D', outlets: ['A'] });
// D 通过 V07 连到 N3... S1 可达 N3，所以 D 并未隔离 —— 构造真正隔离的场景：
const isoNet = {
  nodes: ['S1', 'X', 'Y'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'X', open: true },
    { id: 'V2', from: 'Y', to: 'X', open: false },
  ],
};
const r2b = solver.solve(isoNet, { supplies: ['S1'], leak: 'Y', outlets: ['X'] });
check('漏点已天然隔离时关阀数为 0', r2b.status === 'ok' && r2b.minClosed === 0 && r2b.solutions[0].closed.length === 0);
void r2;

console.log('无解场景：');
const r3 = solver.solve(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['A'] });
check('保供出口与漏点同管段时无解', r3.status === 'no-solution');

console.log('字典序取舍：');
// S—V1—M—V2—L 为串联：关闭 V1 或 V2 都能隔离漏点，
// 两个等价的最小方案 [V1] 与 [V2]，字典序应优先 [V1]
const tieNet = {
  nodes: ['S', 'M', 'L', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V2', from: 'M', to: 'L', open: true },
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V3', from: 'O', to: 'S', open: true },
  ],
};
const r4 = solver.solve(tieNet, { supplies: ['S'], leak: 'L', outlets: ['O'] });
check('并列方案均列出且按字典序排列', r4.status === 'ok' && r4.minClosed === 1 &&
  r4.solutions.length === 2 && r4.solutions[0].closed[0] === 'V1' && r4.solutions[1].closed[0] === 'V2');

console.log('校验：');
const r5 = solver.solve(network, { supplies: ['S1', 'N2'], leak: 'N2', outlets: [] });
check('漏点不能是供水点', r5.status === 'invalid');
const dup = solver.parseNetwork({ nodes: ['a', 'b'], pipes: [], valvedPipes: [
  { id: 'V1', from: 'a', to: 'b', open: true },
  { id: 'V1', from: 'b', to: 'a', open: true },
] });
check('阀门编号重复被拒绝', !dup.network && dup.errors.some((e) => e.includes('重复')));
const many = solver.parseNetwork({
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 13 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
});
const r6 = solver.solve(many.network, { supplies: ['a'], leak: 'b', outlets: [] });
check('超过 12 个开启阀门被拒绝', r6.status === 'invalid' && r6.errors.some((e) => e.includes('13')));

// ============ 保供韧性巡检 ============
console.log('保供韧性巡检：');

const findRow = (r, name) => r.rows.find((x) => x.outlet === name);

const ir1 = solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D', 'N2'] });
check('返回 ok', ir1.status === 'ok');
// B：V08 与 V09(已关) 并行，仅 V08 可用 → 1
const iB = findRow(ir1, 'B');
check('出口 B 至少需失效 1 条（已关阀不参与）', iB.assessable && iB.minFailures === 1 && iB.witnessPipes.join(',') === 'V08');
// C：经单条无阀管段 P2 挂在环上 → 1（无阀管段按单条计）
const iC = findRow(ir1, 'C');
check('出口 C 至少需失效 1 条（无阀管段 P2）', iC.assessable && iC.minFailures === 1 && iC.witnessPipes.join(',') === 'P2');
// D：仅 V07 单管 → 1
const iD = findRow(ir1, 'D');
check('出口 D 至少需失效 1 条', iD.assessable && iD.minFailures === 1 && iD.witnessPipes.join(',') === 'V07');
// N2 位于环路中：须同时切断 V03、V04 两条管段
const iN2 = findRow(ir1, 'N2');
check('环路上的 N2 至少需失效 2 条（环路分别计数）', iN2.assessable && iN2.minFailures === 2 && iN2.witnessPipes.join(',') === 'V03,V04');
check('结果按失效数升序（1,1,1,2）', ir1.rows.map((x) => x.minFailures).join(',') === '1,1,1,2');
check('参与计数管段数（2 无阀 + 8 开启阀门，排除已关 V09）', ir1.activePipeCount === 10);

console.log('巡检：已断水出口为 0 和空清单：');
// 仅经一条关闭阀门挂在网上的出口
const cutNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const ir2 = solver.inspectResilience(cutNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r2row = ir2.rows[0];
check('已断水出口 minFailures=0', r2row.assessable && r2row.minFailures === 0);
check('已断水出口为空清单', Array.isArray(r2row.witnessPipes) && r2row.witnessPipes.length === 0);
check('已断水出口标记 alreadyCut', r2row.alreadyCut === true);

console.log('巡检：并行管段分别计数：');
const parNet = {
  nodes: ['S', 'O'],
  pipes: [
    { id: 'P1', from: 'S', to: 'O' },
    { id: 'P2', from: 'S', to: 'O' },
  ],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
  ],
};
const ir3 = solver.inspectResilience(parNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r3row = ir3.rows[0];
check('3 条并行管段 → 需失效 3 条', r3row.assessable && r3row.minFailures === 3);
check('割清单含全部 3 条并行管段', r3row.witnessPipes.length === 3 &&
  ['P1', 'P2', 'V1'].every((p) => r3row.witnessPipes.includes(p)));

console.log('巡检：多供水点作为整体：');
// O 经 P1 连 S1、经 V1 连 S2：必须两条都失效才失去全部供水
const multiNet = {
  nodes: ['S1', 'S2', 'O'],
  pipes: [{ id: 'P1', from: 'S1', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S2', to: 'O', open: true }],
};
const ir4 = solver.inspectResilience(multiNet, { supplies: ['S1', 'S2'], leak: '', outlets: ['O'] });
check('双供水点分别单管接入 → 需失效 2 条', ir4.rows[0].minFailures === 2);
const ir4b = solver.inspectResilience(multiNet, { supplies: ['S1'], leak: '', outlets: ['O'] });
check('只算一个供水点时 → 需失效 1 条', ir4b.rows[0].minFailures === 1);

console.log('巡检：出口与供水点同名：');
const ir5 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['S1', 'B'] });
const same = findRow(ir5, 'S1');
check('同名出口标记无法评估', same.assessable === false && same.reason.includes('无法按管段失效评估'));
check('无法评估排在升序结果最后', ir5.rows[1].outlet === 'S1');

console.log('巡检：无阀管段按单条计且能出现在割中：');
const pNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [{ id: 'P1', from: 'M', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'M', open: true }],
};
const ir6 = solver.inspectResilience(pNet, { supplies: ['S'], leak: '', outlets: ['O'] });
check('串联无阀管段场景需失效 1 条', ir6.rows[0].minFailures === 1);
check('割可以是无阀管段 P1 或带阀管段 V1', ['P1', 'V1'].includes(ir6.rows[0].witnessPipes[0]));

console.log('巡检：校验与纯函数：');
const ir7 = solver.inspectResilience(network, { supplies: ['NOPE'], leak: '', outlets: ['B'] });
check('供水点不存在时报错', ir7.status === 'invalid');
const ir8 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['NOPE'] });
check('出口不存在时报错', ir8.status === 'invalid');
const ir9 = solver.inspectResilience(network, { supplies: [], leak: '', outlets: ['B'] });
check('缺少供水点时报错', ir9.status === 'invalid');
const beforeInsp = JSON.stringify(network);
solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: '', outlets: ['B', 'C'] });
check('巡检不修改输入网络', JSON.stringify(network) === beforeInsp);
// 不受 12 个开启阀门上限影响（巡检为多项式最大流，非组合枚举）
const ir10 = solver.inspectResilience(many.network, { supplies: ['a'], leak: '', outlets: ['b'] });
check('巡检不受开启阀门 12 个上限影响', ir10.status === 'ok' && ir10.rows[0].minFailures === 13);

// ============ 供水能力核验 ============
console.log('供水能力核验：');

const cap = (supplies, outlets, supplyCaps, outletDemands) =>
  solver.verifyCapacity(network, { supplies, outlets, supplyCaps, outletDemands });
const capRow = (r, name) => r.rows.find((x) => x.outlet === name);
const capKinds = (r) => r.cutItems.map((c) => `${c.kind}:${c.id}=${c.capacity}`).join('|');

// 基本场景：S1/S2 各仅一条单位管接入环网（V01/V02），总入环能力 2；
// B 挂单管 V08（V09 已关）最多获配 1
const c1 = cap(
  ['S1', 'S2'],
  ['B', 'C', 'D'],
  { S1: 5, S2: 3 },
  { B: 2, C: 1, D: 1 }
);
check('核验返回 ok', c1.status === 'ok');
check('总获配为 2（受两条供水接入管 V01/V02 限制）', c1.totalAllocated === 2);
check('总缺口为 2（B 缺 1、C 或 D 缺 1）', c1.totalShortfall === 2);
check('B 获配 1、缺口 1（V09 已关，仅 V08 单管）', capRow(c1, 'B').allocated === 1 && capRow(c1, 'B').shortfall === 1);
check('C、D 合计获配 1', capRow(c1, 'C').allocated + capRow(c1, 'D').allocated === 1);
check('最小割容量合计等于总获配', c1.cutCapacity === 2);
check('最小割为两条供水接入管 V01、V02', c1.cutItems.length === 2 &&
  c1.cutItems.every((x) => x.kind === 'pipe') &&
  c1.cutItems.map((x) => x.id).sort().join(',') === 'V01,V02');
check('割中不含已关阀 V09', !c1.cutItems.some((x) => x.id === 'V09'));

console.log('核验：供给上限成为瓶颈：');
// 供水点直接以并行大通道接出（13 条并行单位管），出口需求很大，
// 此时总获配只受供给上限制约
const bigNet = {
  nodes: ['SA', 'SB', 'O'],
  pipes: [],
  valvedPipes: [
    ...Array.from({ length: 13 }, (_, i) => ({ id: `VA${i}`, from: 'SA', to: 'O', open: true })),
    ...Array.from({ length: 13 }, (_, i) => ({ id: `VB${i}`, from: 'SB', to: 'O', open: true })),
  ],
};
const c2 = solver.verifyCapacity(bigNet, {
  supplies: ['SA', 'SB'], outlets: ['O'],
  supplyCaps: { SA: 2, SB: 1 }, outletDemands: { O: 100 },
});
check('总获配受限于供给上限合计 3', c2.totalAllocated === 3);
check('最小割为两条供给上限（容量 2+1）', c2.cutItems.length === 2 &&
  c2.cutItems.every((x) => x.kind === 'supply') && c2.cutCapacity === 3);

console.log('核验：出口需求成为瓶颈（全部足额）：');
const c3net = {
  nodes: ['SA', 'SB', 'OA', 'OB', 'OC'],
  pipes: [],
  valvedPipes: [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VA${i}`, from: 'SA', to: 'OA', open: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VB${i}`, from: 'SB', to: 'OB', open: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VC${i}`, from: 'SA', to: 'OC', open: true })),
  ],
};
const c3 = solver.verifyCapacity(c3net, {
  supplies: ['SA', 'SB'], outlets: ['OA', 'OB', 'OC'],
  supplyCaps: { SA: 5, SB: 5 }, outletDemands: { OA: 1, OB: 1, OC: 1 },
});
check('总获配等于总需求 3', c3.totalAllocated === 3 && c3.totalShortfall === 0);
check('最小割为三个出口需求', c3.cutItems.length === 3 &&
  c3.cutItems.every((x) => x.kind === 'demand') && c3.cutCapacity === 3);
check('全部出口标记足额', c3.rows.every((x) => x.fullySupplied));

console.log('核验：已关阀不参与、断水出口获配 0：');
const cutCapNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const c4 = solver.verifyCapacity(cutCapNet, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 5 }, outletDemands: { O: 3 },
});
check('仅经已关阀连接时获配 0、缺口 3', c4.status === 'ok' &&
  c4.totalAllocated === 0 && c4.rows[0].allocated === 0 && c4.rows[0].shortfall === 3);
check('参与输水管段仅 1 条（V2 已关排除）', c4.activePipeCount === 1);
check('总获配 0 时割清单为空', c4.cutItems.length === 0 && c4.cutCapacity === 0);

console.log('核验：同一无向管段双向合计只能占用一次：');
// S1—M—S2 为一条单位管，O 从 M 经一条单位管取水：
// 无论 S1、S2 上限多大，M→O 单管使每个出口侧最多 1；
// 关键：S1 与 S2 之间的共享管段不能同时双向各占 1
const sharedNet = {
  nodes: ['S1', 'S2', 'M', 'O'],
  pipes: [{ id: 'P1', from: 'M', to: 'O' }],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'M', open: true },
    { id: 'V2', from: 'S2', to: 'M', open: true },
  ],
};
const c5 = solver.verifyCapacity(sharedNet, {
  supplies: ['S1', 'S2'], outlets: ['O'],
  supplyCaps: { S1: 5, S2: 5 }, outletDemands: { O: 5 },
});
check('两个供水点合计最多经 P1 供出 1', c5.totalAllocated === 1);
check('最小割为管段 P1', c5.cutItems.length === 1 && c5.cutItems[0].kind === 'pipe' && c5.cutItems[0].id === 'P1');

console.log('核验：环路提供两条单位通道：');
// S—N1—N2—O 与 S—N3—N2—O 构成双路径 → O 最多获配 2
const ringNet = {
  nodes: ['S', 'N1', 'N3', 'N2', 'O'],
  pipes: [{ id: 'P1', from: 'N2', to: 'O' }],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'N1', open: true },
    { id: 'V2', from: 'N1', to: 'N2', open: true },
    { id: 'V3', from: 'S', to: 'N3', open: true },
    { id: 'V4', from: 'N3', to: 'N2', open: true },
  ],
};
const c6 = solver.verifyCapacity(ringNet, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 9 }, outletDemands: { O: 9 },
});
check('双路径 + 出口单管 → 获配 1（P1 瓶颈）', c6.totalAllocated === 1 &&
  c6.cutItems.some((x) => x.kind === 'pipe' && x.id === 'P1'));
// 出口再加一条并行管 → 2
const ringNet2 = {
  nodes: ['S', 'N1', 'N3', 'N2', 'O'],
  pipes: [
    { id: 'P1', from: 'N2', to: 'O' },
    { id: 'P2', from: 'N1', to: 'O' },
  ],
  valvedPipes: ringNet.valvedPipes,
};
const c7 = solver.verifyCapacity(ringNet2, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 9 }, outletDemands: { O: 9 },
});
check('环路两路径 + 两并行出口管 → 获配 2', c7.totalAllocated === 2 && c7.cutCapacity === 2);

console.log('核验：零上限 / 零需求：');
const c8 = cap(['S1', 'S2'], ['B', 'C'], { S1: 0, S2: 0 }, { B: 2, C: 2 });
check('供给上限全为 0 时获配 0', c8.totalAllocated === 0);
check('零上限弧不进入割清单', c8.cutItems.length === 0);
const c9 = cap(['S1'], ['B', 'C'], { S1: 5 }, { B: 0, C: 0 });
check('需求全为 0 时获配 0、缺口 0', c9.totalAllocated === 0 && c9.totalShortfall === 0);
check('零需求弧不进入割清单', c9.cutItems.length === 0);
// 混合：B 需求 0（挂在 S1 旁），C 经单管需求 2 → 割只含管段，不含零需求 B
const zeroMixNet = {
  nodes: ['S1', 'B', 'C'],
  pipes: [],
  valvedPipes: [
    { id: 'V0', from: 'S1', to: 'B', open: true },
    { id: 'V1', from: 'S1', to: 'C', open: true },
  ],
};
const c9b = solver.verifyCapacity(zeroMixNet, {
  supplies: ['S1'], outlets: ['B', 'C'],
  supplyCaps: { S1: 5 }, outletDemands: { B: 0, C: 2 },
});
check('零需求出口不产生割项，瓶颈仅为 V1', c9b.totalAllocated === 1 &&
  c9b.cutItems.map((x) => x.id).join(',') === 'V1');

console.log('核验：纯函数与输入校验：');
const beforeCap = JSON.stringify(network);
cap(['S1', 'S2'], ['B'], { S1: 2, S2: 2 }, { B: 3 });
check('核验不修改输入网络与数值表', JSON.stringify(network) === beforeCap);
const ce1 = cap(['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', ce1.status === 'invalid');
const ce2 = cap(['S1'], ['NOPE'], { S1: 1 }, { NOPE: 1 });
check('出口不存在时报错', ce2.status === 'invalid');
const ce3 = cap([], ['B'], {}, { B: 1 });
check('缺少供水点时报错', ce3.status === 'invalid');
const ce4 = cap(['S1'], [], { S1: 1 }, {});
check('缺少出口时报错', ce4.status === 'invalid');
const ce5 = cap(['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', ce5.status === 'invalid' && ce5.errors.some((e) => e.includes('非负整数')));
const ce6 = cap(['S1'], ['B'], { S1: 1.5 }, { B: 1 });
check('小数上限被拒绝', ce6.status === 'invalid');
const ce7 = cap(['S1'], ['B'], {}, { B: 1 });
check('缺少某供水点上限被拒绝', ce7.status === 'invalid');
const ce8 = cap(['S1'], ['B'], { S1: 1 }, { B: '2' });
check('字符串需求量被拒绝', ce8.status === 'invalid');

// ============ 管段增容建议 ============
console.log('管段增容建议：');

const exp = (net, supplies, outlets, supplyCaps, outletDemands) =>
  solver.suggestExpansion(net, { supplies, outlets, supplyCaps, outletDemands });

// 与核验同一网络与数值：基线受 V01/V02 入环限制为 2；
// 单条 V01（或 V02）提容即可到 3，字典序最小为 [V01]
const e1 = exp(network, ['S1', 'S2'], ['B', 'C', 'D'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('增容返回 ok', e1.status === 'ok');
check('基线总获配与核验一致（2）', e1.baseline === 2);
check('推荐单条改造 V01（同增量下条数最少、字典序最小）', e1.recommended.upgraded.join(',') === 'V01');
check('推荐总获配 3、增量 1', e1.recommended.totalAllocated === 3 && e1.recommended.gain === 1);
check('单条最优即推荐方案', e1.bestSingle.upgraded.join(',') === 'V01' && e1.bestSingle.totalAllocated === 3);
check('两条最优同样为 3（字典序最小对 [P1,V01]）',
  e1.bestPair.totalAllocated === 3 && e1.bestPair.upgraded.join(',') === 'P1,V01');
check('候选管段数（2 无阀 + 8 开启，排除已关 V09）', e1.activePipeCount === 10);
check('已关阀 V09 不出现在任何方案中',
  !e1.recommended.upgraded.includes('V09') && !e1.bestSingle.upgraded.includes('V09') &&
  !e1.bestPair.upgraded.includes('V09'));

console.log('增容：两条一起改造才产生收益（串联瓶颈）：');
// S—V1—M—V2—O 串联：单条提容仍受另一条限制，两条一起才通
const seriesNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'O', open: true },
  ],
};
const e2 = exp(seriesNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('串联基线为 1', e2.baseline === 1);
check('单条改造无收益', e2.bestSingle.totalAllocated === 1 && e2.bestSingle.gain === 0);
check('两条一起改造提升至 2', e2.bestPair.totalAllocated === 2 && e2.bestPair.gain === 1);
check('推荐两条组合 [V1,V2]', e2.recommended.upgraded.join(',') === 'V1,V2' &&
  e2.recommended.totalAllocated === 2 && e2.recommended.gain === 1);

console.log('增容：零增量时推荐不改造：');
// 供给上限 1 卡住总获配，管段提容无收益
const noGainNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const e3 = exp(noGainNet, ['S'], ['O'], { S: 1 }, { O: 5 });
check('受供给上限 1 限制，基线 1', e3.baseline === 1);
check('推荐不改造（空清单、增量 0）',
  e3.recommended.upgraded.length === 0 && e3.recommended.gain === 0 && e3.recommended.totalAllocated === 1);
check('单条最优同样无收益', e3.bestSingle.totalAllocated === 1 && e3.bestSingle.gain === 0);
check('仅一条候选时无两条组合', e3.bestPair === null);

console.log('增容：已关阀与自环不可选：');
const skipNet = {
  nodes: ['S', 'O'],
  pipes: [{ id: 'P0', from: 'S', to: 'S' }], // 自环
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
    { id: 'V9', from: 'S', to: 'O', open: false }, // 已关阀
  ],
};
const e4 = exp(skipNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('候选仅 1 条（自环与已关阀不计）', e4.activePipeCount === 1);
check('推荐改造 V1 提容至 2', e4.recommended.upgraded.join(',') === 'V1' && e4.recommended.totalAllocated === 2);
check('无两条组合可选', e4.bestPair === null);

console.log('增容：两条组合按编号列表字典序取舍：');
// 两条并联支路 S—V1—A—V2—O 与 S—V3—B—V4—O，改造任一支路的两条管均可 +1
const twoPairNet = {
  nodes: ['S', 'A', 'B', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'A', open: true },
    { id: 'V2', from: 'A', to: 'O', open: true },
    { id: 'V3', from: 'S', to: 'B', open: true },
    { id: 'V4', from: 'B', to: 'O', open: true },
  ],
};
const e5 = exp(twoPairNet, ['S'], ['O'], { S: 9 }, { O: 9 });
check('双支路基线 2', e5.baseline === 2);
check('单条改造无收益（支路串联）', e5.bestSingle.totalAllocated === 2);
check('推荐字典序最小对 [V1,V2] → 3',
  e5.recommended.upgraded.join(',') === 'V1,V2' && e5.recommended.totalAllocated === 3 && e5.recommended.gain === 1);

console.log('增容：纯函数与输入校验：');
const beforeExp = JSON.stringify(network);
exp(network, ['S1', 'S2'], ['B'], { S1: 2, S2: 2 }, { B: 3 });
check('增容不修改输入网络', JSON.stringify(network) === beforeExp);
const ee1 = exp(network, ['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', ee1.status === 'invalid' && ee1.errors.some((e) => e.includes('非负整数')));
const ee2 = exp(network, ['S1'], ['B'], {}, { B: 1 });
check('缺少上限被拒绝', ee2.status === 'invalid');
const ee3 = exp(network, [], ['B'], {}, { B: 1 });
check('缺少供水点被拒绝', ee3.status === 'invalid');
const ee4 = exp(network, ['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', ee4.status === 'invalid');

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
