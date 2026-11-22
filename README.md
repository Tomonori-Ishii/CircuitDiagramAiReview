# CircuitDiagramAiReview

AIによる回路図のレビュープログラムの作成。コンセプトの可視化が目的でありプロダクト品質ではない。

- 要件: `docs/requirements.md`、機能リスト: `docs/feature-list.json`、ユーザ要求: `docs/user-requirements.json`
- 技術: React + TypeScript + Vite（CON-06）。バックエンドなし、解析と保存はブラウザ内（CON-02）

## 開発

```bash
npm install
npm run dev        # 開発サーバ
npm run test       # 単体・コンポーネント・静的テスト（vitest）
npm run build      # 型検査 + ビルド
```

## 構成

- `src/core/` 解析コア（React 非依存）: MNA ソルバ（DC・AC）、負帰還検査、設計レビュー、FMEA、FTA、検査、保存形式
- `src/ui/` 画面（React）
- `src/test/` テスト用の回路と静的検査

外部 AI への抽出依頼はアプリから送信しません。依頼ファイルを書き出し、利用者が Claude Code で処理して得た結果を読み込みます。
