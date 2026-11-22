// 判断材料の質問（FR-QA）。質問は一度だけ出し、回答はセッション内で保持する。
import { type AnalysisRun } from './analysis';
import { type Finding } from './review';
import { type Netlist } from './netlist';

export type AnswerType = 'number' | 'string' | 'choice';

export interface Question {
  /** 質問キー。同じキーは 1 回だけ出す。 */
  key: string;
  text: string;
  /** どの判定に必要か（FR-QA-01） */
  purpose: string;
  answerType: AnswerType;
  choices?: { value: string; label: string }[];
}

export interface QuestionState {
  answers: Record<string, string>;
}

export const emptyQuestionState = (): QuestionState => ({ answers: {} });

export function answer(state: QuestionState, key: string, value: string): QuestionState {
  return { answers: { ...state.answers, [key]: value } };
}

/** 解析結果から、いま必要な質問を作る（回答済みも含む）。 */
export function buildQuestions(netlist: Netlist, run: AnalysisRun, findings: Finding[]): Question[] {
  const qs: Question[] = [];
  if (run.opampUsed && (run.dc?.ok || run.ac?.ok)) {
    qs.push({
      key: 'Q1',
      text: 'オペアンプの電源電圧（出力の上限の絶対値、V）を入力してください',
      purpose: '出力の飽和の判定',
      answerType: 'number',
    });
  }
  for (const f of findings) {
    if (f.status === 'sign') {
      qs.push({
        key: `Q2:${f.annotationId}`,
        text: `期待値の符号を反転させてよいですか（${f.target}）`,
        purpose: '符号の判定',
        answerType: 'choice',
        choices: [
          { value: 'yes', label: 'はい（符号を反転して比較）' },
          { value: 'no', label: 'いいえ（不一致として扱う）' },
        ],
      });
    }
  }
  for (const a of netlist.annotations) {
    if (a.uncertain || a.text.includes('?') || a.text.includes('？')) {
      qs.push({
        key: `Q3:${a.id}`,
        text: `注釈「${a.text}」は、仕様か、設計者の目標値か、仮の値か`,
        purpose: '期待値の扱い',
        answerType: 'choice',
        choices: [
          { value: 'spec', label: '仕様' },
          { value: 'target', label: '設計者の目標値' },
          { value: 'provisional', label: '仮の値' },
        ],
      });
    }
  }
  if (run.needsFrequency) {
    qs.push({
      key: 'Q4',
      text: '解析する周波数（Hz）を入力してください',
      purpose: '交流の解析',
      answerType: 'number',
    });
  }
  for (const id of run.feedbackMissing) {
    qs.push({
      key: `Q-FB:${id}`,
      text: `オペアンプ ${id} に負帰還の経路がありません。扱いを選んでください`,
      purpose: '理想モデルの前提（負帰還）',
      answerType: 'choice',
      choices: [
        { value: 'skip', label: '理想モデルでは判定しない（解析しない）' },
        { value: 'recheck', label: '回路を確認してから再実行する' },
      ],
    });
  }
  for (const id of run.unsupported) {
    qs.push({
      key: `Q-UNSUP:${id}`,
      text: `${id} は対象外の素子です。扱い方を選んでください`,
      purpose: '対象外素子の扱い',
      answerType: 'choice',
      choices: [
        { value: 'exclude', label: '対象外として記録する' },
        { value: 'stop', label: '解析を中止する' },
      ],
    });
  }
  return qs;
}

/** 回答がない質問だけを返す。 */
export function pending(questions: Question[], state: QuestionState): Question[] {
  return questions.filter((q) => state.answers[q.key] === undefined || state.answers[q.key] === '');
}

/** 質問キーごとに一度だけ残す（同じ質問を繰り返さない）。 */
export function dedupe(questions: Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter((q) => (seen.has(q.key) ? false : (seen.add(q.key), true)));
}

export function numberAnswer(state: QuestionState, key: string): number | undefined {
  const v = state.answers[key];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
