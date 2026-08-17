# Chuyển sang máy khác

Máy đích **không cần** Node.js, **không cần** Python, không cần quyền Administrator.

## Nội dung file zip

```
Download Video/
├── setup.bat                     ← người dùng chạy file này
├── CHAN-DOAN.bat
├── START_SERVER.bat
├── extension/                    ← toàn bộ thư mục
└── server/
    └── server.exe                ← BẮT BUỘC (build bằng BUILD.bat)
```

Chỉ khoảng **40MB**. Không cần kèm `server/bin/`.

> `server/server.exe` bị `.gitignore` loại ra, nên **chuyển bằng `git clone` sẽ
> thiếu**. Phải nén zip thủ công hoặc tải từ Releases.

## Thư viện được tải tự động

Lần đầu server chạy, nó kiểm tra rồi tự tải những gì còn thiếu vào `server/bin/`:

| Thư viện | Dung lượng tải | Nguồn |
|---|---|---|
| yt-dlp.exe | ~18MB | github.com/yt-dlp |
| ffmpeg.exe + ffprobe.exe | ~178MB | github.com/GyanD/codexffmpeg |
| node.exe | ~35MB | nodejs.org |

Tổng ~230MB, **chỉ tải một lần**. Trong lúc tải, `/api/health` trả về
`status: "installing"` kèm tiến độ, và extension hiện thanh phần trăm.

Nếu máy đích mạng yếu, có thể kèm sẵn `server/bin/` vào zip để bỏ qua bước này —
server thấy có đủ file thì không tải nữa.

`node.exe` dùng làm JS runtime cho yt-dlp khi giải mã YouTube. Thiếu nó thì các
trang khác vẫn tải được, riêng YouTube có thể lỗi.

## Các bước trên máy đích

1. Giải nén **toàn bộ** zip vào thư mục ghi được (Desktop, `D:\…` — **không** đặt
   trong `C:\Program Files`, và tốt nhất **không** đặt trong OneDrive).
2. Chạy `setup.bat` → đăng ký Native Messaging Host vào `HKEY_CURRENT_USER`
   cho Chrome / Edge / Brave / Chromium / Vivaldi / Cốc Cốc / Opera.
3. Mở trình duyệt → `chrome://extensions` → bật **Developer mode** →
   **Load unpacked** → chọn thư mục `extension`.

Server tự khởi động khi trình duyệt kết nối tới native host.

### Tự đăng ký

Từ bản này, **mỗi lần server chạy nó đều tự kiểm tra và đăng ký lại nếu cần**
(`ensureRegistered()` trong `setup-registry.js`, gọi lúc server khởi động).

Nghĩa là:

- Quên chạy `setup.bat`? Bấm đúp `server.exe` một lần là xong.
- Di chuyển hoặc đổi tên thư mục? Chạy `START_SERVER.bat` một lần, liên kết
  được nối lại. Không cần chạy `setup.bat` nữa.
- Registry bị dọn dẹp mất? Lần chạy sau server tự ghi lại.

Chỉ có bước **đầu tiên** là không tự động được: khi registry hoàn toàn trống,
trình duyệt không có gì để gọi, nên phải chạy tay một lần (`setup.bat` hoặc
`server.exe`). Sau lần đó mọi thứ tự duy trì.

> **OneDrive:** nếu buộc phải để trong OneDrive, chuột phải thư mục →
> **"Always keep on this device"**. Với chế độ Files On-Demand, `server.exe` có
> thể chỉ là file đại diện chưa tải về, và trình duyệt sẽ không chạy được nó.

## Server không tự khởi động?

Chạy **`CHAN-DOAN.bat`** — nó kiểm tra registry, manifest, vị trí file, công cụ,
trạng thái server và in ra đúng chỗ đang hỏng. Dòng `Build:` cho biết `server.exe`
đang dùng là bản dựng lúc nào, dùng để đối chiếu xem đã copy đúng bản mới chưa.

Ba nguyên nhân thường gặp, theo thứ tự:

1. **Chưa chạy `setup.bat` trên máy đích** — registry là của từng máy/từng
   tài khoản Windows, không đi theo file zip.
2. **Chạy `setup.bat` rồi mới di chuyển thư mục** — chạy lại `setup.bat`.
3. **`server.exe` là bản cũ** — so dòng `Build:` trong CHAN-DOAN.bat với bản
   dựng mới nhất; nếu cũ thì chạy `BUILD.bat` rồi copy lại.

## Build lại server.exe

Chỉ cần làm trên máy phát triển (máy có Node.js):

```bash
BUILD.bat
```

Sau khi build xong phải chạy lại `setup.bat` để manifest trỏ đúng đường dẫn mới.

## Kiểm tra khi có lỗi

| Kiểm tra | Cách làm |
|---|---|
| Server có chạy không | mở `http://localhost:3847/api/health` |
| Native host có được gọi không | xem `server/host_js.log` |
| Server chết vì lý do gì | xem `server/server.log` |
| Registry đã ghi chưa | `reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.video_downloader.server" /ve` |

`/api/health` trả về `missingTools` — nếu danh sách này khác rỗng thì mở tab
Cài đặt trong extension và bấm **Tải công cụ**.
