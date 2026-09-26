# World ID 4.0 検証フロントエンド (webui)

Astro 製のクライアント。`@worldcoin/idkit-core`（v4 系）を使って World ID 4.0 の
検証フローを実行し、結果を verifier worker に転送してバックエンド検証を行います。

## 構成

```text
src/
├── env.d.ts              # PUBLIC_VERIFIER_URL などの型定義
├── layouts/
│   └── Layout.astro      # HTML シェル + グローバルスタイル
├── pages/
│   └── index.astro       # UI（入力フォーム / QR / 状態 / 結果 / エラー）
└── scripts/
    └── idkit-flow.ts     # IDKit 検証フローのクライアントロジック
```

## フロー

1. `POST {verifier}/rp-signature` で RP 署名を取得。
2. `IDKit.request({ app_id, action, rp_context, allow_legacy_proofs, environment })`
   を `.preset(proofOfHuman())` で確定。
3. `request.connectorURI` を QR コードとして描画。
4. `request.pollUntilCompletion({ pollInterval, timeout })` で完了を待機。
5. 成功したら completion（IDKit result）をそのまま
   `POST {verifier}/verify` に送信。
6. verifier の署名付きレスポンス（`signature`・`payload` 等）を表示。

## 設定

`app_id` / `rp_id` / `action` / `environment` は UI 上で入力します。

| 環境変数                | 既定値                  | 説明                                |
| :---------------------- | :---------------------- | :---------------------------------- |
| `PUBLIC_VERIFIER_URL`   | `http://127.0.0.1:8787` | verifier worker のベース URL        |

`.env` に設定するか、ビルド時に環境変数として渡してください。

```sh
PUBLIC_VERIFIER_URL=https://verifier.example.com npm run build
```

## 開発

verifier worker を先に起動しておきます（既定 `http://127.0.0.1:8787`）。

```sh
# webui
npm run dev        # http://localhost:4321
npm run build      # 本番ビルド
npm run astro check
```

> 補足: `astro dev --background` は、依存最適化に時間がかかる環境では
> 既定の 30 秒タイムアウトで起動判定に失敗することがあります。その場合は
> 通常の `npm run dev` を利用してください。
