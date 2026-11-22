import { useState } from 'react';
import { addAnnotation, addNode, addPart, removeAnnotation, removePart, setBlock, setKind, setPin, setSourceMode, setValueParts, updateAnnotation } from '../core/editing';
import { GND, KINDS, type Annotation, type ExpectQuantity, type Kind, type Netlist, type SourceMode, TERMINALS } from '../core/netlist';
import { PREFIXES, type Unit } from '../core/units';
import { type Issue } from '../core/validation';

interface Props {
  netlist: Netlist;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onChange: (next: Netlist) => void;
  issues: Issue[];
  onConfirm: () => void;
  confirmDisabled: boolean;
  readOnly?: boolean;
}

const PREFIX_OPTIONS = Object.keys(PREFIXES);

/** 種別ごとの単位（R: Ω、C: F、L: H、電圧源: V、電流源: A）。 */
export function unitOf(kind: Kind): Unit {
  return kind === 'C' ? 'F' : kind === 'L' ? 'H' : kind === 'V' ? 'V' : kind === 'I' ? 'A' : 'Ω';
}
/** 元の表記から接頭辞と数値を取り出す（例 "4.7kΩ" → "k", "4.7"）。 */
export function prefixOf(raw: string): string {
  return (raw.match(/[pnµmkMG]/u) ?? [''])[0];
}
export function numberOf(raw: string): string {
  return (raw.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/) ?? [''])[0];
}

export function NetlistEditor({ netlist, selectedId, onSelect, onChange, issues, onConfirm, confirmDisabled, readOnly }: Props) {
  const [kind, setNewKind] = useState<Kind>('R');
  const [newNode, setNewNode] = useState('');
  const [annText, setAnnText] = useState('');
  const nodeIds = netlist.nodes.map((n) => n.id);
  const hasErr = issues.some((i) => i.level === 'error');

  return (
    <div className="editor">
      <section>
        <h3>部品</h3>
        <div className="row">
          <select aria-label="追加する種別" value={kind} onChange={(e) => setNewKind(e.target.value as Kind)} disabled={readOnly}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button type="button" disabled={readOnly} onClick={() => onChange(addPart(netlist, kind))}>部品を追加</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>種別</th><th>値</th><th>単位</th><th>信号源</th>
                <th>端子（ノード）</th><th>ブロック</th><th>不確か</th><th></th>
              </tr>
            </thead>
            <tbody>
              {netlist.parts.map((p) => {
                const terms = TERMINALS[p.kind];
                const isSel = p.id === selectedId;
                const numText = numberOf(p.valueRaw);
                const prefix = prefixOf(p.valueRaw);
                const unit = unitOf(p.kind);
                return (
                  <tr key={p.id} data-testid={`part-row-${p.id}`} className={isSel ? 'selected' : undefined} onClick={() => onSelect(p.id)}>
                    <td>{p.id}</td>
                    <td>
                      <select aria-label={`${p.id} の種別`} value={p.kind} disabled={readOnly} onChange={(e) => onChange(setKind(netlist, p.id, e.target.value as Kind))}>
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`${p.id} の数値`}
                        disabled={readOnly || p.kind === 'OPAMP'}
                        defaultValue={numText}
                        key={`${p.id}-${p.valueRaw}`}
                        onBlur={(e) => {
                          onChange(setValueParts(netlist, p.id, e.target.value, prefix, unit).netlist);
                        }}
                      />
                    </td>
                    <td>
                      <select aria-label={`${p.id} の接頭辞`} disabled={readOnly || p.kind === 'OPAMP'} value={prefix}
                        onChange={(e) => onChange(setValueParts(netlist, p.id, numText || '0', e.target.value, unit).netlist)}>
                        {PREFIX_OPTIONS.map((x) => <option key={x} value={x}>{x || '（なし）'}</option>)}
                      </select>
                    </td>
                    <td>{unit}</td>
                    <td>
                      {(p.kind === 'V' || p.kind === 'I') && (
                        <select aria-label={`${p.id} の信号源`} value={p.sourceMode ?? 'dc'} disabled={readOnly}
                          onChange={(e) => onChange(setSourceMode(netlist, p.id, e.target.value as SourceMode))}>
                          <option value="dc">直流</option>
                          <option value="ac_rms">交流（実効値）</option>
                          <option value="ac_peak">交流（ピーク）</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {terms.map((t) => (
                        <label key={t} className="pin">
                          {t}
                          <select aria-label={`${p.id} の端子 ${t}`} value={p.pins[t] ?? ''} disabled={readOnly}
                            onChange={(e) => onChange(setPin(netlist, p.id, t, e.target.value))}>
                            <option value="">（未接続）</option>
                            {nodeIds.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                      ))}
                    </td>
                    <td>
                      <input aria-label={`${p.id} のブロック`} value={p.block} disabled={readOnly} onChange={(e) => onChange(setBlock(netlist, p.id, e.target.value))} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`${p.id} を不確か`} checked={!!p.uncertain} disabled={readOnly}
                        onChange={(e) => onChange({ ...netlist, parts: netlist.parts.map((q) => (q.id === p.id ? { ...q, uncertain: e.target.checked || undefined } : q)) })} />
                    </td>
                    <td>
                      <button type="button" disabled={readOnly} onClick={(e) => { e.stopPropagation(); onChange(removePart(netlist, p.id)); }}>削除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3>ノード</h3>
        <p className="muted">現在のノード: {nodeIds.join(', ')}（接地は {GND}）</p>
        <div className="row">
          <input aria-label="新しいノード ID" placeholder="例 N5" value={newNode} onChange={(e) => setNewNode(e.target.value)} disabled={readOnly} />
          <button type="button" disabled={readOnly || newNode.trim() === ''}
            onClick={() => { onChange(addNode(netlist, newNode.trim()).netlist); setNewNode(''); }}>ノードを作成</button>
        </div>
      </section>

      <section>
        <h3>注釈（期待動作）</h3>
        <ul className="annotations">
          {netlist.annotations.map((a) => (
            <AnnotationRow key={a.id} a={a} netlist={netlist} onChange={onChange} readOnly={readOnly} />
          ))}
        </ul>
        <div className="row">
          <input aria-label="新しい注釈" placeholder="例: 出力 5 Vrms" value={annText} onChange={(e) => setAnnText(e.target.value)} disabled={readOnly} />
          <button type="button" disabled={readOnly || annText.trim() === ''} onClick={() => { onChange(addAnnotation(netlist, annText.trim())); setAnnText(''); }}>注釈を追加</button>
        </div>
      </section>

      <section>
        <h3>確認（確定前の検査）</h3>
        {issues.length === 0 ? <p className="ok">問題は見つかりません。</p> : (
          <ul className="issues">
            {issues.map((i, k) => <li key={k} className={i.level}>{i.level === 'error' ? 'エラー' : '警告'}: {i.message}</li>)}
          </ul>
        )}
        <button type="button" className="primary" onClick={onConfirm} disabled={confirmDisabled || hasErr || readOnly}>確定して版番号を付ける</button>
      </section>
    </div>
  );
}

function AnnotationRow({ a, netlist, onChange, readOnly }: { a: Annotation; netlist: Netlist; onChange: (n: Netlist) => void; readOnly?: boolean }) {
  const e = a.expect;
  const nodes = netlist.nodes.map((n) => n.id);
  return (
    <li data-testid={`ann-${a.id}`}>
      <span>{a.id}: {a.text}</span>
      <label>対象
        <select aria-label={`${a.id} の対象`} disabled={readOnly} value={a.target ? a.target.id : ''}
          onChange={(ev) => {
            const id = ev.target.value;
            onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, target: id ? { type: nodes.includes(id) ? 'node' : 'part', id } : null })));
          }}>
          <option value="">（なし）</option>
          {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
          {netlist.parts.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
      </label>
      <label>期待
        <select aria-label={`${a.id} の期待の種類`} disabled={readOnly} value={e?.quantity ?? ''}
          onChange={(ev) => {
            const q = ev.target.value as ExpectQuantity | '';
            onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, expect: q ? { quantity: q, value: x.expect?.value ?? 0, input: x.expect?.input ?? 'IN' } : undefined })));
          }}>
          <option value="">なし</option>
          <option value="V_rms">電圧（交流・実効値）</option>
          <option value="V_dc">電圧（直流）</option>
          <option value="gain">ゲイン（符号付き）</option>
        </select>
      </label>
      {e && (
        <>
          <input aria-label={`${a.id} の期待値`} type="number" step="any" disabled={readOnly} value={e.value}
            onChange={(ev) => onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, expect: { ...x.expect!, value: Number(ev.target.value) } })))} />
          {e.quantity === 'gain' && (
            <label>入力
              <select aria-label={`${a.id} の入力節点`} disabled={readOnly} value={e.input ?? ''}
                onChange={(ev) => onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, expect: { ...x.expect!, input: ev.target.value } })))}>
                {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <label>許容差（%、空欄は既定）
            <input aria-label={`${a.id} の許容差`} type="number" step="any" disabled={readOnly} value={e.tolerance === undefined ? '' : e.tolerance * 100}
              onChange={(ev) => onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, expect: { ...x.expect!, tolerance: ev.target.value === '' ? undefined : Number(ev.target.value) / 100 } })))} />
          </label>
        </>
      )}
      <label><input type="checkbox" aria-label={`${a.id} を安全関連`} checked={!!a.safety} disabled={readOnly}
        onChange={(ev) => onChange(updateAnnotation(netlist, a.id, (x) => ({ ...x, safety: ev.target.checked || undefined })))} />安全関連</label>
      <button type="button" disabled={readOnly} onClick={() => onChange(removeAnnotation(netlist, a.id))}>削除</button>
    </li>
  );
}
