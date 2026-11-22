// 確定前の検査（FR-CK-05、FR-CK-06）。エラーは確定不可、警告は確定可。
import { GND, KINDS, TERMINALS, VALUED_KINDS, type Netlist, terminalCount } from './netlist';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** 関係する部品・節点・注釈の ID */
  refId?: string;
}

export function validateNetlist(netlist: Netlist): Issue[] {
  const issues: Issue[] = [];
  const nodeIds = new Set(netlist.nodes.map((n) => n.id));

  // 部品 ID の重複
  const seen = new Set<string>();
  for (const p of netlist.parts) {
    if (seen.has(p.id)) {
      issues.push({ level: 'error', code: 'DUP_ID', message: `部品 ID が重複しています: ${p.id}`, refId: p.id });
    }
    seen.add(p.id);
  }

  for (const p of netlist.parts) {
    // 種別と端子数
    if (!KINDS.includes(p.kind)) {
      issues.push({ level: 'error', code: 'KIND', message: `種別が不明です: ${p.id}`, refId: p.id });
      continue;
    }
    const expected = TERMINALS[p.kind];
    const pinNames = Object.keys(p.pins);
    const extra = pinNames.filter((k) => !expected.includes(k));
    if (extra.length > 0 || pinNames.length !== expected.length) {
      issues.push({
        level: 'error',
        code: 'PIN_MISMATCH',
        message: `${p.id}（${p.kind}）の端子数が種別と合いません（期待 ${expected.length} 端子）`,
        refId: p.id,
      });
    }
    // 未接続の端子
    for (const t of expected) {
      const node = p.pins[t];
      if (node === undefined || node === '') {
        issues.push({ level: 'error', code: 'UNCONNECTED', message: `${p.id} の端子 ${t} が未接続です`, refId: p.id });
      } else if (!nodeIds.has(node)) {
        issues.push({ level: 'error', code: 'UNKNOWN_NODE', message: `${p.id} の端子 ${t} が未定義のノード ${node} を指しています`, refId: p.id });
      }
    }
    // 値の未読取・数値化不能
    if (VALUED_KINDS.includes(p.kind)) {
      if (p.value === null || !Number.isFinite(p.value)) {
        issues.push({ level: 'error', code: 'VALUE_MISSING', message: `${p.id} の値が未読取です。入力してください`, refId: p.id });
      } else if (['R', 'C', 'L'].includes(p.kind) && p.value <= 0) {
        issues.push({ level: 'error', code: 'VALUE_INVALID', message: `${p.id} の値は正の数である必要があります`, refId: p.id });
      }
    }
    if (p.uncertain) {
      issues.push({ level: 'warning', code: 'UNCERTAIN_PART', message: `${p.id} は不確かとして示されています`, refId: p.id });
    }
  }

  // 接地（GND）の欠如
  const gndUsed = netlist.parts.some((p) => Object.values(p.pins).includes(GND));
  if (!gndUsed) {
    issues.push({ level: 'error', code: 'NO_GND', message: '接地（GND）がありません' });
  }

  // 端子が 1 つだけのノード
  for (const n of netlist.nodes) {
    if (n.id === GND) continue;
    if (terminalCount(netlist, n.id) === 1) {
      issues.push({ level: 'warning', code: 'SINGLE_TERMINAL', message: `ノード ${n.id} は端子が 1 つだけです`, refId: n.id });
    }
  }

  // 注釈の対象
  for (const a of netlist.annotations) {
    if (a.uncertain || a.text.includes('?') || a.text.includes('？')) {
      issues.push({ level: 'warning', code: 'UNCERTAIN_ANNOTATION', message: `注釈 ${a.id} は不確かとして示されています`, refId: a.id });
    }
    if (!a.target) continue;
    const exists =
      a.target.type === 'node'
        ? nodeIds.has(a.target.id)
        : a.target.type === 'part'
          ? seen.has(a.target.id)
          : netlist.parts.some((p) => p.block === a.target?.id);
    if (!exists) {
      issues.push({ level: 'warning', code: 'TARGET_MISSING', message: `注釈 ${a.id} の対象 ${a.target.id} が見つかりません`, refId: a.id });
    }
  }

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
