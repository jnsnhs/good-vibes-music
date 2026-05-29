import os
import sys
import json
import base64
from mutagen._file import File
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4

def extract_metadata(folder_path):
    if not os.path.exists(folder_path):
        return json.dumps({"error": "Directory does not exist"})

    songs = []
    
    # Scan directory for audio files
    for file in os.listdir(folder_path):
        if file.lower().endswith(('.mp3', '.m4a')):
            file_path = os.path.join(folder_path, file)
            
            # Fallback default values
            track_info = {
                "name": file,
                "artist": "Unknown Artist",
                "album": "Unknown Album",
                "path": file_path,
                "cover": None
            }
            
            try:
                audio = File(file_path)
                if audio is not None:
                    # --- MP3 METADATA PARSING ---
                    if file.lower().endswith('.mp3'):
                        if 'TIT2' in audio: track_info["name"] = str(audio['TIT2'])
                        if 'TPE1' in audio: track_info["artist"] = str(audio['TPE1'])
                        if 'TALB' in audio: track_info["album"] = str(audio['TALB'])
                        
                        # Look for APIC tag (Attached Picture)
                        for key in audio.keys():
                            if key.startswith('APIC'):
                                apic = audio[key]
                                base64_image = base64.b64encode(apic.data).decode('utf-8')
                                track_info["cover"] = f"data:{apic.mime};base64,{base64_image}"
                                break
                                
                    # --- M4A (MP4) METADATA PARSING ---
                    elif file.lower().endswith('.m4a'):
                        if '\xa9nam' in audio: track_info["name"] = str(audio['\xa9nam'][0])
                        if '\xa9ART' in audio: track_info["artist"] = str(audio['\xa9ART'][0])
                        if '\xa9alb' in audio: track_info["album"] = str(audio['\xa9alb'][0])
                        
                        if 'covr' in audio:
                            covr = audio['covr'][0]
                            # covr data can be raw bytes or a Mutagen Image object
                            img_data = covr if isinstance(covr, bytes) else covr.data
                            base64_image = base64.b64encode(img_data).decode('utf-8')
                            track_info["cover"] = f"data:image/jpeg;base64,{base64_image}"

                songs.append(track_info)
            except Exception as e:
                # If a file is corrupted, log it and keep skipping forward
                print(f"Error parsing {file}: {str(e)}", file=sys.stderr)
                songs.append(track_info)

    return json.dumps(songs)

if __name__ == "__main__":
    # Expecting the directory path to be passed as the first CLI argument
    if len(sys.argv) > 1:
        target_dir = sys.argv[1]
        print(extract_metadata(target_dir))
    else:
        print(json.dumps({"error": "No directory path provided"}))
