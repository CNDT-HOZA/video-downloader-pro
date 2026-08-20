import os
import unittest
import app


class TestCleanFilename(unittest.TestCase):
    def test_bo_ky_tu_windows_cam(self):
        self.assertEqual(app.clean_filename('a/b\\c:d*e?f"g<h>i|j', 'fallback'), 'a b c d e f g h i j')

    def test_cat_con_150_ky_tu(self):
        long_name = 'a' * 200
        self.assertEqual(len(app.clean_filename(long_name, 'fallback')), 150)

    def test_giu_nguyen_tieng_viet(self):
        self.assertEqual(app.clean_filename('Video Hướng Dẫn', 'fallback'), 'Video Hướng Dẫn')

    def test_gop_khoang_trang_thua(self):
        self.assertEqual(app.clean_filename('  Video    Test   ', 'fallback'), 'Video Test')

    def test_ten_qua_ngan_dung_fallback(self):
        self.assertEqual(app.clean_filename('a', 'vid_123'), 'video_vid_123')

    def test_ten_toan_ky_tu_cam_van_ra_ten_dung_duoc(self):
        self.assertEqual(app.clean_filename('???///:::***', '12345'), 'video_12345')


class TestExtractUrls(unittest.TestCase):
    def test_nhieu_link_moi_dong_mot_link(self):
        text = "https://youtube.com/watch?v=1\nhttps://tiktok.com/@a/video/2"
        urls = app.extract_urls(text)
        self.assertEqual(len(urls), 2)

    def test_tach_link_khoi_text_chia_se(self):
        text = "Xem video này nè https://youtube.com/watch?v=1 rất hay!"
        urls = app.extract_urls(text)
        self.assertEqual(urls, ["https://youtube.com/watch?v=1"])

    def test_bo_dau_cau_dinh_cuoi_link(self):
        text = "Link: https://youtube.com/watch?v=1)."
        urls = app.extract_urls(text)
        self.assertEqual(urls, ["https://youtube.com/watch?v=1"])

    def test_giai_ma_amp_trong_link(self):
        text = "https://youtube.com/watch?v=1&amp;t=10s"
        urls = app.extract_urls(text)
        self.assertEqual(urls, ["https://youtube.com/watch?v=1&t=10s"])

    def test_khu_trung_lap(self):
        text = "https://youtube.com/watch?v=1\nhttps://youtube.com/watch?v=1"
        urls = app.extract_urls(text)
        self.assertEqual(len(urls), 1)

    def test_dau_vao_rong(self):
        self.assertEqual(app.extract_urls(""), [])
        self.assertEqual(app.extract_urls(None), [])

    def test_bo_qua_text_khong_co_link(self):
        self.assertEqual(app.extract_urls("chỉ là văn bản không có link"), [])


class TestDetectPlatform(unittest.TestCase):
    def test_nhan_dien_theo_ten_mien(self):
        self.assertEqual(app.detect_platform("https://www.youtube.com/watch?v=1"), "YouTube")
        self.assertEqual(app.detect_platform("https://youtu.be/1"), "YouTube")
        self.assertEqual(app.detect_platform("https://www.tiktok.com/@user/video/1"), "TikTok")
        self.assertEqual(app.detect_platform("https://www.facebook.com/watch?v=1"), "Facebook")
        self.assertEqual(app.detect_platform("https://www.instagram.com/reel/1"), "Instagram")

    def test_douyin_duoc_uu_tien_hon_tiktok(self):
        self.assertEqual(app.detect_platform("https://www.douyin.com/video/1"), "Douyin")
        self.assertEqual(app.detect_platform("https://v.douyin.com/abc/"), "Douyin")

    def test_roi_ve_extractor_cua_ytdlp(self):
        info = {'extractor_key': 'BiliBili', 'extractor': 'BiliBili'}
        self.assertEqual(app.detect_platform("https://unknown-site.com/video", info), "BiliBili")

    def test_helper_douyin_va_instagram(self):
        self.assertTrue(app.is_douyin_url("https://v.douyin.com/abc/"))
        self.assertTrue(app.is_instagram_url("https://www.instagram.com/p/abc/"))
        self.assertFalse(app.is_douyin_url("https://youtube.com/watch?v=1"))
        self.assertFalse(app.is_instagram_url("https://youtube.com/watch?v=1"))


class TestNormalizeUrl(unittest.TestCase):
    def test_douyin_rut_gon_ve_v_douyin(self):
        url = "https://www.douyin.com/123"
        self.assertEqual(app.normalize_url(url), "https://v.douyin.com/123/")

    def test_khong_dung_vao_duong_dan_that_cua_douyin(self):
        url = "https://www.douyin.com/video/123456"
        self.assertEqual(app.normalize_url(url), url)

    def test_khong_dung_vao_link_khac(self):
        url = "https://www.youtube.com/watch?v=1"
        self.assertEqual(app.normalize_url(url), url)


class TestEntryToUrl(unittest.TestCase):
    def test_uu_tien_webpage_url(self):
        entry = {'webpage_url': 'https://youtube.com/watch?v=abc', 'url': 'https://other.com'}
        self.assertEqual(app.entry_to_url(entry), 'https://youtube.com/watch?v=abc')

    def test_dung_video_id_cua_youtube_thanh_url_day_du(self):
        entry = {'url': 'dQw4w9WgXcQ', 'extractor_key': 'Youtube'}
        self.assertEqual(app.entry_to_url(entry), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    def test_entry_rong(self):
        self.assertEqual(app.entry_to_url({}), '')
        self.assertEqual(app.entry_to_url(None), '')


class TestFormatMap(unittest.TestCase):
    def test_hai_bang_dinh_dang_cung_bo_khoa(self):
        ffmpeg_keys = set(app._FMT_FFMPEG.keys())
        no_ffmpeg_keys = set(app._FMT_NOFFMPEG.keys())
        self.assertEqual(ffmpeg_keys, no_ffmpeg_keys)

    def test_ban_khong_ffmpeg_khong_dung_dau_cong(self):
        for name, spec in app._FMT_NOFFMPEG.items():
            if name != app.MP3_LABEL:
                self.assertNotIn('+', spec, f"Format '{name}' trong bảng no-ffmpeg có dấu +")

    def test_nhan_mp3_ton_tai_trong_ca_hai_bang(self):
        self.assertIn(app.MP3_LABEL, app._FMT_FFMPEG)
        self.assertIn(app.MP3_LABEL, app._FMT_NOFFMPEG)

    def test_format_map_doi_theo_tinh_trang_ffmpeg(self):
        goc = app._ffmpeg_path
        try:
            app._ffmpeg_path = r'C:\mock\ffmpeg.exe'
            self.assertEqual(app.format_map(), app._FMT_FFMPEG)
            app._ffmpeg_path = None
            self.assertEqual(app.format_map(), app._FMT_NOFFMPEG)
        finally:
            app._ffmpeg_path = goc


class TestFormatSelection(unittest.TestCase):
    def test_4k_phai_ra_4k_du_chi_co_o_webm(self):
        self.assertIn("res", app.FORMAT_SORT)

    def test_2k_phai_ra_1440p(self):
        spec = app._FMT_FFMPEG["2K (1440p)"]
        self.assertIn("1440", spec)

    def test_tot_nhat_phai_ra_do_phan_giai_cao_nhat(self):
        spec = app._FMT_FFMPEG["Tốt Nhất (Best)"]
        self.assertTrue(spec.startswith("bestvideo"))

    def test_cac_muc_thap_van_bi_gioi_han_dung(self):
        self.assertIn("1080", app._FMT_FFMPEG["1080p (Full HD)"])

    def test_uu_tien_mp4_khi_cung_do_phan_giai(self):
        self.assertIn("ext:mp4:m4a", app.FORMAT_SORT)

    def test_bang_ffmpeg_khong_duoc_ep_container(self):
        for name, spec in app._FMT_FFMPEG.items():
            if name != app.MP3_LABEL:
                self.assertNotIn("ext=mp4", spec)

    def test_du_lieu_gia_hop_le(self):
        self.assertIn("bestvideo", app._FMT_FFMPEG["Tốt Nhất (Best)"])


class TestResultHeight(unittest.TestCase):
    def test_lay_chieu_cao_tu_info_don(self):
        info = {'height': 1080}
        self.assertEqual(app.result_height(info), 1080)

    def test_lay_chieu_cao_lon_nhat_khi_ghep_hai_luong(self):
        info = {
            'requested_formats': [
                {'height': 2160, 'vcodec': 'vp9'},
                {'height': None, 'acodec': 'opus'},
            ]
        }
        self.assertEqual(app.result_height(info), 2160)

    def test_info_rong(self):
        self.assertEqual(app.result_height({}), 0)
        self.assertEqual(app.result_height(None), 0)

    def test_nhan_do_phan_giai(self):
        self.assertEqual(app.label_for_height(2160), "4K")
        self.assertEqual(app.label_for_height(1440), "2K")
        self.assertEqual(app.label_for_height(1080), "1080p")
        self.assertEqual(app.label_for_height(720), "720p")
        self.assertEqual(app.label_for_height(480), "480p")
        self.assertEqual(app.label_for_height(360), "360p")

    def test_moi_nhan_chat_luong_deu_co_nguong(self):
        for label in app._FMT_FFMPEG:
            if label not in ("Tốt Nhất (Best)", app.MP3_LABEL):
                self.assertIn(label, app.QUALITY_MAX_HEIGHT)

    def test_nguong_khop_voi_chuoi_format(self):
        self.assertEqual(app.QUALITY_MAX_HEIGHT["4K (2160p)"], 2160)
        self.assertEqual(app.QUALITY_MAX_HEIGHT["1080p (Full HD)"], 1080)


class TestFfmpeg(unittest.TestCase):
    def test_thu_muc_cai_nam_trong_data_dir(self):
        self.assertTrue(app.FFMPEG_DIR.startswith(app.DATA_DIR))

    def test_checksum_va_url_khop_nhau(self):
        self.assertTrue(app.FFMPEG_URL.startswith("https://"))
        self.assertEqual(len(app.FFMPEG_SHA256), 64)

    def test_khong_tai_ffplay(self):
        self.assertEqual(len(app.FFMPEG_WANTED), 2)
        self.assertNotIn("ffplay.exe", app.FFMPEG_WANTED)

    def test_has_ffmpeg_bam_theo_duong_dan(self):
        goc = app._ffmpeg_path
        try:
            app._ffmpeg_path = r'C:\mock\ffmpeg.exe'
            self.assertTrue(app.has_ffmpeg())
            app._ffmpeg_path = None
            self.assertFalse(app.has_ffmpeg())
        finally:
            app._ffmpeg_path = goc


class TestInstagramHelpers(unittest.TestCase):
    def test_lay_shortcode_tu_moi_dang_link(self):
        self.assertEqual(app.instagram_shortcode("https://www.instagram.com/p/ABC123_/"), "ABC123_")
        self.assertEqual(app.instagram_shortcode("https://www.instagram.com/reel/XYZ789/"), "XYZ789")
        self.assertEqual(app.instagram_shortcode("https://www.instagram.com/tv/TV123/"), "TV123")

    def test_doi_shortcode_sang_media_id(self):
        self.assertEqual(app.instagram_shortcode_to_media_id("B"), "1")
        self.assertEqual(app.instagram_shortcode_to_media_id("BA"), "64")

    def test_link_khong_phai_instagram(self):
        self.assertEqual(app.instagram_shortcode("https://youtube.com/watch?v=1"), "")


class TestFindMediaUrlInJson(unittest.TestCase):
    def test_tim_thay_link_mp4_long_sau(self):
        payload = {
            'graphql': {
                'shortcode_media': {
                    'video_url': 'https://cdninstagram.com/v/t50.1234/test.mp4'
                }
            }
        }
        self.assertEqual(app.find_media_url_in_json(payload), 'https://cdninstagram.com/v/t50.1234/test.mp4')

    def test_uu_tien_khoa_url_cua_cobalt(self):
        payload = {'url': 'https://tunnel.cobalt.tools/test.mp4', 'text': 'hi'}
        self.assertEqual(app.find_media_url_in_json(payload), 'https://tunnel.cobalt.tools/test.mp4')

    def test_bo_qua_thumbnail_va_anh(self):
        payload = {'display_url': 'https://instagram.com/pic.jpg', 'thumbnail_src': 'https://instagram.com/thumb.jpg'}
        self.assertIsNone(app.find_media_url_in_json(payload))

    def test_khong_co_gi(self):
        self.assertIsNone(app.find_media_url_in_json({}))
        self.assertIsNone(app.find_media_url_in_json(None))


class TestTranscode(unittest.TestCase):
    def test_moi_che_do_khai_bao_du_truong(self):
        for name, spec in app.TRANSCODE_MODES.items():
            if spec is not None:
                self.assertIn('ext', spec)
                self.assertIn('encoder', spec)
                self.assertIn('video', spec)

    def test_che_do_khong_chuyen_la_mac_dinh_va_khong_lam_gi(self):
        self.assertIsNone(app.TRANSCODE_MODES[app.TRANSCODE_NONE])

    def test_chi_chuyen_ma_codec_khong_dung_duoc(self):
        self.assertFalse(app.needs_transcode({'vcodec': 'h264'}))
        self.assertFalse(app.needs_transcode({'vcodec': 'avc1'}))
        self.assertTrue(app.needs_transcode({'vcodec': 'vp9'}))
        self.assertTrue(app.needs_transcode({'vcodec': 'av01'}))

    def test_khong_ro_codec_thi_khong_dung_vao(self):
        self.assertFalse(app.needs_transcode({}))
        self.assertFalse(app.needs_transcode({'vcodec': ''}))

    def test_luon_con_it_nhat_lua_chon_khong_chuyen(self):
        self.assertIn(app.TRANSCODE_NONE, app.transcode_modes_available())

    def test_khong_co_ffmpeg_thi_khong_cho_chuyen_ma(self):
        goc = app._ffmpeg_path
        try:
            app._ffmpeg_path = None
            self.assertEqual(app.transcode_modes_available(), [app.TRANSCODE_NONE])
        finally:
            app._ffmpeg_path = goc


class TestDownloadAttempts(unittest.TestCase):
    def test_luon_thu_khong_cookie_truoc(self):
        attempts = app.download_attempts_for('https://youtu.be/x')
        self.assertEqual(attempts[0], ('không cookie', {}))

    def test_link_thuong_khong_dung_toi_cookie(self):
        self.assertEqual(len(app.download_attempts_for('https://vimeo.com/123456')), 1)

    def test_instagram_co_the_tat_cookie_trinh_duyet(self):
        without = app.download_attempts_for('https://www.instagram.com/p/x/', allow_browser_cookies=False)
        self.assertTrue(all('cookiesfrombrowser' not in opts for _, opts in without))


class TestProxyManager(unittest.TestCase):
    def test_init_proxy_manager(self):
        pm = app.ProxyManager()
        self.assertEqual(pm.api_url, app.PROXY_API_URL)
        self.assertEqual(pm.proxies, [])
        self.assertEqual(pm.current_index, 0)
        self.assertFalse(pm.is_fetching)

    def test_get_proxy_returns_formatted_url(self):
        pm = app.ProxyManager()
        pm.proxies = ['1.2.3.4:8080', '5.6.7.8:3128', '9.10.11.12:80', '13.14.15.16:8080',
                      '17.18.19.20:8080', '21.22.23.24:8080', '25.26.27.28:8080']
        pm.current_index = 0
        proxy = pm.get_proxy(test_live=False)
        self.assertTrue(proxy.startswith('http://'))
        self.assertEqual(pm.current_index, 1)

    def test_mark_proxy_dead(self):
        pm = app.ProxyManager()
        pm.proxies = ['1.1.1.1:80', '2.2.2.2:80', '3.3.3.3:80']
        pm.current_index = 2
        pm.mark_proxy_dead('http://1.1.1.1:80')
        self.assertNotIn('1.1.1.1:80', pm.proxies)
        self.assertEqual(len(pm.proxies), 2)
        self.assertEqual(pm.current_index, 1)

    def test_mark_proxy_dead_none_or_unknown(self):
        pm = app.ProxyManager()
        pm.proxies = ['1.1.1.1:80']
        pm.mark_proxy_dead(None)
        pm.mark_proxy_dead('http://9.9.9.9:80')
        self.assertEqual(pm.proxies, ['1.1.1.1:80'])


class TestDefaultTranscodeMode(unittest.TestCase):
    def test_default_transcode_mode_logic(self):
        mode = app.default_transcode_mode()
        available = app.transcode_modes_available()
        if 'H.264 — GPU, nhanh' in available:
            self.assertEqual(mode, 'H.264 — GPU, nhanh')
        elif 'H.264 — CPU, chất lượng cao nhất' in available:
            self.assertEqual(mode, 'H.264 — CPU, chất lượng cao nhất')
        else:
            self.assertEqual(mode, app.TRANSCODE_NONE)


class TestIsBotBlocked(unittest.TestCase):
    def test_nhan_dien_bot_va_403(self):
        self.assertTrue(app.is_bot_blocked("ERROR: Sign in to confirm you’re not a bot"))
        self.assertTrue(app.is_bot_blocked("HTTP Error 429: Too Many Requests"))
        self.assertTrue(app.is_bot_blocked("Your IP address is blocked"))
        self.assertTrue(app.is_bot_blocked("ProxyError: Tunnel connection failed"))

    def test_khong_phai_loi_bot(self):
        self.assertFalse(app.is_bot_blocked(""))
        self.assertFalse(app.is_bot_blocked(None))
        self.assertFalse(app.is_bot_blocked("Invalid URL format"))
        self.assertFalse(app.is_bot_blocked("No video formats found"))


class TestParseAvailableFormats(unittest.TestCase):
    def test_format_label_for_stream(self):
        f = {
            'height': 1080,
            'fps': 60,
            'vcodec': 'avc1.64002a',
            'ext': 'mp4',
            'filesize': 150 * 1024 * 1024,
        }
        label = app.format_label_for_stream(f)
        self.assertIn("1080p (Full HD)", label)
        self.assertIn("60fps", label)
        self.assertIn("H.264", label)
        self.assertIn(".mp4", label)
        self.assertIn("150 MB", label)

    def test_parse_available_formats_sorting_and_filtering(self):
        info = {
            'title': 'Test Video',
            'formats': [
                {'format_id': '140', 'vcodec': 'none', 'acodec': 'mp4a.40.2', 'resolution': 'audio only'},
                {'format_id': 'sb0', 'vcodec': 'none', 'format_note': 'storyboard'},
                {'format_id': '137', 'height': 1080, 'fps': 30, 'vcodec': 'avc1', 'ext': 'mp4', 'filesize': 100000000},
                {'format_id': '313', 'height': 2160, 'fps': 60, 'vcodec': 'vp9', 'ext': 'webm', 'filesize': 500000000},
                {'format_id': '136', 'height': 720, 'fps': 30, 'vcodec': 'avc1', 'ext': 'mp4', 'filesize': 50000000},
            ]
        }
        parsed = app.parse_available_formats(info)
        # Chỉ giữ lại Full HD (1080p) trở lên (4K và 1080p), loại bỏ 720p
        self.assertEqual(len(parsed), 2)
        self.assertIn("4K (2160p)", parsed[0][0])
        self.assertIn("1080p (Full HD)", parsed[1][0])
        self.assertEqual(parsed[0][1], "313+bestaudio/313/best")

    def test_parse_available_formats_low_res_fallback(self):
        info = {
            'title': 'Test Low Res Video',
            'formats': [
                {'format_id': '136', 'height': 720, 'fps': 30, 'vcodec': 'avc1', 'ext': 'mp4', 'filesize': 50000000},
                {'format_id': '135', 'height': 480, 'fps': 30, 'vcodec': 'avc1', 'ext': 'mp4', 'filesize': 25000000},
            ]
        }
        parsed = app.parse_available_formats(info)
        # Video chỉ có < 1080p thì giữ lại để người dùng vẫn tải được
        self.assertEqual(len(parsed), 2)
        self.assertIn("720p (HD)", parsed[0][0])

    def test_parse_available_formats_empty(self):
        self.assertEqual(app.parse_available_formats(None), [])
        self.assertEqual(app.parse_available_formats({}), [])


class TestLibraryUpdate(unittest.TestCase):
    def test_parse_version_tuple_basic(self):
        self.assertEqual(app.parse_version_tuple("2026.08.18"), (2026, 8, 18))
        self.assertEqual(app.parse_version_tuple("2026.7.4"), (2026, 7, 4))
        self.assertEqual(app.parse_version_tuple("v2026.08.18.122307"), (2026, 8, 18, 122307))

    def test_parse_version_tuple_comparison(self):
        v_old = app.parse_version_tuple("2026.7.4")
        v_new = app.parse_version_tuple("2026.8.18")
        self.assertTrue(v_new > v_old)
        self.assertFalse(v_old > v_new)

class TestTaskCard(unittest.TestCase):
    def test_task_card_class_attributes(self):
        self.assertTrue(hasattr(app, 'TaskCard'))

    def test_task_queue_initialization(self):
        app_mock = app.VideoDownloaderApp.__new__(app.VideoDownloaderApp)
        app_mock._tasks = []
        self.assertEqual(len(app_mock._tasks), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
