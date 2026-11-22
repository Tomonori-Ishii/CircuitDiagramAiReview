import { useState } from 'react';
import { type Question } from '../core/questions';

interface Props {
  pending: Question[];
  onAnswer: (key: string, value: string) => void;
}

export function QuestionPanel({ pending, onAnswer }: Props) {
  if (pending.length === 0) return <p className="muted">判断材料の質問はありません。</p>;
  return (
    <div className="questions">
      <h3>判断材料の質問</h3>
      <p className="muted">回答がない項目は「未確定」として扱います。</p>
      {pending.map((q) => (
        <QuestionItem key={q.key} q={q} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

function QuestionItem({ q, onAnswer }: { q: Question; onAnswer: (key: string, value: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="question" data-testid={`question-${q.key}`}>
      <p><strong>{q.text}</strong></p>
      <p className="muted">必要な判定: {q.purpose}</p>
      {q.answerType === 'choice' ? (
        <div className="row">
          {q.choices?.map((c) => (
            <button type="button" key={c.value} onClick={() => onAnswer(q.key, c.value)}>{c.label}</button>
          ))}
        </div>
      ) : (
        <div className="row">
          <input
            aria-label={`${q.key} の回答`}
            type={q.answerType === 'number' ? 'number' : 'text'}
            step="any"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" disabled={text.trim() === ''} onClick={() => onAnswer(q.key, text.trim())}>回答する</button>
        </div>
      )}
    </div>
  );
}
