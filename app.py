import configparser
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
import music_tag
import os
import sqlite3
import threading
import time
from tinytag import TinyTag
import urllib.parse
import webview

CONFIG_FILE = "config.ini"
LIBRARY_FILE = "library.db"
IMG_BROWSER_CACHE_DAYS = 30


class HttpRequestHandler(BaseHTTPRequestHandler):
    """
    Local HTTP Server für Audio Streaming and Access to Cover Art
    """

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)

        if 'art' in query:
            hash_val = query['art'][0]
            art_path = os.path.join('art_cache', f"{hash_val}.jpg")
            if os.path.exists(art_path):
                self.send_response(200)
                self.send_header('Content-type', 'image/jpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header(
                    'Cache-Control',
                    f'public, max-age={IMG_BROWSER_CACHE_DAYS * 86400}'
                )
                self.end_headers()
                with open(art_path, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_response(404)
                self.end_headers()
                return

        if 'file' in query:
            file_path = query['file'][0]
            if os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                    range_header = self.headers.get('Range')
                    start_byte = 0
                    end_byte = file_size - 1
                    status_code = 200
                    if range_header and range_header.startswith('bytes='):
                        status_code = 206  # 206 = Partial Content
                        range_val = range_header.split('=')[1]
                        try:
                            if ',' in range_val:
                                range_val = range_val.split(',')[0]
                            start_str, end_str = range_val.split('-')
                            if start_str:
                                start_byte = int(start_str)
                            if end_str:
                                end_byte = int(end_str)
                        except ValueError:
                            pass
                    if start_byte >= file_size:
                        self.send_response(416)  # 416 = Range Not Satisfiable
                        self.end_headers()
                        return
                    if end_byte >= file_size:
                        end_byte = file_size - 1
                    content_length = end_byte - start_byte + 1
                    self.send_response(status_code)
                    if file_path.lower().endswith('.mp3'):
                        self.send_header('Content-type', 'audio/mpeg')
                    elif file_path.lower().endswith('.m4a'):
                        self.send_header('Content-type', 'audio/mp4')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Length', str(content_length))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    if status_code == 206:
                        self.send_header(
                            'Content-Range',
                            f'bytes {start_byte}-{end_byte}/{file_size}'
                            )
                    self.end_headers()
                    with open(file_path, 'rb') as f:
                        f.seek(start_byte)
                        remaining = content_length
                        chunk_size = 64 * 1024
                        while remaining > 0:
                            to_read = min(chunk_size, remaining)
                            chunk = f.read(to_read)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return
                except (ConnectionAbortedError, ConnectionResetError):
                    return
                except Exception as e:
                    print(f"Unexpected streaming error: {e}")
        self.send_response(404)
        self.end_headers()


class Api:

    def __init__(self) -> None:
        self.import_state = {
            "is_running": False,
            "current": 0,
            "total": 0,
            "new_tracks": []
        }

    def get_library(self) -> list[dict]:
        conn = sqlite3.connect(LIBRARY_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT
                file_path,
                title,
                artist,
                album,
                year,
                duration,
                album_artist,
                genre,
                track_num,
                disc_num,
                compilation,
                comments,
                cover_hash
            FROM tracks
        """)
        rows = c.fetchall()
        conn.close()
        tracks = []
        for row in rows:
            track = dict(row)
            track['missing'] = not os.path.exists(track['file_path'])
            tracks.append(track)
        return tracks

    def locate_missing_file(self, old_path: str) -> dict:
        window = webview.windows[0]
        file_paths = window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=('Audio Files (*.mp3;*.m4a)',)
        )
        if file_paths and len(file_paths) > 0:
            new_path = file_paths[0]
            conn = sqlite3.connect(LIBRARY_FILE)
            c = conn.cursor()
            c.execute(
                "UPDATE tracks SET file_path = ? WHERE file_path = ?",
                (new_path, old_path)
            )
            conn.commit()
            conn.close()
            return {"status": "success", "new_path": new_path}
        return {"status": "cancelled"}

    def add_files_to_db(self) -> dict:
        if self.import_state["is_running"]:
            return {"status": "busy"}
        window = webview.windows[0]
        file_paths = window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=('Audio Files (*.mp3;*.m4a)',)
        )
        if not file_paths:
            return {"status": "cancelled"}
        self.import_state = {
            "is_running": True,
            "current": 0,
            "total": len(file_paths),
            "new_tracks": []
        }
        threading.Thread(
            target=self._process_files_thread,
            args=(file_paths,),
            daemon=True
        ).start()
        return {"status": "started"}

    def _process_files_thread(self, file_paths: list[str]) -> None:
        conn = sqlite3.connect(LIBRARY_FILE)
        c = conn.cursor()
        for file_path in file_paths:
            try:
                tags = TinyTag.get(file_path, image=True)
                title = tags.title or "Unknown"
                artist = tags.artist or "Unknown"
                album = tags.album or ""
                year = str(tags.year) if tags.year else ""
                album_artist = tags.albumartist or ""
                genre = tags.genre or ""
                track_num = str(tags.track) if tags.track else ""
                disc_num = str(tags.disc) if tags.disc else ""
                comments = tags.comment or ""
                is_compilation = 1 if album_artist.lower() in [
                    'various artists',
                    'various'
                    ] else 0
                duration = time.strftime(
                    '%M:%S', time.gmtime(tags.duration or 0))
                cover_hash = None
                image_data = tags.get_image()
                if image_data:
                    cover_hash = hashlib.md5(image_data).hexdigest()
                    art_path = os.path.join('art_cache', f"{cover_hash}.jpg")
                    if not os.path.exists(art_path):
                        with open(art_path, 'wb') as f:
                            f.write(image_data)
                c.execute("""
                          INSERT OR IGNORE INTO tracks (
                            file_path,
                            title,
                            artist,
                            album,
                            year,
                            duration,
                            album_artist,
                            genre,
                            track_num,
                            disc_num,
                            compilation,
                            comments,
                            cover_hash
                          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                          """,
                          (file_path,
                           title,
                           artist,
                           album,
                           year,
                           duration,
                           album_artist,
                           genre,
                           track_num,
                           disc_num,
                           is_compilation,
                           comments,
                           cover_hash))
                if c.rowcount > 0:
                    self.import_state["new_tracks"].append({
                        "file_path": file_path,
                        "title": title,
                        "artist": artist,
                        "album": album,
                        "year": year,
                        "duration": duration,
                        "album_artist": album_artist,
                        "genre": genre,
                        "track_num": track_num,
                        "disc_num": disc_num,
                        "is_compilation": is_compilation,
                        "comments": comments,
                        "cover_hash": cover_hash
                    })
            except Exception as e:
                print(f"Error parsing {file_path}: {e}")
            self.import_state["current"] += 1
        conn.commit()
        conn.close()
        self.import_state["is_running"] = False

    def get_import_progress(self) -> dict:
        return self.import_state

    def remove_tracks_from_db(self, file_paths: list[str]) -> dict:
        if not file_paths:
            return {"status": "error"}
        conn = sqlite3.connect(LIBRARY_FILE)
        c = conn.cursor()
        placeholders = ','.join('?' for _ in file_paths)
        hashes_to_check = self.identify_distinct_cover_hashes(c, file_paths)
        c.execute(
            f"DELETE FROM tracks WHERE file_path IN ({placeholders})",
            file_paths
        )
        conn.commit()
        self.delete_orphaned_cover_art_from_hd(c, hashes_to_check)
        conn.close()
        return {"status": "success"}

    def identify_distinct_cover_hashes(
            self, c: sqlite3.Cursor, file_paths: list[str]
            ) -> list[str]:
        placeholders = ','.join('?' for _ in file_paths)
        c.execute(
            f"SELECT DISTINCT cover_hash FROM tracks WHERE \
            file_path IN ({placeholders}) AND cover_hash IS NOT NULL",
            file_paths)
        return [row[0] for row in c.fetchall()]

    def delete_orphaned_cover_art_from_hd(
            self, c: sqlite3.Cursor, hashes_to_check: list[str]
            ) -> None:
        for h in hashes_to_check:
            c.execute(
                "SELECT COUNT(*) FROM tracks WHERE cover_hash = ?", (h,))
            count = c.fetchone()[0]
            if count == 0:
                img_path = os.path.join("art_cache", f"{h}.jpg")
                if os.path.exists(img_path):
                    try:
                        os.remove(img_path)
                    except Exception as e:
                        print("Failed to delete orphaned cover art "
                              f"{img_path}: {e}")

    def update_metadata(
            self, file_paths: list[str], modified_data: dict
            ) -> dict:
        tag_map = {
            'title': 'title',
            'artist': 'artist',
            'album': 'album',
            'year': 'year',
            'album_artist': 'albumartist',
            'genre': 'genre',
            'track_num': 'tracknumber',
            'disc_num': 'discnumber',
            'compilation': 'compilation',
            'comments': 'comment'
        }
        conn = sqlite3.connect('library.db')
        c = conn.cursor()
        try:
            for path in file_paths:
                f = music_tag.load_file(path)
                for key, val in modified_data.items():
                    if key in tag_map:
                        f[tag_map[key]] = val  # type: ignore
                f.save()  # type: ignore
                set_clause = ", ".join(
                    [f"{k} = ?" for k in modified_data.keys()])
                values = list(modified_data.values())
                values.append(path)
                c.execute(
                    f"UPDATE tracks SET {set_clause} WHERE file_path = ?",
                    values
                )
            conn.commit()
            status = "success"
        except Exception as e:
            print(f"Failed to edit metadata: {e}")
            status = "error"
        conn.close()
        return {"status": status}

    def get_preferences(self) -> dict:
        config = configparser.ConfigParser()
        config.read(CONFIG_FILE)
        if "Preferences" not in config:
            return {}
        else:
            return dict(config["Preferences"])

    def save_preferences(self, key: str, value: str) -> None:
        config = configparser.ConfigParser()
        config.read(CONFIG_FILE)
        if "Preferences" not in config:
            config["Preferences"] = {}
        else:
            config["Preferences"][key] = str(value)
            print(config["Preferences"][key])
        with open(CONFIG_FILE, "w") as configfile:
            config.write(configfile)

    def check_file_exists(self, file_path: str) -> bool:
        return os.path.exists(file_path)

    def quit_application(self):
        window.destroy()


def init_db() -> None:
    os.makedirs('art_cache', exist_ok=True)
    conn = sqlite3.connect(LIBRARY_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE,
            title TEXT,
            artist TEXT,
            album TEXT,
            year TEXT,
            duration TEXT,
            album_artist TEXT,
            genre TEXT,
            track_num TEXT,
            disc_num TEXT,
            compilation INTEGER,
            comments TEXT,
            cover_hash TEXT
        )
    ''')
    conn.commit()
    conn.close()


def init_config() -> None:
    config = configparser.ConfigParser()
    if not os.path.exists(CONFIG_FILE):
        config["Preferences"] = {
            "accent_color": "blue",
            "show_cover_art": "True",
            "volume_normalization": "True",
            "dimmed_cover_art": "True"
        }
        with open(CONFIG_FILE, "w") as configFile:
            config.write(configFile)


def start_audio_server() -> None:
    """Runs the server on a dedicated background thread."""
    server = HTTPServer(('127.0.0.1', 65432), HttpRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()


if __name__ == '__main__':
    init_db()
    init_config()
    start_audio_server()
    window = webview.create_window(
        title='Good Vibes',
        url='gui/index.html',
        js_api=Api(),
        width=900,
        height=600,
        resizable=True,
        frameless=False,
        min_size=(816, 584)
    )
    webview.start(debug=True)
