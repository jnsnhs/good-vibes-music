import webview
import sqlite3
import base64
import mutagen
from mutagen._file import File
import os
import urllib.parse
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from tinytag import TinyTag

# --- NEW: Micro Local Audio Streaming Server ---
# --- UPDATED: Advanced Micro Streaming Server (Supports Seeking/HTTP 206) ---
class AudioStreamHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)
        
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
                        status_code = 206 # 206 = Partial Content
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
                        self.send_response(416) # Range Not Satisfiable
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
                        self.send_header('Content-Range', f'bytes {start_byte}-{end_byte}/{file_size}')
                        
                    self.end_headers()
                    
                    # Open the file, skip directly to the requested byte, and stream it
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
                    # The browser aborted the connection because the user seeked or skipped.
                    # We log nothing and exit gracefully.
                    return
                except Exception as e:
                    print(f"Unexpected streaming error: {e}")
        
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass # Keep terminal logs clean

def start_audio_server():
    """Runs the server on a dedicated background thread."""
    server = HTTPServer(('127.0.0.1', 65432), AudioStreamHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

def init_db():
    conn = sqlite3.connect('library.db')
    c = conn.cursor()
    # Added 'year' to the schema
    c.execute('''
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE,
            title TEXT,
            artist TEXT,
            album TEXT,
            year TEXT, 
            duration TEXT,
            cover_base64 TEXT
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
            mime = "image/png" if encoded.startswith("iVBORw0KGgo") else "image/jpeg"
            cover_base64 = f"data:{mime};base64,{encoded}"

        # Clean up the year (sometimes tags return YYYY-MM-DD, we just want YYYY)
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
    def get_library(self):
        conn = sqlite3.connect('library.db')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT file_path, title, artist, album, year, duration, cover_base64 FROM tracks")
        rows = c.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def add_music(self):
        file_types = ('Audio Files (*.mp3;*.m4a)', 'All files (*.*)')
        selected_files = webview.windows[0].create_file_dialog(
            webview.FileDialog.OPEN, 
            allow_multiple=True, 
            file_types=file_types
        )
        
        if not selected_files:
            return {"status": "cancelled"}
        
        conn = sqlite3.connect('library.db')
        c = conn.cursor()
        added_tracks = []
        
        for file_path in selected_files:
            meta = extract_metadata(file_path)
            if not meta:
                continue
                
            try:
                c.execute('''
                    INSERT INTO tracks (file_path, title, artist, album, year, duration, cover_base64) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (file_path, meta['title'], meta['artist'], meta['album'], meta['year'], meta['duration'], meta['cover']))
                
                track_data = meta.copy()
                track_data['file_path'] = file_path
                track_data['cover_base64'] = meta['cover']
                added_tracks.append(track_data)
                
            except sqlite3.IntegrityError:
                pass
                
        conn.commit()
        conn.close()
        
        if added_tracks:
            return {"status": "success", "tracks": added_tracks}
        else:
            return {"status": "duplicate"}

    # NEW: Securely remove single or multiple files from the database
    def remove_tracks(self, file_paths):
        if not file_paths:
            return {"status": "error"}
            
        conn = sqlite3.connect('library.db')
        c = conn.cursor()
        # Create SQL placeholders dynamically based on how many files we are deleting
        placeholders = ','.join('?' for _ in file_paths)
        c.execute(f"DELETE FROM tracks WHERE file_path IN ({placeholders})", file_paths)
        conn.commit()
        conn.close()
        
        return {"status": "success"}
    
    # NEW: Write metadata to MP3/M4A and update database
    def edit_track_metadata(self, file_path, new_title, new_artist, new_year):
        try:
            # 1. Update the physical file
            # easy=True gives us a unified interface for both MP3 and M4A files
            audio = File(file_path, easy=True) 
            if audio is None:
                return {"status": "error", "message": "Unsupported file format."}

            # Mutagen expects lists for values
            audio['title'] = [new_title]
            audio['artist'] = [new_artist]
            audio['date'] = [str(new_year)] # 'date' acts as the year tag across formats
            audio.save()

            # 2. Update the SQLite Database
            conn = sqlite3.connect('library.db')
            c = conn.cursor()
            c.execute('''
                UPDATE tracks 
                SET title = ?, artist = ?, year = ? 
                WHERE file_path = ?
            ''', (new_title, new_artist, str(new_year), file_path))
            conn.commit()
            conn.close()

            return {"status": "success"}

        except Exception as e:
            print(f"Error editing tag: {e}")
            return {"status": "error", "message": str(e)}

if __name__ == '__main__':
    init_db()
    start_audio_server()     
    api = Api()
    window = webview.create_window(
        title='Good Vibes Music', 
        url='gui/index.html', 
        js_api=api, 
        width=1000, 
        height=750,
        resizable=True
    )
    webview.start(debug=True)
