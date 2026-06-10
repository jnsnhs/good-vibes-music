import webview
import sqlite3
import music_tag
import base64
import os
import urllib.parse
import threading
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from tinytag import TinyTag
import time

LIBRARY_FILE = "library.db"
IMG_BROWSER_CACHE_DAYS = 30


class AudioStreamHandler(BaseHTTPRequestHandler):
    """
    Local Audio Streaming HTTP Server (Supports Seeking/HTTP 206)
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

                    # Default variables for full file transfer
                    start_byte = 0
                    end_byte = file_size - 1
                    status_code = 200

                    # Check if the browser is asking for a specific file chunk
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

                    # Safety check for boundaries
                    if start_byte >= file_size:
                        self.send_response(416)  # Range Not Satisfiable
                        self.end_headers()
                        return

                    if end_byte >= file_size:
                        end_byte = file_size - 1

                    content_length = end_byte - start_byte + 1

                    # Send response headers
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

                    # Open the file, skip directly to the requested byte, and
                    #  stream it
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

                # NEW: Catch when the browser intentionally cuts off the stream
                except (ConnectionAbortedError, ConnectionResetError):
                    # The browser aborted the connection because the user
                    # seeked or skipped.
                    # We log nothing and exit gracefully.
                    return
                except Exception as e:
                    print(f"Unexpected streaming error: {e}")

        self.send_response(404)
        self.end_headers()


def start_audio_server():
    """Runs the server on a dedicated background thread."""
    server = HTTPServer(('127.0.0.1', 65432), AudioStreamHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()


def init_db():
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


def extract_metadata(file_path):
    try:
        tag = TinyTag.get(file_path, image=True)
        duration_sec = int(tag.duration) if tag.duration else 0
        mins, secs = divmod(duration_sec, 60)
        formatted_duration = f"{mins}:{secs:02d}"
        cover_base64 = None
        image_data = tag.get_image()
        if image_data:
            encoded = base64.b64encode(image_data).decode('utf-8')
            mime = "image/png" if encoded.startswith("iVBORw0KGgo") else \
                   "image/jpeg"
            cover_base64 = f"data:{mime};base64,{encoded}"
        year = str(tag.year)[:4] if tag.year else "Unknown"
        return {
            "title": tag.title or "Unknown Title",
            "artist": tag.artist or "Unknown Artist",
            "album": tag.album or "Unknown Album",
            "year": year,
            "duration": formatted_duration,
            "cover": cover_base64
        }
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None


class Api:

    def __init__(self):
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

    def locate_missing_file(self, old_path) -> dict:
        window = webview.windows[0]
        result = window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=('Audio Files (*.mp3;*.m4a)',)
        )
        if result and len(result) > 0:
            new_path = result[0]
            conn = sqlite3.connect(LIBRARY_FILE)
            c = conn.cursor()
            c.execute(
                "UPDATE tracks SET file_path = ? WHERE file_path = ?",
                (new_path, old_path))
            conn.commit()
            conn.close()
            return {"status": "success", "new_path": new_path}
        return {"status": "cancelled"}

    # 1. The Trigger Method
    def add_music(self):
        if self.import_state["is_running"]:
            return {"status": "busy"}
        # Ask user for files
        window = webview.windows[0]
        files = window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=('Audio Files (*.mp3;*.m4a)',)
        )
        if not files:
            return {"status": "cancelled"}
        # Reset state
        self.import_state = {
            "is_running": True,
            "current": 0,
            "total": len(files),
            "new_tracks": []
        }
        # Spin up the background worker thread
        threading.Thread(
            target=self._process_files_thread,
            args=(files,),
            daemon=True
        ).start()
        return {"status": "started"}

    # 2. The Background Worker Thread
    def _process_files_thread(self, files):
        # MUST open a new connection strictly for this thread
        conn = sqlite3.connect(LIBRARY_FILE)
        c = conn.cursor()
        for file_path in files:
            try:
                # FIX 1: Tell TinyTag to extract the image data
                tag = TinyTag.get(file_path, image=True)
                title = tag.title or "Unknown"
                artist = tag.artist or "Unknown"
                album = tag.album or "Unknown"
                year = str(tag.year) if tag.year else ""
                # --- NEW METADATA EXTRACTIONS ---
                album_artist = tag.albumartist or ""
                genre = tag.genre or ""
                track_num = str(tag.track) if tag.track else ""
                disc_num = str(tag.disc) if tag.disc else ""
                comments = tag.comment or ""
                # Infer compilation status (1 for True, 0 for False)
                is_compilation = 1 if album_artist.lower() in [
                    'various artists',
                    'various'
                    ] else 0
                duration = time.strftime(
                    '%M:%S', time.gmtime(tag.duration or 0))
                # Image Extraction & Deduplication
                cover_hash = None
                image_data = tag.get_image()
                if image_data:
                    cover_hash = hashlib.md5(image_data).hexdigest()
                    art_path = os.path.join('art_cache', f"{cover_hash}.jpg")
                    if not os.path.exists(art_path):
                        with open(art_path, 'wb') as f:
                            f.write(image_data)
                c.execute('''INSERT OR IGNORE INTO tracks
                            (file_path,title, artist, album, year, duration,
                            album_artist, genre, track_num, disc_num,
                            compilation, comments, cover_hash)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                          (file_path, title, artist, album, year, duration,
                           album_artist, genre, track_num, disc_num,
                           is_compilation, comments, cover_hash))
                # FIX 2: c.rowcount will be 1 if a new row was added, and 0 if
                #  IGNORE triggered.
                # We only send data back to the JavaScript GUI if it is
                # genuinely a new track.
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
            # Increment progress counter
            self.import_state["current"] += 1
        conn.commit()
        conn.close()
        # Flag thread as done
        self.import_state["is_running"] = False

    # 3. The Polling Endpoint
    def get_import_progress(self):
        return self.import_state

    def remove_tracks_from_db(self, file_paths):
        if not file_paths:
            return {"status": "error"}
        conn = sqlite3.connect('library.db')
        c = conn.cursor()
        # Create SQL placeholders dynamically based on how many files we are
        # deleting
        placeholders = ','.join('?' for _ in file_paths)
        c.execute(
            f"DELETE FROM tracks WHERE file_path IN ({placeholders})",
            file_paths
        )
        conn.commit()
        conn.close()
        return {"status": "success"}

    def update_metadata(self, file_paths, modified_data):
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
            print(file_paths)
            print(modified_data)
            for path in file_paths:
                # 1. Update the Physical Audio File
                f = music_tag.load_file(path)
                print(modified_data.items())
                for key, val in modified_data.items():
                    if key in tag_map:
                        print(key)
                        print(tag_map[key])
                        f[tag_map[key]] = val  # type: ignore
                f.save()  # type: ignore

                # 2. Update the SQLite Database dynamically
                # We only update the columns that were actually modified
                set_clause = ", ".join(
                    [f"{k} = ?" for k in modified_data.keys()])
                values = list(modified_data.values())
                values.append(path)  # Add path for the WHERE clause
                c.execute(
                    f"UPDATE tracks SET {set_clause} WHERE file_path = ?",
                    values
                )
            conn.commit()
            status = "success"
            print(status)
        except Exception as e:
            print(f"Failed to edit metadata: {e}")
            status = "error"
        conn.close()
        return {"status": status}

    def check_file_exists(self, file_path) -> bool:
        return os.path.exists(file_path)


if __name__ == '__main__':
    init_db()
    start_audio_server()
    window = webview.create_window(
        title='Good Vibes',
        url='gui/index.html',
        js_api=Api(),
        width=900,
        height=600,
        resizable=True,
        frameless=False,
        min_size=(816, 420)
    )
    webview.start(debug=True)
