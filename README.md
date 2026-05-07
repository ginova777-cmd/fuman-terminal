# 輔滿股票終端

深色股票終端介面，前端顯示市場總覽、強勢排行、熱力圖與策略中心；後端 API 透過 Vercel Serverless Function 抓取 TWSE 官方公開資料。

## 本機預覽

目前可以直接打開 `index.html` 看畫面，但真實資料 API 需要透過 Vercel 或 `vercel dev` 執行。

```powershell
npm i -g vercel
vercel dev
```

開啟：

```text
http://localhost:3000
```

## 部署

```powershell
vercel --prod
```

部署後前端會優先抓：

```text
/api/market
```

若 API 暫時無法連線，畫面會自動顯示內建展示資料，避免空白。
