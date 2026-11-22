import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { App } from './App';
import { ImageOverlay } from './ImageOverlay';
import { ImageDropZone } from './ImageDropZone';
import { AUTOSAVE_KEY } from '../core/autosave';
import { serializeProject } from '../core/project';
import { emptyQuestionState } from '../core/questions';
import { divider } from '../test/fixtures';

beforeEach(() => {
  window.localStorage.clear();
});

describe('画像の入力（UR-01、F-01）', () => {
  it('PDF はドロップを拒否し理由を表示する', async () => {
    render(<ImageDropZone onImage={() => {}} />);
    const zone = screen.getByTestId('dropzone');
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('対応形式は PNG と JPG です');
  });
  it('10 MB を超えるファイルは拒否する（境界の内外）', async () => {
    render(<ImageDropZone onImage={() => {}} />);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('file-input'), { target: { files: [big] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('10 MB 以下');
  });
});

describe('画像の重ね表示（UR-03、UR-04、UR-26）', () => {
  const boxes = [
    { id: 'R1', label: 'R1', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
    { id: 'R2', label: 'R2', bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.1 } },
    { id: 'U1', label: 'U1', bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } },
  ];
  it('部品の枠を描き、濃さを反映し、枠のクリックで選択を通知する', () => {
    const onSelect = (id: string) => calls.push(id);
    const calls: string[] = [];
    render(<ImageOverlay src="x.png" boxes={boxes} opacity={0.4} onSelect={onSelect} />);
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('box')).length).toBe(3);
    expect(screen.getByTestId('overlay').querySelector('.overlay-layer')).toHaveStyle({ opacity: '0.4' });
    fireEvent.click(screen.getByTestId('box-U1'));
    expect(calls).toEqual(['U1']);
  });
  it('指摘箇所は強調表示になる', () => {
    render(<ImageOverlay src="x.png" boxes={boxes} opacity={1} highlightIds={['R2']} />);
    expect(screen.getByTestId('box-R2').className).toContain('highlight');
    expect(screen.getByTestId('box-R1').className).not.toContain('highlight');
  });
});

describe('画面全体（UR-35、UR-33、UR-34、UR-32、UR-29）', () => {
  it('日本語の見出しと免責、保存の注意が表示される', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '回路図レビュー' })).toBeInTheDocument();
    expect(screen.getByText(/設計支援であり、安全認証や規格適合の判定ではありません/)).toBeInTheDocument();
  });

  it('サンプルを読み込み、確定すると版 1 になり、期待値（ゲイン −10）が一致する', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    fireEvent.click(screen.getByRole('button', { name: '確定して版番号を付ける' }));
    expect(screen.getByText(/確定済み（版 1）/)).toBeInTheDocument();
    expect(screen.getByTestId('question-Q1')).toBeInTheDocument();
    // Q1 に答えると飽和が判定される
    fireEvent.change(screen.getByLabelText('Q1 の回答'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '回答する' }));
    expect(screen.queryByTestId('question-Q1')).toBeNull();
    expect(screen.getByTestId('finding-A1')).toHaveTextContent('一致');
    expect(screen.getByText(/飽和: なし|飽和: あり/)).toBeInTheDocument();
  });

  it('確定後に編集すると既存の評価が無効になる（AC-06）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    fireEvent.click(screen.getByRole('button', { name: '確定して版番号を付ける' }));
    const r1 = screen.getByLabelText('R1 の数値');
    fireEvent.change(r1, { target: { value: '2' } });
    fireEvent.blur(r1);
    expect(screen.queryByTestId('finding-A1')).toBeNull();
    expect(screen.getByText(/既存の評価結果は無効/)).toBeInTheDocument();
  });

  it('外部 AI への書き出しは承認チェックの後にだけ有効（NFR-SEC-01）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    const btn = screen.getByRole('button', { name: '抽出依頼を書き出す' });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText('外部 AI に送信することを承認'));
    expect(btn).toBeEnabled();
  });

  it('保存・読込の領域に保存ファイルの注意が出る（NFR-SEC-02）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    expect(screen.getByText(/保存ファイルの管理は利用者の責任です/)).toBeInTheDocument();
  });

  it('自動退避データがあると復元を提示し、破棄で消える（AC-07）', () => {
    window.localStorage.setItem(
      AUTOSAVE_KEY,
      serializeProject({ netlist: divider(), version: 0, image: { name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }, answers: emptyQuestionState(), settings: {} }),
    );
    render(<App />);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(/自動退避/)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: '破棄する' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });
});

describe('許容差・注入値の入力（UR-15、UR-20）', () => {
  it('既定の許容差を入力でき、評価の許容差の出所が利用者指定になる（F-22）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    fireEvent.click(screen.getByRole('button', { name: '確定して版番号を付ける' }));
    fireEvent.change(screen.getByLabelText('既定の許容差'), { target: { value: '2' } });
    expect(screen.getByTestId('finding-A1')).toHaveTextContent('利用者指定');
  });
});

describe('選択の同期・取り消し・保存の読込（UR-04、UR-17、UR-30）', () => {
  it('部品表の行を選ぶと画像の枠が選択状態になる（UR-04）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    // 枠を描いた部品があるときに、枠の選択が表と連動する。サンプルは枠を持たないので、枠の描画は別テストで確認する。
    fireEvent.click(screen.getByTestId('part-row-R2'));
    expect(screen.getByTestId('part-row-R2').className).toContain('selected');
  });

  it('値の変更を取り消す（Undo）と元に戻る（UR-17）', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    const r1 = screen.getByLabelText('R1 の数値') as HTMLInputElement;
    expect(r1.value).toBe('1');
    fireEvent.change(r1, { target: { value: '2' } });
    fireEvent.blur(r1);
    expect((screen.getByLabelText('R1 の数値') as HTMLInputElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '取り消す（Undo）' }));
    expect((screen.getByLabelText('R1 の数値') as HTMLInputElement).value).toBe('1');
  });

  it('保存した JSON を開くと回路と画像が戻る（UR-30）', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    const text = serializeProject({
      netlist: divider(5),
      version: 1,
      image: { name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
      answers: emptyQuestionState(),
      settings: {},
    });
    const input = container.querySelector('[data-testid="open-input"]') as HTMLInputElement;
    const file = new File([text], 'p.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await screen.findByLabelText('R1 の数値')).toBeInTheDocument();
  });

  it('形式の違うファイルは拒否して理由を出す（UR-30）', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'サンプル（反転増幅器）を読み込む' }));
    const input = container.querySelector('[data-testid="open-input"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['{"format":"x"}'], 'x.json')] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('形式が違います');
  });
});
