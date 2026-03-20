# ChatGPT Playwright セレクタ修正依頼

## 状況

chatgpt-brain の Playwright スクリプトが ChatGPT の UI 変更によりセレクタを見つけられずエラーになりました。
添付のスクリーンショット（現在の画面状態）と HTML ソース（実際の DOM 構造）を確認し、
セレクタファイルを修正してください。

---

## エラー情報

```json
{{ERROR_JSON}}
```

---

## 修正対象ファイル

ファイルパス: `{{SELECTOR_FILE_PATH}}`

```typescript
{{SELECTOR_FILE_CONTENT}}
```

---

## 現在の DOM（HTML ソース）

ファイルパス: `{{HTML_PATH}}`

```html
{{HTML_CONTENT}}
```

---

## 修正指示

1. スクリーンショット（添付画像）で現在の画面状態を確認する
2. HTML ソースで実際の DOM を確認し、以下の要素を特定する:
   - モデル選択トリガーボタン（`MODEL_SELECTORS.triggerButton`）
   - モデル選択モーダル本体（`MODEL_SELECTORS.modal`）
3. `MODEL_MAP` のラベル文字列が実際の UI 表示と一致するか確認・修正する
4. ロジック（`selectModel` 関数）は変更せず、定数定義のみを修正する

---

## 出力形式

以下の形式で出力してください（それ以外の説明文は不要）:

### 変更理由
（1〜2文で何が変わっていたかを説明）

### 修正後のコード
修正対象ファイルの **全文** を出力してください:

```typescript
（修正後のファイル全文をここに）
```

### 適用コマンド
```bash
cp {{SELECTOR_FILE_PATH}}.bak {{SELECTOR_FILE_PATH}}.bak  # 自動でバックアップ済み
```
