import { useState } from 'react';
import { buildRequest, parseResult } from '../core/extraction';
import { type Netlist } from '../core/netlist';
import { parseProject, serializeProject, type Project, type ProjectImage } from '../core/project';

/** ファイルを文字列として読む（FileReader は古いブラウザ実装や jsdom でも動く）。 */
export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  image: ProjectImage | null;
  buildProject: () => Project;
  onOpen: (p: Project) => void;
  onDraftFromAi: (n: Netlist) => void;
}

export function ProjectPanel({ image, buildProject, onOpen, onDraftFromAi }: Props) {
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<string[]>([]);

  return (
    <section className="project">
      <h3>保存と読込</h3>
      <p className="warn">保存ファイルの管理は利用者の責任です。ファイルには回路図の画像と回路情報が含まれます。</p>
      <div className="row">
        <button type="button" onClick={() => download('circuit-review.json', serializeProject(buildProject()), 'application/json')}>
          保存（JSON をダウンロード）
        </button>
        <label className="file-btn">
          開く（JSON を選ぶ）
          <input
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="open-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = parseProject(await readText(f));
              if (r.ok) {
                setMessage([]);
                onOpen(r.value);
              } else setMessage(r.errors);
            }}
          />
        </label>
      </div>
      {message.length > 0 && <ul className="error-list" role="alert">{message.map((m) => <li key={m}>{m}</li>)}</ul>}

      <h3>AI による抽出（利用者の Claude Code で実行）</h3>
      <p className="warn">
        抽出依頼ファイルには回路図の画像が含まれます。このファイルを外部の AI（Claude Code）に渡すと、回路図が外部に送られます。送信は利用者の操作で行ってください。アプリ自身は外部 API を呼びません。
      </p>
      <label>
        <input type="checkbox" aria-label="外部 AI に送信することを承認" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        回路図を外部 AI に送信することを承認します
      </label>
      <div className="row">
        <button
          type="button"
          disabled={!consent || !image}
          onClick={() => image && download('extraction-request.json', buildRequest(image), 'application/json')}
        >
          抽出依頼を書き出す
        </button>
        <label className="file-btn">
          抽出結果を読み込む（下書きになります）
          <input
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="result-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = parseResult(await readText(f));
              if (r.ok) {
                setMessage([]);
                onDraftFromAi(r.value);
              } else setMessage(r.errors);
            }}
          />
        </label>
      </div>
    </section>
  );
}
