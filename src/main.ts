import './style.css';
import {
  parseNetwork,
  solve,
  inspectResilience,
  verifyCapacity,
  suggestExpansion,
  MAX_OPEN_VALVES,
  EXPANSION_TARGET_CAPACITY,
  MAX_EXPANSION_PIPES,
  type Query,
  type CapacityQuery,
  type SolveResult,
  type ResilienceResult,
  type CapacityResult,
  type ExpansionResult,
  type ExpansionPlan,
} from './solver';
import {
  SAMPLE_NETWORK,
  SAMPLE_QUERY,
  SAMPLE_SUPPLY_CAPS,
  SAMPLE_OUTLET_DEMANDS,
} from './sample';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header>
    <h1>展馆水路检修隔离方案搜索</h1>
    <p class="subtitle">
      粘贴管网拓扑 JSON，指定供水点、漏点与保供出口，可自动搜索最优关阀组合，
      也可对各保供出口做「保供韧性巡检」（按当前阀门开闭状态估算使其断水至少需失效的管段数），
      还可做「供水能力核验」（按供给上限与出口需求量求总供给最大分配、缺口与限制总供给的最小割），
      并能给出「管段增容建议」（在当前阀门状态下枚举将参与输水管段容量由 1 提至 2 的改造方案，最多改造两条）。
      组合搜索最多覆盖 ${MAX_OPEN_VALVES} 个当前开启的阀门；求解过程不修改输入中的阀门状态。
    </p>
  </header>
  <main>
    <section class="panel input-panel">
      <div class="panel-title">
        <h2>1. 管网拓扑 JSON</h2>
        <button id="load-sample" type="button">载入示例拓扑</button>
      </div>
      <textarea id="topology" spellcheck="false" placeholder='{"nodes":[...],"pipes":[...],"valvedPipes":[...]}'></textarea>
      <h2>2. 检修条件</h2>
      <div class="fields">
        <label>
          供水点（多个用逗号分隔）
          <input id="supplies" type="text" placeholder="如：市政供水S1, 备用水箱S2" />
        </label>
        <label>
          漏点
          <input id="leak" type="text" placeholder="如：环管N2" />
        </label>
        <label>
          保供出口（多个用逗号分隔）
          <input id="outlets" type="text" placeholder="如：展厅B, 咖啡厅" />
        </label>
      </div>
      <div class="button-row">
        <button id="solve" type="button" class="primary">搜索关阀方案</button>
        <button id="inspect" type="button" class="secondary">保供韧性巡检</button>
      </div>
      <p class="hint">
        巡检沿用上方「供水点」与「保供出口」：无阀管段与开启的带阀管段均按单条失效计，
        已关阀不参与；多供水点作为整体，环路及并行管段分别计数。
      </p>
      <h2>3. 供水能力核验与管段增容</h2>
      <p class="hint">
        为每个供水点填写非负整数<strong>供给上限</strong>、为每个保供出口填写非负整数<strong>需求量</strong>，
        按当前阀门开闭状态求总供给最大分配（每条连通管段容量为 1、同一无向管段双向合计只能占用一次，
        已关阀不参与）。留空按 0 处理。
      </p>
      <button id="build-capacity-form" type="button">按上方供水点 / 保供出口生成填写表</button>
      <div id="capacity-form" class="capacity-form">
        <p class="hint">尚未生成填写表：点击上方按钮后，为各供水点和保供出口填写数值，再点「核验供水能力」。</p>
      </div>
      <div class="button-row">
        <button id="verify-capacity" type="button" class="secondary">核验供水能力</button>
        <button id="suggest-expansion" type="button" class="secondary">管段增容建议</button>
      </div>
      <p class="hint">
        增容建议沿用本页拓扑与上方填写的供给上限 / 需求量：仅将参与输水的不同管段（无阀管段或开启阀门）
        容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}，最多改造 ${MAX_EXPANSION_PIPES} 条；
        已关阀及自环不可选。分别计算不改造、单条与两条组合的总获配量，按
        「总获配量最高 → 改造条数最少 → 管段编号列表字典序最小」推荐方案。
      </p>
    </section>
    <div class="side-column">
      <section class="panel result-panel">
        <h2>关阀方案搜索结果</h2>
        <div id="result"><p class="hint">尚未求解。可点击「载入示例拓扑」快速体验。</p></div>
      </section>
      <section class="panel result-panel">
        <h2>保供韧性巡检</h2>
        <div id="inspect-result">
          <p class="hint">
            点击「保供韧性巡检」后，这里按「使其失去全部供水至少需失效的不同管段数」升序列出各出口，
            并给出一组达到该数量的管段编号，供安排巡检。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>供水能力核验</h2>
        <div id="capacity-result">
          <p class="hint">
            点击「核验供水能力」后，这里展示总供给最大分配、每个出口的获配量与缺口，
            以及一组限制总供给的最小割项目（供给上限、管段或出口需求）。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>管段增容建议</h2>
        <div id="expansion-result">
          <p class="hint">
            点击「管段增容建议」后，这里对比不改造、单条与两条组合改造的总获配量，
            推荐总获配量最高、改造条数最少、管段编号字典序最小的方案；零增量时提示无需增容。
          </p>
        </div>
      </section>
    </div>
  </main>
`;

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少元素 ${selector}`);
  return node;
}

const topologyEl = el<HTMLTextAreaElement>('#topology');
const suppliesEl = el<HTMLInputElement>('#supplies');
const leakEl = el<HTMLInputElement>('#leak');
const outletsEl = el<HTMLInputElement>('#outlets');
const resultEl = el<HTMLDivElement>('#result');
const inspectResultEl = el<HTMLDivElement>('#inspect-result');
const capacityFormEl = el<HTMLDivElement>('#capacity-form');
const capacityResultEl = el<HTMLDivElement>('#capacity-result');
const expansionResultEl = el<HTMLDivElement>('#expansion-result');

/** 已生成填写表对应的供水点 / 保供出口，以及各输入框当前值。 */
interface CapacityFormState {
  supplies: string[];
  outlets: string[];
}
let capacityFormState: CapacityFormState | null = null;

function splitList(text: string): string[] {
  return text
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

function renderErrors(target: HTMLElement, title: string, errors: string[]): void {
  target.innerHTML = `
    <div class="banner error">${escapeHtml(title)}</div>
    <ul class="error-list">
      ${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
    </ul>`;
}

function renderResult(result: SolveResult, query: Query): void {
  if (result.status === 'invalid') {
    renderErrors(resultEl, '输入有误，无法求解：', result.errors);
    return;
  }
  if (result.status === 'no-solution') {
    resultEl.innerHTML = `
      <div class="banner error">无解：当前条件下不存在满足要求的关阀组合。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">参与搜索的开启阀门数：${result.openValveCount}</p>`;
    return;
  }

  const best = result.solutions[0];
  const rows = (sol: typeof best) =>
    sol.outletStatus
      .map(
        (o) => `
        <tr>
          <td>${escapeHtml(o.outlet)}</td>
          <td class="${o.connected ? 'ok' : 'bad'}">${o.connected ? '✓ 正常供水' : '✗ 断水'}</td>
          <td>${o.reachableSupplies.map(escapeHtml).join('、') || '—'}</td>
        </tr>`
      )
      .join('');

  resultEl.innerHTML = `
    <div class="banner success">
      找到 ${result.solutions.length}${result.truncated ? '+' : ''} 个最优方案：
      最少需关闭 <strong>${result.minClosed}</strong> 个阀门。
      推荐方案（同数按阀门编号字典序最小）：关闭
      ${best.closed.length > 0 ? best.closed.map((v) => `<code>${escapeHtml(v)}</code>`).join('、') : '（无需关阀）'}
    </div>
    <p class="hint">
      参与搜索的当前开启阀门数：${result.openValveCount}；
      漏点「${escapeHtml(query.leak)}」在所有方案中均已与全部供水点断开；
      输入 JSON 中的阀门开闭状态不会被修改。
    </p>
    ${result.solutions
      .map(
        (sol, i) => `
      <details class="solution" ${i === 0 ? 'open' : ''}>
        <summary>
          方案 ${i + 1}：关闭 ${sol.closed.length} 个阀门
          ${sol.closed.length > 0 ? `（${sol.closed.map(escapeHtml).join('、')}）` : ''}
        </summary>
        <table>
          <thead>
            <tr><th>保供出口</th><th>连通状态</th><th>可达供水点</th></tr>
          </thead>
          <tbody>${rows(sol)}</tbody>
        </table>
      </details>`
      )
      .join('')}
    ${result.truncated ? '<p class="hint">最优方案过多，仅展示前 100 个。</p>' : ''}`;
}

function renderInspection(result: ResilienceResult): void {
  if (result.status === 'invalid') {
    renderErrors(inspectResultEl, '输入有误，无法巡检：', result.errors);
    return;
  }

  const rows = result.rows.map((row) => {
    if (!row.assessable) {
      return `
        <tr>
          <td>${escapeHtml(row.outlet)}</td>
          <td><span class="tag tag-skip">无法评估</span></td>
          <td class="num">—</td>
          <td>${escapeHtml(row.reason)}</td>
        </tr>`;
    }
    const tag = row.alreadyCut
      ? '<span class="tag tag-cut">已断水</span>'
      : row.minFailures === 1
        ? '<span class="tag tag-low">薄弱</span>'
        : '<span class="tag tag-ok">有韧性</span>';
    const pipes =
      row.witnessPipes.length > 0
        ? row.witnessPipes.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
        : '<span class="hint">（空清单）</span>';
    return `
      <tr>
        <td>${escapeHtml(row.outlet)}</td>
        <td>${tag}</td>
        <td class="num"><strong>${row.minFailures}</strong></td>
        <td>${pipes}</td>
      </tr>`;
  });

  inspectResultEl.innerHTML = `
    <div class="banner success">
      巡检完成：共评估 ${result.rows.length} 个保供出口，参与计数的管段
      （无阀管段 + 当前开启的带阀管段）共 <strong>${result.activePipeCount}</strong> 条；
      已关阀不参与。结果已按所需失效数升序排列。
    </div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>状态</th><th>至少需失效管段数</th><th>一组达到该数量的管段（巡检清单）</th></tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <p class="hint">
      数值表示：在当前阀门开闭状态下，使该出口与全部供水点断开，至少需要同时失效多少条不同管段
      （多供水点作为整体；环路及并行管段分别计数）。已断水出口显示 0 与空清单；
      出口与供水点同名时无法按管段失效评估。数值越小越应优先巡检，右侧管段为一组最薄弱环节。
    </p>`;
}

/** 渲染供水能力核验的数值填写表（保留已有同值输入）。 */
function buildCapacityForm(
  supplies: string[],
  outlets: string[],
  prevCaps?: Record<string, number>,
  prevDemands?: Record<string, number>
): void {
  const valueOr = (map: Record<string, number> | undefined, key: string): string => {
    if (!map) return '';
    const v = map[key];
    return v === undefined ? '' : String(v);
  };
  const supplyInputs = supplies
    .map(
      (s) => `
        <label class="cap-row">
          <span>${escapeHtml(s)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-supply="${escapeHtml(s)}"
            value="${valueOr(prevCaps, s)}"
            placeholder="供给上限"
          />
        </label>`
    )
    .join('');
  const outletInputs = outlets
    .map(
      (o) => `
        <label class="cap-row">
          <span>${escapeHtml(o)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-outlet="${escapeHtml(o)}"
            value="${valueOr(prevDemands, o)}"
            placeholder="需求量"
          />
        </label>`
    )
    .join('');
  capacityFormEl.innerHTML = `
    <div class="cap-grid">
      <div>
        <h3>供水点供给上限</h3>
        ${supplies.length > 0 ? supplyInputs : '<p class="hint">请先在上方填写至少一个供水点。</p>'}
      </div>
      <div>
        <h3>保供出口需求量</h3>
        ${outlets.length > 0 ? outletInputs : '<p class="hint">请先在上方填写至少一个保供出口。</p>'}
      </div>
    </div>`;
  capacityFormState = { supplies, outlets };
}

/** 读取填写表中的非负整数；返回错误信息列表（空串与纯空白按 0）。 */
function readCapacityNumbers(): {
  supplyCaps: Record<string, number>;
  outletDemands: Record<string, number>;
  errors: string[];
} {
  const supplyCaps: Record<string, number> = {};
  const outletDemands: Record<string, number> = {};
  const errors: string[] = [];
  if (!capacityFormState) return { supplyCaps, outletDemands, errors: ['请先生成供水能力填写表。'] };

  const parseInput = (input: HTMLInputElement): number | null => {
    const isSupply = input.dataset.supply !== undefined;
    const name = isSupply ? input.dataset.supply! : input.dataset.outlet!;
    const fieldLabel = isSupply ? '供给上限' : '需求量';
    const ownerLabel = isSupply ? '供水点' : '保供出口';
    const text = input.value.trim();
    if (text === '') return 0;
    if (!/^\d+$/.test(text)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}必须是非负整数。`);
      return null;
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}数值过大。`);
      return null;
    }
    return n;
  };

  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-supply]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) supplyCaps[input.dataset.supply!] = n;
  });
  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-outlet]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) outletDemands[input.dataset.outlet!] = n;
  });
  return { supplyCaps, outletDemands, errors };
}

const CUT_KIND_LABEL: Record<import('./solver').CapacityCutKind, string> = {
  supply: '供给上限',
  pipe: '管段',
  demand: '出口需求',
};

function renderCapacity(result: CapacityResult): void {
  if (result.status === 'invalid') {
    renderErrors(capacityResultEl, '输入有误，无法核验：', result.errors);
    return;
  }

  const outletRows = result.rows
    .map(
      (o) => `
      <tr>
        <td>${escapeHtml(o.outlet)}</td>
        <td class="num">${o.demand}</td>
        <td class="num"><strong>${o.allocated}</strong></td>
        <td class="num ${o.shortfall > 0 ? 'bad' : 'ok'}">${o.shortfall}</td>
        <td>${o.fullySupplied ? '<span class="tag tag-ok">足额</span>' : '<span class="tag tag-cut">缺口</span>'}</td>
      </tr>`
    )
    .join('');

  const supplyRows = result.supplyRows
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.supply)}</td>
        <td class="num">${s.cap}</td>
        <td class="num">${s.used}</td>
        <td class="num ${s.used >= s.cap && s.cap > 0 ? 'bad' : ''}">${s.cap - s.used}</td>
      </tr>`
    )
    .join('');

  const cutList =
    result.cutItems.length > 0
      ? `<ul class="cut-list">
          ${result.cutItems
            .map(
              (c) => `
            <li>
              <span class="tag tag-kind tag-${c.kind}">${CUT_KIND_LABEL[c.kind]}</span>
              <code>${escapeHtml(c.id)}</code>
              <span class="hint">限制容量 ${c.capacity}</span>
            </li>`
            )
            .join('')}
        </ul>
        <p class="hint">上述项目容量合计 <strong>${result.cutCapacity}</strong>，恰等于总获配量（最大流 = 最小割）。</p>`
      : '<p class="hint">总获配量为 0，不存在容量为正的限制项（当前阀门状态下供水点与出口完全不通，或供给上限/需求量均为 0）。</p>';

  const bannerClass = result.totalShortfall > 0 ? 'warn' : 'success';
  const banner =
    result.totalShortfall > 0
      ? `总供给最大分配 <strong>${result.totalAllocated}</strong> / 总需求 ${result.totalDemand}，
         总缺口 <strong>${result.totalShortfall}</strong>：当前供水能力无法足额满足全部出口。`
      : `总供给最大分配 <strong>${result.totalAllocated}</strong>，全部出口需求均已足额满足
         （总供给上限 ${result.totalSupplyCap}，总需求 ${result.totalDemand}）。`;

  capacityResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>需求量</th><th>获配量</th><th>缺口</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <details>
      <summary>各供水点供出情况（上限 / 已供 / 富余）</summary>
      <table>
        <thead>
          <tr><th>供水点</th><th>供给上限</th><th>已供出</th><th>富余</th></tr>
        </thead>
        <tbody>${supplyRows}</tbody>
      </table>
    </details>
    <h3>一组限制总供给的最小割项目</h3>
    ${cutList}
    <p class="hint">
      参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，
      每条容量为 1；同一无向管段双向合计只能占用一次，已关阀不参与。
      最小割项目可能是某个供水点的供给上限、某条管段或某个出口的需求量——它们共同卡住了总供给。
    </p>`;
}

/** 渲染方案明细行（不改造 / 单条最优 / 两条最优），推荐方案所在行加标记。 */
function expansionPlanRow(
  label: string,
  plan: ExpansionPlan | null,
  recommended: ExpansionPlan
): string {
  if (!plan) {
    return `
      <tr>
        <td>${label}</td>
        <td class="hint">—（候选不足）</td>
        <td class="num">—</td>
        <td class="num">—</td>
      </tr>`;
  }
  const isRecommended =
    plan.upgraded.length === recommended.upgraded.length &&
    plan.upgraded.every((p, i) => p === recommended.upgraded[i]);
  const pipes =
    plan.upgraded.length > 0
      ? plan.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '<span class="hint">（不改造）</span>';
  return `
    <tr>
      <td>
        ${label}
        ${isRecommended ? '<span class="tag tag-ok">推荐</span>' : ''}
      </td>
      <td>${pipes}</td>
      <td class="num"><strong>${plan.totalAllocated}</strong></td>
      <td class="num ${plan.gain > 0 ? 'ok' : ''}">${plan.gain > 0 ? `+${plan.gain}` : '0'}</td>
    </tr>`;
}

function renderExpansion(result: ExpansionResult): void {
  if (result.status === 'invalid') {
    renderErrors(expansionResultEl, '输入有误，无法给出增容建议：', result.errors);
    return;
  }

  const rec = result.recommended;
  const recPipes =
    rec.upgraded.length > 0
      ? rec.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '（不改造）';
  const banner =
    rec.gain > 0
      ? `建议改造 <strong>${rec.upgraded.length}</strong> 条管段：${recPipes}（容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}）。
         总获配量由基线 <strong>${result.baseline}</strong> 提升至 <strong>${rec.totalAllocated}</strong>，
         增量 <strong>+${rec.gain}</strong>。`
      : `无需增容：不改造即达最高总获配量 <strong>${result.baseline}</strong>；
         改造任意单条或两条管段（容量由 1 提至 ${EXPANSION_TARGET_CAPACITY}）均无额外收益。`;
  const bannerClass = rec.gain > 0 ? 'success' : 'warn';

  const noUpgradePlan: ExpansionPlan = {
    upgraded: [],
    totalAllocated: result.baseline,
    gain: 0,
  };

  expansionResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>方案</th><th>改造管段编号</th><th>总获配量</th><th>相对基线增量</th></tr>
      </thead>
      <tbody>
        ${expansionPlanRow('不改造（基线）', noUpgradePlan, rec)}
        ${expansionPlanRow('单条改造最优', result.bestSingle, rec)}
        ${expansionPlanRow('两条组合改造最优', result.bestPair, rec)}
      </tbody>
    </table>
    <p class="hint">
      基线总获配量 <strong>${result.baseline}</strong>，推荐总获配量
      <strong>${rec.totalAllocated}</strong>，增量 <strong>+${rec.gain}</strong>；
      推荐管段编号：${recPipes}。
    </p>
    <p class="hint">
      候选管段为参与输水的不同管段（无阀管段 + 当前开启的带阀管段），共
      <strong>${result.activePipeCount}</strong> 条；已关阀及自环不可选。
      已枚举不改造、全部单条与全部两条组合（含「两条一起改造才产生收益」的情形），
      按总获配量最高、改造条数最少、管段编号（升序）列表字典序最小取舍。
      增容仅为方案测算，不会改写拓扑或已核验的供水能力结果。
    </p>`;
}

function readNetwork(): import('./solver').Network {
  let raw: unknown;
  try {
    raw = JSON.parse(topologyEl.value);
  } catch (e) {
    throw { topologyErrors: [`拓扑 JSON 解析失败：${(e as Error).message}`] };
  }
  const { network, errors } = parseNetwork(raw);
  if (!network) throw { topologyErrors: errors };
  return network;
}

function readQuery(): { network: import('./solver').Network; query: Query } {
  const network = readNetwork();
  const query: Query = {
    supplies: splitList(suppliesEl.value),
    leak: leakEl.value.trim(),
    outlets: splitList(outletsEl.value),
  };
  return { network, query };
}

function run(): void {
  try {
    const { network, query } = readQuery();
    renderResult(solve(network, query), query);
  } catch (e) {
    renderErrors(resultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runInspection(): void {
  try {
    const { network, query } = readQuery();
    renderInspection(inspectResilience(network, query));
  } catch (e) {
    renderErrors(inspectResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runCapacity(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(capacityResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再核验。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(capacityResultEl, '填写有误：', formErrors);
      return;
    }
    // 填写表可能与上方名单不一致（名单改动后未重新生成）：以填写表为准构建查询
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderCapacity(verifyCapacity(network, capacityQuery));
  } catch (e) {
    renderErrors(capacityResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

function runExpansion(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(expansionResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再生成增容建议。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(expansionResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderExpansion(suggestExpansion(network, capacityQuery));
  } catch (e) {
    renderErrors(expansionResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
  }
}

el<HTMLButtonElement>('#load-sample').addEventListener('click', () => {
  topologyEl.value = JSON.stringify(SAMPLE_NETWORK, null, 2);
  suppliesEl.value = SAMPLE_QUERY.supplies.join(', ');
  leakEl.value = SAMPLE_QUERY.leak;
  outletsEl.value = SAMPLE_QUERY.outlets.join(', ');
  buildCapacityForm(SAMPLE_QUERY.supplies, SAMPLE_QUERY.outlets, SAMPLE_SUPPLY_CAPS, SAMPLE_OUTLET_DEMANDS);
  run();
  runInspection();
  runCapacity();
  runExpansion();
});

el<HTMLButtonElement>('#solve').addEventListener('click', run);
el<HTMLButtonElement>('#inspect').addEventListener('click', runInspection);
el<HTMLButtonElement>('#verify-capacity').addEventListener('click', runCapacity);
el<HTMLButtonElement>('#suggest-expansion').addEventListener('click', runExpansion);
el<HTMLButtonElement>('#build-capacity-form').addEventListener('click', () => {
  try {
    readNetwork(); // 仅校验拓扑 JSON，核验不依赖漏点
  } catch (e) {
    renderErrors(capacityResultEl, '拓扑校验失败：', (e as { topologyErrors: string[] }).topologyErrors);
    return;
  }
  const supplies = [...new Set(splitList(suppliesEl.value))];
  const outlets = [...new Set(splitList(outletsEl.value))];
  if (supplies.length === 0 || outlets.length === 0) {
    renderErrors(capacityResultEl, '无法生成填写表：', [
      ...(supplies.length === 0 ? ['请先在上方填写至少一个供水点。'] : []),
      ...(outlets.length === 0 ? ['请先在上方填写至少一个保供出口。'] : []),
    ]);
  }
  // 重新生成时尽量保留同节点已填数值
  const prev = readCapacityNumbers();
  buildCapacityForm(supplies, outlets, prev.supplyCaps, prev.outletDemands);
});
