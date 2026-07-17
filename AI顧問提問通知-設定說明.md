# 📣 AI 顧問提問通知 — 設定說明

只要有人（組長/主管）在 AI 顧問提問，系統就會寄 email 通知管理員（黃柏翰，可加多個收件人，包含你自己）。

運作方式：AI 顧問頁面偵測到使用者提問 → 透過 EmailJS 寄信。同一位主角 30 分鐘內只寄一封，期間累積的提問會列在下一封信裡（不轟炸信箱）。設定填一次即可，會透過雲端同步到全公司裝置。

## 一、申請 EmailJS（免費 200 封/月，約 5 分鐘）

1. 到 https://www.emailjs.com 註冊帳號（用公司 Gmail 即可）
2. 左側 **Email Services → Add New Service → Gmail** → 連結你的 Gmail → 記下 **Service ID**（形如 `service_xxxxxxx`）
3. 左側 **Email Templates → Create New Template**，照下面「二」設定 → 記下 **Template ID**（形如 `template_xxxxxxx`）
4. 右上角 **Account → General** → 記下 **Public Key**

## 二、Template 內容（直接照抄）

**Settings 分頁：**

- To Email 欄位填：`{{to_email}}`
- Subject 填：`【AI 顧問】{{char_name}} 提問了 — {{feature}}`

**Content（內文）填：**

```
{{char_name}} 在 {{time}} 於「{{feature}}」提問：

{{question}}

{{recent}}

查看完整對話紀錄：{{admin_url}}
```

## 三、回到系統填設定

1. 打開 **admin-ai-chats.html**（AI 顧問中心 — 對話紀錄）
2. 點開最上方的 **「📣 提問通知設定」** 面板
3. 填入：
   - 啟用：**開啟**
   - 收件人 Email：黃柏翰的信箱（要自己也收一份就用逗號加上，例如 `bohan@xxx.com, ham15154321@gmail.com`）
   - 節流：30（分鐘，可調）
   - Service ID / Template ID / Public Key：貼上第一步記下的三個值
4. 按 **💾 儲存設定** → 按 **🧪 寄一封測試信** 確認收得到

完成。之後任何人在 AI 顧問提問，黃柏翰（和你）就會收到通知信。

## 常見問題

- **收不到測試信？** 檢查垃圾信匣；確認 Template 的 To Email 是 `{{to_email}}` 而不是寫死的信箱；三個 ID 有沒有貼錯。
- **想換收件人/暫停通知？** 回 admin-ai-chats.html 的設定面板改，儲存即可（會自動同步到所有裝置）。
- **200 封/月夠嗎？** 有 30 分鐘節流，正常使用量夠。不夠時可把節流調大（例如 60 分鐘），或升級 EmailJS 方案。
- **工程師備用：** 也可在 AI 顧問頁面 console 執行 `aiNotify.status()` 看設定、`aiNotify.test()` 寄測試信。
