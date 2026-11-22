import { useEffect, useMemo, useState } from 'react';
import { runAnalysis, okSolution } from '../core/analysis';
import { AUTOSAVE_KEY, clearAutosave, loadAutosave, saveAutosave, type KeyValueStorage } from '../core/autosave';
import { addPart, setBBox, setPin, setValueParts } from '../core/editing';
import { emptyNetlist, GND, type Netlist } from '../core/netlist';
import { buildQuestions, dedupe, emptyQuestionState, numberAnswer, pending, answer, type QuestionState } from '../core/questions';
import { assumptionsOf } from '../core/record';
import { type ProjectImage, type Project } from '../core/project';
import { evaluateExpectations, type ReviewSettings } from '../core/review';
import { canEvaluate, confirm, edit, newSession, type Session } from '../core/session';
import { historyOf, push, redo, undo, type History } from '../core/history';
import { validateNetlist } from '../core/validation';
import { ImageDropZone, type LoadedImage } from './ImageDropZone';
import { ImageOverlay, type OverlayBox } from './ImageOverlay';
import { NetlistEditor } from './NetlistEditor';
import { QuestionPanel } from './QuestionPanel';
import { ReviewPanel } from './ReviewPanel';
import { FmeaPanel, type FmeaState } from './FmeaPanel';
import { FtaPanel } from './FtaPanel';
import { ProjectPanel } from './ProjectPanel';
import { Disclaimer } from './Disclaimer';

type Perspective = 'review' | 'fmea' | 'fta';

const PERSPECTIVES: { id: Perspective; label: string }[] = [
  { id: 'review', label: '設計レビュー' },
  { id: 'fmea', label: 'FMEA' },
  { id: 'fta', label: 'FTA' },
];

const browserStorage = (): KeyValueStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** 画面確認用の白い 1 画素の PNG（サンプル回路の画像の代わり）。 */
const SAMPLE_IMAGE: ProjectImage = {
  name: 'sample-inverting-amp.png',
  mime: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
};

/** サンプル: 反転増幅器（入力 1 Vrms、R1 = 1 kΩ、R2 = 10 kΩ、ゲイン −10）。 */
export function sampleNetlist(): Netlist {
  const base: Netlist = { ...emptyNetlist(), nodes: [{ id: GND }, { id: 'IN' }, { id: 'N2' }, { id: 'OUT' }] };
  const withV = addPart(base, 'V');
  const v1 = withV.parts[withV.parts.length - 1].id;
  let n = { ...withV, parts: withV.parts.map((p) => (p.id === v1 ? { ...p, id: 'V1', sourceMode: 'ac_rms' as const, value: 1, valueRaw: '1V' } : p)) };
  n = setPin(setPin(n, 'V1', '+', 'IN'), 'V1', '-', GND);
  n = {
    ...n,
    parts: [
      ...n.parts,
      { id: 'R1', kind: 'R', value: 1000, valueRaw: '1kΩ', pins: {}, block: '反転増幅器' },
      { id: 'R2', kind: 'R', value: 10000, valueRaw: '10kΩ', pins: {}, block: '反転増幅器' },
      { id: 'U1', kind: 'OPAMP', value: null, valueRaw: '', pins: {}, block: '反転増幅器' },
    ],
  };
  n = setPin(setPin(n, 'R1', 'a', 'IN'), 'R1', 'b', 'N2');
  n = setPin(setPin(n, 'R2', 'a', 'N2'), 'R2', 'b', 'OUT');
  n = setPin(setPin(setPin(n, 'U1', '+', GND), 'U1', '-', 'N2'), 'U1', 'out', 'OUT');
  n = setValueParts(setValueParts(n, 'R1', '1', 'k', 'Ω').netlist, 'R2', '10', 'k', 'Ω').netlist;
  return { ...n, annotations: [{ id: 'A1', text: 'ゲイン -10', target: { type: 'node', id: 'OUT' }, expect: { quantity: 'gain', value: -10, input: 'IN' } }] };
}

export function App() {
  const [image, setImage] = useState<ProjectImage | null>(null);
  const [sess, setSess] = useState<Session>(newSession(emptyNetlist()));
  const [hist, setHist] = useState<History<Netlist>>(historyOf(emptyNetlist()));
  const [qs, setQs] = useState<QuestionState>(emptyQuestionState());
  const [userTolerance, setUserTolerance] = useState<number | undefined>(undefined);
  const [perspective, setPerspective] = useState<Perspective>('review');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [drawMode, setDrawMode] = useState(false);
  const [opacity, setOpacity] = useState(0.7);
  const [restore, setRestore] = useState<Project | null>(null);
  const [fmea, setFmea] = useState<FmeaState>({ targets: [], occurrence: {}, percent: {}, rpnThreshold: 100, sThreshold: 9 });
  const [fta, setFta] = useState<{ targets: string[]; order: number; topAnnotationId?: string }>({ targets: [], order: 2 });

  // 起動時に自動退避データを提示する（FR-ST-01）
  useEffect(() => {
    const s = browserStorage();
    if (!s) return;
    const saved = loadAutosave(s);
    if (saved) setRestore(saved);
  }, []);

  const buildProject = (): Project => ({
    netlist: sess.netlist,
    version: sess.version,
    image,
    answers: qs,
    settings: {
      userTolerance,
      fmea,
      fta,
    },
  });

  // 変更のたびに自動退避（FR-ST-01）。失敗しても画面は動く。
  useEffect(() => {
    const s = browserStorage();
    if (!s || image === null) return;
    saveAutosave(s, { netlist: sess.netlist, version: sess.version, image, answers: qs, settings: { userTolerance, fmea, fta } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, sess, qs, userTolerance, fmea, fta]);

  const applyProject = (p: Project) => {
    setImage(p.image);
    setSess({ netlist: p.netlist, status: 'editing', version: 0 });
    setHist(historyOf(p.netlist));
    setQs(p.answers);
    setUserTolerance(p.settings.userTolerance);
    if (p.settings.fmea) setFmea({ ...fmea, ...p.settings.fmea });
    if (p.settings.fta) setFta({ ...fta, ...p.settings.fta });
    setSelected(undefined);
  };

  const commit = (next: Netlist) => {
    setHist((h) => push(h, next));
    setSess((s) => edit(s, next));
  };
  const doUndo = () => {
    const h = undo(hist);
    setHist(h);
    setSess((s) => edit(s, h.present));
  };
  const doRedo = () => {
    const h = redo(hist);
    setHist(h);
    setSess((s) => edit(s, h.present));
  };

  const netlist = sess.netlist;
  const issues = useMemo(() => validateNetlist(netlist), [netlist]);
  const frequency = numberAnswer(qs, 'Q4');
  const supplyV = numberAnswer(qs, 'Q1');
  const signFlipKey = Object.entries(qs.answers)
    .filter(([k, v]) => k.startsWith('Q2:') && v === 'yes')
    .map(([k]) => k.slice(3))
    .join(',');
  const reviewSettings: ReviewSettings = useMemo(
    () => ({ userTolerance, signFlips: new Set(signFlipKey ? signFlipKey.split(',') : []), frequency }),
    [userTolerance, signFlipKey, frequency],
  );
  const confirmed = sess.confirmed;
  const canRun = canEvaluate(sess) && confirmed !== undefined;
  const run = useMemo(
    () => (canRun && confirmed ? runAnalysis(confirmed, { frequency }) : null),
    [canRun, confirmed, frequency],
  );
  const findings = useMemo(
    () => (run && !run.blocked && confirmed ? evaluateExpectations(confirmed, { dc: okSolution(run.dc), ac: okSolution(run.ac) }, reviewSettings) : []),
    [run, confirmed, reviewSettings],
  );
  const questions = useMemo(
    () => (run && confirmed ? dedupe(buildQuestions(confirmed, run, findings)) : []),
    [run, confirmed, findings],
  );
  const pendingQs = pending(questions, qs);
  const assumptions = assumptionsOf(questions, qs);

  const boxes: OverlayBox[] = netlist.parts
    .filter((p) => p.bbox)
    .map((p) => ({ id: p.id, label: p.id, bbox: p.bbox!, nodeLabel: Object.values(p.pins).join('/') }));
  // 不一致の節点に接続する部品を画像上で強調する（FR-RS-01）
  const flaggedNodes = findings.filter((f) => f.status === 'mismatch').map((f) => f.target);
  const highlightIds = netlist.parts.filter((p) => Object.values(p.pins).some((n) => flaggedNodes.includes(n))).map((p) => p.id);

  return (
    <main>
      <header>
        <h1>回路図レビュー</h1>
        <Disclaimer />
      </header>

      {restore && (
        <section className="banner" role="status">
          <p>前回の作業が自動退避されています（保存先はこのブラウザ内。ブラウザのデータを消去すると失われます）。</p>
          <button type="button" onClick={() => { applyProject(restore); setRestore(null); }}>復元する</button>
          <button type="button" onClick={() => { const s = browserStorage(); if (s) clearAutosave(s); setRestore(null); }}>破棄する</button>
        </section>
      )}

      <section>
        <h2>1. 入力と確認・修正</h2>
        {!image ? (
          <>
            <ImageDropZone onImage={(img: LoadedImage) => { setImage({ name: img.name, mime: img.mime, dataUrl: img.dataUrl }); }} />
            <div className="row">
              <button type="button" onClick={() => { setImage(SAMPLE_IMAGE); setSess(newSession(sampleNetlist())); setHist(historyOf(sampleNetlist())); }}>
                サンプル（反転増幅器）を読み込む
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <button type="button" onClick={() => setImage(null)}>別の画像を選ぶ</button>
              <label>
                <input type="checkbox" checked={drawMode} disabled={!selected} onChange={(e) => setDrawMode(e.target.checked)} />
                選択中の部品の枠を画像上にドラッグで描く
              </label>
              <label>重ね表示の濃さ
                <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
              </label>
            </div>
            <div className="input-grid">
              <ImageOverlay
                src={image.dataUrl}
                boxes={boxes}
                selectedId={selected}
                highlightIds={highlightIds}
                opacity={opacity}
                onSelect={(id) => setSelected(id)}
                drawFor={drawMode ? selected : undefined}
                onDraw={(id, bbox) => commit(setBBox(netlist, id, bbox))}
              />
              <NetlistEditor
                netlist={netlist}
                selectedId={selected}
                onSelect={setSelected}
                onChange={commit}
                issues={issues}
                confirmDisabled={false}
                onConfirm={() => {
                  const r = confirm(sess);
                  if (r.ok) {
                    setSess(r.session);
                    setHist(historyOf(r.session.netlist));
                  }
                }}
              />
            </div>
            <div className="row">
              <button type="button" onClick={doUndo} disabled={hist.past.length === 0}>取り消す（Undo）</button>
              <button type="button" onClick={doRedo} disabled={hist.future.length === 0}>やり直す（Redo）</button>
              <span className="muted">
                状態: {sess.status === 'confirmed' ? `確定済み（版 ${sess.version}）` : sess.version > 0 ? `編集中（版 ${sess.version} は無効）` : '未確定'}
              </span>
            </div>
            {sess.status === 'editing' && sess.version > 0 && (
              <p className="warn">確定後に編集したため、既存の評価結果は無効です。再確定してください。</p>
            )}
          </>
        )}
      </section>

      {image && (
        <section>
          <h2>2. 観点の選択と評価</h2>
          {!canRun ? (
            <p className="muted">評価には回路の確定が必要です。</p>
          ) : (
            <>
              <nav className="tabs">
                {PERSPECTIVES.map((p) => (
                  <button key={p.id} type="button" aria-pressed={perspective === p.id} className={perspective === p.id ? 'active' : ''} onClick={() => setPerspective(p.id)}>
                    {p.label}
                  </button>
                ))}
              </nav>
              <label>既定の許容差（%、空欄は 5%）
                <input
                  aria-label="既定の許容差"
                  type="number"
                  min={0}
                  step="any"
                  value={userTolerance === undefined ? '' : userTolerance * 100}
                  onChange={(e) => setUserTolerance(e.target.value === '' ? undefined : Number(e.target.value) / 100)}
                />
              </label>
              <QuestionPanel pending={pendingQs} onAnswer={(key, value) => setQs((q) => answer(q, key, value))} />
              {run && perspective === 'review' && (
                <ReviewPanel
                  netlist={confirmed!}
                  version={sess.version}
                  run={run}
                  settings={reviewSettings}
                  supplyV={supplyV}
                  assumptions={assumptions}
                  onApply={commit}
                />
              )}
              {run && perspective === 'fmea' && (
                <FmeaPanel netlist={confirmed!} run={run} state={fmea} base={reviewSettings} onState={setFmea} />
              )}
              {run && perspective === 'fta' && (
                <FtaPanel
                  netlist={confirmed!}
                  run={run}
                  settings={reviewSettings}
                  targets={fta.targets}
                  onTargets={(t) => setFta({ ...fta, targets: t })}
                />
              )}
            </>
          )}
        </section>
      )}

      {image && (
        <section>
          <h2>3. 保存と外部 AI への受け渡し</h2>
          <ProjectPanel
            image={image}
            buildProject={buildProject}
            onOpen={applyProject}
            onDraftFromAi={(n) => {
              setSess({ netlist: n, status: 'editing', version: 0 });
              setHist(historyOf(n));
            }}
          />
        </section>
      )}
      <footer className="muted">自動退避キー: {AUTOSAVE_KEY}</footer>
    </main>
  );
}
