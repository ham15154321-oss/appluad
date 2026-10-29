# 面談檢核 → Google 試算表自動寫入（設定一次就好）

這是一支新的 Apps Script，跟你原本那支完全分開，不會動到它。不叫 AI、不花 token。

## 一、建試算表、貼程式（約 3 分鐘）

1. 開一份新的 Google 試算表，取名「面談檢核資料庫」
2. 上方選單：擴充功能 → Apps Script
3. 把編輯器裡原本的內容全部刪掉，貼上第三段的程式碼
4. 按儲存（磁碟片圖示）。不用改任何字，這版不需要密語

## 二、部署成網址

1. 右上角「部署」→「新增部署作業」
2. 齒輪選「網頁應用程式」
3. 執行身分：我（你的 Google 帳號）
4. 誰可以存取：任何人
5. 按「部署」，第一次會要你授權，照畫面按允許
6. 複製出現的「網頁應用程式網址」（https://script.google.com/macros/s/……/exec）

「任何人」的意思是知道網址的人可以往裡面加列，但讀不到、也刪不掉試算表裡的資料。網址不要貼到公開的地方。

## 三、程式碼（整段貼上）

```javascript
var SECRET = '';   // 不用密語就留空；想加密語就填在引號裡，網頁設定也要填一樣的
var SHEET_ID = '';  // 試算表網址 /d/ 和 /edit 中間那一串；填了就一定寫進那份試算表

function getBook() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// 用瀏覽器打開網址就能確認：會寫進哪一份試算表
function doGet() {
  var ss = getBook();
  return ContentService.createTextOutput(ss ? ('ok：會寫進「' + ss.getName() + '」') : '找不到試算表：請在 SHEET_ID 填試算表 ID');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    if (SECRET && data.key !== SECRET) return ContentService.createTextOutput('密語不對');
    var ss = getBook();
    if (!ss) return ContentService.createTextOutput('找不到試算表：請在 SHEET_ID 填試算表 ID');
    var sheets = data.sheets || {};
    Object.keys(sheets).forEach(function (name) {
      var rows = sheets[name] || [];
      if (!rows.length) return;
      var sh = ss.getSheetByName(name) || ss.insertSheet(name);
      var head = (data.head && data.head[name]) || [];
      if (sh.getLastRow() === 0 && head.length) {
        sh.appendRow(head);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
      }
      var width = 0;
      rows.forEach(function (r) { if (r.length > width) width = r.length; });
      var values = rows.map(function (r) {
        var out = r.slice();
        while (out.length < width) out.push('');
        return out.map(function (v) { return typeof v === 'string' ? v.slice(0, 49000) : v; });
      });
      sh.getRange(sh.getLastRow() + 1, 1, values.length, width).setValues(values);
    });
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('錯誤：' + err);
  } finally {
    lock.releaseLock();
  }
}
```

## 四、接到面談檢核

1. 開太空基地 → 星際廣場 → 面談能力檢核
2. 右上角「⚙ 設定」（只有柏翰看得到）
3. 「Google 試算表自動寫入網址」貼上第二段複製的網址，「密語」留空
4. 按「測試試算表」，回到試算表看有沒有多一個「連線測試」分頁，有就成功了
5. 按「儲存」，全公司之後每一次檢核、回饋、改判都會自動多寫一列

## 會寫進哪些分頁

| 分頁 | 一列是什麼 |
|---|---|
| 檢核總表 | 一次檢核：分數（含改判）、AI 原判分數、五個階段、總評、下次要注意、型號、花費 |
| 逐項明細 | 一次檢核裡的一個項目：判定、AI 原判、原話、時間點、理由（最適合做樞紐分析） |
| 主管改判 | 主管每改一次判：AI 判什麼、改成什麼、為什麼 |
| 主管回饋 | 每次回饋：重點、下次要注意 3 件、回饋全文 |
| 逐字稿 | 排好版的全文；超過 4.5 萬字會拆到下一格 |

設定之前的舊紀錄不會自動補寫。要全部資料的話，用頁面最下面的「⬇ 匯出試算表」下載 Excel，再匯入 Google 試算表。
