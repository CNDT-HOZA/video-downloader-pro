"""Pro Video Downloader — bản rút gọn, chỉ còn chức năng tải video.

Đã gỡ: tracking Google Sheet, tự cập nhật .exe, tự tải/chạy cobalt, mời cafe/QR,
danh sách donor, biểu đồ thống kê, chữ chạy, lịch sử, tải thumbnail, theo dõi
clipboard nền.
"""

import base64
import concurrent.futures
import hashlib
import os
import queue
import re
import json
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.parse
import urllib.request
import zipfile
from tkinter import filedialog

import customtkinter as ctk
import yt_dlp

APP_VERSION = "2.3.7"

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def safe_print(text):
    """In an toàn không bao giờ văng lỗi Unicode trên console Windows."""
    try:
        print(text)
    except Exception:
        try:
            print(str(text).encode('ascii', errors='replace').decode('ascii'))
        except Exception:
            pass


APP_DIR = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))


def resource_path(relative_path):
    """Đường dẫn tới file kèm theo, chạy được cả khi dev lẫn khi đã đóng gói."""
    base_path = getattr(sys, '_MEIPASS', None) or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


DOWNLOAD_PATH = os.path.join(os.path.expanduser('~'), 'Downloads', 'VideoDownloader')
DATA_DIR = os.path.join(os.path.expanduser('~'), '.pro_video_downloader')
os.makedirs(DATA_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
INSTAGRAM_COOKIE_FILE = os.path.join(DATA_DIR, 'instagram_cookies.txt')

PLATFORMS = "YouTube • TikTok • Douyin • Facebook • Instagram • Twitter/X • Reddit • Vimeo • Bilibili • 1000+ sites"


# ─────────────────────────────────────────────────────────────
# Cấu hình
# ─────────────────────────────────────────────────────────────

def load_config():
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_config(data):
    try:
        current = load_config()
        current.update(data)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(current, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# FFmpeg
#
# Không có FFmpeg thì yt-dlp không ghép được luồng hình + tiếng, nên YouTube
# tụt xuống 360p và không xuất được MP3. App tự dò, và nếu thiếu thì tải bản
# đã pin sẵn về thư mục dữ liệu riêng — không đụng vào PATH, không cần admin.
# ─────────────────────────────────────────────────────────────

FFMPEG_DIR = os.path.join(DATA_DIR, 'ffmpeg')

# Pin đúng bản phát hành FFmpeg 7.1 ổn định trên GitHub tương thích hoàn toàn
# với mọi card GPU NVIDIA/AMD/Intel và các phần mềm dựng phim.
FFMPEG_URL = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip'
FFMPEG_SHA256 = 'fa7d4d7e795db0e2503f49f105f46ed5852386f0cfdd819899be3b65ebde24fc'
FFMPEG_ZIP_SIZE = 92100272
FFMPEG_WANTED = ('ffmpeg.exe', 'ffprobe.exe')   # bỏ ffplay.exe, tiết kiệm ~100MB

_ffmpeg_path = None


def find_ffmpeg():
    """Tìm ffmpeg.exe: ưu tiên cạnh file app, rồi thư mục dữ liệu đã cài bản 7.1 ổn định, cuối cùng là PATH."""
    for candidate in (os.path.join(APP_DIR, 'ffmpeg.exe'),
                      os.path.join(FFMPEG_DIR, 'ffmpeg.exe')):
        if os.path.isfile(candidate):
            return candidate
    path_exe = shutil.which('ffmpeg')
    if path_exe and os.path.isfile(path_exe):
        return path_exe
    return None


def ffmpeg_path():
    return _ffmpeg_path


def has_ffmpeg():
    return _ffmpeg_path is not None


def refresh_ffmpeg():
    global _ffmpeg_path
    _ffmpeg_path = find_ffmpeg()
    return _ffmpeg_path


def install_ffmpeg(on_progress=None, should_cancel=None):
    """Tải, xác minh SHA256, rồi giải nén ffmpeg.exe + ffprobe.exe.

    Ném RuntimeError nếu checksum sai — file tải về bị xoá, không chạy gì cả.
    """
    os.makedirs(FFMPEG_DIR, exist_ok=True)
    archive = os.path.join(FFMPEG_DIR, '_tai_ve.zip')

    digest = hashlib.sha256()
    req = urllib.request.Request(FFMPEG_URL, headers={'User-Agent': 'ProVideoDownloader'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, open(archive, 'wb') as f:
            total = int(resp.headers.get('Content-Length') or FFMPEG_ZIP_SIZE)
            done = 0
            while True:
                if should_cancel and should_cancel():
                    raise RuntimeError('Đã huỷ tải FFmpeg.')
                chunk = resp.read(524288)
                if not chunk:
                    break
                f.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if on_progress:
                    on_progress(done, total)

        actual = digest.hexdigest()
        if actual != FFMPEG_SHA256:
            raise RuntimeError(
                "File tải về không khớp checksum — đã huỷ để đảm bảo an toàn.\n"
                f"Mong đợi: {FFMPEG_SHA256[:16]}...\n"
                f"Nhận được: {actual[:16]}..."
            )

        extracted = 0
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                name = os.path.basename(info.filename)
                if name.lower() in FFMPEG_WANTED:
                    info.filename = name          # phẳng hoá, bỏ thư mục con trong zip
                    zf.extract(info, FFMPEG_DIR)
                    extracted += 1
        if not extracted:
            raise RuntimeError('Không tìm thấy ffmpeg.exe trong file tải về.')
    finally:
        try:
            if os.path.exists(archive):
                os.remove(archive)
        except OSError:
            pass

    if not refresh_ffmpeg():
        raise RuntimeError('Đã giải nén nhưng vẫn không thấy ffmpeg.exe.')
    return _ffmpeg_path


refresh_ffmpeg()


# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
# Tự động kiểm tra & cập nhật ứng dụng & thư viện (yt-dlp, FFmpeg,...)
# ─────────────────────────────────────────────────────────────

GITHUB_API_VERSION_URL = "https://api.github.com/repos/CNDT-HOZA/video-downloader-pro/contents/version.json?ref=App"
APP_UPDATE_URL = "https://raw.githubusercontent.com/CNDT-HOZA/video-downloader-pro/App/version.json"


def parse_version_tuple(v_str):
    """Chuyển chuỗi phiên bản dạng '2026.08.18' hoặc '2.2.0' thành tuple số để so sánh."""
    if not v_str:
        return ()
    clean = re.sub(r'^[^\d]*', '', str(v_str).strip())
    parts = []
    for chunk in re.split(r'[.\-_+]', clean):
        num = ''
        for ch in chunk:
            if ch.isdigit():
                num += ch
            else:
                break
        if num:
            parts.append(int(num))
    return tuple(parts)


def check_latest_app_version(url=None):
    """Kiểm tra phiên bản ứng dụng mới nhất từ Git repository (dùng GitHub API để realtime không bị cache)."""
    # 1. Thử qua GitHub API (luôn cập nhật tức thì, không bị Fastly CDN cache đệm)
    if not url:
        try:
            req = urllib.request.Request(
                GITHUB_API_VERSION_URL,
                headers={
                    'User-Agent': UA or 'ProVideoDownloader',
                    'Accept': 'application/vnd.github.v3+json'
                }
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                raw_json = base64.b64decode(data.get('content', '')).decode('utf-8')
                return json.loads(raw_json)
        except Exception:
            pass

    # 2. Fallback sang raw URL nếu GitHub API bị chặn/rate-limit
    target_url = url or f"{APP_UPDATE_URL}?t={int(time.time())}"
    try:
        req = urllib.request.Request(
            target_url,
            headers={
                'User-Agent': UA or 'ProVideoDownloader',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        safe_print(f"[AutoUpdate] Khong the lay thong tin cap nhat app: {e}")
        return None


def download_app_update(download_url, target_path, on_progress=None):
    """Tải file cập nhật ứng dụng từ Git về target_path kèm báo tiến độ."""
    try:
        req = urllib.request.Request(
            download_url,
            headers={'User-Agent': UA or 'ProVideoDownloader'}
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            total_size = int(resp.headers.get('Content-Length') or 0)
            downloaded = 0
            chunk_size = 64 * 1024
            with open(target_path, 'wb') as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if on_progress:
                        pct = (downloaded / total_size * 100.0) if total_size > 0 else 0.0
                        on_progress(downloaded, total_size, pct)
        return True
    except Exception as e:
        safe_print(f"[AutoUpdate] Loi khi tai ban cap nhat: {e}")
        if os.path.exists(target_path):
            try:
                os.remove(target_path)
            except Exception:
                pass
        return False


def apply_update_and_restart(new_exe_path):
    """Áp dụng bản cập nhật: tạo updater.ps1 đợi app đóng rồi đè file EXE và khởi động lại."""
    if not getattr(sys, 'frozen', False):
        safe_print(f"[AutoUpdate] Dang chay ma nguon, file moi da luu tai: {new_exe_path}")
        return

    current_exe = os.path.abspath(sys.executable)
    exe_dir = os.path.dirname(current_exe)
    ps1_path = os.path.join(exe_dir, "updater.ps1")
    pid = os.getpid()

    # Tạo script PowerShell an toàn 100%
    ps_content = f"""# PowerShell Auto-Updater for Pro Video Downloader
$targetPid = {pid}
$currentExe = '{current_exe}'
$newExe = '{new_exe_path}'
$exeDir = '{exe_dir}'

# 1. Chờ tiến trình PID đóng hẳn
for ($i = 0; $i -lt 30; $i++) {{
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if (-not $proc) {{ break }}
    Start-Sleep -Milliseconds 200
}}
Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 2. Vòng lặp thay thế file đến khi file mới ghi đè thành công
for ($i = 0; $i -lt 40; $i++) {{
    if (-not (Test-Path -LiteralPath $newExe)) {{ break }}
    try {{
        Remove-Item -LiteralPath $currentExe -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $newExe -Destination $currentExe -Force -ErrorAction Stop
        break
    }} catch {{
        try {{
            Copy-Item -LiteralPath $newExe -Destination $currentExe -Force -ErrorAction Stop
            Remove-Item -LiteralPath $newExe -Force -ErrorAction SilentlyContinue
            break
        }} catch {{
            Start-Sleep -Milliseconds 300
        }}
    }}
}}

# 3. Xoá sạch mọi biến môi trường tạm của PyInstaller
[System.Environment]::SetEnvironmentVariable('_MEIPASS2', $null, 'Process')
[System.Environment]::SetEnvironmentVariable('_MEIPASS', $null, 'Process')
Remove-Item env:_MEIPASS2 -ErrorAction SilentlyContinue
Remove-Item env:_MEIPASS -ErrorAction SilentlyContinue

# 4. Khởi động bản mới hoàn toàn độc lập và xoá script cập nhật
if (Test-Path -LiteralPath $currentExe) {{
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $currentExe
    $psi.WorkingDirectory = $exeDir
    $psi.UseShellExecute = $false
    [System.Diagnostics.Process]::Start($psi)
}}

Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
"""

    try:
        with open(ps1_path, "w", encoding="utf-8") as f:
            f.write(ps_content)

        env = dict(os.environ)
        env.pop('_MEIPASS2', None)
        env.pop('_MEIPASS', None)

        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1_path],
            cwd=exe_dir,
            env=env,
            creationflags=getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0) | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        os._exit(0)
    except Exception as e:
        safe_print(f"[AutoUpdate] Khong the khoi chay updater.ps1: {e}")


def check_latest_ytdlp_version():
    """Lấy phiên bản yt-dlp mới nhất từ PyPI hoặc GitHub Releases."""
    # 1. Thử PyPI trước
    try:
        req = urllib.request.Request('https://pypi.org/pypi/yt-dlp/json', headers={'User-Agent': 'ProVideoDownloader'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return str(data.get('info', {}).get('version') or '')
    except Exception:
        pass

    # 2. Dự phòng GitHub API
    try:
        req = urllib.request.Request('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
                                     headers={'User-Agent': 'ProVideoDownloader'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            tag = str(data.get('tag_name') or '').lstrip('v')
            return tag
    except Exception:
        pass

    return ""


def update_ytdlp_package():
    """Tự động nâng cấp thư viện yt-dlp (và yt-dlp-ejs) bằng pip hoặc binary."""
    if getattr(sys, 'frozen', False):
        bin_dir = os.path.join(DATA_DIR, 'bin')
        os.makedirs(bin_dir, exist_ok=True)
        exe_target = os.path.join(bin_dir, 'yt-dlp.exe')
        url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        req = urllib.request.Request(url, headers={'User-Agent': 'ProVideoDownloader'})
        with urllib.request.urlopen(req, timeout=60) as resp, open(exe_target, 'wb') as f:
            f.write(resp.read())
        return True

    cmd = [sys.executable, "-m", "pip", "install", "-U", "--pre", "yt-dlp[default]", "yt-dlp-ejs"]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    )
    return proc.returncode == 0


# ─────────────────────────────────────────────────────────────
# Định dạng tải
# ─────────────────────────────────────────────────────────────

# Có ffmpeg: tải riêng luồng hình + tiếng rồi ghép → chất lượng cao nhất.
#
# TUYỆT ĐỐI KHÔNG ép [ext=mp4] ở đây. YouTube chỉ phát 1440p/2160p dưới dạng
# WebM/VP9 (trừ video có AV1), còn mp4 dừng ở 1080p. Ép mp4 thì nhánh đó vẫn
# "thành công" ở 1080p nên yt-dlp không bao giờ chạy tới nhánh dự phòng —
# kết quả là chọn 4K vẫn ra Full HD. Việc ưu tiên mp4 để ở FORMAT_SORT, nơi
# nó chỉ có tác dụng khi hai format cùng độ phân giải.
_FMT_FFMPEG = {
    "Tốt Nhất (Best)":     "bestvideo+bestaudio/best",
    "4K (2160p)":          "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best",
    "2K (1440p)":          "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best",
    "1080p (Full HD)":     "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "Chỉ Lấy Nhạc (MP3)":  "bestaudio/best",
}

# Không có ffmpeg: chỉ dùng file đã gộp sẵn, nếu không sẽ ra video câm.
_FMT_NOFFMPEG = {
    "Tốt Nhất (Best)":     "best",
    "4K (2160p)":          "best[height<=2160]/best",
    "2K (1440p)":          "best[height<=1440]/best",
    "1080p (Full HD)":     "best[height<=1080]/best",
    "Chỉ Lấy Nhạc (MP3)":  "bestaudio/best",
}

# Độ phân giải là tiêu chí số một; mp4/m4a chỉ để phá hoà khi bằng điểm.
FORMAT_SORT = ['res', 'ext:mp4:m4a']

MP3_LABEL = "Chỉ Lấy Nhạc (MP3)"

# Chiều cao tối đa mà người dùng yêu cầu, dùng để báo khi video gốc không có
# đủ độ phân giải đó. None = không giới hạn.
QUALITY_MAX_HEIGHT = {
    "Tốt Nhất (Best)": None,
    "4K (2160p)": 2160,
    "2K (1440p)": 1440,
    "1080p (Full HD)": 1080,
    "1080p": 1080,
    MP3_LABEL: None,
}


def result_height(info):
    """Chiều cao thực tế của video vừa tải (0 nếu không xác định được)."""
    if not info:
        return 0
    height = info.get('height') or 0
    for fmt in info.get('requested_formats') or []:
        height = max(height, fmt.get('height') or 0)
    return height


def label_for_height(height):
    if not height:
        return ''
    if height >= 2160:
        return '4K'
    if height >= 1440:
        return '2K'
    return f'{height}p'


def format_map():
    """Bảng định dạng hiện hành — đổi theo việc có FFmpeg hay không.

    Phải là hàm chứ không phải hằng số: FFmpeg có thể được cài ngay lúc app
    đang chạy, và menu chất lượng phải đổi theo.
    """
    return _FMT_FFMPEG if has_ffmpeg() else _FMT_NOFFMPEG


def format_label_for_stream(f):
    """Tạo nhãn hiển thị chi tiết cho một stream video (độ phân giải, fps, codec, đuôi, dung lượng)."""
    height = f.get('height') or 0
    width = f.get('width') or 0
    if not height and width:
        height = int(width * 9 / 16)

    if height >= 2160:
        res_label = f"4K ({height}p)"
    elif height >= 1440:
        res_label = f"2K ({height}p)"
    elif height >= 1080:
        res_label = "1080p (Full HD)"
    elif height >= 720:
        res_label = "720p (HD)"
    elif height > 0:
        res_label = f"{height}p"
    else:
        res_label = f.get('resolution') or 'Video'

    parts = [res_label]

    fps = f.get('fps')
    if fps and fps > 30:
        parts.append(f"{int(fps)}fps")

    vcodec = str(f.get('vcodec') or '').lower()
    if vcodec.startswith(('avc', 'h264')):
        parts.append("H.264")
    elif vcodec.startswith(('hev', 'h265', 'hvc')):
        parts.append("H.265")
    elif vcodec.startswith(('vp9', 'vp09')):
        parts.append("VP9")
    elif vcodec.startswith('av01'):
        parts.append("AV1")
    elif vcodec and vcodec != 'none':
        parts.append(vcodec.split('.')[0].upper())

    ext = f.get('ext')
    if ext and ext not in ('mhtml', 'none'):
        parts.append(f".{ext}")

    filesize = f.get('filesize') or f.get('filesize_approx') or 0
    if filesize > 0:
        if filesize >= 1024 * 1024 * 1024:
            parts.append(f"{filesize / (1024**3):.1f} GB")
        else:
            parts.append(f"{filesize / (1024**2):.0f} MB")

    return " • ".join(parts)


def parse_available_formats(info):
    """Phân tích toàn bộ các định dạng chất lượng từ Full HD (1080p) trở lên từ dữ liệu video info."""
    if not info:
        return []

    raw_formats = info.get('formats') or []
    video_formats = []
    for f in raw_formats:
        vcodec = str(f.get('vcodec') or '').lower()
        ext = str(f.get('ext') or '').lower()
        if vcodec == 'none' or ext in ('mhtml',):
            continue
        height = f.get('height') or 0
        width = f.get('width') or 0
        if not height and not width and f.get('resolution') == 'audio only':
            continue
        if str(f.get('format_note') or '').lower() == 'storyboard':
            continue
        video_formats.append(f)

    if not video_formats and (info.get('url') or info.get('id')):
        return []

    # Chỉ hiển thị các định dạng từ Full HD (1080p) trở lên
    fhd_plus = [
        f for f in video_formats
        if (f.get('height') or 0) >= 1080 or (f.get('width') or 0) >= 1920
    ]
    if fhd_plus:
        video_formats = fhd_plus

    video_formats.sort(
        key=lambda f: (
            f.get('height') or 0,
            f.get('filesize') or f.get('filesize_approx') or 0,
            f.get('fps') or 0,
            1 if str(f.get('vcodec') or '').startswith(('avc', 'h264')) else 0
        ),
        reverse=True
    )

    seen_labels = {}
    result = []
    for f in video_formats:
        fmt_id = str(f.get('format_id') or '')
        label = format_label_for_stream(f)
        if label in seen_labels:
            label = f"{label} [#{fmt_id}]"
        seen_labels[label] = True

        format_spec = f"{fmt_id}+bestaudio/{fmt_id}/best" if fmt_id else "bestvideo+bestaudio/best"
        result.append((label, format_spec))

    return result


# ─────────────────────────────────────────────────────────────
# Chuyển mã cho phần mềm dựng phim
#
# Premiere / Vegas / After Effects không đọc được VP9 và AV1 — mà YouTube chỉ
# phát 1440p và 2160p ở hai codec đó. Không có cách nào "đổi vỏ" để tránh:
# muốn dựng thì bắt buộc mã hoá lại. Tham số dưới đây đặt ở mức mắt thường
# không phân biệt được với bản gốc (cao hơn hẳn mặc định của CapCut).
# ─────────────────────────────────────────────────────────────

# Codec mà phần mềm dựng phim đọc được — đã là các codec này thì KHÔNG đụng vào,
# giữ nguyên file gốc, không mất mát gì.
EDITABLE_CODECS = ('h264', 'avc1', 'mpeg4', 'prores', 'dnxhd', 'mjpeg')

TRANSCODE_NONE = 'Không chuyển — giữ nguyên'

_working_gpu_encoder = None


def detect_working_gpu_encoder():
    """Tự động kiểm tra thực tế trên card đồ hoạ để chọn encoder GPU tương thích nhất."""
    global _working_gpu_encoder
    if _working_gpu_encoder is not None:
        return _working_gpu_encoder

    exe = ffmpeg_path()
    if not exe:
        return None

    # Thứ tự kiểm tra:
    # 1. h264_nvenc (NVIDIA NVENC Hardware)
    # 2. h264_mf (Windows MediaFoundation GPU - Direct3D11/DXVA2)
    # 3. h264_amf (AMD AMF GPU)
    # 4. h264_qsv (Intel QuickSync GPU)
    candidates = [
        ('h264_nvenc', ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-pix_fmt', 'yuv420p']),
        ('h264_mf', ['-c:v', 'h264_mf', '-b:v', '14M', '-pix_fmt', 'yuv420p']),
        ('h264_amf', ['-c:v', 'h264_amf', '-quality', 'balanced', '-b:v', '14M', '-pix_fmt', 'yuv420p']),
        ('h264_qsv', ['-c:v', 'h264_qsv', '-global_quality', '20']),
    ]

    for enc_name, args in candidates:
        try:
            test_cmd = [
                exe, '-y', '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
                *args, '-f', 'null', '-'
            ]
            res = subprocess.run(
                test_cmd,
                capture_output=True,
                timeout=5,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            if res.returncode == 0:
                _working_gpu_encoder = (enc_name, args)
                return _working_gpu_encoder
        except Exception:
            continue

    _working_gpu_encoder = None
    return None


TRANSCODE_MODES = {
    TRANSCODE_NONE: None,
    'H.264 — GPU, nhanh': {
        'encoder': 'h264_gpu',
        'ext': 'mp4',
        'video': ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-pix_fmt', 'yuv420p'],
    },
    'H.264 — CPU, chất lượng cao nhất': {
        'encoder': 'libx264',
        'ext': 'mp4',
        'video': ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow',
                  '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
    },
    'DNxHR HQ — chuẩn dựng phim (file rất nặng)': {
        'encoder': 'dnxhd',
        'ext': 'mov',
        # All-intra: Premiere tua mượt, nhưng ~5 GB mỗi phút ở 4K.
        'video': ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p'],
        'audio': ['-c:a', 'pcm_s16le'],
    },
}

_encoders_cache = None


def available_encoders():
    """Danh sách encoder mà bản ffmpeg hiện tại hỗ trợ."""
    global _encoders_cache
    if _encoders_cache is not None:
        return _encoders_cache
    _encoders_cache = set()
    exe = ffmpeg_path()
    if exe:
        try:
            out = subprocess.run([exe, '-hide_banner', '-encoders'], capture_output=True,
                                 text=True, timeout=20,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for line in out.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[0][:1] in 'VAS':
                    _encoders_cache.add(parts[1])
        except Exception:
            pass
    return _encoders_cache


def get_transcode_config(mode_name):
    if not mode_name or mode_name == TRANSCODE_NONE:
        return None
    if mode_name == 'H.264 — GPU, nhanh':
        gpu = detect_working_gpu_encoder()
        if gpu:
            enc_name, args = gpu
            return {
                'encoder': enc_name,
                'ext': 'mp4',
                'video': args,
            }
        return {
            'encoder': 'libx264',
            'ext': 'mp4',
            'video': ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
        }
    if mode_name == 'H.264 — CPU, chất lượng cao nhất':
        return TRANSCODE_MODES['H.264 — CPU, chất lượng cao nhất']
    if mode_name == 'DNxHR HQ — chuẩn dựng phim (file rất nặng)':
        return TRANSCODE_MODES['DNxHR HQ — chuẩn dựng phim (file rất nặng)']
    return TRANSCODE_MODES.get(mode_name)


def transcode_modes_available():
    """Chỉ hiện những chế độ mà máy này chạy được."""
    if not has_ffmpeg():
        return [TRANSCODE_NONE]
    modes = [TRANSCODE_NONE]
    gpu_enc = detect_working_gpu_encoder()
    if gpu_enc:
        modes.append('H.264 — GPU, nhanh')
    if 'libx264' in available_encoders():
        modes.append('H.264 — CPU, chất lượng cao nhất')
    if 'dnxhd' in available_encoders():
        modes.append('DNxHR HQ — chuẩn dựng phim (file rất nặng)')
    return modes


def default_transcode_mode():
    """Mặc định là H.264 GPU (nếu máy có GPU), nếu không có GPU thì dùng CPU."""
    available = transcode_modes_available()
    if 'H.264 — GPU, nhanh' in available:
        return 'H.264 — GPU, nhanh'
    if 'H.264 — CPU, chất lượng cao nhất' in available:
        return 'H.264 — CPU, chất lượng cao nhất'
    return TRANSCODE_NONE


def ffprobe_path():
    exe = ffmpeg_path()
    if exe:
        candidate = os.path.join(os.path.dirname(exe), 'ffprobe.exe')
        if os.path.isfile(candidate):
            return candidate
    return shutil.which('ffprobe')


def probe_media(path):
    """Trả về dict {vcodec, acodec, duration} của file, rỗng nếu không đọc được."""
    exe = ffprobe_path()
    if not exe or not os.path.isfile(path):
        return {}
    try:
        out = subprocess.run(
            [exe, '-v', 'error', '-show_entries',
             'stream=codec_type,codec_name:format=duration', '-of', 'json', path],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        data = json.loads(out.stdout or '{}')
    except Exception:
        return {}

    info = {'vcodec': '', 'acodec': '', 'duration': 0.0}
    for stream in data.get('streams') or []:
        if stream.get('codec_type') == 'video' and not info['vcodec']:
            info['vcodec'] = (stream.get('codec_name') or '').lower()
        elif stream.get('codec_type') == 'audio' and not info['acodec']:
            info['acodec'] = (stream.get('codec_name') or '').lower()
    try:
        info['duration'] = float((data.get('format') or {}).get('duration') or 0)
    except (TypeError, ValueError):
        pass
    return info


def needs_transcode(media):
    """Chỉ mã hoá lại khi codec thật sự không dựng được."""
    vcodec = (media or {}).get('vcodec', '')
    return bool(vcodec) and vcodec not in EDITABLE_CODECS


def transcode(src, dst, mode, media=None, on_progress=None, should_cancel=None):
    """Mã hoá lại src -> dst. Ném RuntimeError kèm thông báo của ffmpeg nếu hỏng."""
    exe = ffmpeg_path()
    if not exe:
        raise RuntimeError('Không có FFmpeg.')

    media = media or probe_media(src)
    duration = media.get('duration') or 0

    # Tiếng đã là AAC thì chép thẳng — không mã hoá lại, không mất mát.
    audio_args = mode.get('audio') or (
        ['-c:a', 'copy'] if media.get('acodec') == 'aac' else ['-c:a', 'aac', '-b:a', '320k'])

    # Tăng tốc giải mã trực tiếp bằng phần cứng GPU (NVDEC / DirectX) để không tốn CPU
    hwaccel_args = []
    enc_name = mode.get('encoder', '')
    if enc_name in ('h264_nvenc', 'h264_gpu', 'h264_mf', 'h264_amf', 'h264_qsv'):
        hwaccel_args = ['-hwaccel', 'auto']

    cmd = [exe, '-hide_banner', '-loglevel', 'error', '-y', *hwaccel_args, '-i', src,
           *mode['video'], *audio_args]
    if mode['ext'] == 'mp4':
        cmd += ['-movflags', '+faststart']
    cmd += ['-progress', 'pipe:1', '-nostats', dst]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace',
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for line in proc.stdout:
            if should_cancel and should_cancel():
                proc.kill()
                raise RuntimeError('Đã huỷ chuyển mã.')
            if line.startswith('out_time_us=') and duration > 0 and on_progress:
                try:
                    done = int(line.split('=', 1)[1]) / 1_000_000
                    on_progress(min(done / duration, 1.0))
                except ValueError:
                    pass
        proc.wait(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()

    if proc.returncode != 0:
        detail = (proc.stderr.read() or '').strip().splitlines()
        raise RuntimeError(detail[-1][:180] if detail else f'ffmpeg lỗi mã {proc.returncode}')
    return dst


# ─────────────────────────────────────────────────────────────
# URL và tên file
# ─────────────────────────────────────────────────────────────

URL_RE = re.compile(r'https?://[^\s<>"\']+', re.I)
TRAILING_URL_CHARS = '.,;:)\\]}>\'",。;:)】》、…'

PLATFORM_HINTS = [
    (('douyin.com', 'iesdouyin.com'), 'Douyin'),
    (('tiktok.com', 'vm.tiktok.com'), 'TikTok'),
    (('youtube.com', 'youtu.be'), 'YouTube'),
    (('facebook.com', 'fb.watch'), 'Facebook'),
    (('instagram.com',), 'Instagram'),
    (('twitter.com', 'x.com'), 'Twitter/X'),
    (('reddit.com', 'redd.it', 'redditmedia.com'), 'Reddit'),
    (('vimeo.com',), 'Vimeo'),
    (('dailymotion.com', 'dai.ly'), 'Dailymotion'),
    (('bilibili.com',), 'Bilibili'),
    (('twitch.tv',), 'Twitch'),
    (('soundcloud.com',), 'SoundCloud'),
]


def clean_filename(raw, fallback_id="x"):
    """Tên file hợp lệ trên Windows, tối đa 150 ký tự."""
    if not raw or len(raw) < 3:
        raw = f"video_{fallback_id}"
    if len(raw) > 150:
        raw = raw[:150]
    cleaned = re.sub(r'[\\/*?:"<>|]', " ", raw)
    return " ".join(cleaned.split()).strip() or f"video_{fallback_id}"


def normalize_url(url):
    """Link Douyin dạng douyin.com/<token> phải đổi về v.douyin.com mới tải được."""
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.lower()
        parts = [p for p in parsed.path.split('/') if p]
        if host in ('www.douyin.com', 'douyin.com') and len(parts) == 1 and not parsed.query:
            token = parts[0]
            if token not in ('video', 'user', 'search', 'discover'):
                return f"https://v.douyin.com/{token}/"
    except Exception:
        pass
    return url


def extract_urls(text):
    """Rút mọi link ra khỏi đoạn text chia sẻ, đã bỏ ký tự thừa và khử trùng lặp."""
    urls = []
    seen = set()
    for match in URL_RE.findall(text or ''):
        url = match.strip().replace('&amp;', '&')
        for sep in (',', '。', ';', '、', ')', '】', '》', '…'):
            url = url.split(sep, 1)[0]
        url = normalize_url(url.rstrip(TRAILING_URL_CHARS))
        if url and url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def detect_platform(value, info=None):
    hay = f"{value or ''} {info.get('extractor', '') if info else ''} {info.get('extractor_key', '') if info else ''}".lower()
    for needles, name in PLATFORM_HINTS:
        if any(n in hay for n in needles):
            return name
    if info:
        extractor = info.get('extractor_key') or info.get('extractor')
        if extractor:
            return str(extractor).split(':')[0]
    return 'yt-dlp'


def is_douyin_url(url):
    return detect_platform(url) == 'Douyin'


def is_instagram_url(url):
    return detect_platform(url) == 'Instagram'


def entry_to_url(entry):
    """Mục trong playlist -> URL đầy đủ (yt-dlp đôi khi chỉ trả về video id)."""
    if not entry:
        return ''
    url = entry.get('webpage_url') or entry.get('original_url') or entry.get('url') or ''
    if url.startswith('http'):
        return url
    ie_key = str(entry.get('ie_key') or entry.get('extractor_key') or '').lower()
    if url and 'youtube' in ie_key:
        return f"https://www.youtube.com/watch?v={url}"
    return url


# ─────────────────────────────────────────────────────────────
# Headers riêng cho từng nền tảng
# ─────────────────────────────────────────────────────────────

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'


def douyin_headers():
    return {
        'User-Agent': UA,
        'Referer': 'https://www.douyin.com/',
        'Origin': 'https://www.douyin.com',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,vi;q=0.7',
    }


def instagram_headers():
    return {
        'User-Agent': UA,
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    }


def download_binary(url, path, referer=None):
    headers = {'User-Agent': UA, 'Accept': '*/*'}
    if referer:
        headers['Referer'] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp, open(path, 'wb') as f:
        shutil.copyfileobj(resp, f)


# ─────────────────────────────────────────────────────────────
# Quản lý Proxy tự động (Auto Proxy)
# ─────────────────────────────────────────────────────────────

PROXY_API_URL = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all'
PROXY_FALLBACK_URL = 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt'


def check_proxy_connect(ip_port, timeout=1.2):
    """Kiểm tra nhanh xem IP:Port của proxy có mở cổng và phản hồi TCP không (tránh treo yt-dlp)."""
    try:
        parts = ip_port.split(':')
        if len(parts) != 2:
            return False
        ip, port = parts[0], int(parts[1])
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            return s.connect_ex((ip, port)) == 0
    except Exception:
        return False


def check_proxy_https(ip_port, timeout=2.5):
    """Kiểm tra proxy có hỗ trợ kết nối HTTPS thực tế (tránh lỗi Unable to download API page)."""
    proxy_url = f"http://{ip_port}"
    try:
        handler = urllib.request.ProxyHandler({'https': proxy_url, 'http': proxy_url})
        opener = urllib.request.build_opener(handler)
        req = urllib.request.Request('https://www.google.com/generate_204', headers={'User-Agent': UA or 'Mozilla/5.0'})
        with opener.open(req, timeout=timeout) as resp:
            return resp.status in (200, 204)
    except Exception:
        return False


class ProxyManager:
    """Quản lý danh sách proxy miễn phí, tự động tải, kiểm tra kết nối nhanh và xoay vòng IP."""

    def __init__(self, api_url=None):
        self.api_url = api_url or PROXY_API_URL
        self.proxies = []          # Proxy đã check sống (sẵn sàng dùng)
        self._raw_proxies = []     # Proxy chưa check (đang chờ lọc)
        self.current_index = 0
        self.is_fetching = False
        self._is_prechecking = False
        self._lock = threading.Lock()

    def fetch_proxies(self):
        with self._lock:
            if self.is_fetching:
                return
            self.is_fetching = True

        try:
            safe_print('[ProxyManager] Dang tai danh sach Proxy moi...')
            data = ""
            for target_url in (self.api_url, PROXY_FALLBACK_URL):
                try:
                    req = urllib.request.Request(
                        target_url,
                        headers={'User-Agent': UA or 'ProVideoDownloader'}
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        data = resp.read().decode('utf-8', errors='ignore')
                    if len(data) > 50:
                        break
                except Exception:
                    continue

            import random
            lines = [l.strip() for l in data.splitlines() if l.strip() and len(l.strip()) > 5 and ':' in l]
            # Trộn ngẫu nhiên (Shuffle)
            random.shuffle(lines)

            with self._lock:
                self._raw_proxies = lines
                self.current_index = 0
            safe_print(f'[ProxyManager] Da nap {len(lines)} proxy, dang loc proxy HTTPS song...')

            # Bắt đầu lọc proxy sống ngầm đa luồng
            threading.Thread(target=self._precheck_worker, daemon=True).start()
        except Exception as err:
            safe_print(f'[ProxyManager] Loi tai proxy: {err}')
        finally:
            with self._lock:
                self.is_fetching = False

    def _precheck_worker(self):
        """Chạy ngầm đa luồng: check HTTPS thực tế tất cả proxy, chỉ giữ proxy sống."""
        with self._lock:
            if self._is_prechecking:
                return
            self._is_prechecking = True
            raw = list(self._raw_proxies)

        import concurrent.futures
        alive = []

        def _check_one(ip_port):
            if check_proxy_https(ip_port, timeout=2.5):
                with self._lock:
                    if ip_port not in self.proxies:
                        self.proxies.append(ip_port)
                return ip_port
            return None

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
                futures = [executor.submit(_check_one, ip) for ip in raw]
                for f in concurrent.futures.as_completed(futures):
                    res = f.result()
                    if res:
                        alive.append(res)
        except Exception as e:
            safe_print(f'[ProxyManager] Loi khi loc proxy: {e}')

        with self._lock:
            self._is_prechecking = False
        safe_print(f'[ProxyManager] Loc xong: {len(alive)} proxy HTTPS song / {len(raw)} tong.')

    def fetch_proxies_async(self):
        threading.Thread(target=self.fetch_proxies, daemon=True).start()

    def get_proxy(self, test_live=False):
        """Lấy proxy sống từ danh sách đã lọc. Nếu chưa có, tải và check nhanh."""
        needs_fetch = False
        with self._lock:
            if len(self.proxies) == 0 and len(self._raw_proxies) == 0:
                needs_fetch = True

        if needs_fetch:
            self.fetch_proxies()

        # Chờ tối đa 5 giây cho precheck tìm được ít nhất 1 proxy sống
        for _ in range(10):
            with self._lock:
                if self.proxies and self.current_index < len(self.proxies):
                    candidate = self.proxies[self.current_index]
                    self.current_index += 1
                    return f"http://{candidate}"
            # Chưa có proxy sống, đợi precheck thêm
            import time
            time.sleep(0.5)

        # Fallback: nếu precheck chưa xong, lấy từ raw và check trực tiếp
        with self._lock:
            raw = list(self._raw_proxies)
            used = set(self.proxies)

        for ip_port in raw[:30]:
            if ip_port in used:
                continue
            if check_proxy_https(ip_port, timeout=2.0):
                with self._lock:
                    if ip_port not in self.proxies:
                        self.proxies.append(ip_port)
                return f"http://{ip_port}"

        return None

    def mark_proxy_dead(self, proxy_url):
        if not proxy_url:
            return
        ip_port = proxy_url.replace('http://', '').replace('https://', '').replace('socks5://', '')
        with self._lock:
            if ip_port in self.proxies:
                idx = self.proxies.index(ip_port)
                self.proxies.remove(ip_port)
                if self.current_index > idx:
                    self.current_index -= 1


proxy_manager = ProxyManager()


def is_bot_blocked(error_message):
    """Kiểm tra xem lỗi có phải do bị phát hiện bot, rate limit hoặc chặn IP không."""
    if not error_message:
        return False
    low = str(error_message).lower()
    indicators = (
        'sign in to confirm',
        'bot confirmation',
        'bot check',
        '429: too many requests',
        'http error 429',
        'too many requests',
        'captcha',
        'rate-limit',
        'ratelimit',
        'temporarily blocked',
        'ip address is blocked',
        'proxyerror',
        'tunnel connection failed',
    )
    return any(ind in low for ind in indicators)


# ─────────────────────────────────────────────────────────────
# Cookie trình duyệt
# ─────────────────────────────────────────────────────────────

PREFERRED_DOUYIN_COOKIE_SPECS = [('chrome', 'Default'), ('edge', 'Default'), ('firefox',)]
PREFERRED_INSTAGRAM_COOKIE_SPECS = [('chrome', 'Default'), ('edge', 'Default'), ('firefox',)]
INSTAGRAM_MAX_COOKIE_PROFILES_PER_BROWSER = 2
DOUYIN_MAX_COOKIE_PROFILES_PER_BROWSER = 5


def browser_profile_dirs(browser):
    """Các profile của Chrome/Edge, profile mới dùng gần đây xếp trước."""
    if browser == 'chrome':
        root = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'User Data')
    elif browser == 'edge':
        root = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Edge', 'User Data')
    else:
        return []
    if not os.path.isdir(root):
        return []

    profiles = []
    for name in os.listdir(root):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        if name != 'Default' and not name.startswith('Profile '):
            continue
        cookie_paths = [os.path.join(path, 'Network', 'Cookies'), os.path.join(path, 'Cookies')]
        existing = [p for p in cookie_paths if os.path.exists(p)]
        if not existing:
            continue
        try:
            mtime = max(os.path.getmtime(p) for p in existing)
        except Exception:
            mtime = 0
        profiles.append((mtime, name))

    profiles.sort(reverse=True)
    return [name for _, name in profiles]


def _cookie_specs(preferred, max_profiles):
    specs = []
    seen = set()

    def add(spec):
        if spec not in seen:
            seen.add(spec)
            specs.append(spec)

    for browser in ('chrome', 'edge'):
        for profile in browser_profile_dirs(browser)[:max_profiles]:
            add((browser, profile))
    for spec in preferred:
        add(spec)
    return specs


def douyin_cookie_specs():
    return _cookie_specs(PREFERRED_DOUYIN_COOKIE_SPECS, DOUYIN_MAX_COOKIE_PROFILES_PER_BROWSER)


def instagram_cookie_specs():
    return _cookie_specs(PREFERRED_INSTAGRAM_COOKIE_SPECS, INSTAGRAM_MAX_COOKIE_PROFILES_PER_BROWSER)


def instagram_cookie_files():
    candidates = [
        INSTAGRAM_COOKIE_FILE,
        os.path.join(APP_DIR, 'instagram_cookies.txt'),
        os.path.join(APP_DIR, 'cookies.txt'),
        os.path.join(os.path.expanduser('~'), 'Downloads', 'instagram_cookies.txt'),
        os.path.join(os.path.expanduser('~'), 'Downloads', 'cookies.txt'),
    ]
    files = []
    seen = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        try:
            if os.path.isfile(path) and os.path.getsize(path) > 0:
                files.append(path)
        except Exception:
            pass
    return files


def browser_has_instagram_session_cookie():
    """Có sessionid Instagram trong Chrome/Edge không — dùng để báo lỗi cho đúng."""
    import sqlite3

    roots = [
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'User Data'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Edge', 'User Data'),
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            profile_names = os.listdir(root)
        except Exception:
            continue
        for name in profile_names:
            if name != 'Default' and not name.startswith('Profile '):
                continue
            db = os.path.join(root, name, 'Network', 'Cookies')
            if not os.path.exists(db):
                continue
            try:
                con = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=1)
                count = con.execute(
                    "select count(*) from cookies where host_key like '%instagram%' and name='sessionid'"
                ).fetchone()[0]
                con.close()
                if count:
                    return True
            except Exception:
                pass
    return False


def download_attempts_for(url, allow_browser_cookies=True):
    """Thứ tự thử: không cookie trước, chỉ leo thang lên cookie khi thất bại.
    YouTube không dùng cookie — chuyển thẳng sang Proxy khi bị bot-check."""
    attempts = [('không cookie', {})]
    if is_douyin_url(url):
        for spec in douyin_cookie_specs():
            label = f"cookie {spec[0]}" + (f" {spec[1]}" if len(spec) > 1 else "")
            attempts.append((label, {'cookiesfrombrowser': spec}))
    elif is_instagram_url(url):
        for path in instagram_cookie_files():
            attempts.append((f"cookie file {os.path.basename(path)}", {'cookiefile': path}))
        if allow_browser_cookies:
            for spec in instagram_cookie_specs():
                label = f"cookie {spec[0]}" + (f" {spec[1]}" if len(spec) > 1 else "")
                attempts.append((label, {'cookiesfrombrowser': spec}))
    # YouTube: chỉ thử 'không cookie', nếu bị block thì _download_one sẽ dùng Proxy ngay
    return attempts


# ─────────────────────────────────────────────────────────────
# Đường vòng cho Instagram khi yt-dlp bó tay
# ─────────────────────────────────────────────────────────────

def instagram_shortcode(url):
    match = re.search(r'instagram\.com/(?:p|tv|reel|reels)/([A-Za-z0-9_-]+)', url or '', re.I)
    return match.group(1) if match else ''


def instagram_shortcode_to_media_id(shortcode):
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    media_id = 0
    for char in shortcode:
        if char not in alphabet:
            return ''
        media_id = media_id * 64 + alphabet.index(char)
    return str(media_id)


def instagram_public_request(url, headers=None):
    req_headers = instagram_headers()
    req_headers.update({
        'Accept': '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '198387',
        'X-IG-WWW-Claim': '0',
    })
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode('utf-8', errors='replace')


def find_media_url_in_json(value, key_hint=''):
    """Dò link video trong JSON trả về từ resolver ngoài, cấu trúc mỗi nơi mỗi khác."""
    if isinstance(value, dict):
        for key in ('url', 'download_url', 'downloadUrl', 'video_url', 'videoUrl', 'media_url', 'mediaUrl'):
            if key in value:
                found = find_media_url_in_json(value[key], key)
                if found:
                    return found
        for key, item in value.items():
            found = find_media_url_in_json(item, key)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_media_url_in_json(item, key_hint)
            if found:
                return found
    elif isinstance(value, str) and value.startswith(('http://', 'https://')):
        low_key = (key_hint or '').lower()
        low_value = value.lower()
        if (
            'thumb' not in low_key
            and 'image' not in low_key
            and ('video' in low_key or 'download' in low_key or '.mp4' in low_value
                 or 'cdninstagram' in low_value or '/tunnel' in low_value)
        ):
            return value
    return None


def instagram_resolver_providers():
    """Resolver ngoài — chỉ dùng khi người dùng tự khai báo trong config/biến môi trường."""
    cfg = load_config()
    providers = []

    cobalt_url = (
        os.environ.get('INSTAGRAM_COBALT_API_URL')
        or os.environ.get('COBALT_API_URL')
        or cfg.get('instagram_cobalt_api_url')
        or cfg.get('cobalt_api_url')
    )
    if cobalt_url:
        providers.append({
            'kind': 'cobalt',
            'url': cobalt_url,
            'auth': (os.environ.get('INSTAGRAM_COBALT_AUTH') or os.environ.get('COBALT_API_AUTH')
                     or cfg.get('instagram_cobalt_auth') or cfg.get('cobalt_api_auth')),
        })

    generic_url = os.environ.get('INSTAGRAM_RESOLVER_URL') or cfg.get('instagram_resolver_url')
    if generic_url:
        providers.append({
            'kind': 'generic',
            'url': generic_url,
            'auth': os.environ.get('INSTAGRAM_RESOLVER_AUTH') or cfg.get('instagram_resolver_auth'),
        })

    return providers


def instagram_external_resolver_info(url):
    for provider in instagram_resolver_providers():
        try:
            headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
            if provider.get('auth'):
                headers['Authorization'] = provider['auth']

            if provider['kind'] == 'cobalt':
                endpoint = provider['url'].rstrip('/') + '/'
                payload = {'url': url, 'downloadMode': 'auto', 'videoQuality': '1080', 'filenameStyle': 'basic'}
            else:
                endpoint = provider['url']
                payload = {'url': url}

            req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'),
                                         headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode('utf-8', errors='replace'))

            direct_url = find_media_url_in_json(data)
            if direct_url:
                shortcode = instagram_shortcode(url) or 'instagram'
                return {
                    'id': shortcode,
                    'title': f'Instagram {shortcode}',
                    'fulltitle': f'Instagram {shortcode}',
                    'uploader': provider['kind'],
                    'direct_url': direct_url,
                }
        except Exception:
            continue
    return None


def instagram_parse_public_item(item, shortcode):
    if not item:
        return None
    versions = item.get('video_versions') or []
    if not versions:
        return None

    caption = item.get('caption') or {}
    title = caption.get('text', '') if isinstance(caption, dict) else ''
    title = title.splitlines()[0][:120] if title else f"Instagram {shortcode}"
    best = max(versions, key=lambda v: (v.get('height') or 0) * (v.get('width') or 0))

    return {
        'id': shortcode,
        'title': title,
        'fulltitle': title,
        'uploader': (item.get('user') or {}).get('username') or 'instagram',
        'direct_url': best.get('url'),
    }


def instagram_public_info(url):
    external = instagram_external_resolver_info(url)
    if external:
        return external

    shortcode = instagram_shortcode(url)
    if not shortcode:
        return None

    media_id = instagram_shortcode_to_media_id(shortcode)
    if media_id:
        try:
            # Ghé trang reel trước để lấy cookie phiên tạm, API dưới mới chịu trả dữ liệu.
            instagram_public_request(f'https://www.instagram.com/reel/{shortcode}/')
        except Exception:
            pass
        try:
            data = json.loads(instagram_public_request(f'https://i.instagram.com/api/v1/media/{media_id}/info/'))
            items = data.get('items') or []
            result = instagram_parse_public_item(items[0] if items else None, shortcode)
            if result and result.get('direct_url'):
                return result
        except Exception:
            pass

    try:
        variables = {
            'shortcode': shortcode,
            'child_comment_count': 0,
            'fetch_comment_count': 0,
            'parent_comment_count': 0,
            'has_threaded_comments': False,
        }
        query = urllib.parse.quote(json.dumps(variables, separators=(',', ':')))
        data = json.loads(instagram_public_request(
            f'https://www.instagram.com/graphql/query/?doc_id=8845758582119845&variables={query}',
            {'X-Requested-With': 'XMLHttpRequest'},
        ))
        media = (data.get('data') or {}).get('xdt_shortcode_media') or {}
        video_url = media.get('video_url')
        if video_url:
            edges = (media.get('edge_media_to_caption') or {}).get('edges') or []
            title = (((edges[0] or {}).get('node') or {}).get('text') if edges else '') or f"Instagram {shortcode}"
            return {
                'id': shortcode,
                'title': title.splitlines()[0][:120],
                'fulltitle': title.splitlines()[0][:120],
                'uploader': 'instagram',
                'direct_url': video_url,
            }
    except Exception:
        pass

    return None


def instagram_public_download(url, path_template):
    info = instagram_public_info(url)
    direct_url = (info or {}).get('direct_url')
    if not direct_url:
        return None, None
    path = path_template.replace('%(ext)s', 'mp4')
    download_binary(direct_url, path, referer='https://www.instagram.com/')
    return info, path


def instagram_missing_reason():
    if instagram_resolver_providers():
        return "Resolver Instagram da cau hinh nhung khong tra ve link tai. Hay kiem tra endpoint/API key."
    if instagram_cookie_files():
        return "Da co file cookie Instagram nhung khong tai duoc. Cookie co the het han, hay nap lai cookie moi."
    if browser_has_instagram_session_cookie():
        return "Trinh duyet co session Instagram. Bam IG LOGIN -> Dung trinh duyet; neu van loi, dong tat ca Chrome roi thu lai."
    return "Chua dang nhap Instagram tren Chrome/Edge. Hay dang nhap roi bam IG LOGIN, hoac nap file cookies.txt."


# ─────────────────────────────────────────────────────────────
# Giao diện
# ─────────────────────────────────────────────────────────────

class TaskCard(ctk.CTkFrame):
    """Khay hiển thị tiến trình của từng video riêng biệt giống giao diện chuyên nghiệp."""
    FONT = "Segoe UI"

    def __init__(self, master, task_id, url, quality, custom_fmt=None, app_ref=None, title=None, **kwargs):
        super().__init__(master, fg_color="#181c27", corner_radius=10, border_width=1, border_color="#262d3d", **kwargs)
        self.task_id = task_id
        self.url = url
        self.quality = quality
        self.custom_fmt = custom_fmt
        self.app = app_ref
        self.file_path = None
        self.title_text = title or "Video download"
        self.logs = []
        self.is_expanded = False
        self.state = "pending"  # pending, downloading, transcoding, completed, failed
        self.last_ratio = 0.0

        self._build_ui()

    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.pack_configure(fill="x", padx=4, pady=4)

        # ── Hàng 1: Tiêu đề Video + Nút Folder + Nút Thử lại + Nút Xoá ──
        top_row = ctk.CTkFrame(self, fg_color="transparent")
        top_row.pack(fill="x", padx=10, pady=(8, 2))
        top_row.grid_columnconfigure(0, weight=1)

        self.lbl_title = ctk.CTkLabel(
            top_row, text=self.title_text,
            font=ctk.CTkFont(family=self.FONT, size=12, weight="bold"),
            text_color="#ffffff", anchor="w"
        )
        self.lbl_title.pack(side="left", fill="x", expand=True, padx=(0, 6))

        # Nút Mở thư mục 📁 (Mở file trong Explorer)
        self.btn_folder = ctk.CTkButton(
            top_row, text="📁", width=28, height=26,
            font=ctk.CTkFont(size=13),
            fg_color="transparent", hover_color="#2f3542",
            text_color="#2ed573", corner_radius=6,
            command=self.open_folder
        )
        self.btn_folder.pack(side="right", padx=(2, 0))

        # Nút Thử lại 🔄 (Xử lý lại khi lỗi)
        self.btn_retry = ctk.CTkButton(
            top_row, text="🔄 Thử lại", width=68, height=26,
            font=ctk.CTkFont(family=self.FONT, size=10, weight="bold"),
            fg_color="#e67e22", hover_color="#d35400",
            text_color="#ffffff", corner_radius=6,
            command=self.retry
        )
        # Ban đầu ẩn nút thử lại

        # Nút Xoá khay ✕
        self.btn_remove = ctk.CTkButton(
            top_row, text="✕", width=22, height=26,
            font=ctk.CTkFont(family=self.FONT, size=11),
            fg_color="transparent", hover_color="#c0392b",
            text_color="#747d8c", corner_radius=6,
            command=self.remove_card
        )
        self.btn_remove.pack(side="right", padx=(2, 2))

        # ── Hàng 2: Trạng thái + Phần trăm ──
        status_row = ctk.CTkFrame(self, fg_color="transparent")
        status_row.pack(fill="x", padx=10, pady=(2, 2))

        self.lbl_status = ctk.CTkLabel(
            status_row, text="⏳ Đang chuẩn bị...",
            font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
            text_color="#00cec9", anchor="w"
        )
        self.lbl_status.pack(side="left", fill="x", expand=True)

        self.lbl_percent = ctk.CTkLabel(
            status_row, text="0.0%",
            font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
            text_color="#ffffff", anchor="e"
        )
        self.lbl_percent.pack(side="right")

        # ── Hàng 3: Thanh tiến độ Progress Bar ──
        self.pbar = ctk.CTkProgressBar(
            self, height=6, corner_radius=3,
            progress_color="#2ed573", fg_color="#2f3542"
        )
        self.pbar.pack(fill="x", padx=10, pady=(4, 4))
        self.pbar.set(0)

        # ── Hàng 4: Chi tiết / Log vắn tắt ──
        self.detail_frame = ctk.CTkFrame(self, fg_color="#12151e", corner_radius=6)
        self.detail_frame.pack(fill="x", padx=10, pady=(2, 4))

        self.lbl_detail = ctk.CTkLabel(
            self.detail_frame, text=f"[{time.strftime('%I:%M:%S %p')}] ⚡ Khởi tạo tác vụ...",
            font=ctk.CTkFont(family="Consolas", size=9),
            text_color="#a4b0be", anchor="w"
        )
        self.lbl_detail.pack(fill="x", padx=6, pady=3)

        # ── Hàng 5: Nút Xem log (x) + Container Log mở rộng ──
        log_ctrl_row = ctk.CTkFrame(self, fg_color="transparent")
        log_ctrl_row.pack(fill="x", padx=10, pady=(0, 4))

        self.btn_toggle_log = ctk.CTkButton(
            log_ctrl_row, text="▶ Xem log (1)", width=85, height=18,
            font=ctk.CTkFont(family=self.FONT, size=9),
            fg_color="transparent", hover_color="#262d3d",
            text_color="#70a1ff", anchor="w",
            command=self.toggle_log
        )
        self.btn_toggle_log.pack(side="left")

        self.log_container = ctk.CTkFrame(self, fg_color="#0e1118", corner_radius=6)
        self.log_textbox = ctk.CTkTextbox(
            self.log_container, height=60, font=ctk.CTkFont(family="Consolas", size=9),
            fg_color="#0b0e14", text_color="#dfe6e9", corner_radius=6
        )
        self.log_textbox.pack(fill="both", expand=True, padx=4, pady=4)
        self.log_textbox.configure(state="disabled")

        self.add_log(f"Khởi tạo tiến trình tải: {self.url}")

    def set_title(self, title):
        clean = (title or "").strip()
        if len(clean) > 65:
            clean = clean[:62] + "..."
        self.title_text = clean
        self.after(0, lambda: self.lbl_title.configure(text=clean))

    def set_status(self, status_text, color=None):
        def update():
            self.lbl_status.configure(text=status_text)
            if color:
                self.lbl_status.configure(text_color=color)
        self.after(0, update)

    def set_progress(self, ratio, percent_str=None):
        self.last_ratio = max(0.0, min(1.0, float(ratio)))
        pct = percent_str or f"{self.last_ratio * 100:.1f}%"
        def update():
            self.pbar.set(self.last_ratio)
            self.lbl_percent.configure(text=pct)
        self.after(0, update)

    def set_detail(self, detail_text):
        ts = time.strftime('%I:%M:%S %p')
        msg = f"[{ts}] {detail_text}"
        self.after(0, lambda: self.lbl_detail.configure(text=msg))

    def add_log(self, text):
        ts = time.strftime('%H:%M:%S')
        line = f"[{ts}] {text}"
        self.logs.append(line)
        count = len(self.logs)

        def update():
            self.btn_toggle_log.configure(
                text=f"{'▼ Thu gọn' if self.is_expanded else '▶ Xem log'} ({count})"
            )
            try:
                self.log_textbox.configure(state="normal")
                self.log_textbox.insert("end", line + "\n")
                self.log_textbox.see("end")
                self.log_textbox.configure(state="disabled")
            except Exception:
                pass
        self.after(0, update)

    def toggle_log(self):
        self.is_expanded = not self.is_expanded
        count = len(self.logs)
        if self.is_expanded:
            self.btn_toggle_log.configure(text=f"▼ Thu gọn ({count})")
            self.log_container.pack(fill="x", padx=10, pady=(0, 6))
        else:
            self.btn_toggle_log.configure(text=f"▶ Xem log ({count})")
            self.log_container.pack_forget()

    def set_completed(self, file_path, codec_label="MP4"):
        self.state = "completed"
        self.file_path = file_path
        ext = os.path.splitext(file_path)[1].upper().replace(".", "") or codec_label
        short_path = file_path if len(file_path) < 45 else "..." + file_path[-40:]
        self.set_progress(1.0, "100.0%")
        self.set_status(f"✅ Hoàn tất ({ext})", "#2ed573")
        self.set_detail(f"✅ Hoàn tất tải: {short_path}")
        self.add_log(f"Hoàn tất lưu file: {file_path}")
        self.after(0, lambda: self.btn_retry.pack_forget())

    def set_failed(self, error_reason):
        self.state = "failed"
        reason = str(error_reason).split("\n")[0][:100]
        self.set_status("❌ Thất bại", "#ff7675")
        self.set_detail(f"❌ Lỗi: {reason[:60]}")
        self.add_log(f"Lỗi: {reason}")
        def show_retry():
            self.btn_retry.pack(side="right", padx=(2, 2))
        self.after(0, show_retry)

    def open_folder(self):
        try:
            if self.file_path and os.path.exists(self.file_path):
                subprocess.Popen(f'explorer /select,"{os.path.normpath(self.file_path)}"')
            else:
                target_dir = getattr(self.app, "download_path", DOWNLOAD_PATH)
                os.startfile(target_dir)
        except Exception as e:
            if self.app:
                self.app._log(f"Không thể mở thư mục: {e}", level="warning")

    def remove_card(self):
        if self.app:
            self.app._remove_task_card(self)
        self.destroy()

    def retry(self):
        self.state = "pending"
        self.set_progress(0.0, "0.0%")
        self.set_status("🔄 Đang thử lại...", "#f39c12")
        self.set_detail("Đang khởi động lại tiến trình tải...")
        self.add_log("Bắt đầu thử lại tải video...")
        self.btn_retry.pack_forget()

        if self.app:
            threading.Thread(
                target=self.app._single_download_worker,
                args=(self.task_id, self.url, self.quality, self.custom_fmt, self),
                daemon=True
            ).start()


class VideoDownloaderApp(ctk.CTk):
    FONT = "Segoe UI"

    def __init__(self):
        super().__init__()
        self.title("⚡ Pro Video Downloader")
        self.geometry("660x820")
        self.minsize(600, 700)

        try:
            icon_path = resource_path("icon.ico")
            if os.path.exists(icon_path):
                self.iconbitmap(icon_path)
        except Exception:
            pass

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        cfg = load_config()
        saved_path = cfg.get('download_path', DOWNLOAD_PATH)
        self.download_path = saved_path if os.path.isdir(saved_path) else DOWNLOAD_PATH
        self.auto_browser_cookies_ok = bool(cfg.get('auto_browser_cookies_ok'))

        self._last_hook_time = 0
        self._busy = False          # trạng thái bận cho các tác vụ quét kênh / tải hàng loạt
        self._chan_videos = []
        self._action_buttons = []
        self._quality_menus = []
        self._transcode_menus = []
        self._cancel_ffmpeg = False
        self._installing_ffmpeg = False
        self._custom_format_map = {}
        self._last_scanned_url = ""
        self._format_scan_timer = None
        self._tasks = []
        self._render_file_paths = []

        # Hàng đợi render tuần tự 1 luồng duy nhất cho toàn bộ app
        self._transcode_queue = queue.Queue()
        self._task_counter = 0
        self._active_downloads_count = 0
        self._task_lock = threading.Lock()
        self._transcode_thread = threading.Thread(target=self._global_transcode_consumer, daemon=True)
        self._transcode_thread.start()

        self.setup_ui()
        self._refresh_ffmpeg_ui()

        # Tải danh sách proxy ngầm
        proxy_manager.fetch_proxies_async()
        self._log("⚡ Ứng dụng sẵn sàng. Đang nạp danh sách proxy ngầm...")

        # Tự động kiểm tra cập nhật các thư viện (yt-dlp, FFmpeg,...) ở nền khi khởi động
        self.after(800, self._start_auto_update_libraries)

    # ───── Dựng giao diện ─────

    def setup_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        self._build_header()
        self._build_tabs()
        self._build_task_list()
        self._build_log_box()
        self._build_status_bar()

    def _build_transcode_menu(self, parent, width=220):
        saved = load_config().get('transcode_mode')
        options = transcode_modes_available()
        default_mode = default_transcode_mode()
        selected = saved if (saved and saved in options) else default_mode
        menu = ctk.CTkOptionMenu(
            parent, width=width, height=34, corner_radius=8, fg_color="#2c3e50",
            values=options, font=ctk.CTkFont(family=self.FONT, size=11),
            command=lambda choice: self._on_transcode_mode_change(choice))
        menu.set(selected)
        self._transcode_menus.append(menu)
        return menu

    def _on_transcode_mode_change(self, choice):
        save_config({'transcode_mode': choice})
        for m in getattr(self, '_transcode_menus', []):
            if m.get() != choice:
                m.set(choice)

    def _build_task_list(self):
        task_frame = ctk.CTkFrame(self, fg_color="#12141c", corner_radius=10)
        task_frame.grid(row=2, column=0, padx=16, pady=(0, 6), sticky="nsew")
        task_frame.grid_columnconfigure(0, weight=1)
        task_frame.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(task_frame, fg_color="transparent")
        header.grid(row=0, column=0, padx=10, pady=(6, 4), sticky="ew")

        ctk.CTkLabel(header, text="TIẾN TRÌNH",
                     font=ctk.CTkFont(family=self.FONT, size=12, weight="bold"),
                     text_color="#a4b0be").pack(side="left")

        self.btn_clear_tasks = ctk.CTkButton(
            header, text="🗑️", width=32, height=24,
            font=ctk.CTkFont(size=13),
            fg_color="transparent", hover_color="#c0392b",
            text_color="#a4b0be", corner_radius=6,
            command=self._clear_finished_tasks
        )
        self.btn_clear_tasks.pack(side="right")

        self.task_scroll = ctk.CTkScrollableFrame(
            task_frame, fg_color="#0e1017", corner_radius=8
        )
        self.task_scroll.grid(row=1, column=0, padx=6, pady=(0, 6), sticky="nsew")
        self.task_scroll.grid_columnconfigure(0, weight=1)

        self.task_empty_lbl = ctk.CTkLabel(
            self.task_scroll,
            text="Chưa có tiến trình tải nào. Dán link và bấm tải để bắt đầu.",
            font=ctk.CTkFont(family=self.FONT, size=11),
            text_color="#57606f"
        )
        self.task_empty_lbl.pack(pady=30)

    def _create_task_card(self, task_id, url, quality, custom_fmt=None, title=None):
        if hasattr(self, 'task_empty_lbl') and self.task_empty_lbl.winfo_exists():
            self.task_empty_lbl.pack_forget()

        card = TaskCard(self.task_scroll, task_id, url, quality, custom_fmt, app_ref=self, title=title)
        self._tasks.append(card)
        return card

    def _remove_task_card(self, card):
        if card in self._tasks:
            self._tasks.remove(card)
        if not self._tasks and hasattr(self, 'task_empty_lbl'):
            self.task_empty_lbl.pack(pady=30)

    def _clear_finished_tasks(self):
        for card in list(self._tasks):
            if card.state in ("completed", "failed"):
                card.remove_card()

    def _build_log_box(self):
        log_frame = ctk.CTkFrame(self, fg_color="#12121e", corner_radius=10)
        log_frame.grid(row=3, column=0, padx=16, pady=(0, 6), sticky="ew")
        log_frame.grid_columnconfigure(0, weight=1)
        log_frame.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(log_frame, fg_color="transparent")
        header.grid(row=0, column=0, padx=10, pady=(4, 2), sticky="ew")

        ctk.CTkLabel(header, text="📋 Nhật ký hoạt động (Logs):",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#81ecec").pack(side="left")

        ctk.CTkButton(header, text="Xoá log", width=55, height=20,
                     font=ctk.CTkFont(family=self.FONT, size=10),
                     fg_color="#2c3e50", hover_color="#34495e", corner_radius=6,
                     command=self._clear_logs).pack(side="right")

        self.log_box = ctk.CTkTextbox(
            log_frame, height=70, font=ctk.CTkFont(family="Consolas", size=10),
            fg_color="#0b0b14", text_color="#dfe6e9", corner_radius=8,
            border_width=1, border_color="#1e1e30"
        )
        self.log_box.grid(row=1, column=0, padx=8, pady=(0, 6), sticky="ew")
        self.log_box.configure(state="disabled")

    def _log(self, text, level="info"):
        now_str = time.strftime("%H:%M:%S")
        line = f"[{now_str}] {text}\n"
        safe_print(line.strip())

        def append():
            try:
                self.log_box.configure(state="normal")
                self.log_box.insert("end", line)
                self.log_box.see("end")
                self.log_box.configure(state="disabled")
            except Exception:
                pass

        self.after(0, append)

    def _clear_logs(self):
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.configure(state="disabled")

    def _build_header(self):
        header = ctk.CTkFrame(self, fg_color="#1a1a2e", corner_radius=0)
        header.grid(row=0, column=0, sticky="ew")

        logo = tk.Canvas(header, bg="#1a1a2e", highlightthickness=0, width=36, height=36)
        logo.pack(side="left", padx=(12, 6), pady=4)
        logo.create_oval(2, 2, 34, 34, outline="#00b894", width=2)
        logo.create_oval(5, 5, 31, 31, outline="#55efc4", width=1)
        logo.create_text(18, 18, text="⚡", fill="#f1c40f", font=(self.FONT, 18, "bold"))

        titles = ctk.CTkFrame(header, fg_color="transparent")
        titles.pack(side="left", pady=4)
        ctk.CTkLabel(titles, text="PRO VIDEO DOWNLOADER",
                     font=ctk.CTkFont(family=self.FONT, size=15, weight="bold"),
                     text_color="#00b894").pack(anchor="w")
        self.subtitle = ctk.CTkLabel(titles, text="", font=ctk.CTkFont(family=self.FONT, size=9))
        self.subtitle.pack(anchor="w")

        # Nút kiểm tra cập nhật trên header
        self.btn_check_update = ctk.CTkButton(
            header, text="🔄 Kiểm tra cập nhật", width=125, height=26,
            font=ctk.CTkFont(family=self.FONT, size=10, weight="bold"),
            fg_color="#2c3e50", hover_color="#34495e", corner_radius=6,
            command=lambda: self._check_app_update(manual=True)
        )
        self.btn_check_update.pack(side="right", padx=(0, 16), pady=6)

    def _build_tabs(self):
        self.tabview = ctk.CTkTabview(
            self, corner_radius=14,
            segmented_button_fg_color="#1a1a2e",
            segmented_button_selected_color="#00b894",
            segmented_button_selected_hover_color="#00a381",
            segmented_button_unselected_color="#2c3e50",
        )
        self.tabview.grid(row=1, column=0, padx=16, pady=(6, 6), sticky="nsew")
        self.tabview.add("▶ Tải Video")
        self.tabview.add("⏬ Hàng Loạt")
        self.tabview.add("🎬 Render")
        self.tabview._segmented_button.configure(font=ctk.CTkFont(family=self.FONT, size=12, weight="bold"))

        self._build_tab_single(self.tabview.tab("▶ Tải Video"))
        self._build_tab_bulk(self.tabview.tab("⏬ Hàng Loạt"))
        self._build_tab_render(self.tabview.tab("🎬 Render"))

    def _quality_menu(self, parent, width=220):
        menu = ctk.CTkOptionMenu(parent, width=width, height=34, values=list(format_map().keys()),
                                 corner_radius=8, fg_color="#2c3e50")
        self._quality_menus.append(menu)
        return menu

    def _action_button(self, parent, text, command, **kwargs):
        button = ctk.CTkButton(
            parent, text=text, command=command,
            font=ctk.CTkFont(family=self.FONT, size=kwargs.pop('size', 14), weight="bold"),
            fg_color=kwargs.pop('fg_color', "#00b894"),
            hover_color=kwargs.pop('hover_color', "#00a381"),
            corner_radius=10, **kwargs,
        )
        self._action_buttons.append(button)
        return button

    def _build_tab_single(self, tab):
        ctk.CTkLabel(tab, text=f"Hỗ trợ: {PLATFORMS}", font=ctk.CTkFont(family=self.FONT, size=9),
                     text_color="#777", wraplength=460).pack(pady=(4, 2))

        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.pack(pady=(2, 4), fill="x", padx=16)
        self.single_url = ctk.CTkEntry(row, placeholder_text="Dán link video tại đây...", height=42,
                                       font=ctk.CTkFont(family=self.FONT, size=13), corner_radius=8)
        self.single_url.pack(side="left", fill="x", expand=True, padx=(0, 8))
        ctk.CTkButton(row, text="📋", width=42, height=42, font=ctk.CTkFont(size=18),
                      fg_color="#444", hover_color="#555", corner_radius=8,
                      command=lambda: self._paste_to(self.single_url)).pack(side="right")

        # Lắng nghe sự kiện dán / gõ link để tự động tải danh sách định dạng video
        self.single_url.bind("<KeyRelease>", self._on_url_key_release)
        self.single_url.bind("<FocusOut>", lambda e: self._check_and_scan_formats())
        self.single_url.bind("<Return>", lambda e: self._check_and_scan_formats())

        # Hàng tuỳ chọn: Chất lượng + Dựng phim trên cùng 1 hàng
        opt_row = ctk.CTkFrame(tab, fg_color="transparent")
        opt_row.pack(pady=(4, 6), fill="x", padx=16)

        col_quality = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_quality.pack(side="left", expand=True, fill="x", padx=(0, 6))
        ctk.CTkLabel(col_quality, text="Chất lượng:",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#55efc4").pack(anchor="w", pady=(0, 2))
        self.q_single = self._quality_menu(col_quality, width=260)
        self.q_single.pack(fill="x")

        col_transcode = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_transcode.pack(side="right", expand=True, fill="x", padx=(6, 0))
        ctk.CTkLabel(col_transcode, text="🎬 Dựng phim:",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#81ecec").pack(anchor="w", pady=(0, 2))
        self.transcode_single = self._build_transcode_menu(col_transcode, width=260)
        self.transcode_single.pack(fill="x")

        self.btn_single = self._action_button(tab, "⚡  BẮT ĐẦU TẢI NGAY", self.on_single, width=260, height=44, size=15)
        self.btn_single.pack(pady=(4, 4))

    def _build_tab_bulk(self, tab):
        ctk.CTkLabel(tab, text="Dán danh sách link (mỗi dòng 1 link)",
                     font=ctk.CTkFont(family=self.FONT, size=13, weight="bold")).pack(pady=(4, 2))

        self.bulk_text = ctk.CTkTextbox(tab, height=90, font=ctk.CTkFont(family=self.FONT, size=11),
                                        corner_radius=8, border_width=1, border_color="#34495e")
        self.bulk_text.pack(pady=(0, 4), padx=16, fill="x")

        opt_row = ctk.CTkFrame(tab, fg_color="transparent")
        opt_row.pack(pady=(2, 4), fill="x", padx=16)

        col_quality = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_quality.pack(side="left", expand=True, fill="x", padx=(0, 6))
        ctk.CTkLabel(col_quality, text="Chất lượng:",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#55efc4").pack(anchor="w", pady=(0, 2))
        self.q_bulk = self._quality_menu(col_quality, width=260)
        self.q_bulk.pack(fill="x")

        col_transcode = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_transcode.pack(side="right", expand=True, fill="x", padx=(6, 0))
        ctk.CTkLabel(col_transcode, text="🎬 Dựng phim:",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#81ecec").pack(anchor="w", pady=(0, 2))
        self.transcode_bulk = self._build_transcode_menu(col_transcode, width=260)
        self.transcode_bulk.pack(fill="x")

        self.btn_bulk = self._action_button(tab, "⚡  BẮT ĐẦU TẢI NGAY", self.on_bulk, width=280, height=44, size=15)
        self.btn_bulk.pack(pady=(2, 4))

    def _build_tab_render(self, tab):
        ctk.CTkLabel(tab, text="Chuyển mã & render tối ưu video sang chuẩn H.264 (MP4) để dựng phim bằng Premiere / CapCut / Vegas",
                     font=ctk.CTkFont(family=self.FONT, size=10), text_color="#a4b0be",
                     wraplength=480).pack(pady=(4, 4))

        # Hàng chọn file / thư mục
        file_row = ctk.CTkFrame(tab, fg_color="transparent")
        file_row.pack(pady=(2, 4), fill="x", padx=16)

        ctk.CTkButton(file_row, text="📁 Chọn Video...", width=140, height=36,
                      font=ctk.CTkFont(family=self.FONT, size=12, weight="bold"),
                      fg_color="#34495e", hover_color="#2c3e50", corner_radius=8,
                      command=self._pick_render_files).pack(side="left", padx=(0, 6))

        ctk.CTkButton(file_row, text="📂 Chọn Cả Thư Mục...", width=160, height=36,
                      font=ctk.CTkFont(family=self.FONT, size=12, weight="bold"),
                      fg_color="#2c3e50", hover_color="#1a252f", corner_radius=8,
                      command=self._pick_render_folder).pack(side="left", padx=(0, 6))

        ctk.CTkButton(file_row, text="🗑️ Xoá danh sách", width=120, height=36,
                      font=ctk.CTkFont(family=self.FONT, size=11),
                      fg_color="transparent", hover_color="#c0392b", text_color="#ff7675", corner_radius=8,
                      command=self._clear_render_files).pack(side="right")

        # Hộp hiển thị danh sách video đã chọn
        self.render_file_box = ctk.CTkTextbox(tab, height=75, font=ctk.CTkFont(family="Consolas", size=10),
                                              corner_radius=8, border_width=1, border_color="#34495e",
                                              fg_color="#0e1017", text_color="#dfe6e9")
        self.render_file_box.pack(pady=(2, 4), padx=16, fill="both", expand=True)
        self.render_file_box.insert("1.0", "Chưa chọn file nào. Bấm 'Chọn Video' hoặc 'Chọn Cả Thư Mục' ở trên để nạp file cần Render...")
        self.render_file_box.configure(state="disabled")

        # Hàng tùy chọn Render
        opt_row = ctk.CTkFrame(tab, fg_color="transparent")
        opt_row.pack(pady=(4, 6), fill="x", padx=16)

        col_t = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_t.pack(side="left", expand=True, fill="x", padx=(0, 6))
        ctk.CTkLabel(col_t, text="🎬 Chế độ Render (Engine):",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#81ecec").pack(anchor="w", pady=(0, 2))
        self.transcode_tab_menu = self._build_transcode_menu(col_t, width=270)
        self.transcode_tab_menu.pack(fill="x")

        col_dest = ctk.CTkFrame(opt_row, fg_color="transparent")
        col_dest.pack(side="right", expand=True, fill="x", padx=(6, 0))
        ctk.CTkLabel(col_dest, text="💾 Lưu file đầu ra:",
                     font=ctk.CTkFont(family=self.FONT, size=11, weight="bold"),
                     text_color="#55efc4").pack(anchor="w", pady=(0, 2))
        self.render_out_option = ctk.CTkOptionMenu(
            col_dest, width=250, height=34, corner_radius=8, fg_color="#2c3e50",
            values=["Lưu vào cùng thư mục file gốc", "Lưu vào thư mục Tải xuống mặc định"]
        )
        self.render_out_option.pack(fill="x")

        # Nút bắt đầu Render
        self.btn_start_render = self._action_button(
            tab, "🎬  BẮT ĐẦU RENDER NGAY", self.on_start_render,
            width=280, height=44, size=15, fg_color="#e17055", hover_color="#d63031"
        )
        self.btn_start_render.pack(pady=(2, 4))
    def _build_status_bar(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        frame.grid(row=3, column=0, padx=16, pady=(0, 6), sticky="ew")
        frame.grid_columnconfigure(0, weight=1)

        self.pbar = ctk.CTkProgressBar(frame, height=8)
        self.pbar.set(0)
        self.pbar.grid(row=0, column=0, pady=(2, 2), sticky="ew")
        self.pbar.grid_remove()

        self.status = ctk.CTkLabel(frame, text="Sẵn sàng", font=ctk.CTkFont(family=self.FONT, size=12))
        self.status.grid(row=1, column=0, pady=(1, 4))

        buttons = ctk.CTkFrame(frame, fg_color="transparent")
        buttons.grid(row=2, column=0, pady=(0, 2))
        ctk.CTkButton(buttons, text="📂  MỞ THƯ MỤC", command=self._open_folder,
                      fg_color="#2ecc71", hover_color="#27ae60", width=140, height=34,
                      font=ctk.CTkFont(family=self.FONT, size=12, weight="bold")).pack(side="left", padx=(0, 8))
        ctk.CTkButton(buttons, text="📁  ĐỔI THƯ MỤC", command=self._pick_folder,
                      fg_color="#636e72", hover_color="#2d3436", width=140, height=34,
                      font=ctk.CTkFont(family=self.FONT, size=12, weight="bold")).pack(side="left", padx=(0, 8))
        ctk.CTkButton(buttons, text="IG LOGIN", command=self._import_instagram_cookie,
                      fg_color="#e17055", hover_color="#d35400", width=95, height=34,
                      font=ctk.CTkFont(family=self.FONT, size=11, weight="bold")).pack(side="left")

        self.path_label = ctk.CTkLabel(frame, text=f"📍 {self.download_path}",
                                       font=ctk.CTkFont(family=self.FONT, size=9),
                                       text_color="#777", wraplength=500)
        self.path_label.grid(row=3, column=0, pady=(0, 2))

    # ───── Hộp thoại ─────

    def _show_dialog(self, title, message, kind="info", buttons=("OK",)):
        result = {"value": buttons[0] if buttons else "OK"}
        colors = {
            "info": ("#3498db", "#2980b9"),
            "success": ("#2ecc71", "#27ae60"),
            "warning": ("#f39c12", "#d68910"),
            "error": ("#e74c3c", "#c0392b"),
        }
        accent, hover = colors.get(kind, colors["info"])

        dlg = ctk.CTkToplevel(self)
        dlg.title(title)
        dlg.geometry("420x230")
        dlg.resizable(False, False)
        dlg.configure(fg_color="#141422")
        dlg.transient(self)
        dlg.grab_set()
        try:
            dlg.attributes("-topmost", True)
            dlg.after(200, lambda: dlg.attributes("-topmost", False))
        except Exception:
            pass

        wrap = ctk.CTkFrame(dlg, fg_color="#1a1a2e", corner_radius=12)
        wrap.pack(fill="both", expand=True, padx=14, pady=14)
        ctk.CTkLabel(wrap, text=title, font=ctk.CTkFont(family=self.FONT, size=17, weight="bold"),
                     text_color=accent).pack(anchor="w", padx=18, pady=(16, 8))
        ctk.CTkLabel(wrap, text=message, font=ctk.CTkFont(family=self.FONT, size=13),
                     text_color="#e8e8f0", justify="left", wraplength=360).pack(anchor="w", fill="x",
                                                                               padx=18, pady=(0, 14))

        btn_frame = ctk.CTkFrame(wrap, fg_color="transparent")
        btn_frame.pack(side="bottom", fill="x", padx=18, pady=(0, 16))

        def choose(value):
            result["value"] = value
            dlg.destroy()

        for idx, label in enumerate(reversed(buttons)):
            is_primary = idx == 0
            ctk.CTkButton(btn_frame, text=label, width=104, height=36, corner_radius=8,
                          fg_color=accent if is_primary else "#3a3a4d",
                          hover_color=hover if is_primary else "#4a4a60",
                          font=ctk.CTkFont(family=self.FONT, size=13, weight="bold"),
                          command=lambda v=label: choose(v)).pack(side="right", padx=(8, 0))

        dlg.update_idletasks()
        x = self.winfo_rootx() + (self.winfo_width() // 2) - (dlg.winfo_width() // 2)
        y = self.winfo_rooty() + (self.winfo_height() // 2) - (dlg.winfo_height() // 2)
        dlg.geometry(f"+{max(0, x)}+{max(0, y)}")
        dlg.protocol("WM_DELETE_WINDOW", lambda: choose(buttons[-1] if buttons else "OK"))
        dlg.wait_window()
        return result["value"]

    def _alert(self, title, message, kind="info"):
        self._show_dialog(title, message, kind=kind, buttons=("OK",))

    def _confirm(self, title, message):
        return self._show_dialog(title, message, kind="warning", buttons=("Không", "Có")) == "Có"

    # ───── FFmpeg ─────

    def _refresh_ffmpeg_ui(self):
        """Đồng bộ giao diện với tình trạng FFmpeg hiện tại."""
        ready = has_ffmpeg()
        self.subtitle.configure(
            text=f"v{APP_VERSION}" + ("" if ready else "  •  chưa có FFmpeg"),
            text_color="#55efc4" if ready else "#f0c070",
        )
        # Bảng chất lượng đổi khi FFmpeg xuất hiện, menu phải đổi theo.
        values = list(format_map().keys())
        for menu in self._quality_menus:
            current = menu.get()
            menu.configure(values=values)
            menu.set(current if current in values else values[0])

        t_options = transcode_modes_available()
        saved = load_config().get('transcode_mode')
        default_mode = default_transcode_mode()
        selected = saved if (saved and saved in t_options) else default_mode
        for m in getattr(self, '_transcode_menus', []):
            m.configure(values=t_options)
            m.set(selected)

    def _auto_install_ffmpeg(self):
        """Cài FFmpeg ở nền, không hỏi và không khoá nút.

        Cố tình KHÔNG dùng self._busy: người dùng vẫn tải video được ngay
        (ở chất lượng gộp sẵn) trong lúc FFmpeg đang tải về.
        """
        self._installing_ffmpeg = True
        threading.Thread(target=self._ffmpeg_worker, daemon=True).start()

    def _ffmpeg_status(self, text, color="#f0c070"):
        """Chỉ ghi lên thanh trạng thái khi nó đang rảnh, để không đè tiến trình tải video."""
        if self._busy:
            return
        try:
            self.status.configure(text=text, text_color=color)
        except tk.TclError:
            pass   # cửa sổ đã đóng trong lúc đang tải

    def destroy(self):
        self._cancel_ffmpeg = True   # dừng tải FFmpeg nếu còn đang chạy dở
        super().destroy()

    def _ffmpeg_worker(self):
        last_update = [0.0]

        def on_progress(done, total):
            now = time.time()
            if now - last_update[0] < 0.3:
                return
            last_update[0] = now
            mb, mb_total = done / 1048576, total / 1048576
            pct = (done / total * 100) if total else 0
            self.after(0, self._ffmpeg_status,
                       f"Đang tự cài FFmpeg ở nền: {mb:.0f}/{mb_total:.0f} MB ({pct:.0f}%)")

        try:
            self.after(0, self._ffmpeg_status, "Đang tự cài FFmpeg ở nền...")
            install_ffmpeg(on_progress=on_progress, should_cancel=lambda: self._cancel_ffmpeg)
            self.after(0, self._ffmpeg_done, None)
        except Exception as e:
            self.after(0, self._ffmpeg_done, str(e))

    def _ffmpeg_done(self, error):
        self._installing_ffmpeg = False
        self._refresh_ffmpeg_ui()
        if error:
            self._ffmpeg_status(f"Không cài được FFmpeg: {str(error)[:60]}", "#ff7675")
        else:
            self._ffmpeg_status("✅ Đã cài xong FFmpeg — giờ tải được 4K và MP3.", "#00d084")

    def _start_auto_update_libraries(self):
        """Khởi chạy tiến trình kiểm tra và cập nhật ứng dụng + thư viện ngầm khi bật app."""
        threading.Thread(target=self._update_libraries_worker, daemon=True).start()

    def _check_app_update(self, manual=False):
        """Khởi chạy kiểm tra cập nhật ứng dụng từ Git."""
        threading.Thread(target=self._check_app_update_worker, args=(manual,), daemon=True).start()

    def _check_app_update_worker(self, manual=False):
        try:
            if manual:
                self._log("🔍 Đang kiểm tra bản cập nhật mới của ứng dụng trên GitHub...")
            info = check_latest_app_version()
            if not info:
                if manual:
                    self.after(0, self._alert, "Kiểm tra cập nhật",
                               "Không thể kết nối tới máy chủ cập nhật GitHub.\nVui lòng kiểm tra lại kết nối mạng.", "warning")
                return

            remote_ver = str(info.get('version') or '').strip()
            download_url = str(info.get('download_url') or '').strip()
            changelog = str(info.get('changelog') or '').strip()

            curr_tuple = parse_version_tuple(APP_VERSION)
            remote_tuple = parse_version_tuple(remote_ver)

            if remote_tuple > curr_tuple and download_url:
                self._log(f"🚀 Phát hiện phiên bản mới: v{APP_VERSION} ➔ v{remote_ver}!")
                msg = f"Đã có phiên bản mới v{remote_ver}!\n\n"
                if changelog:
                    msg += f"Nội dung cập nhật:\n{changelog}\n\n"
                msg += "Bạn có muốn tải xuống và tự động cập nhật ngay không?"

                def prompt_update():
                    choice = self._show_dialog(
                        "Cập nhật ứng dụng",
                        msg,
                        kind="info",
                        buttons=("Để sau", "Cập nhật ngay")
                    )
                    if choice == "Cập nhật ngay":
                        threading.Thread(target=self._perform_app_update, args=(download_url, remote_ver), daemon=True).start()

                self.after(0, prompt_update)
            else:
                if manual:
                    self.after(0, self._alert, "Cập nhật ứng dụng",
                               f"Bạn đang sử dụng phiên bản mới nhất (v{APP_VERSION}).", "info")
                else:
                    self._log(f"✅ Ứng dụng đang ở phiên bản mới nhất (v{APP_VERSION}).")
        except Exception as e:
            if manual:
                self.after(0, self._alert, "Lỗi kiểm tra cập nhật", f"Không thể kiểm tra cập nhật: {e}", "warning")
            else:
                self._log(f"ℹ Kiểm tra cập nhật ứng dụng: {e}")

    def _perform_app_update(self, download_url, remote_ver):
        self._log(f"⬇ Đang tải bản cập nhật v{remote_ver} từ GitHub...")
        self.after(0, lambda: self.status.configure(
            text=f"⬇ Đang tải bản cập nhật v{remote_ver}...", text_color="#f0c070"
        ))

        if getattr(sys, 'frozen', False):
            exe_dir = os.path.dirname(os.path.abspath(sys.executable))
            target_path = os.path.join(exe_dir, "app_update.tmp")
        else:
            target_path = os.path.join(DATA_DIR, "app_update.tmp")

        def on_prog(downloaded, total, pct):
            pct_str = f"{pct:.1f}%" if total > 0 else f"{downloaded / (1024*1024):.1f} MB"
            self.after(0, lambda p=pct_str: self.status.configure(
                text=f"⬇ Đang tải bản cập nhật v{remote_ver} ({p})...", text_color="#f0c070"
            ))

        success = download_app_update(download_url, target_path, on_progress=on_prog)
        if success and os.path.isfile(target_path) and os.path.getsize(target_path) > 1024:
            self._log(f"✅ Đã tải xong bản cập nhật v{remote_ver}. Đang khởi động lại ứng dụng để nâng cấp...")
            self.after(0, lambda: self.status.configure(
                text="✅ Đã tải xong. Đang khởi động lại...", text_color="#55efc4"
            ))
            time.sleep(1)
            apply_update_and_restart(target_path)
        else:
            self._log("❌ Không thể tải bản cập nhật từ GitHub.", level="error")
            self.after(0, self._alert, "Cập nhật thất bại",
                       "Không thể tải bản cập nhật từ Git. Vui lòng thử lại sau.", "warning")

    def _update_libraries_worker(self):
        self._log("🔍 Đang kiểm tra cập nhật ứng dụng và các thư viện...")

        # 0. Kiểm tra cập nhật ứng dụng chính
        self._check_app_update(manual=False)

        # 1. Kiểm tra FFmpeg
        if not has_ffmpeg():
            self._log("ℹ FFmpeg chưa có sẵn, đang tự động tải và kích hoạt ở nền...")
            self.after(0, self._auto_install_ffmpeg)
        else:
            self._log("✅ Thư viện FFmpeg đã sẵn sàng.")

        # 2. Kiểm tra cập nhật yt-dlp
        try:
            current_ver = getattr(yt_dlp.version, '__version__', '')
            latest_ver = check_latest_ytdlp_version()
            if not latest_ver:
                self._log("ℹ Không thể kết nối tới máy chủ cập nhật yt-dlp (bỏ qua).")
                return

            curr_tuple = parse_version_tuple(current_ver)
            late_tuple = parse_version_tuple(latest_ver)

            if late_tuple > curr_tuple:
                self._log(f"⬆ Phát hiện bản cập nhật yt-dlp mới (v{current_ver} ➔ v{latest_ver}). Đang tự động nâng cấp...")
                success = update_ytdlp_package()
                if success:
                    self._log(f"✅ Đã nâng cấp thành công yt-dlp lên phiên bản mới nhất (v{latest_ver}).")
                else:
                    self._log(f"⚠ Quá trình tự động nâng cấp yt-dlp không hoàn tất.")
            else:
                self._log(f"✅ Thư viện yt-dlp đã ở phiên bản mới nhất (v{current_ver}).")
        except Exception as e:
            self._log(f"ℹ Quá trình kiểm tra cập nhật thư viện: {str(e)[:80]}")

    # ───── Thư mục & cookie ─────

    def _open_folder(self):
        os.makedirs(self.download_path, exist_ok=True)
        os.startfile(self.download_path)

    def _pick_folder(self):
        chosen = filedialog.askdirectory(title="Chọn thư mục lưu video", initialdir=self.download_path)
        if not chosen:
            return
        self.download_path = os.path.normpath(chosen)
        os.makedirs(self.download_path, exist_ok=True)
        self.path_label.configure(text=f"📍 {self.download_path}")
        save_config({'download_path': self.download_path})

    def _import_instagram_cookie(self):
        choice = self._show_dialog(
            "Cookie Instagram",
            "Instagram thuong can phien dang nhap de tai video.\n\n"
            "Ban co the cho phep app dung cookie trinh duyet tren may nay, "
            "hoac chon file cookies.txt da xuat san.",
            kind="warning",
            buttons=("Huy", "Chon file", "Dung trinh duyet"),
        )

        if choice == "Dung trinh duyet":
            self.auto_browser_cookies_ok = True
            save_config({'auto_browser_cookies_ok': True})
            self.status.configure(text="Da bat tu dong dung cookie trinh duyet cho Instagram.", text_color="#00d084")
            self._alert("Cookie Instagram",
                        "Da bat tu dong dung cookie trinh duyet cho Instagram.\n\n"
                        "Neu Chrome dang mo va bi khoa cookie, hay dong tat ca cua so Chrome roi thu lai.",
                        "success")
            return

        if choice != "Chon file":
            return

        chosen = filedialog.askopenfilename(
            title="Chon file cookies.txt Instagram",
            filetypes=[("Cookie text files", "*.txt"), ("All files", "*.*")],
        )
        if not chosen:
            return
        try:
            shutil.copyfile(chosen, INSTAGRAM_COOKIE_FILE)
            self.status.configure(text="Da nap cookie Instagram.", text_color="#00d084")
            self._alert("Cookie Instagram", f"Da luu cookie vao:\n{INSTAGRAM_COOKIE_FILE}", "success")
        except Exception as e:
            self._alert("Cookie Instagram", f"Khong the luu file cookie:\n{e}", "error")

    def _paste_to(self, entry):
        try:
            clip = self.clipboard_get()
        except Exception:
            return
        urls = extract_urls(clip)
        value = urls[0] if urls else clip.strip()
        if not value:
            return
        entry.delete(0, "end")
        entry.insert(0, value)
        if urls:
            self.status.configure(text=f"Đã nhận diện link: {detect_platform(value)}", text_color="#55efc4")
        if entry is self.single_url and urls:
            self.after(50, self._check_and_scan_formats)

    def _on_url_key_release(self, event=None):
        if self._format_scan_timer:
            try:
                self.after_cancel(self._format_scan_timer)
            except Exception:
                pass
        self._format_scan_timer = self.after(500, self._check_and_scan_formats)

    def _check_and_scan_formats(self):
        raw_text = self.single_url.get().strip()
        urls = extract_urls(raw_text)
        if not urls:
            return
        url = urls[0]
        if url == self._last_scanned_url:
            return
        self._last_scanned_url = url
        platform = detect_platform(url)
        self.status.configure(text=f"🔍 Đang kiểm tra định dạng: {platform}...", text_color="#f0c070")
        self.q_single.configure(values=["⏳ Đang quét định dạng..."])
        self.q_single.set("⏳ Đang quét định dạng...")
        self._log(f"🔍 Đang quét định dạng video [{platform}]: {url[:60]}...")
        threading.Thread(target=self._fetch_formats_worker, args=(url,), daemon=True).start()

    def _fetch_formats_worker(self, url):
        opts = {
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 15,
        }
        if is_douyin_url(url):
            opts['http_headers'] = douyin_headers()
        elif is_instagram_url(url):
            opts['http_headers'] = instagram_headers()

        info = None
        last_err = ""
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            last_err = str(e).split('\n')[0][:180]
            if is_bot_blocked(last_err):
                self._log(f"⚠ Bị chặn Bot check, đang thử xoay vòng Proxy...", level="warning")
                for retry in range(1, 11):
                    current_proxy = proxy_manager.get_proxy()
                    if not current_proxy:
                        self._log("❌ Không tìm thấy Proxy nào phản hồi.", level="error")
                        break
                    self._log(f"🔄 Quét qua Proxy: {current_proxy} (Lần {retry}/10)...")
                    try:
                        p_opts = dict(opts)
                        p_opts['proxy'] = current_proxy
                        p_opts['socket_timeout'] = 8
                        p_opts['retries'] = 0
                        p_opts['fragment_retries'] = 0
                        p_opts['extractor_retries'] = 0
                        with yt_dlp.YoutubeDL(p_opts) as ydl:
                            info = ydl.extract_info(url, download=False)
                            if info:
                                self._log(f"✅ Quét định dạng thành công qua Proxy: {current_proxy}")
                                break
                    except Exception as pe:
                        proxy_manager.mark_proxy_dead(current_proxy)
                        last_err = str(pe).split('\n')[0][:180]
                        self._log(f"⚠ Proxy {current_proxy} lỗi: {last_err[:50]}")

        if not info:
            self._log(f"❌ Không thể quét định dạng: {last_err[:80]}", level="error")
            self.after(0, self._restore_default_qualities, f"Không thể quét định dạng: {last_err[:60]}")
            return

        parsed = parse_available_formats(info)
        self.after(0, self._apply_parsed_formats, url, info, parsed)

    def _apply_parsed_formats(self, url, info, parsed):
        current_val = self.single_url.get().strip()
        if current_val and url not in current_val:
            return

        self._custom_format_map.clear()
        options = ["Tốt Nhất (Best)"]

        if parsed:
            for label, fmt_spec in parsed:
                options.append(label)
                self._custom_format_map[label] = fmt_spec
        else:
            for label in format_map():
                if label not in ("Tốt Nhất (Best)", MP3_LABEL):
                    options.append(label)

        options.append(MP3_LABEL)
        self.q_single.configure(values=options)
        self.q_single.set(options[0])

        title = info.get('title') or 'Video'
        platform = detect_platform(url, info)
        count_str = f"{len(parsed)} mức chất lượng" if parsed else "định dạng tiêu chuẩn"
        self.status.configure(
            text=f"✅ [{platform}] {title[:45]} — Nhận diện {count_str}",
            text_color="#55efc4"
        )
        self._log(f"✅ [{platform}] {title[:45]} — Đã nhận diện {count_str}.")

    def _restore_default_qualities(self, err_msg=""):
        values = list(format_map().keys())
        self.q_single.configure(values=values)
        self.q_single.set(values[0])
        if err_msg:
            self.status.configure(text=f"⚠ {err_msg}", text_color="#f0c070")

    # ───── Điều phối tác vụ ─────

    def _set_buttons_enabled(self, enabled):
        """Khoá nút hành động khi đang chạy quét kênh / tải hàng loạt."""
        for button in self._action_buttons:
            # Nút Tải Đơn Lẻ luôn mở để người dùng có thể bấm tải thêm link mới bất kỳ lúc nào
            if button is getattr(self, 'btn_single', None):
                button.configure(state="normal")
                continue
            button.configure(state="normal" if enabled else "disabled")

    def _start_job(self, target, args):
        if self._busy:
            self._alert("Đang bận", "Đang có tác vụ chạy. Hãy đợi hoàn tất rồi thử lại.", "warning")
            return
        self._busy = True
        self._set_buttons_enabled(False)
        threading.Thread(target=target, args=args, daemon=True).start()

    def _job_done(self):
        self._busy = False
        self._set_buttons_enabled(True)

    # ───── Render lại video địa phương ─────

    def _pick_render_files(self):
        paths = filedialog.askopenfilenames(
            title="Chọn các video cần Render lại",
            filetypes=[
                ("Video files", "*.mp4 *.webm *.mkv *.mov *.avi *.flv *.ts *.m4v *.wmv *.3gp"),
                ("Tất cả file", "*.*")
            ]
        )
        if not paths:
            return
        for p in paths:
            norm = os.path.normpath(p)
            if norm not in self._render_file_paths and os.path.isfile(norm):
                self._render_file_paths.append(norm)
        self._refresh_render_file_box()

    def _pick_render_folder(self):
        folder = filedialog.askdirectory(title="Chọn thư mục chứa các video cần Render lại")
        if not folder or not os.path.isdir(folder):
            return
        video_exts = {'.mp4', '.webm', '.mkv', '.mov', '.avi', '.flv', '.ts', '.m4v', '.wmv', '.3gp'}
        found = []
        for root, _, files in os.walk(folder):
            for f in files:
                if os.path.splitext(f)[1].lower() in video_exts:
                    found.append(os.path.normpath(os.path.join(root, f)))
        if not found:
            self._alert("Thông báo", "Không tìm thấy file video nào trong thư mục đã chọn.", "info")
            return
        for p in found:
            if p not in self._render_file_paths:
                self._render_file_paths.append(p)
        self._refresh_render_file_box()

    def _clear_render_files(self):
        self._render_file_paths.clear()
        self._refresh_render_file_box()

    def _refresh_render_file_box(self):
        self.render_file_box.configure(state="normal")
        self.render_file_box.delete("1.0", "end")
        if not self._render_file_paths:
            self.render_file_box.insert("1.0", "Chưa chọn file nào. Bấm 'Chọn Video' hoặc 'Chọn Cả Thư Mục' ở trên để nạp file cần Render...")
        else:
            lines = [f"{idx}. [{os.path.basename(p)}] ({p})" for idx, p in enumerate(self._render_file_paths, start=1)]
            self.render_file_box.insert("1.0", "\n".join(lines))
        self.render_file_box.configure(state="disabled")

    def on_start_render(self):
        if not self._render_file_paths:
            self._alert("Chưa chọn file", "Vui lòng chọn ít nhất 1 file video để Render.", "warning")
            return
        if not has_ffmpeg():
            self._alert("Thiếu FFmpeg", "Ứng dụng cần FFmpeg để thực hiện Render. Vui lòng chờ FFmpeg cài xong.", "error")
            return

        files = list(self._render_file_paths)
        mode_str = self.transcode_tab_menu.get()
        out_opt = self.render_out_option.get()

        threading.Thread(target=self._render_worker_thread, args=(files, mode_str, out_opt), daemon=True).start()

    def _render_worker_thread(self, files, mode_str, out_opt):
        total = len(files)
        mode_cfg = get_transcode_config(mode_str)
        if not mode_cfg or mode_cfg.get('encoder') == 'none':
            self._alert("Chế độ render", "Vui lòng chọn chế độ Render GPU hoặc CPU (không chọn 'Không chuyển mã').", "warning")
            return

        enc_name = mode_cfg['encoder']
        is_gpu = enc_name in ('h264_nvenc', 'h264_mf', 'h264_amf', 'h264_qsv')
        mode_label = "GPU 🚀" if is_gpu else "CPU ⚙"

        self._log(f"🎬 Bắt đầu Render {total} video ({mode_label} • {enc_name})...")
        self.after(0, lambda: (self.pbar.grid(), self.pbar.set(0)))

        for idx, src_path in enumerate(files, start=1):
            if not os.path.isfile(src_path):
                self._log(f"⚠ [{idx}/{total}] File không tồn tại: {src_path}", level="warning")
                continue

            with self._task_lock:
                self._task_counter += 1
                task_id = f"Render #{self._task_counter}"

            file_name = os.path.basename(src_path)
            card = self._create_task_card(task_id, src_path, f"Render {mode_label}", title=file_name)
            card.set_status(f"⏳ Đang phân tích...", "#00cec9")
            card.set_detail("Đang đọc thông số video gốc...")

            try:
                media = probe_media(src_path)
                src_codec = (media.get('vcodec') or 'UNKNOWN').upper()
                width = media.get('width') or '?'
                height = media.get('height') or '?'

                if "thư mục Tải xuống mặc định" in out_opt:
                    out_dir = self.download_path
                else:
                    out_dir = os.path.dirname(src_path)

                os.makedirs(out_dir, exist_ok=True)
                base_name, _ = os.path.splitext(file_name)
                target_path = os.path.join(out_dir, f"{base_name}_h264.{mode_cfg['ext']}")
                counter = 1
                while os.path.exists(target_path):
                    target_path = os.path.join(out_dir, f"{base_name}_h264_{counter}.{mode_cfg['ext']}")
                    counter += 1

                self._log(f"[{task_id}] 🎬 Render: {file_name} ({src_codec}, {width}x{height}) ➔ {os.path.basename(target_path)}...")
                card.set_status(f"🎬 Render {mode_label} ({enc_name})", "#f0c070")
                card.set_detail(f"{src_codec} ({width}x{height}) ➔ H.264 MP4")
                card.add_log(f"Bắt đầu render {mode_label} ({enc_name}): {src_codec} -> H.264")

                def on_progress(ratio, c=card, fn=file_name, i=idx, t=total):
                    pct_str = f"{ratio * 100:.1f}%"
                    c.set_progress(ratio, pct_str)
                    self.after(0, lambda r=ratio, p=pct_str, f=fn, curr=i, tot=t: (
                        self.pbar.set(r),
                        self.status.configure(text=f"[{curr}/{tot}] Render {f[:30]}: {p}")
                    ))

                transcode(src_path, target_path, mode_cfg, media=media, on_progress=on_progress)

                if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
                    card.set_completed(target_path, "H.264")
                    card.add_log("Render hoàn tất thành công.")
                    self._log(f"[{task_id}] ✅ Render hoàn tất: {os.path.basename(target_path)}")
                else:
                    raise RuntimeError("File đầu ra không được tạo hoặc dung lượng rỗng.")

            except Exception as e:
                err_msg = str(e).split('\n')[0][:120]
                card.set_failed(f"Lỗi render: {err_msg}")
                self._log(f"❌ [{task_id}] Lỗi render: {err_msg}", level="error")

        self.after(0, lambda: (
            self.pbar.set(1.0),
            self.status.configure(text=f"✅ Đã hoàn thành tiến trình Render {total} video!", text_color="#55efc4")
        ))

    # ───── Tải video ─────

    def on_single(self):
        urls = extract_urls(self.single_url.get().strip())
        if not urls:
            self._alert("Lỗi", "Nhập link!", "error")
            return
        url = urls[0]
        quality = self.q_single.get()
        custom_fmt = self._custom_format_map.get(quality)

        with self._task_lock:
            self._task_counter += 1
            task_id = f"Tải #{self._task_counter}"
            self._active_downloads_count += 1

        self.pbar.grid()
        self.pbar.set(0)
        self._log(f"⚡ [{task_id}] Bắt đầu tải video (Định dạng: {quality}): {url[:60]}")
        self.status.configure(text=f"[{task_id}] Đang tải dữ liệu...", text_color="white")

        # Tạo khay hiển thị tiến trình riêng biệt cho video này
        card = self._create_task_card(task_id, url, quality, custom_fmt=custom_fmt)

        # Nút KHÔNG bị khoá — người dùng có thể nhập link tiếp theo và bấm Tải ngay lập tức
        threading.Thread(
            target=self._single_download_worker,
            args=(task_id, url, quality, custom_fmt, card),
            daemon=True
        ).start()

    def _single_download_worker(self, task_id, url, quality, custom_fmt=None, card=None):
        if card is None:
            card = self._create_task_card(task_id, url, quality, custom_fmt=custom_fmt)

        is_mp3 = quality == MP3_LABEL
        ydl_opts = self._base_ydl_opts(quality, custom_fmt=custom_fmt, card=card)
        os.makedirs(self.download_path, exist_ok=True)
        tmp = os.path.join(self.download_path, f"_tmp_{threading.get_ident()}_{time.time_ns()}.%(ext)s")

        try:
            card.set_status("⏳ Đang kết nối...", "#00cec9")
            card.set_detail(f"Đang phân tích và tải luồng video...")
            self._log(f"[{task_id}] 📥 Bắt đầu tải: {url[:60]}")
            self.after(0, lambda: self.status.configure(
                text=f"[{task_id}] Đang tải: {url[:45]}...", text_color="white"))

            info, src, last_err = self._download_one(url, ydl_opts, tmp, 1, 1, card=card)

            if not info and is_instagram_url(url):
                try:
                    info, src = instagram_public_download(url, tmp)
                except Exception as e:
                    last_err = str(e).split('\n')[0][:180] or last_err

            if not info or not src:
                err_reason = self._explain_failure(url, last_err)
                card.set_failed(err_reason)
                self._log(f"❌ [{task_id}] Tải thất bại: {err_reason[:80]}", level="error")
                self.after(0, lambda: self.status.configure(
                    text=f"❌ [{task_id}] Thất bại: {err_reason[:50]}", text_color="#ff7675"))
                with self._task_lock:
                    self._active_downloads_count = max(0, self._active_downloads_count - 1)
                return

            raw = info.get('fulltitle') or info.get('title') or ''
            if len(raw) < 5:
                raw = (info.get('description') or '').split('\n')[0] or info.get('alt_title') or 'video'
            name = clean_filename(raw, info.get('id', 'x'))
            card.set_title(raw or name)

            if is_mp3:
                mp3_path = os.path.splitext(src)[0] + ".mp3"
                if os.path.exists(mp3_path):
                    src = mp3_path

            if not os.path.exists(src):
                card.set_failed("File không tồn tại sau khi tải")
                self._log(f"❌ [{task_id}] File không tồn tại sau khi tải: {src}", level="error")
                with self._task_lock:
                    self._active_downloads_count = max(0, self._active_downloads_count - 1)
                return

            ext = os.path.splitext(src)[1]
            with self._task_lock:
                dst = os.path.join(self.download_path, f"{name}{ext}")
                counter = 1
                while os.path.exists(dst):
                    dst = os.path.join(self.download_path, f"{name} ({counter}){ext}")
                    counter += 1
                os.rename(src, dst)

            # Kiểm tra định dạng codec TRƯỚC KHI cho vào hàng chờ Render
            should_queue_render = False
            if not is_mp3:
                selected_mode = (self._transcode_menus[0].get() if getattr(self, '_transcode_menus', None)
                                 else load_config().get('transcode_mode', default_transcode_mode()))
                mode_cfg = get_transcode_config(selected_mode) if has_ffmpeg() else None
                if mode_cfg and mode_cfg.get('encoder') != 'none':
                    media = probe_media(dst)
                    if needs_transcode(media):
                        should_queue_render = True
                    else:
                        vcodec_name = (media.get('vcodec') or 'H.264').upper()
                        if card:
                            card.set_completed(dst, vcodec_name)
                            card.add_log(f"Codec video đã là {vcodec_name}, giữ nguyên file gốc.")
                        self._log(f"[{task_id}] ✅ Codec đã là {vcodec_name}, giữ nguyên không cần Render: {os.path.basename(dst)}")
                else:
                    if card:
                        card.set_completed(dst)
                    self._log(f"[{task_id}] ✅ Hoàn tất (không yêu cầu Render): {os.path.basename(dst)}")
            else:
                if card:
                    card.set_completed(dst, "MP3")
                self._log(f"[{task_id}] ✅ Hoàn tất: {os.path.basename(dst)}")

            if should_queue_render:
                card.set_status("⏳ Chờ render GPU...", "#f0c070")
                card.set_detail(f"Đã tải xong -> Đưa vào hàng đợi render tuần tự...")
                self._log(f"[{task_id}] 📥 Tải xong: {os.path.basename(dst)} ➔ Đưa vào hàng đợi render tuần tự...")
                self.after(0, lambda: self.status.configure(
                    text=f"[{task_id}] Đã tải xong, đang xếp hàng render GPU...", text_color="#f0c070"))
                # Đưa vào hàng đợi render tuần tự 1 luồng kèm tham chiếu card
                self._transcode_queue.put((task_id, dst, quality, is_mp3, info, card))
            else:
                self.after(0, lambda p=os.path.basename(dst): self.status.configure(
                    text=f"✅ Hoàn tất: {p[:50]}", text_color="#55efc4"))
                with self._task_lock:
                    self._active_downloads_count = max(0, self._active_downloads_count - 1)
                    remain = self._active_downloads_count
                if remain == 0:
                    self.after(0, lambda: (self.pbar.set(1.0), self.status.configure(
                        text="✅ Tất cả tác vụ đã hoàn tất!", text_color="#55efc4")))

        except Exception as e:
            message = str(e).split('\n')[0][:120]
            card.set_failed(message)
            self._log(f"❌ [{task_id}] Lỗi ngoại lệ: {message}", level="error")
            self.after(0, lambda: self.status.configure(
                text=f"❌ [{task_id}] Lỗi: {message[:50]}", text_color="#ff7675"))
            with self._task_lock:
                self._active_downloads_count = max(0, self._active_downloads_count - 1)

    def _global_transcode_consumer(self):
        """Luồng ngầm duy nhất xử lý hàng đợi chuyển mã/render tuần tự 1-by-1 cho toàn bộ ứng dụng."""
        while True:
            try:
                task = self._transcode_queue.get()
                if task is None:
                    self._transcode_queue.task_done()
                    break

                task_id, path, quality, is_mp3, info, card = task
                try:
                    if not is_mp3:
                        final_path = self._maybe_transcode(path, task_id, "1", card=card)
                    else:
                        final_path = path
                        if card:
                            card.set_completed(final_path, "MP3")

                    final_name = os.path.basename(final_path)
                    self._log(f"[{task_id}] ✅ Hoàn tất: {final_name}")
                    self.after(0, lambda p=final_name: self.status.configure(
                        text=f"✅ Hoàn tất: {p[:50]}", text_color="#55efc4"))
                except Exception as ex:
                    msg = str(ex).split('\n')[0][:120]
                    self._log(f"❌ [{task_id}] Lỗi render: {msg}", level="error")
                    if card:
                        card.set_failed(f"Lỗi render: {msg}")
                finally:
                    self._transcode_queue.task_done()
                    with self._task_lock:
                        self._active_downloads_count = max(0, self._active_downloads_count - 1)
                        remain = self._active_downloads_count
                    if remain == 0:
                        self.after(0, lambda: (self.pbar.set(1.0), self.status.configure(
                            text="✅ Tất cả tác vụ đã hoàn tất!", text_color="#55efc4")))
            except Exception:
                pass

    def on_bulk(self):
        urls = extract_urls(self.bulk_text.get("1.0", "end").strip())
        if not urls:
            self._alert("Lỗi", "Không tìm thấy link hợp lệ!", "error")
            return
        self._start_job(self._download_engine, (urls, self.q_bulk.get(), False))

    def _base_ydl_opts(self, quality, custom_fmt=None, card=None):
        is_mp3 = quality == MP3_LABEL
        format_spec = custom_fmt or getattr(self, '_custom_format_map', {}).get(quality) or format_map().get(quality, "bestvideo+bestaudio/best")
        
        hooks = [self._hook]
        if card:
            def card_hook(d):
                if d.get('status') == 'downloading':
                    total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                    downloaded = d.get('downloaded_bytes') or 0
                    speed = d.get('speed') or 0
                    speed_str = f"{speed / 1048576:.1f} MB/s" if speed else ""
                    if total > 0:
                        ratio = downloaded / total
                        pct_str = f"{ratio * 100:.1f}%"
                        card.set_progress(ratio, pct_str)
                        card.set_status(f"📥 Đang tải ({speed_str})" if speed_str else "📥 Đang tải...", "#00cec9")
                    else:
                        mb = downloaded / 1048576
                        card.set_status(f"📥 Đang tải ({mb:.1f} MB)", "#00cec9")
                elif d.get('status') == 'finished':
                    card.set_progress(1.0, "100.0%")
                    card.set_status("🔄 Đang xử lý file...", "#f0c070")
            hooks.append(card_hook)

        opts = {
            'format': format_spec,
            'format_sort': FORMAT_SORT,
            'quiet': True,
            'no_warnings': True,
            'noprogress': True,
            'noplaylist': True,
            'progress_hooks': hooks,
            'concurrent_fragment_downloads': 8,
            'retries': 10,
            'fragment_retries': 10,
            'http_chunk_size': 10485760,
            'socket_timeout': 30,
        }
        if has_ffmpeg():
            # yt-dlp không tự tìm được ffmpeg nằm trong thư mục dữ liệu riêng.
            opts['ffmpeg_location'] = ffmpeg_path()
        if has_ffmpeg() and not is_mp3:
            opts['merge_output_format'] = 'mp4'
        if is_mp3 and has_ffmpeg():
            opts['postprocessors'] = [
                {'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}
            ]
        return opts

    def _download_one(self, url, ydl_opts, tmp_template, index, total, card=None):
        """Thử lần lượt các cách lấy cookie; trả về (info, đường dẫn file, lỗi cuối)."""
        last_err = ""
        failed_cookie_browsers = set()
        allow_browser_cookies = self.auto_browser_cookies_ok or not is_instagram_url(url)

        for label, extra_opts in download_attempts_for(url, allow_browser_cookies):
            cookie_spec = extra_opts.get('cookiesfrombrowser')
            cookie_browser = cookie_spec[0] if isinstance(cookie_spec, tuple) and cookie_spec else None
            if cookie_browser and cookie_browser in failed_cookie_browsers:
                continue

            try:
                attempt = dict(ydl_opts)
                attempt['http_headers'] = dict(ydl_opts.get('http_headers') or {})
                if is_douyin_url(url):
                    attempt['http_headers'].update(douyin_headers())
                elif is_instagram_url(url):
                    attempt['http_headers'].update(instagram_headers())
                    attempt.update({
                        'socket_timeout': 20,
                        'retries': 3,
                        'fragment_retries': 3,
                        'extractor_retries': 1,
                    })
                attempt.update(extra_opts)
                attempt['outtmpl'] = {'default': tmp_template}

                self.after(0, lambda i=index, t=total, lb=label: self.status.configure(
                    text=f"[{i}/{t}] Đang tải ({lb})...", text_color="white"))
                if card:
                    card.set_status(f"📥 Đang tải ({label})...", "#00cec9")

                with yt_dlp.YoutubeDL(attempt) as ydl:
                    info = ydl.extract_info(url, download=True)
                    if info:
                        return info, ydl.prepare_filename(info), ""
            except Exception as e:
                last_err = str(e).split('\n')[0][:180]
                low_err = last_err.lower()
                if cookie_browser and any(k in low_err for k in
                                          ('dpapi', 'could not copy', 'cookie database', 'failed to decrypt')):
                    failed_cookie_browsers.add(cookie_browser)

        # Nếu thất bại do Bot check / 403 / IP block, tự động đổi Proxy và thử lại (tối đa 3 lần)
        if is_bot_blocked(last_err):
            self._log(f"⚠ Phát hiện chặn IP/Bot check: {last_err[:80]}", level="warning")
            if card:
                card.add_log(f"Phát hiện Bot check / chặn IP: {last_err[:60]}")
            for retry in range(1, 11):
                current_proxy = proxy_manager.get_proxy()
                if not current_proxy:
                    self._log("❌ Không tìm thấy Proxy nào còn phản hồi.", level="error")
                    if card:
                        card.add_log("Không tìm thấy Proxy nào còn hoạt động.")
                    break
                self._log(f"🔄 Đang kết nối qua Proxy: {current_proxy} (Lần {retry}/10)...")
                if card:
                    card.add_log(f"Đổi Proxy: {current_proxy} (Lần {retry}/10)")
                    card.set_status(f"🔄 Đổi Proxy ({retry}/10)...", "#f0c070")
                self.after(0, lambda i=index, t=total, r=retry, p=current_proxy: self.status.configure(
                    text=f"[{i}/{t}] 🔄 Đang đổi Proxy ({p}) thử lại ({r}/10)...", text_color="#f0c070"))
                try:
                    attempt = dict(ydl_opts)
                    attempt['http_headers'] = dict(ydl_opts.get('http_headers') or {})
                    attempt['proxy'] = current_proxy
                    attempt['socket_timeout'] = 8
                    attempt['retries'] = 0
                    attempt['fragment_retries'] = 1
                    attempt['extractor_retries'] = 0
                    attempt['concurrent_fragment_downloads'] = 1
                    attempt['outtmpl'] = {'default': tmp_template}
                    with yt_dlp.YoutubeDL(attempt) as ydl:
                        info = ydl.extract_info(url, download=True)
                        if info:
                            self._log(f"✅ Vượt Bot check thành công bằng Proxy: {current_proxy}")
                            if card:
                                card.add_log(f"Vượt Bot check thành công qua Proxy {current_proxy}")
                            return info, ydl.prepare_filename(info), ""
                except Exception as pe:
                    proxy_manager.mark_proxy_dead(current_proxy)
                    last_err = str(pe).split('\n')[0][:180]
                    self._log(f"⚠ Proxy {current_proxy} lỗi ({last_err[:50]}), đổi proxy khác...")
                    if card:
                        card.add_log(f"Proxy lỗi ({last_err[:40]}), đổi tiếp...")

        return None, None, last_err

    def _explain_failure(self, url, last_err):
        low_err = (last_err or '').lower()
        if is_douyin_url(url):
            if 'unsupported url' in low_err or '404' in low_err:
                return "Link Douyin rút gọn đã hết hạn hoặc sai. Hãy copy link mới từ Douyin."
            if any(k in low_err for k in ('cookie', 'dpapi', 'fresh cookies')):
                return "Douyin yêu cầu cookie hợp lệ. Hãy đăng nhập Douyin trên Chrome rồi thử lại."
            return last_err or "Douyin yêu cầu cookie hợp lệ hoặc link public còn hạn."
        if is_instagram_url(url):
            return f"Instagram khong lay duoc video. {instagram_missing_reason()}"
        return last_err or "Không lấy được thông tin video"

    def _download_engine(self, urls, quality, is_channel=False):
        total = len(urls)
        is_mp3 = quality == MP3_LABEL

        os.makedirs(self.download_path, exist_ok=True)
        self.after(0, lambda: (self.pbar.grid(), self.pbar.set(0)))

        selected_mode = (self._transcode_menus[0].get() if getattr(self, '_transcode_menus', None)
                         else load_config().get('transcode_mode', default_transcode_mode()))
        mode_cfg = get_transcode_config(selected_mode)
        enc_name = mode_cfg['encoder'] if mode_cfg else 'none'
        is_gpu = enc_name in ('h264_nvenc', 'h264_mf', 'h264_amf', 'h264_qsv')
        render_info = f" • Render: {'GPU (' + enc_name + ')' if is_gpu else 'CPU (' + enc_name + ')'}" if (mode_cfg and not is_mp3) else ""

        self._log(f"⚡ Bắt đầu tiến trình tải {total} video (Định dạng: {quality}{render_info})...")
        if total > 1:
            self._log(f"🧵 Kích hoạt đa luồng tải song song (3 luồng) & hàng đợi render tuần tự 1 luồng để giữ máy mượt mà.")

        # Tạo TaskCard cho từng video
        cards = {}
        for idx, url in enumerate(urls, start=1):
            with self._task_lock:
                self._task_counter += 1
                t_id = f"Tải #{self._task_counter}"
            cards[url] = self._create_task_card(t_id, url, quality)

        transcode_queue = queue.Queue()
        download_done_event = threading.Event()
        results = []
        failures = []
        lock = threading.Lock()

        # ── Luồng xử lý chuyển mã / render tuần tự 1-by-1 ──
        def transcode_consumer():
            while True:
                try:
                    item = transcode_queue.get(timeout=0.4)
                except queue.Empty:
                    if download_done_event.is_set():
                        break
                    continue

                if item is None:
                    transcode_queue.task_done()
                    break

                idx, total_count, url, item_path, info, card = item
                try:
                    if not is_mp3:
                        final_path = self._maybe_transcode(item_path, idx, total_count, card=card)
                    else:
                        final_path = item_path
                        if card:
                            card.set_completed(final_path, "MP3")

                    final_name = os.path.basename(final_path)
                    h = 0 if is_mp3 else result_height(info)
                    with lock:
                        results.append((final_name, h))
                    self._log(f"[{idx}/{total_count}] ✅ Hoàn tất: {final_name}")
                except Exception as ex:
                    msg = str(ex).split('\n')[0][:120]
                    with lock:
                        failures.append((url, f"Lỗi render: {msg}"))
                    if card:
                        card.set_failed(f"Lỗi render: {msg}")
                    self._log(f"❌ [{idx}/{total_count}] Lỗi render: {msg}", level="error")
                finally:
                    transcode_queue.task_done()

        transcode_thread = threading.Thread(target=transcode_consumer, daemon=True)
        transcode_thread.start()

        # ── Hàm tải đơn lẻ cho từng video (chạy đa luồng song song) ──
        def worker_download_one(i, url):
            card = cards.get(url)
            ydl_opts = self._base_ydl_opts(quality, card=card)
            try:
                if card:
                    card.set_status("⏳ Đang kết nối...", "#00cec9")
                    card.set_detail("Đang nạp dữ liệu video...")
                self._log(f"[{i}/{total}] 📥 Bắt đầu tải: {url[:60]}")
                self.after(0, lambda idx=i, u=url: self.status.configure(
                    text=f"[{idx}/{total}] Đang tải: {u[:50]}...", text_color="white"))

                tmp = os.path.join(self.download_path, f"_tmp_{threading.get_ident()}_{i}.%(ext)s")
                info, src, last_err = self._download_one(url, ydl_opts, tmp, i, total, card=card)

                if not info and is_instagram_url(url):
                    try:
                        info, src = instagram_public_download(url, tmp)
                    except Exception as e:
                        last_err = str(e).split('\n')[0][:180] or last_err

                if not info or not src:
                    err_reason = self._explain_failure(url, last_err)
                    if card:
                        card.set_failed(err_reason)
                    with lock:
                        failures.append((url, err_reason))
                    self._log(f"❌ [{i}/{total}] Tải thất bại: {err_reason[:80]}", level="error")
                    return

                raw = info.get('fulltitle') or info.get('title') or ''
                if len(raw) < 5:
                    raw = (info.get('description') or '').split('\n')[0] or info.get('alt_title') or 'video'
                name = clean_filename(raw, info.get('id', 'x'))
                if card:
                    card.set_title(raw or name)

                if is_mp3:
                    mp3_path = os.path.splitext(src)[0] + ".mp3"
                    if os.path.exists(mp3_path):
                        src = mp3_path

                if not os.path.exists(src):
                    if card:
                        card.set_failed("File không tồn tại sau khi tải")
                    with lock:
                        failures.append((url, "File không tồn tại sau khi tải"))
                    self._log(f"❌ [{i}/{total}] File không tồn tại sau khi tải: {src}", level="error")
                    return

                ext = os.path.splitext(src)[1]
                with lock:
                    dst = os.path.join(self.download_path, f"{name}{ext}")
                    counter = 1
                    while os.path.exists(dst):
                        dst = os.path.join(self.download_path, f"{name} ({counter}){ext}")
                        counter += 1
                    os.rename(src, dst)

                should_queue_render = False
                if not is_mp3 and mode_cfg and mode_cfg.get('encoder') != 'none':
                    media = probe_media(dst)
                    if needs_transcode(media):
                        should_queue_render = True
                    else:
                        vcodec_name = (media.get('vcodec') or 'H.264').upper()
                        if card:
                            card.set_completed(dst, vcodec_name)
                            card.add_log(f"Codec video đã là {vcodec_name}, không cần Render.")
                        self._log(f"[{i}/{total}] ✅ Codec đã là {vcodec_name}, giữ nguyên không cần Render: {os.path.basename(dst)}")
                        h = result_height(info)
                        with lock:
                            results.append((os.path.basename(dst), h))
                elif is_mp3:
                    if card:
                        card.set_completed(dst, "MP3")
                    self._log(f"[{i}/{total}] ✅ Hoàn tất: {os.path.basename(dst)}")
                    with lock:
                        results.append((os.path.basename(dst), 0))
                else:
                    if card:
                        card.set_completed(dst)
                    self._log(f"[{i}/{total}] ✅ Hoàn tất: {os.path.basename(dst)}")
                    h = result_height(info)
                    with lock:
                        results.append((os.path.basename(dst), h))

                if should_queue_render:
                    if card:
                        card.set_status("⏳ Chờ render GPU...", "#f0c070")
                        card.set_detail("Đã tải xong -> Đang xếp hàng render...")
                    self._log(f"[{i}/{total}] 📥 Tải xong: {os.path.basename(dst)} ➔ Đưa vào hàng đợi render...")
                    transcode_queue.put((i, total, url, dst, info, card))

            except Exception as e:
                message = str(e).split('\n')[0][:120]
                if card:
                    card.set_failed(message)
                with lock:
                    failures.append((url, message))
                self._log(f"❌ [{i}/{total}] Lỗi ngoại lệ: {message}", level="error")
                self.after(0, lambda err=message: self.status.configure(text=f"❌ {err[:70]}", text_color="#ff7675"))

        # ── Kích hoạt ThreadPool tải song song ──
        max_workers = min(3, max(1, total))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(worker_download_one, i, url) for i, url in enumerate(urls, start=1)]
            concurrent.futures.wait(futures)

        download_done_event.set()
        transcode_queue.join()
        transcode_thread.join()

        ok_count = len(results)
        self.after(0, self._finish, ok_count, total, is_channel, failures, results, quality)

    def _quality_report(self, results, quality):
        """Cho biết thực tế tải về được bao nhiêu, và vì sao không đạt mức đã chọn."""
        heights = [h for _, h in results if h]
        if not heights:
            return ''

        best, worst = max(heights), min(heights)
        got = label_for_height(best) if best == worst else f"{label_for_height(worst)}–{label_for_height(best)}"
        line = f"🎞 Độ phân giải: {got}"

        wanted = QUALITY_MAX_HEIGHT.get(quality)
        if wanted and best < wanted:
            line += f"\n⚠ Bạn chọn {quality} nhưng video gốc chỉ có tối đa {label_for_height(best)}."
        elif wanted is None and quality != MP3_LABEL:
            line += " (cao nhất mà video gốc có)"
        return line

    def _maybe_transcode(self, path, index, total, card=None):
        """Chuyển sang codec dựng được, nếu người dùng bật và file thật sự cần.

        Trả về đường dẫn file cuối cùng. Lỗi chuyển mã không làm hỏng bản tải:
        file gốc luôn được giữ lại cho tới khi bản mới hoàn tất.
        """
        selected_mode = (self._transcode_menus[0].get() if getattr(self, '_transcode_menus', None)
                         else load_config().get('transcode_mode', default_transcode_mode()))
        mode = get_transcode_config(selected_mode)
        if not mode or not has_ffmpeg():
            if card:
                card.set_completed(path)
            return path

        media = probe_media(path)
        if not needs_transcode(media):
            # Đã là H.264 — đụng vào chỉ tổ giảm chất lượng vô ích.
            self._log(f"[{index}/{total}] 🎬 Codec đã là H.264, giữ nguyên không cần chuyển mã.")
            self.after(0, lambda: self.status.configure(
                text=f"[{index}/{total}] Đã là H.264, không cần chuyển mã.", text_color="#55efc4"))
            if card:
                card.set_completed(path, "H.264")
                card.add_log("Codec video đã là H.264, giữ nguyên file gốc.")
            return path

        target = os.path.splitext(path)[0] + '.' + mode['ext']
        if target == path:
            target = os.path.splitext(path)[0] + f"_h264.{mode['ext']}"

        codec = media.get('vcodec', '?').upper()
        enc_display = mode['encoder']
        is_gpu = enc_display in ('h264_nvenc', 'h264_mf', 'h264_amf', 'h264_qsv')
        mode_label = "GPU 🚀" if is_gpu else "CPU ⚙"
        self._log(f"[{index}/{total}] 🎬 Đang render ({mode_label} • {enc_display}): {codec} → {mode['ext'].upper()}...")
        if card:
            card.set_status(f"🎬 Render {mode_label} ({enc_display})", "#f0c070")
            card.set_detail(f"Đang render: {codec} → {mode['ext'].upper()}...")
            card.add_log(f"Bắt đầu render ({mode_label} • {enc_display}): {codec} → {mode['ext'].upper()}")
        self.after(0, lambda: (self.pbar.set(0), self.status.configure(
            text=f"[{index}/{total}] Đang render ({mode_label} • {enc_display}): {codec} → MP4...", text_color="#f0c070")))

        def on_progress(ratio):
            pct_str = f"{ratio * 100:.1f}%"
            self.after(0, lambda: (
                self.pbar.set(ratio),
                self.status.configure(text=f"[{index}/{total}] Render {mode_label} ({enc_display}): {pct_str}"),
            ))
            if card:
                card.set_progress(ratio, pct_str)

        try:
            transcode(path, target, mode, media=media, on_progress=on_progress)
            self._log(f"[{index}/{total}] ✅ Render ({mode_label}) hoàn tất: {os.path.basename(target)}")
            if target != path and os.path.exists(target) and os.path.getsize(target) > 0:
                try:
                    os.remove(path)
                except Exception:
                    pass
            if card:
                card.set_completed(target, mode['ext'].upper())
            return target
        except Exception as e:
            fallback = get_transcode_config('H.264 — CPU, chất lượng cao nhất')
            if is_gpu and fallback:
                self._log(f"⚠ [{index}/{total}] GPU không hỗ trợ file này ({e}), tự động lùi về CPU...")
                if card:
                    card.add_log(f"GPU lỗi ({e}), chuyển sang CPU render...")
                self.after(0, lambda: self.status.configure(
                    text=f"[{index}/{total}] GPU lỗi, chuyển sang CPU...", text_color="#f0c070"))
                try:
                    target_cpu = os.path.splitext(path)[0] + '.mp4'
                    if target_cpu == path:
                        target_cpu = os.path.splitext(path)[0] + '_h264.mp4'
                    transcode(path, target_cpu, fallback, media=media, on_progress=on_progress)
                    self._log(f"[{index}/{total}] ✅ Render (CPU) hoàn tất: {os.path.basename(target_cpu)}")
                    if target_cpu != path and os.path.exists(target_cpu) and os.path.getsize(target_cpu) > 0:
                        try:
                            os.remove(path)
                        except Exception:
                            pass
                    if card:
                        card.set_completed(target_cpu, "MP4")
                    return target_cpu
                except Exception as e2:
                    self._transcode_failed(e2)
                    if card:
                        card.set_failed(f"Render CPU thất bại: {e2}")
                    return path
            else:
                self._transcode_failed(e)
                if card:
                    card.set_failed(f"Render thất bại: {e}")
                return path

    def _transcode_failed(self, error):
        message = str(error)[:90]
        self._log(f"❌ Chuyển mã thất bại: {message}", level="error")
        self.after(0, lambda: self.status.configure(
            text=f"⚠ Không chuyển mã được: {message}", text_color="#ff7675"))

    def _finish(self, ok, total, is_channel, failures, results=(), quality=''):
        self._job_done()
        self.pbar.set(1.0 if ok > 0 else 0)

        report = self._quality_report(results, quality)
        summary = f"✅ Thành công {ok}/{total}!" if ok else f"❌ Thất bại {total}/{total}"
        if ok and results:
            heights = [h for _, h in results if h]
            if heights:
                summary += f"  —  {label_for_height(max(heights))}"
        self.status.configure(text=summary, text_color="white")
        self._log(f"🏁 {summary}")

        if ok and not failures:
            what = 'video từ kênh' if is_channel else 'video'
            body = f"✅ Đã tải {ok}/{total} {what}."
            if report:
                body += f"\n{report}"
            self._alert("Kết quả", f"{body}\n📁 {self.download_path}", "success")
            return

        limit = 8 if ok else 6
        detail = "\n".join(f"❌ {u[:60]}\n   ↳ {e[:80]}" for u, e in failures[:limit])
        if len(failures) > limit:
            detail += f"\n... và {len(failures) - limit} link khác thất bại"

        if ok:
            head = f"✅ Thành công: {ok}/{total}\n❌ Thất bại: {len(failures)}"
            if report:
                head += f"\n{report}"
            self._alert("Kết quả", f"{head}\n\n{detail}", "warning")
        else:
            self._alert("Thất bại", f"Không tải được {total} video.\n\n{detail}\n\n"
                                    "💡 Kiểm tra lại link hoặc kết nối mạng.", "error")

    def _hook(self, d):
        if d['status'] == 'downloading':
            now = time.time()
            if now - self._last_hook_time < 0.25:
                return
            self._last_hook_time = now
            try:
                percent_str = d.get('_percent_str', '0%')
                percent = float(percent_str.replace('%', '').strip()) / 100
                speed = d.get('_speed_str', '')
                eta = d.get('_eta_str', '')
                self.after(0, lambda: (
                    self.pbar.set(percent),
                    self.status.configure(text=f"Đang tải: {percent_str} — {speed} — ETA: {eta}"),
                ))
            except Exception:
                pass
        elif d['status'] == 'finished':
            self.after(0, lambda: (self.pbar.set(0.95), self.status.configure(text="Đang hoàn thiện...")))


if __name__ == "__main__":
    VideoDownloaderApp().mainloop()
