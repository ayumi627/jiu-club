# 🍯 揪是有局：多人團購／儲值／記帳網頁 App

這是一個可以自行部署的 **Next.js + Supabase + Gemini** Web App 專案，**不是已上線服務**。手機與桌面瀏覽器皆可使用；部署後會得到正式網址。

## 已實作功能

- Email 密碼註冊登入、Google OAuth（須在 Supabase/Google Cloud 設定）
- 每位使用者可建立自己的團並成為管理員，分享邀請碼讓他人加入，資料依團隔離
- 團主開團，設定店家與截止時間，手動新增商品與售價
- JPG/PNG/WebP 菜單圖片使用 Gemini 辨識品名和價格，人工修改確認後匯入
- 團員購物車下單、訂單總額一次扣款、餘額不足禁止下單、取消退款
- 團員提出儲值申請，**管理員核實實際收到款項** 後審核入帳
- 各團獨立錢包、完整帳務流水、團主報表匯出 CSV
- Supabase Row Level Security 限制資料可見性；敏感寫入使用資料庫 RPC

## 技術架構

```
手機／電腦瀏覽器
       │ HTTPS
       ▼
Vercel：Next.js（網頁 + /api/recognize-menu）
       │                         │
       ▼                         ▼
Supabase Auth / Postgres      Gemini API
  ├ 登入與 Google OAuth        （伺服器端 API 金鑰）
  ├ 團／成員／商品／訂單
  ├ 儲值審核／交易流水
  └ RLS + 原子扣款函式
```

**沒有串接金流**；使用者在系統外轉帳／付現，團主收到款項後手動審核。此專案不代收或託管款項。

## 1. 建立 Supabase 雲端資料庫

1. 於 https://supabase.com 建立 Project。
2. 打開 **SQL Editor**，貼上並執行 `supabase/migrations/001_init.sql`（只執行一次）。
3. 在 **Authentication → Providers** 啟用 Email。建議開啟 Email confirmation，並設定正式寄信 SMTP 供公眾註冊使用。
4. 在 **Authentication → URL Configuration**：Site URL 設為正式網址，例如 `https://YOUR-APP.vercel.app`；Redirect URLs 至少加入 `https://YOUR-APP.vercel.app/**`，開發時可加入 `http://localhost:3000/**`。
5. 在 **Project Settings → API** 取得 Project URL、publishable/anon key。**切勿把 service_role key 放在 NEXT_PUBLIC_ 變數中。**

## 2. 啟用 Google 登入

1. 到 https://console.cloud.google.com 建立專案，設定 OAuth consent screen（正式公開使用時需依 Google 要求配置應用程式資訊與驗證）。
2. 建立 OAuth Client ID（Web application）。
3. Authorized redirect URI 設為 **Supabase 提供的 OAuth callback URL**，通常為 `https://YOUR_PROJECT.supabase.co/auth/v1/callback`；以 Supabase 後台顯示為準。
4. 在 Supabase → Authentication → Providers → Google 填入 Google Client ID/Secret，啟用 Google。
5. Google OAuth Client 的 authorized JavaScript origins 可加入你的正式網站來源。登入後頁面將返回 `window.location.origin`。

## 3. 啟用菜單圖片辨識

1. 於 https://aistudio.google.com 取得 Gemini API key（請先確認帳戶、配額、計費、隱私條款是否符合使用情境）。
2. 環境變數 `GEMINI_API_KEY` 設為該私密金鑰，**不可加 `NEXT_PUBLIC_` 前綴**。
3. 預設模型 `gemini-2.5-flash`，可用 `GEMINI_MODEL` 覆寫。請以 Google 當下實際支援的模型和帳戶權限為準。
4. 登入狀態下才能呼叫辨識 API。圖片只送至伺服器及 Gemini API，不寫入本專案資料庫；使用者必須檢查辨識結果。

## 4. 本機啟動

建議 Node.js 20.9+（Node.js 22 LTS 亦可）。

```bash
npm install
cp .env.example .env.local
# 編輯 .env.local，填入 Supabase URL、anon key、Gemini API Key
npm run dev
```

開啟 http://localhost:3000 。

## 5. 部署至 Vercel，取得多人共用網址

1. 把整個專案推送至 GitHub（不要上傳 `.env.local`）。
2. 到 https://vercel.com → Add New → Project，匯入此 GitHub Repository。
3. Framework Preset 選 Next.js，在 Environment Variables 設定：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`（非必填）
4. 按 Deploy，完成後將 Vercel 網址填到 Supabase Authentication 的 Site URL / Redirect URLs。
5. 用兩個不同帳戶、兩台裝置測試：新建團 → 邀請加入 → 儲值申請 → 審核 → 下單 → 取消退款 → CSV 匯出。
6. 如要自訂網域，在 Vercel Domains 設定 DNS 並更新 OAuth Redirect URLs。

## 權限表

| 操作 | 未登入 | 團員 | 團管理員 |
|---|---:|---:|---:|
| 建團、加入團 | 否 | 是 | 是 |
| 查看所加入團菜單 | 否 | 是 | 是 |
| 建立團購、匯入商品 | 否 | 否 | 是 |
| 使用自己的儲值餘額下單 | 否 | 是 | 是 |
| 提出自己儲值申請 | 否 | 是 | 是 |
| 審核團員儲值 | 否 | 否 | 是 |
| 查看全團儲值及帳本 | 否 | 否 | 是 |
| 查看自己訂單和流水 | 否 | 是 | 是 |
| 取消自己的訂單 | 否 | 截止前 | 是（含截止後） |

## 注意：正式營運前需要補強的項目

此版本可部署作為 **MVP／小規模試營運**，不是已完成第三方安全稽核的商用金流系統。

1. **儲值不是支付交易**：付款由團主線下收取；應建立退款、團主交接、爭議處理和個資告知機制。若面向公眾提供儲值服務，請確認所在地涉及的預付價金、電子支付、稅務與消費者保護規範；避免未經評估即營運跨人頭收付。
2. **公開使用與流量控管**：建議對 `/api/recognize-menu` 加上 Redis/Upstash 或平台級 rate limiting、使用量額度，以及濫用監控（目前僅驗證登入和圖片大小）。AI API 成本由部署者負擔。
3. **備份與安全**：開啟 Supabase 備份策略、建立監控和異常告警；邀請碼可轉傳，無法取代受邀者身分審核。
4. **帳務限制**：目前沒有手動退款到外部銀行、轉讓團主、移除團員、忘記密碼 UI、匯出訂單明細、商品規格／加料／備註與購物車草稿跨裝置同步。支援訂單取消返還**系統錢包**，不等於退回真實款項。
5. **照片辨識風險**：圖片上傳經過第三方 Gemini；不要上傳包含個人敏感資訊的照片。辨識結果可能誤判，務必人工確認。
6. **匯入部分成功**：AI 菜單匯入逐筆建立，若中間失敗，先前成功的商品仍會保留，重新匯入前請檢查重複項目。
7. **Email 身分驗證**：對公開註冊請啟用 email confirmation、密碼政策、垃圾帳號防護與適當的寄信額度。
8. **資料庫更新**：SQL migration 只設計給空白新專案執行；不要在已存在同名資料表的專案重複執行。

## 主要目錄

- `app/page.tsx`：主操作介面
- `app/api/recognize-menu/route.ts`：Gemini 圖片辨識 API
- `supabase/migrations/001_init.sql`：資料表、權限政策與帳務 RPC
- `lib/supabase.ts`：瀏覽器 Supabase client
- `.env.example`：環境設定範本

## 首次測試建議

使用 A、B 兩個帳號：A 建立團，B 用邀請碼加入；B 申請 500 元儲值；A 確認後 B 下單 120 元，應剩 380 元；B 取消訂單後，應回復 500 元。再建立另一個團，檢查兩團帳本及餘額沒有共用。
