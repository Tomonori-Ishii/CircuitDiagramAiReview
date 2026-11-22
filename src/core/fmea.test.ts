import { describe, expect, it } from 'vitest';
import { runAnalysis } from './analysis';
import { effectOf, nominalOf, rowsFor, scoreSD, type Effect, type FmeaSettings } from './fmea/evaluate';
import { failureModes } from './fmea/library';
import { divider, invertingAmp } from '../test/fixtures';


const base: Effect = { analysisOk: true, findings: [], outputLost: false, outputChange: 0, internalChange: 0, safetyAffected: false };
const settings = (occ: Record<string, number>): FmeaSettings => ({
  occurrence: Object.fromEntries(Object.entries(occ).map(([k, v]) => [k, { value: v, basis: 'テスト' }])),
  percent: {},
  rpnThreshold: 100,
  sThreshold: 9,
});

describe('FMEA の重大度 S・検出度 D（FR-FM-05）', () => {
  const mismatch = (relErr: number) => ({
    annotationId: 'A1', target: 'OUT', quantity: 'V_dc' as const, expected: 5, actual: 5 * (1 + relErr), relErr,
    tolerance: { rel: 0.05, source: 'default' as const }, status: 'mismatch' as const, reason: '',
  });
  it('許容誤差以内で内部だけ変化 → S=1、D=7', () => {
    expect(scoreSD({ ...base, internalChange: 0.05 })).toMatchObject({ S: 1, D: 7 });
  });
  it('変化なし → S=1、D=10（潜在故障）', () => {
    expect(scoreSD(base)).toMatchObject({ S: 1, D: 10 });
  });
  it('逸脱（小、中、大）→ S は 4・5・6、D=3', () => {
    expect(scoreSD({ ...base, findings: [mismatch(0.1)] })).toMatchObject({ S: 4, D: 3 });
    expect(scoreSD({ ...base, findings: [mismatch(0.3)] })).toMatchObject({ S: 5, D: 3 });
    expect(scoreSD({ ...base, findings: [mismatch(0.8)] })).toMatchObject({ S: 6, D: 3 });
  });
  it('出力喪失 → S=7、安全関連 → S=9', () => {
    expect(scoreSD({ ...base, findings: [mismatch(1)], outputLost: true }).S).toBe(7);
    expect(scoreSD({ ...base, findings: [mismatch(0.1)], safetyAffected: true }).S).toBe(9);
  });
  it('解析できない → S=7、D=3', () => {
    expect(scoreSD({ ...base, analysisOk: false, reason: 'x' })).toMatchObject({ S: 7, D: 3 });
  });
});

describe('FMEA の行と RPN・対策要否（FR-FM-05、FR-FM-06、AC-04）', () => {
  it('分圧器の R1 開放: 出力喪失 S=7、D=3、O=5 で RPN=105 → 対策要', () => {
    const n = divider(5);
    const run = runAnalysis(n);
    const rows = rowsFor(n, run, settings({ R1: 5 }), ['R1'], (k) => failureModes(k as never));
    const open = rows.find((r) => r.modeId === 'open')!;
    expect(open.S).toBe(7);
    expect(open.D).toBe(3);
    expect(open.RPN).toBe(105);
    expect(open.action).toBe('required');
  });
  it('O 未指定なら RPN は未算出、S ≥ 9 なら対策要', () => {
    const n = invertingAmp();
    const run = runAnalysis(n, { frequency: 1000 });
    const rows = rowsFor(n, run, settings({}), ['U1'], (k) => failureModes(k as never));
    expect(rows[0].RPN).toBeNull();
    expect(rows[0].action).toBe('undetermined');
    expect(rows[0].S).toBe(7); // 出力喪失
  });
  it('RPN 99 は対策不要、100 は対策要（閾値の境界）', () => {
    const n = divider(5);
    const run = runAnalysis(n);
    // S=1, D=... を直接作れないため、閾値を変えて境界を確かめる
    const rows = rowsFor(n, run, { ...settings({ R1: 4 }), rpnThreshold: 85 }, ['R1'], (k) => failureModes(k as never));
    const open = rows.find((r) => r.modeId === 'open')!;
    expect(open.RPN).toBe(7 * 4 * 3); // 84
    expect(open.action).toBe('not_required');
    const strict = rowsFor(n, run, { ...settings({ R1: 4 }), rpnThreshold: 84 }, ['R1'], (k) => failureModes(k as never));
    expect(strict.find((r) => r.modeId === 'open')!.action).toBe('required');
  });
  it('注入の既定値で R の値変化（+50%）が効く', () => {
    const n = divider(5);
    const nominal = nominalOf(n, runAnalysis(n));
    const { description, effect } = effectOf(n, nominal, 'R1', failureModes('R')![2], settings({}));
    expect(description).toContain('+50%');
    expect(effect.analysisOk).toBe(true);
  });
});
