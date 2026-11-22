import { describe, expect, it } from 'vitest';
import { okSolution, runAnalysis } from './analysis';
import { assumptionsOf } from './record';
import { answer, buildQuestions, emptyQuestionState } from './questions';
import { evaluateExpectations } from './review';
import { solve } from './mna';
import { validateImage, MAX_LONG_SIDE, MAX_IMAGE_BYTES } from './imageValidation';
import { divider, invertingAmp } from '../test/fixtures';
import { addAnnotation, removePart } from './editing';

describe('画像の受付条件（FR-IN-02、FR-IN-03）', () => {
  it('形式・サイズ・長辺の境界', () => {
    expect(validateImage({ type: 'image/png', size: MAX_IMAGE_BYTES, width: MAX_LONG_SIDE, height: 10 })).toEqual([]);
    expect(validateImage({ type: 'image/jpeg', size: 1, width: 1, height: 1 })).toEqual([]);
    expect(validateImage({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })[0]).toMatch(/10 MB/);
    expect(validateImage({ type: 'image/png', size: 1, width: MAX_LONG_SIDE + 1, height: 10 })[0]).toMatch(/4000 px/);
    expect(validateImage({ type: 'image/gif', size: 1 })[0]).toMatch(/PNG と JPG/);
  });
});

describe('解析結果の再現性（FR-FL-02、UR-31）', () => {
  it('同じ入力から同じ結果になる', () => {
    const a = solve(invertingAmp(), 'ac', 1000);
    const b = solve(invertingAmp(), 'ac', 1000);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const run = (): number => {
      const r = runAnalysis(divider(5));
      return evaluateExpectations(divider(5), { dc: okSolution(r.dc) })[0].actual ?? NaN;
    };
    expect(run()).toBe(run());
  });
});

describe('判断材料の記録（FR-QA-04、FR-RS-02）', () => {
  it('回答が前提として記録され、未回答は含まれない', () => {
    const n = invertingAmp();
    const run = runAnalysis(n, { frequency: 1000 });
    const qs = buildQuestions(n, run, []);
    let st = emptyQuestionState();
    expect(assumptionsOf(qs, st)).toEqual([]);
    st = answer(st, 'Q1', '12');
    const rec = assumptionsOf(qs, st);
    expect(rec).toHaveLength(1);
    expect(rec[0].answer).toBe('12');
    expect(rec[0].question).toMatch(/電源電圧/);
  });
});

describe('注釈の編集（FR-CK-04）', () => {
  it('注釈を追加でき、部品を削除すると対象の参照が外れる', () => {
    let n = addAnnotation(divider(), 'R1 の注記', { type: 'part', id: 'R1' });
    expect(n.annotations.at(-1)!.text).toBe('R1 の注記');
    n = removePart(n, 'R1');
    expect(n.annotations.find((a) => a.text === 'R1 の注記')!.target).toBeNull();
  });
});
