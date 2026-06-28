# gas-notion-paper

arxiv の論文 URL を Notion に登録すると、Gemini API で自動要約して Notion に書き込む Google Apps Script (GAS)

## セットアップ

### 1. API キーの準備

- GEMINI_API_KEY
- NOTION_API_TOKEN
- DATABASE_ID

### 2. GAS スクリプトの設定

`src/main.js` を GAS エディタにコピーする。  
`.env` の値をスクリプト先頭の const 宣言に反映

### 3. 実行

GAS エディタで実行する関数として `main` を選択して実行
