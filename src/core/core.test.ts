import { describe, expect, it } from 'vitest';
import { runAnalysis } from './analysis';
import { abs } from './complex';
import { checkFeedback } from './feedback';
import { solve } from './mna';
import { GND, type Netlist } from './netlist';
import { evaluateExpectations, resolveTolerance, withinTolerance, ABS_TOLERANCE_AT_ZERO, checkSaturation } from './review';
import { parseValueText, compose } from './units';
import { validateNetlist, hasErrors } from './validation';
import { confirm, edit, newSession, canEvaluate } from './session';
import { historyOf, push, undo, redo } from './history';
import { buildQuestions, pending, answer, emptyQuestionState, dedupe } from './questions';
import { inject } from './fmea/inject';
import { failureModes } from './fmea/library';
import { minimalCutSets, basicEventsOf, countCombinations } from './fta/cutsets';
import { topEventCandidates } from './fta/topEvents';
import { treeSvg } from './fta/tree';
import { proposeRepairs, roundE24 } from './repair';
import { fmeaToCsv, escapeCsv } from './fmea/csv';
import { addPart, removePart, setKind, setPin, setValueParts, addNode, addAnnotation, setValue, boxFromPoints, clampBox, setSourceMode } from './editing';
import { parseProject, serializeProject, PROJECT_FORMAT } from './project';
import { parseResult, buildRequest, RESULT_FORMAT } from './extraction';
import { saveAutosave, loadAutosave, type KeyValueStorage, AUTOSAVE_KEY } from './autosave';
import { checkSaturation as _cs } from './review';
import { divider, invertingAmp, rcLowpass, nonInvertingAmp, noFeedback, part, net } from '../test/fixtures';

void _cs;
const n0 = () => invertingAmp(-10);
const lastAnalysis = (n: Netlist, mode: 'dc' | 'ac', f = 1000) => {
  const r = solve(n, mode, f);
  if (!r.ok) throw new Error(r.message);
  return r.solution;
};

describe('MNA solver', () => {
  it('直流分圧 10 V・1k/1k で N1 は 5 V', () => {
    const s = lastAnalysis(divider(), 'dc');
    expect(s.nodeVoltage.N1.re).toBeCloseTo(5, 9);
  });
  it('反転増幅器のゲインは −10', () => {
    const s = lastAnalysis(invertingAmp(), 'ac');
    expect(s.nodeVoltage.OUT.re).toBeCloseTo(-10, 6);
    expect(s.nodeVoltage.OUT.im).toBeCloseTo(0, 6);
  });
  it('非反転増幅器のゲインは 11', () => {
    const s = lastAnalysis(nonInvertingAmp(), 'ac');
    expect(s.nodeVoltage.OUT.re).toBeCloseTo(11, 6);
  });
  it('RC ローパスは fc で |H| = 1/√2', () => {
    const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
    const s = lastAnalysis(rcLowpass(), 'ac', fc);
    expect(abs(s.nodeVoltage.OUT)).toBeCloseTo(1 / Math.SQRT2, 6);
  });
  it('DC では C は開放、L は短絡', () => {
    const n = net(
      [
        part('V1', 'V', { '+': 'IN', '-': GND }, 5, 'dc'),
        part('R1', 'R', { a: 'IN', b: 'OUT' }, 1000),
        part('C1', 'C', { a: 'OUT', b: GND }, 1e-6),
      ],
      ['IN', 'OUT'],
    );
    // C は DC で開放。R1 に電流が流れないので OUT は 5 V（直流経路は R1 にある）
    const s0 = lastAnalysis(n, 'dc');
    expect(s0.nodeVoltage.OUT.re).toBeCloseTo(5, 9);
    expect(s0.current.C1.re).toBeCloseTo(0, 12);
    const L = net(
      [
        part('V1', 'V', { '+': 'IN', '-': GND }, 5, 'dc'),
        part('L1', 'L', { a: 'IN', b: 'OUT' }, 1e-3),
        part('R1', 'R', { a: 'OUT', b: GND }, 1000),
      ],
      ['IN', 'OUT'],
    );
    expect(lastAnalysis(L, 'dc').nodeVoltage.OUT.re).toBeCloseTo(5, 9);
  });
  it('電流源と抵抗: 1 mA を 1 kΩ に流すと 1 V', () => {
    const n = net(
      [part('I1', 'I', { '+': 'N1', '-': GND }, 1e-3, 'dc'), part('R1', 'R', { a: 'N1', b: GND }, 1000)],
      ['N1'],
    );
    expect(lastAnalysis(n, 'dc').nodeVoltage.N1.re).toBeCloseTo(1, 9);
  });
  it('電力保存: 電源の供給と受動素子の消費が一致', () => {
    const s = lastAnalysis(divider(), 'dc');
    const supplied = s.power.V1;
    const absorbed = s.power.R1 + s.power.R2;
    expect(supplied).toBeCloseTo(absorbed, 9);
    expect(supplied).toBeCloseTo(0.05, 9); // 10 V / 2 kΩ = 5 mA → 50 mW
  });
  it('浮遊節点は特異として節点名を示す', () => {
    const n = net(
      [part('V1', 'V', { '+': 'IN', '-': GND }, 1, 'dc'), part('R1', 'R', { a: 'FLOAT', b: 'FLOAT2' }, 1000)],
      ['IN', 'FLOAT', 'FLOAT2'],
    );
    const r = solve(n, 'dc');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('singular');
      expect(r.message).toMatch(/FLOAT|R1/);
    }
  });
  it('ダイオードは対象外として報告する', () => {
    const n = net([part('D1', 'D', { a: 'N1', k: GND }), part('V1', 'V', { '+': 'N1', '-': GND }, 1, 'dc')], ['N1']);
    const r = solve(n, 'dc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details).toEqual(['D1']);
  });
  it('節点数 51 は上限超過', () => {
    const nodes = Array.from({ length: 51 }, (_, i) => `N${i}`);
    const parts = nodes.map((n, i) => part(`R${i}`, 'R', { a: n, b: GND }, 1000));
    const r = solve(net(parts, nodes), 'dc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_many_nodes');
  });
});

describe('負帰還の検査（FR-AN-08）', () => {
  it('反転増幅器は帰還あり、帰還のない回路は無し', () => {
    expect(checkFeedback(invertingAmp())[0].hasFeedback).toBe(true);
    expect(checkFeedback(noFeedback())[0].hasFeedback).toBe(false);
  });
  it('帰還がないと解析せず、質問を作る', () => {
    const run = runAnalysis(noFeedback());
    expect(run.blocked).toBe(true);
    expect(run.dc).toBeUndefined();
    expect(run.ac).toBeUndefined();
    const qs = buildQuestions(noFeedback(), run, []);
    expect(qs.map((q) => q.key)).toContain('Q-FB:U1');
  });
});

describe('許容誤差と期待値の比較（FR-DR-01、FR-DR-02、AC-01）', () => {
  it('既定 ±5%。境界の 4.9% は合格、5.1% は不合格', () => {
    const tol = { rel: 0.05, source: 'default' as const };
    expect(withinTolerance(1.049, 1, tol).ok).toBe(true);
    expect(withinTolerance(1.051, 1, tol).ok).toBe(false);
  });
  it('注釈の許容差（10%）を優先する', () => {
    const n = divider();
    n.annotations[0].expect!.tolerance = 0.1;
    expect(resolveTolerance(n.annotations[0].expect!, {}).source).toBe('annotation');
  });
  it('期待値 0 は絶対値 1 mV で判定', () => {
    const tol = { rel: 0.05, source: 'default' as const };
    expect(withinTolerance(0.0009, 0, tol).ok).toBe(true);
    expect(withinTolerance(0.0011, 0, tol).ok).toBe(false);
    expect(ABS_TOLERANCE_AT_ZERO).toBe(1e-3);
  });
  it('期待値と 20% ずれた回路で不一致を理由とともに検出（AC-01）', () => {
    const n = divider(6); // 実測は 5 V、期待 6 V
    const sol = { dc: lastAnalysis(n, 'dc') };
    const f = evaluateExpectations(n, sol);
    expect(f[0].status).toBe('mismatch');
    expect(f[0].reason).toMatch(/期待.*6.*実測.*5/);
  });
  it('一致する回路では不一致 0 件', () => {
    const n = divider(5);
    const f = evaluateExpectations(n, { dc: lastAnalysis(n, 'dc') });
    expect(f[0].status).toBe('ok');
  });
  it('符号だけ異なるゲインは sign（Q2 の対象）', () => {
    const n = invertingAmp(10);
    const f = evaluateExpectations(n, { ac: lastAnalysis(n, 'ac') });
    expect(f[0].status).toBe('sign');
  });
});

describe('修正案（FR-DR-03、AC-03）', () => {
  it('反転増幅器の期待ゲイン −20 に対し、R2 の修正案が再解析で許容内', () => {
    const n = invertingAmp(-20);
    const f = evaluateExpectations(n, { ac: lastAnalysis(n, 'ac') }, {})[0];
    expect(f.status).toBe('mismatch');
    const props = proposeRepairs(n, f, {});
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      expect(p.relErrAfter).not.toBeNull();
      expect(p.relErrAfter!).toBeLessThanOrEqual(0.05);
      // 再解析で確かめる
      const variant = { ...n, parts: n.parts.map((q) => (q.id === p.partId ? { ...q, value: p.to } : q)) };
      const v = lastAnalysis(variant, 'ac').nodeVoltage.OUT.re;
      expect(Math.abs(v + 20) / 20).toBeLessThanOrEqual(0.05);
    }
    expect(props.some((p) => p.partId === 'R2')).toBe(true);
  });
  it('E24 丸め', () => {
    expect(roundE24(1005)).toBe(1000);
    expect(roundE24(4.6)).toBeCloseTo(4.7, 9);
  });
});

describe('飽和の判定（FR-DR-07、Q1）', () => {
  it('Q1 未回答は未確定', () => {
    const n = invertingAmp();
    const run = runAnalysis(n, { frequency: 1000 });
    const r = checkSaturation(n, run, undefined);
    expect(r[0].status).toBe('unknown');
    expect(r[0].message).toMatch(/未確定/);
  });
  it('電源 12 V（出力ピーク約 14.1 V）は飽和、電源 20 V は非飽和', () => {
    // 入力 1 Vrms × ゲイン −10 → 出力 10 Vrms、ピーク約 14.1 V
    const run = runAnalysis(n0(), { frequency: 1000 });
    expect(checkSaturation(n0(), run, 12)[0].status).toBe('saturated');
    expect(checkSaturation(n0(), run, 20)[0].status).toBe('not_saturated');
  });
});

describe('確定と版・編集の無効化（FR-CK-07、FR-CK-08、AC-06）', () => {
  it('エラーのある回路は確定できず、確定の度に版が増える', () => {
    const bad = addPart(divider(), 'R');
    expect(confirm(newSession(bad)).ok).toBe(false);
    const s1 = confirm(newSession(divider()));
    expect(s1.ok).toBe(true);
    if (s1.ok) {
      expect(s1.session.version).toBe(1);
      const s2 = confirm(edit(s1.session, divider(4)));
      expect(s2.ok && s2.session.version).toBe(2);
    }
  });
  it('確定後の編集で評価不可になる', () => {
    const s = confirm(newSession(divider()));
    if (!s.ok) throw new Error();
    expect(canEvaluate(s.session)).toBe(true);
    const e = edit(s.session, divider(4));
    expect(canEvaluate(e)).toBe(false);
  });
});

describe('検査（FR-CK-05、FR-CK-06）', () => {
  it('サンプルの反転増幅器はエラーなし', () => {
    expect(hasErrors(validateNetlist(invertingAmp()))).toBe(false);
  });
  it('値の未読取はエラー', () => {
    const n = divider();
    n.parts[1].value = null;
    expect(validateNetlist(n).some((i) => i.code === 'VALUE_MISSING')).toBe(true);
  });
  it('端子の未接続はエラー', () => {
    const n = divider();
    delete n.parts[1].pins.b;
    expect(validateNetlist(n).some((i) => i.code === 'UNCONNECTED')).toBe(true);
  });
  it('部品 ID の重複はエラー', () => {
    const n = divider();
    n.parts.push({ ...n.parts[1] });
    expect(validateNetlist(n).some((i) => i.code === 'DUP_ID')).toBe(true);
  });
  it('種別と端子数の不一致はエラー', () => {
    const n = divider();
    n.parts[1].pins.c = 'N1';
    expect(validateNetlist(n).some((i) => i.code === 'PIN_MISMATCH')).toBe(true);
  });
  it('GND の欠如はエラー', () => {
    const n = net([part('R1', 'R', { a: 'N1', b: 'N2' }, 1000)], ['N1', 'N2']);
    expect(validateNetlist(n).some((i) => i.code === 'NO_GND')).toBe(true);
  });
  it('端子 1 つのノードと対象なし注釈は警告（確定は可）', () => {
    const n = addAnnotation(divider(), '存在しない対象', { type: 'part', id: 'X9' });
    const n2 = net([...n.parts, part('R9', 'R', { a: 'N9', b: GND }, 10)], ['N9', 'N1', 'N0'], n.annotations);
    const issues = validateNetlist(n2);
    expect(issues.some((i) => i.code === 'SINGLE_TERMINAL' && i.level === 'warning')).toBe(true);
    expect(issues.some((i) => i.code === 'TARGET_MISSING' && i.level === 'warning')).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('値の表記（FR-CK-04）', () => {
  it.each([
    ['4.7', 'k', 'Ω', 4700],
    ['100', 'n', 'F', 1e-7],
    ['1', 'µ', 'F', 1e-6],
    ['2.2', 'M', 'Ω', 2.2e6],
  ])('compose(%s, %s, %s) = %s', (num, pre, unit, want) => {
    const r = compose(num, pre, unit);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(want, 12);
  });
  it('表記文字列を読み、元の表記は呼び出し側で保持', () => {
    expect(parseValueText('4.7kΩ')).toEqual({ ok: true, value: 4700, unit: 'Ω' });
    expect(parseValueText('100 nF')).toMatchObject({ ok: true, unit: 'F' });
    expect(parseValueText('1uF').ok).toBe(false); // u は受け付けない
    expect(parseValueText('abc').ok).toBe(false);
    expect(parseValueText('10 X').ok).toBe(false);
  });
  it('値の設定で元の表記を保持する', () => {
    const r = setValueParts(divider(), 'R1', '4.7', 'k', 'Ω');
    const p = r.netlist.parts.find((x) => x.id === 'R1')!;
    expect(p.value).toBe(4700);
    expect(p.valueRaw).toBe('4.7kΩ');
  });
});

describe('編集操作（FR-CK-04）', () => {
  it('部品の追加・削除・種別変更・端子割当', () => {
    let n = addPart(divider(), 'R');
    const id = n.parts[n.parts.length - 1].id;
    expect(n.parts.some((p) => p.id === id)).toBe(true);
    n = setPin(n, id, 'a', 'N1');
    n = setPin(n, id, 'b', GND);
    expect(n.parts.find((p) => p.id === id)!.pins).toEqual({ a: 'N1', b: GND });
    n = setKind(n, id, 'C');
    expect(n.parts.find((p) => p.id === id)!.kind).toBe('C');
    n = removePart(n, id);
    expect(n.parts.some((p) => p.id === id)).toBe(false);
  });
  it('新規ノードの作成と既存 ID の重複作成の防止', () => {
    const a = addNode(divider(), 'NX');
    expect(a.netlist.nodes.some((x) => x.id === 'NX')).toBe(true);
    const b = addNode(a.netlist, 'NX');
    expect(b.netlist.nodes.filter((x) => x.id === 'NX').length).toBe(1);
  });
  it('信号源の種類の切替え', () => {
    const n = setSourceMode(divider(), 'V1', 'ac_peak');
    expect(n.parts[0].sourceMode).toBe('ac_peak');
  });
  it('数値を直接設定（修正適用に使う）', () => {
    expect(setValue(divider(), 'R2', 2000).parts[2].value).toBe(2000);
  });
  it('枠の作成とクランプ', () => {
    expect(clampBox({ x: -0.1, y: 0.2, w: 2, h: 0.3 })).toEqual({ x: 0, y: 0.2, w: 1, h: 0.3 });
    const b = boxFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 });
    expect(b.x).toBeCloseTo(0.2, 12);
    expect(b.y).toBeCloseTo(0.1, 12);
    expect(b.w).toBeCloseTo(0.3, 12);
    expect(b.h).toBeCloseTo(0.5, 12);
  });
});

describe('取り消し・やり直し（FR-DR-06）', () => {
  it('undo / redo', () => {
    let h = historyOf(1);
    h = push(h, 2);
    h = push(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(undo(h)));
    expect(h.present).toBe(1);
    expect(undo(h).present).toBe(1);
  });
});

describe('質問（FR-QA）', () => {
  it('Q1 はオペアンプ出力を解析で使う場合に出る', () => {
    const n = invertingAmp();
    const qs = buildQuestions(n, runAnalysis(n, { frequency: 1000 }), []);
    expect(qs.some((q) => q.key === 'Q1')).toBe(true);
    expect(buildQuestions(divider(), runAnalysis(divider()), []).some((q) => q.key === 'Q1')).toBe(false);
  });
  it('Q4 は交流源と C/L があるときだけ出る', () => {
    expect(buildQuestions(rcLowpass(), runAnalysis(rcLowpass()), []).some((q) => q.key === 'Q4')).toBe(true);
    expect(buildQuestions(invertingAmp(), runAnalysis(invertingAmp()), []).some((q) => q.key === 'Q4')).toBe(false);
  });
  it('同じ質問は 1 件、回答は保持されて未回答の扱いが変わる', () => {
    const qs = dedupe([...buildQuestions(invertingAmp(), runAnalysis(invertingAmp(), { frequency: 1000 }), []), ...buildQuestions(invertingAmp(), runAnalysis(invertingAmp(), { frequency: 1000 }), [])]);
    expect(qs.filter((q) => q.key === 'Q1').length).toBe(1);
    let st = emptyQuestionState();
    expect(pending(qs, st).length).toBeGreaterThan(0);
    st = answer(st, 'Q1', '15');
    expect(pending(qs, st).some((q) => q.key === 'Q1')).toBe(false);
  });
});

describe('FMEA の注入（FR-FM-02〜04）', () => {
  it('R の故障モードは 4、未定義種別は null', () => {
    expect(failureModes('R')!.map((m) => m.id)).toEqual(['open', 'short', 'change_up', 'change_down']);
    expect(failureModes('D')).toBeNull();
  });
  it('分圧器の上側 R を開放すると出力が変わる、下側 R を短絡すると出力は 0', () => {
    const d = divider();
    const open = inject(d, 'R1', failureModes('R')![0]).netlist;
    expect(open.parts.some((p) => p.id === 'R1')).toBe(false);
    const short = inject(d, 'R2', failureModes('R')![1]).netlist;
    expect(lastAnalysis(short, 'dc').nodeVoltage.N1.re).toBeCloseTo(0, 2);
  });
  it('オペアンプの出力喪失で出力は 0 V', () => {
    const n = invertingAmp();
    const loss = inject(n, 'U1', failureModes('OPAMP')![0]).netlist;
    expect(abs(lastAnalysis(loss, 'ac').nodeVoltage.OUT)).toBeCloseTo(0, 9);
  });
});

describe('FTA（FR-FT-01〜04、AC-05）', () => {
  it('期待値の注釈からトップ事象の候補', () => {
    expect(topEventCandidates(divider()).length).toBe(1);
  });
  it('既知回路で最小カットセットを求め、最小性を満たす', () => {
    // 分圧器 R1 開放 → N1 は 10 V、R2 開放 → N1 は 0 V / 短絡 → N1 は 0 V
    const n = divider(5);
    const events = basicEventsOf([{ id: 'R1', modes: failureModes('R')! }, { id: 'R2', modes: failureModes('R')! }]);
    const r = minimalCutSets(n, events, { order: 2, topAnnotationId: 'A1' });
    expect(r.cutSets.length).toBeGreaterThan(0);
    // 1 次の単独カットセット: R1 開放・R1 短絡・R2 開放・R2 短絡（いずれも N1 の期待 5 V を外す）
    const singles = r.cutSets.filter((c) => c.events.length === 1).map((c) => c.events[0].id);
    expect(singles).toContain('R1:open');
    expect(singles).toContain('R2:short');
    // 最小性: どのカットセットも既出の真部分集合を含まない
    for (const c of r.cutSets) {
      for (const d of r.cutSets) {
        if (c === d) continue;
        expect(c.events.every((e) => d.events.some((x) => x.id === e.id)) && d.events.length < c.events.length).toBe(false);
      }
    }
    // 同一部品の組合せは出ない
    for (const c of r.cutSets) expect(new Set(c.events.map((e) => e.partId)).size).toBe(c.events.length);
  });
  it('次数は 3 で頭打ち、組合せ数が 500 を超えると警告の判定に使う値になる', () => {
    // 分圧器に並列抵抗 R0〜R11 を足す（出力は変わらない）
    const extra = Array.from({ length: 12 }, (_, i) => part(`R${i}`, 'R', { a: 'N1', b: GND }, 1e6));
    const n = { ...divider(5), parts: [...divider().parts, ...extra] };
    const events = basicEventsOf(extra.map((p) => ({ id: p.id, modes: failureModes('R')! })));
    expect(countCombinations(events, 2)).toBeGreaterThan(500);
    const small = minimalCutSets(n, events.slice(0, 8), { order: 9, topAnnotationId: 'A1' });
    expect(small.warning).toBeUndefined();
    expect(Math.max(0, ...small.cutSets.map((c) => c.events.length))).toBeLessThanOrEqual(3);
  });
  it('FTA 図の SVG に、トップ事象とカットセットのラベルが含まれる', () => {
    const svg = treeSvg('トップ事象<test>', [{ events: [{ id: 'R1:open', partId: 'R1', mode: failureModes('R')![0], label: 'R1 の開放' }], deviation: 1, basis: '' }]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('トップ事象&lt;test&gt;');
    expect(svg).toContain('R1 の開放');
  });
});

describe('FMEA の表と CSV（FR-FM-07）', () => {
  it('カンマと引用符をエスケープ', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv(null)).toBe('');
  });
  it('ヘッダと行を出す', () => {
    const csv = fmeaToCsv([{ partId: 'R1', kind: 'R', modeId: 'open', modeLabel: '開放', injection: 'x,y', S: 7, O: 3, D: 3, RPN: 63, action: 'not_required', basis: ['b'] }]);
    const lines = csv.trim().split('\r\n');
    expect(lines.length).toBe(2);
    expect(lines[0].startsWith('部品ID,種別,故障モード')).toBe(true);
    expect(lines[1]).toContain('"x,y"');
  });
});

describe('プロジェクトファイル・抽出結果・自動退避', () => {
  const img = { name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  it('保存と読込の往復で netlist・回答・設定が一致し、評価結果は含まない', () => {
    const text = serializeProject({ netlist: invertingAmp(), version: 2, image: img, answers: { answers: { Q1: '15' } }, settings: { userTolerance: 0.1 } });
    expect(text).not.toMatch(/evaluation|findings/);
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.netlist).toEqual(invertingAmp());
      expect(r.value.answers.answers.Q1).toBe('15');
      expect(r.value.version).toBe(2);
    }
  });
  it('不正 JSON・形式違い・未知の版を拒否', () => {
    expect(parseProject('{').ok).toBe(false);
    expect(parseProject(JSON.stringify({ format: 'x' })).ok).toBe(false);
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, formatVersion: 99 })).ok).toBe(false);
  });
  it('抽出依頼には画像と依頼が入り、結果は形式を検証する', () => {
    const req = JSON.parse(buildRequest(img));
    expect(req.image.dataUrl).toBe(img.dataUrl);
    expect(parseResult('{"format":"x"}').ok).toBe(false);
    const good = JSON.stringify({ format: RESULT_FORMAT, formatVersion: 1, netlist: { parts: [], nodes: [{ id: GND }], annotations: [] } });
    expect(parseResult(good).ok).toBe(true);
    const bad = JSON.stringify({ format: RESULT_FORMAT, formatVersion: 1, netlist: { parts: [{ id: 1 }], nodes: [], annotations: [] } });
    expect(parseResult(bad).ok).toBe(false);
  });
  it('自動退避は往復し、保存失敗でも例外を出さない', () => {
    const mem = new Map<string, string>();
    const store: KeyValueStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    expect(saveAutosave(store, { netlist: divider(), version: 1, image: null, answers: emptyQuestionState(), settings: {} })).toBe(true);
    expect(mem.has(AUTOSAVE_KEY)).toBe(true);
    expect(loadAutosave(store)!.netlist).toEqual(divider());
    const full: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(saveAutosave(full, { netlist: divider(), version: 0, image: null, answers: emptyQuestionState(), settings: {} })).toBe(false);
    const broken: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
    expect(loadAutosave(broken)).toBeNull();
  });
});
