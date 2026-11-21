# 香港交通地圖

打開就是一幅可拖動的香港地圖。地圖用 [OpenFreeMap](https://openfreemap.org/) 作底圖，畫上十條有實時班次的港鐵重鐵綫，以及運輸署的交通快拍點。

- 點選車站，查看即將到站的班次、月台和預計分鐘。
- 點選快拍點，查看該處最新照片。
- 轉車站會列出每條經過的路綫。
- 暫時沒有班次、連不上資料，或照片載入不到時，畫面會直接說明。

輕鐵和高鐵沒有列入港鐵這份實時班次資料，所以地圖不畫這兩種鐵路。

## 本地預覽

```bash
npm install
npm test
npm run dev
```

開發伺服器會在連接埠 4731 啟動。

## 資料

| 內容 | 來源 |
| --- | --- |
| 底圖 | OpenFreeMap 公開樣式 `liberty` |
| 路綫次序 | [港鐵路綫及車站表](https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv) |
| 馬場站 | 港鐵實時班次 API 有這站，路綫表沒有，地圖補上 |
| 車站座標 | 地政總署 iGeoCom 鐵路站，由香港 1980 方格網轉成經緯度 |
| 路綫形狀 | OpenStreetMap 的港鐵軌道，路綫順著真實彎道 |
| 到站班次 | `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php` |
| 快拍位置和照片 | [運輸署交通情況快拍圖像](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images) |

車站和路綫已整理在 `src/data/network.json`。要重造這份檔案，先下載 iGeoCom 的 CSV，存成 `data/iGeoCOM_POI.csv`。地政總署的下載網站有時不附上中繼憑證，瀏覽器可以下載，這台預設的憑證庫則可能拒絕。然後安裝座標轉換套件再執行：

```bash
python3 -m venv .venv
.venv/bin/pip install pyproj
npm run network
```

如果 CSV 不在預設位置，可以執行 `npm run network -- --igeocom /路徑/iGeoCOM_POI.csv`。軌道彎度可再用 `python3 scripts/apply_track_shapes.py` 從 OpenStreetMap 更新。

重疊路段（例如中環至金鐘）會左右分開約 48 米，兩種顏色才不會疊成一條。

## 正式發佈

驗收通過之後，才發佈到 Cloudflare Workers 免費方案，使用 `workers.dev` 網址。網站是靜態檔案，班次和快拍由瀏覽器直接向政府網站讀取。

```bash
npm run build
npx wrangler deploy
```

預計費用是 0 元。靜態檔案不計入 Workers 每日 10 萬次請求。不使用自訂網域、資料庫或付費地圖。若 Cloudflare 帳戶本身已是 Workers 付費計劃，帳戶最低月費是 5 美元，那是帳戶原有收費。
