import os
import sys
import json
import base64
import sqlite3
from mutagen._file import File

# --- SAFELY TARGET USER HOME DIRECTORY ---
HOME_DIR = os.path.expanduser("~")
APP_DATA_DIR = os.path.join(HOME_DIR, ".good_vibes_amp")

# Ensure the permanent directory actually exists
if not os.path.exists(APP_DATA_DIR):
    os.makedirs(APP_DATA_DIR)

# This path remains completely safe and permanent across restarts!
DB_PATH = os.path.join(APP_DATA_DIR, "good_vibes.db")

def init_db():
    """Creates the SQLite database and all relational tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Master Tracks Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE,
            name TEXT,
            artist TEXT,
            album TEXT,
            cover TEXT
        )
    """)
    
    # 2. Playlists Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE
        )
    """)
    
    # 3. Many-to-Many Mapping Table (Links tracks to playlists)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER,
            track_id INTEGER,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
    """)
    
    conn.commit()
    conn.close()


def scan_directory(folder_path):
    """Scans a directory and streams live progress markers to stdout."""
    if not os.path.exists(folder_path):
        return json.dumps({"error": "Directory does not exist"})

    # Gather valid target files first to calculate exact percentages
    target_files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.mp3', '.m4a'))]
    total_files = len(target_files)

    if total_files == 0:
        print("STREAM_STATUS: Complete (0 files found)", flush=True)
        return get_all_tracks()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Inform frontend that processing has initialized
    print(f"STREAM_STATUS: Starting scan of {total_files} files...", flush=True)

    for index, file in enumerate(target_files):
        file_path = os.path.join(folder_path, file)
        name = file
        artist = "Unknown Artist"
        album = "Unknown Album"
        cover_str = None
        
        try:
            audio = File(file_path)
            if audio is not None:
                if file.lower().endswith('.mp3'):
                    if 'TIT2' in audio: name = str(audio['TIT2'])
                    if 'TPE1' in audio: artist = str(audio['TPE1'])
                    if 'TALB' in audio: album = str(audio['TALB'])
                    for key in audio.keys():
                        if key.startswith('APIC'):
                            base64_image = base64.b64encode(audio[key].data).decode('utf-8')
                            cover_str = f"data:{audio[key].mime};base64,{base64_image}"
                            break
                elif file.lower().endswith('.m4a'):
                    if '\xa9nam' in audio: name = str(audio['\xa9nam'][0])
                    if '\xa9ART' in audio: artist = str(audio['\xa9ART'][0])
                    if '\xa9alb' in audio: album = str(audio['\xa9alb'][0])
                    if 'covr' in audio:
                        covr = audio['covr'][0]
                        img_data = covr if isinstance(covr, bytes) else covr.data
                        base64_image = base64.b64encode(img_data).decode('utf-8')
                        cover_str = f"data:image/jpeg;base64,{base64_image}"

            cursor.execute("""
                INSERT OR IGNORE INTO tracks (path, name, artist, album, cover)
                VALUES (?, ?, ?, ?, ?)
            """, (file_path, name, artist, album, cover_str))

        except Exception as e:
            # Print errors to stderr so they don't corrupt our stdout stream pipeline
            print(f"Error parsing {file}: {str(e)}", file=sys.stderr)

        # STREAM PROGRESS MATCH LINES OUT LIVE
        # JavaScript will intercept any stdout strings starting with "STREAM_PROGRESS:"
        percent_complete = int(((index + 1) / total_files) * 100)
        print(f"STREAM_PROGRESS: {percent_complete}% | Processing: {name}", flush=True)

    conn.commit()
    conn.close()
    
    # Send a clear termination signal
    print("STREAM_STATUS: Finished parsing successfully!", flush=True)
    return get_all_tracks()

def get_all_tracks():
    """Retrieves all tracks from the database ordered by artist and track name."""
    conn = sqlite3.connect(DB_PATH)
    # Allows fetching rows as dictionaries
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, path, name, artist, album, cover FROM tracks ORDER BY artist, name")
    rows = cursor.fetchall()
    
    songs = [dict(row) for row in rows]
    conn.close()
    return json.dumps(songs)

def create_playlist(name):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO playlists (name) VALUES (?)", (name,))
        conn.commit()
    except sqlite3.IntegrityError:
        pass # Playlist name already exists
    conn.close()
    return get_playlists_data()

def add_to_playlist(playlist_id, track_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id) VALUES (?, ?)", (playlist_id, track_id))
        conn.commit()
    except Exception as e:
        print(f"Error adding to playlist: {e}", file=sys.stderr)
    conn.close()
    return get_playlists_data()

def get_playlists_data():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all playlists
    cursor.execute("SELECT id, name FROM playlists ORDER BY name")
    playlists = [dict(row) for row in cursor.fetchall()]
    
    # For each playlist, pull its associated tracks
    for pl in playlists:
        cursor.execute("""
            SELECT t.id, t.path, t.name, t.artist, t.album, t.cover 
            FROM tracks t
            JOIN playlist_tracks pt ON t.id = pt.track_id
            WHERE pt.playlist_id = ?
            ORDER BY t.artist, t.name
        """, (pl["id"],))
        pl["tracks"] = [dict(row) for row in cursor.fetchall()]
        
    conn.close()
    return json.dumps(playlists)

def delete_playlist(playlist_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        # SQLite foreign key with ON DELETE CASCADE will handle cleaning up playlist_tracks automatically!
        cursor.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        conn.commit()
    except Exception as e:
        print(f"Error deleting playlist: {e}", file=sys.stderr)
    conn.close()
    return get_playlists_data()

def remove_from_playlist(playlist_id, track_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
        conn.commit()
    except Exception as e:
        print(f"Error removing track from playlist: {e}", file=sys.stderr)
    conn.close()
    return get_playlists_data()

# --- UPDATE YOUR MAIN ROUTER BLOCK ---
if __name__ == "__main__":
    init_db()
    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "scan" and len(sys.argv) > 2:
            print(scan_directory(sys.argv[2]))
        elif command == "get_all":
            print(get_all_tracks())
        elif command == "create_playlist" and len(sys.argv) > 2:
            print(create_playlist(sys.argv[2]))
        elif command == "add_to_playlist" and len(sys.argv) > 3:
            print(add_to_playlist(sys.argv[2], sys.argv[3]))
        elif command == "get_playlists":
            print(get_playlists_data())
        # NEW UTILITY COMMAND ROUTERS
        elif command == "delete_playlist" and len(sys.argv) > 2:
            print(delete_playlist(sys.argv[2]))
        elif command == "remove_from_playlist" and len(sys.argv) > 3:
            print(remove_from_playlist(sys.argv[2], sys.argv[3]))
    else:
        print(json.dumps({"error": "No command provided"}))
