// 評価結果の記録（FR-RS-02、FR-QA-04）。前提（回答）、許容誤差とその出所、判定根拠を含める。
import { type Question, type QuestionState } from './questions';
import { type Tolerance } from './review';

export interface EvaluationRecord {
  netlistVersion: number;
  assumptions: { question: string; answer: string }[];
  tolerance: Tolerance;
  findings: { title: string; basis: string }[];
}

export function assumptionsOf(questions: Question[], state: QuestionState): { question: string; answer: string }[] {
  return questions
    .filter((q) => state.answers[q.key] !== undefined && state.answers[q.key] !== '')
    .map((q) => {
      const raw = state.answers[q.key];
      const label = q.choices?.find((c) => c.value === raw)?.label ?? raw;
      return { question: q.text, answer: label };
    });
}
