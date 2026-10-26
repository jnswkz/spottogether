# 🎧 SpotTogether

Web app nghe nhạc Spotify **cùng nhau, đồng bộ real-time** (kiểu B).

Mỗi người nghe trên máy/tài khoản Spotify **của chính họ**. App không stream nhạc — nó chỉ
đồng bộ *trạng thái phát* (bài nào, giây thứ mấy, play/pause). Khi **Host** đổi bài hoặc tua,
tất cả người trong phòng tự nhảy theo.

> ⚠️ **Bắt buộc Spotify Premium** cho mọi người tham gia (do Web Playback SDK + lệnh điều
> khiển playback chỉ hoạt động với Premium).

---

## Kiến trúc

```
Trình duyệt mỗi người                     Server (Node)
┌────────────────────────┐                ┌──────────────────┐
│ OAuth PKCE (đăng nhập)  │                │ Express (tĩnh)   │
│ Web Playback SDK (phát) │ ◄── Socket.io ─► │ Socket.io rooms  │
│ Web API (play/seek)     │                │ (host = nguồn    │
└────────────────────────┘                │  trạng thái)     │
        ▲                                  └──────────────────┘
        │ phát nhạc trực tiếp từ Spotify (không qua server)
   ☁ Spotify
```

- **Host** là người vào phòng đầu tiên. SDK báo trạng thái → server → broadcast cho cả phòng.
- **Người nghe** nhận trạng thái và gọi Web API để khớp theo (có bù trừ độ trễ mạng).

---

## Thiết lập trên Spotify Developer Dashboard

1. Vào https://developer.spotify.com/dashboard → **Create app**.
2. Mục **Redirect URIs** thêm chính xác:
   ```
   http://127.0.0.1:3000/callback
   ```
   (Dùng `127.0.0.1`, **không** dùng `localhost` — Spotify bắt buộc cho http loopback.)
3. Ở **APIs used**, chọn **Web API** và **Web Playback SDK**.
4. Copy **Client ID**.
5. Vào tab **User Management**, thêm **email** của từng người sẽ tham gia.
   - App ở **Development mode** nên **chỉ tối đa ~25 người** và phải được thêm thủ công.
   - Ai không có trong danh sách sẽ bị chặn ngay khi đăng nhập.

---

## Chạy

```bash
npm install
```

Copy `.env.example` thành `.env` và điền `SPOTIFY_CLIENT_ID`:

```bash
cp .env.example .env
```

```bash
npm start
```

Mở **http://127.0.0.1:3000** (nhớ đúng `127.0.0.1`, khớp redirect URI).

### Thử đồng bộ
1. Mỗi người mở trang, bấm **Đăng nhập Spotify** (tài khoản Premium).
2. Nhập cùng một **mã phòng** rồi **Vào phòng**.
3. Host dán link một bài Spotify (chuột phải bài hát → Chia sẻ → Sao chép link) và bấm
   **Phát cho cả phòng** → mọi người cùng nghe.

---

## Deploy miễn phí lên Render

App cần server Node chạy liên tục (Socket.io/WebSocket) nên **không** hợp Vercel/Netlify.
Dùng **Render** (free, có HTTPS, không cần thẻ).

1. Push repo này lên GitHub (đã làm nếu bạn dùng script).
2. Vào https://render.com → **New +** → **Web Service** → chọn repo này.
3. Cấu hình:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Mục **Environment**, thêm biến:
   - `SPOTIFY_CLIENT_ID` = Client ID thật của bạn
   - `SPOTIFY_REDIRECT_URI` = `https://<ten-app>.onrender.com/callback`
5. Trên **Spotify Dashboard** → thêm đúng URL `https://<ten-app>.onrender.com/callback`
   vào Redirect URIs.
6. Deploy. App chạy ở `https://<ten-app>.onrender.com`.

> Render free **ngủ sau ~15 phút** không dùng; lần vào đầu chờ ~50s khởi động lại.

## Giữ-thức theo lịch (chống ngủ)

Repo có sẵn `.github/workflows/keep-awake.yml`: ping app mỗi 10 phút,
**chỉ Thứ 2–6, 08:00–21:00 giờ VN** (đã quy đổi sang UTC trong file).

Bật nó lên:
1. Vào repo trên GitHub → **Settings** → **Secrets and variables** → **Actions** → tab **Variables**.
2. **New repository variable**: tên `PING_URL`, giá trị `https://<ten-app>.onrender.com/healthz`.
3. Xong. Muốn test ngay: tab **Actions** → **keep-awake** → **Run workflow**.

Lưu ý:
- Lịch cron GitHub đôi khi chạy trễ vài phút (bình thường).
- Repo **public** → Actions miễn phí không giới hạn. Repo **private** → tính phút, lịch này
  ~1700 phút/tháng (sát trần 2000); khi đó nên dùng **cron-job.org** thay thế (tạo cron-job trỏ
  tới `/healthz`, chọn T2–T6 và khung giờ 08–21h).
- Workflow tự tắt sau 60 ngày nếu repo không có commit mới.

## Giới hạn đã biết của MVP (hướng nâng cấp)

- **Trạng thái lưu trong RAM** → restart server là mất phòng. Nâng cấp: Redis/DB.
- **Đồng bộ dựa trên đồng hồ client vs server** → lệch nhẹ. Nâng cấp: đo offset đồng hồ
  (kiểu NTP) + heartbeat định kỳ để re-sync.
- **Chưa có hàng đợi (queue)** — host phát từng bài. Nâng cấp: playlist chung + vote.
- **Pause rồi play lại có thể giật nhẹ** ở người nghe (do phát lại từ URI). Có thể tối ưu
  bằng cách chỉ `seek`/`pause` khi cùng bài.
- **Chưa làm mới token nền cho SDK dài hạn** ngoài cơ chế refresh khi gọi API.

## Bảo mật
- Chỉ dùng **PKCE**, không có `client_secret` ở client → an toàn để chạy phía trình duyệt.
- Không lưu/tải nhạc, không vượt giới hạn Spotify ToS.
