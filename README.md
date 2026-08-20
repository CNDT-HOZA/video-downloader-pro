# ⚡ Pro Video Downloader

Tải video từ **YouTube, TikTok, Douyin, Facebook, Instagram, Twitter/X** và **1000+ nền tảng khác**.

---

## 📥 Cài đặt

### Cách 1: Tải file .exe

1. Vào trang **[Releases](../../releases/latest)** hoặc tải trực tiếp từ nhánh `App`
2. Tải `Pro_VideoDownloader.exe` — chạy trực tiếp, không cần cài

> ⚠️ Windows SmartScreen có thể cảnh báo "Unknown Publisher" → **More info** → **Run anyway**.

### Cách 2: Chạy từ source

```bash
pip install -r requirements.txt
python app.py
```

---

## ✨ Tính năng

| Tính năng | Mô tả |
|-----------|-------|
| ▶ **Tải Video** | Dán link → chọn chất lượng → tải |
| ⏬ **Tải Hàng Loạt** | Dán nhiều link, tải lần lượt |
| 📡 **Quét Kênh** | Quét toàn bộ video của kênh/playlist rồi tải |
| 🎵 **Trích xuất MP3** | Chỉ lấy phần audio (cần FFmpeg) |
| 📁 **Chọn thư mục lưu** | Nhớ lại cho lần sau |
| 🍪 **Cookie Instagram** | Nút `IG LOGIN` — dùng cookie trình duyệt hoặc nạp `cookies.txt` |
| 🌐 **Tự động Proxy** | Tự động lấy proxy & xoay vòng IP vượt chặn Bot check / 403 / IP limit |
| 🎬 **Chuyển mã dựng phim** | Tự đổi VP9/AV1 sang H.264 để Premiere đọc được |

### 🎬 Dựng phim bằng Premiere / Vegas / After Effects

YouTube chỉ phát 1440p và 2160p ở codec **VP9** hoặc **AV1** — hai codec mà
Premiere không đọc được. Không có cách "đổi vỏ" để né: muốn dựng thì **bắt buộc
mã hoá lại**. Ô "🎬 Dựng phim" ở dưới cửa sổ lo việc đó ngay sau khi tải xong.

| Chế độ | Dùng khi | Tốc độ (4K) | Dung lượng |
|---|---|---|---|
| **Không chuyển** | Chỉ xem, hoặc đăng lại lên mạng xã hội | — | nhỏ nhất |
| **H.264 — GPU** | Có card NVIDIA. Lựa chọn cho hầu hết mọi người | nhanh hơn thời gian thật | ~400 MB/phút |
| **H.264 — CPU** | Không có NVIDIA, hoặc muốn file nhỏ hơn | chậm hơn | ~220 MB/phút |
| **DNxHR HQ** | Dựng chuyên nghiệp, cần tua thật mượt | trung bình | ~5 GB/phút |

App **tự kiểm tra codec trước**: file đã là H.264 thì giữ nguyên, không đụng
vào — nên tải 1080p trở xuống sẽ không mất thời gian và không mất chất lượng.

**Chất lượng thực đo** (nguồn VP9 4K, so bằng VMAF — 100 là trùng khít, trên 95
là mắt thường không phân biệt được):

| | Dung lượng | VMAF |
|---|---|---|
| H.264 GPU (NVENC cq18) | 32.6 MB | **98.3** |
| H.264 CPU (x264 crf16) | 18.7 MB | **97.1** |
| *Bộ convert thông thường ở 8 Mbps* | *5.4 MB* | *88.0* |

Nếu GPU lỗi (driver cũ, độ phân giải lạ), app tự lùi về CPU. File gốc chỉ bị xoá
sau khi bản mới hoàn tất — chuyển mã hỏng thì bạn vẫn còn nguyên bản tải về.

### Chất lượng hỗ trợ

Tốt Nhất (Best) • 4K 2160p • 2K 1440p • 1080p • 720p • 480p • Chỉ Lấy Nhạc (MP3)

---

## 💡 Yêu cầu

**Chỉ cần Windows 10/11 (64-bit).** Không cần cài Python hay thư viện gì — copy
file `.exe` sang máy khác là chạy.

### FFmpeg — app tự lo

Lúc mở app, nó tự tìm FFmpeg theo thứ tự: **cạnh file exe** → **thư mục dữ liệu
riêng** → **PATH của hệ thống**.

Nếu không thấy, app hỏi một câu và tự tải bản chính thức về (110 MB). Cụ thể:

- Tải từ một **bản phát hành cố định** trên GitHub, URL và phiên bản đã pin trong code
- **Đối chiếu SHA256** với giá trị nhúng sẵn — sai một bit là xoá file, không chạy
- Giải nén vào `%USERPROFILE%\.pro_video_downloader\ffmpeg\` — **không cần quyền
  admin, không sửa PATH, không đụng gì tới hệ thống**
- Bỏ `ffplay.exe` (~100 MB) vì app không dùng tới

Chọn "Không hỏi lại" thì app sẽ không nhắc nữa.

**Không có FFmpeg thì sao?** App vẫn chạy, chỉ tải được file đã gộp sẵn hình +
tiếng:

| | Ảnh hưởng |
|---|---|
| YouTube | Tụt xuống **360p** — chỉ còn một format gộp sẵn |
| TikTok, Facebook, Instagram, Twitter/X | Gần như không ảnh hưởng |
| MP3 | Không ra `.mp3`, chỉ ra `.webm` / `.m4a` |

Dưới tiêu đề app sẽ hiện `chưa có FFmpeg` màu vàng khi thiếu.

---

## 🔨 Build .exe

```bash
BUILD_APP.bat
```

Script này cài dependency → **chạy test** → nếu test fail thì dừng, không build → đóng gói bằng PyInstaller vào `dist/`.

---

## 🧪 Chạy test

```bash
python -m unittest test_app -v
```

36 test cho phần logic thuần: tách link, chuẩn hoá URL Douyin, làm sạch tên file,
nhận diện nền tảng, đọc JSON của resolver, tính nhất quán của bảng định dạng.

---

## 🔧 Cấu hình nâng cao (tuỳ chọn)

App lưu cấu hình tại `%USERPROFILE%\.pro_video_downloader\config.json`.

Nếu Instagram chặn, có thể trỏ app sang một **resolver ngoài** do bạn tự dựng —
xem [instagram_resolver_example.json](instagram_resolver_example.json). Cũng có thể
dùng biến môi trường `COBALT_API_URL` / `INSTAGRAM_RESOLVER_URL`.

App **không tự cài hay tự chạy** bất cứ phần mềm nào — bạn phải tự khai báo endpoint.

---

## 📋 Changelog

### v2.2.0
- **Chuyển mã cho dựng phim**: tự đổi VP9/AV1 sang H.264 (GPU NVENC hoặc CPU
  x264) hoặc DNxHR, ngay sau khi tải. Đo được VMAF 97–98 — mắt thường không
  phân biệt được với bản gốc.
- Kiểm tra codec trước: đã là H.264 thì bỏ qua, không mã hoá lại vô ích.
- GPU lỗi thì tự lùi về CPU. Bản gốc chỉ xoá sau khi bản mới xong.
- Cửa sổ rộng hơn cho vừa hàng tuỳ chọn mới.

### v2.1.0

**🔴 Sửa lỗi lớn: chọn "Tốt Nhất" hoặc "4K" nhưng chỉ tải về Full HD**

Chuỗi format cũ ép container mp4:

```
bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best
```

YouTube chỉ phát 1440p và 2160p dưới dạng **WebM/VP9**; mp4 dừng ở 1080p (trừ
video có AV1). Nhánh mp4 vẫn khớp ở 1080p nên yt-dlp **không bao giờ chạy tới
nhánh dự phòng** — kết quả là chọn 4K vẫn ra 1080p.

Đã bỏ ràng buộc container khỏi chuỗi format, chuyển ưu tiên mp4 sang
`format_sort = ['res', 'ext:mp4:m4a']` — độ phân giải xét trước, mp4 chỉ dùng
để phá hoà khi hai format cùng độ phân giải. Có test cố định chặn tái phát.

**Báo rõ độ phân giải thực nhận được**

App giờ hiện `🎞 Độ phân giải: 4K` sau khi tải. Nếu bạn chọn 4K mà video gốc
không có, nó nói thẳng: *"Bạn chọn 4K (2160p) nhưng video gốc chỉ có tối đa
1080p."* — thay vì im lặng để bạn tưởng app chọn sai.

**Tự cài FFmpeg, không hỏi**

- Mở app, thiếu FFmpeg thì **tự tải luôn ở nền**, không có hộp thoại nào
- **Không khoá nút** — vẫn tải video được bình thường trong lúc FFmpeg đang về
- Tải từ bản phát hành GitHub đã pin, **đối chiếu SHA256** rồi mới giải nén
- Cài vào thư mục dữ liệu riêng — không cần admin, không sửa PATH
- Xong thì bảng chất lượng và nhãn tiêu đề **đổi ngay**, khỏi khởi động lại
- Tìm `ffmpeg.exe` cạnh file exe trước tiên, nên chỉ cần đặt cạnh app là xong

**Khác**
- Truyền `ffmpeg_location` cho yt-dlp (chỉ tìm thấy file thôi là chưa đủ)
- Bỏ "by Hoàng Đức" khỏi tiêu đề cửa sổ

### v2.0.0
Rút gọn về đúng chức năng cốt lõi. **Đã gỡ bỏ:**

- Tracking Google Sheet (gửi device ID lên server mỗi lần mở app / tải xong)
- Bộ đếm "lượt sử dụng" và biểu đồ 30 ngày
- Tự động tải & cài đè file `.exe` từ GitHub Releases mà không xác minh chữ ký
- Tự động `git clone` và chạy ngầm cobalt (kèm `pnpm install`)
- Mời cafe / QR chuyển khoản / danh sách donor
- Chữ chạy (marquee), lịch sử tải, tải thumbnail
- Theo dõi clipboard ngầm mỗi 0.9 giây

**Sửa lỗi:**

- Nút bấm không còn được bật lại khi tác vụ khác đang chạy → không còn hai
  luồng tải chồng lên nhau
- Chỉ số `[i/n]` trên thanh trạng thái hiển thị đúng số thứ tự
- Thay `except:` trần bằng `except Exception:` (không còn nuốt Ctrl+C)
- Cửa sổ đổi được kích thước, có kích thước tối thiểu
- Pin phiên bản `yt-dlp` và `customtkinter` để build tái lập được
- Thay `test_app.py` (chỉ tìm chuỗi trong source, luôn báo pass) bằng test thật

**Kết quả:** `app.py` từ 1906 → 1212 dòng, bỏ phụ thuộc `pillow` khi chạy.

Các file đã gỡ được chuyển vào `_da_go_bo/` (kể cả `real_qr.png`) — xoá thư mục
đó khi bạn chắc không cần nữa.

### v1.9.x
Xem lịch sử cũ trong `_da_go_bo/`.

---

## ⚖️ Lưu ý

Công cụ này dành cho việc tải nội dung bạn có quyền tải. Việc tải nội dung có
bản quyền có thể vi phạm điều khoản dịch vụ của nền tảng và luật bản quyền —
người dùng tự chịu trách nhiệm.

---

## 📞 Liên hệ

**Dev:** Hoàng Đức — [facebook.com/ducserving](https://www.facebook.com/ducserving)
