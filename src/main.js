// Import Tauri APIs for dialogs and execution
const { open } = window.__TAURI__.dialog;
const { Command } = window.__TAURI__.shell;

// DOM Elements
const btnAddFolder = document.getElementById('btn-add-folder');
const trackListContainer = document.getElementById('track-list');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playerCover = document.getElementById('player-cover');
const btnPlay = document.getElementById('btn-play');

// Progress & Volume UX Elements
const progressSlider = document.getElementById('progress-slider');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');

let currentAudio = null;
let isPlaying = false;
let updateInterval = null;

// --- INITIALIZATION (BOOTSTRAP) ---
document.addEventListener('DOMContentLoaded', () => {
  // Check if the user previously loaded a music folder
  const savedFolder = localStorage.getItem('good_vibes_music_folder');
  if (savedFolder) {
    console.log("Found persisted library path:", savedFolder);
    loadLibrary(savedFolder);
  }
});

// 1. Listen for "Add Folder" Click
btnAddFolder.addEventListener('click', async () => {
  try {
    const selectedFolder = await open({
      directory: true,
      multiple: false,
      title: 'Select your Music Directory'
    });

    if (selectedFolder) {
      // Save path to local storage before running
      localStorage.setItem('good_vibes_music_folder', selectedFolder);
      loadLibrary(selectedFolder);
    }
  } catch (err) {
    console.error("Failed to open dialog:", err);
  }
});

// 2. Pass folder path to Python sidecar
async function loadLibrary(folderPath) {
  trackListContainer.innerHTML = "<p style='padding: 16px; color: var(--text-muted);'>Scanning vibes...</p>";
  
  try {
    const command = Command.sidecar('metadata_engine', [folderPath]);
    const output = await command.execute();
    
    if (output.code === 0) {
      // Stripping out the leaked folderPath bug you fixed!
      const sanitizedOutput = output.stdout.replace(folderPath + '\r\n', '');
      const tracks = JSON.parse(sanitizedOutput);
      renderTracklist(tracks);
    } else {
      trackListContainer.innerHTML = `<p style='color: red;'>Engine error: ${output.stderr}</p>`;
    }
  } catch (err) {
    console.error("Sidecar execution failed:", err);
  }
}

// 3. Dynamically inject tracks into UI
function renderTracklist(tracks) {
  trackListContainer.innerHTML = ''; 

  if (tracks.length === 0) {
    trackListContainer.innerHTML = "<p style='padding: 16px; color: var(--text-muted);'>No files found here.</p>";
    return;
  }

  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    
    row.innerHTML = `
      <span class="track-number">${index + 1}</span>
      <div class="track-info">
        <span class="track-name">${track.name}</span>
        <span class="track-artist">${track.artist}</span>
      </div>
      <span class="track-album">${track.album}</span>
    `;

    row.addEventListener('click', () => playTrack(track));
    trackListContainer.appendChild(row);
  });
}

// 4. Native Playback & Time Tracking
function playTrack(track) {
  if (currentAudio) {
    currentAudio.pause();
    clearInterval(updateInterval);
  }

  const assetUrl = window.__TAURI__.core.convertFileSrc(track.path);
  currentAudio = new Audio(assetUrl);
  
  // Set starting volume based on slider position
  currentAudio.volume = volumeSlider.value / 100;

  currentAudio.play();

  // Reset UI elements
  playerTitle.textContent = track.name;
  playerArtist.textContent = track.artist;
  isPlaying = true;
  btnPlay.textContent = '⏸';

  if (track.cover) {
    playerCover.innerHTML = `<img src="${track.cover}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;" />`;
  } else {
    playerCover.innerHTML = '⚡';
  }

  // Handle Metadata Load for Duration Trackers
  currentAudio.addEventListener('loadedmetadata', () => {
    progressSlider.max = Math.floor(currentAudio.duration);
    timeTotal.textContent = formatTime(currentAudio.duration);
  });

  // Track Progress loop
  updateInterval = setInterval(() => {
    if (!currentAudio) return;
    progressSlider.value = Math.floor(currentAudio.currentTime);
    timeCurrent.textContent = formatTime(currentAudio.currentTime);

    // Track finished logic
    if (currentAudio.ended) {
      clearInterval(updateInterval);
      btnPlay.textContent = '▶';
      isPlaying = false;
    }
  }, 250);
}

// --- CONTROLS & TIMELINE UX EVENT LISTENERS ---

// Play / Pause Button
btnPlay.addEventListener('click', () => {
  if (!currentAudio) return;

  if (isPlaying) {
    currentAudio.pause();
    btnPlay.textContent = '▶';
  } else {
    currentAudio.play();
    btnPlay.textContent = '⏸';
  }
  isPlaying = !isPlaying;
});

// Manual Scrubbing through timeline
progressSlider.addEventListener('input', () => {
  if (!currentAudio) return;
  currentAudio.currentTime = progressSlider.value;
  timeCurrent.textContent = formatTime(currentAudio.currentTime);
});

// Dynamic Volume adjustment
volumeSlider.addEventListener('input', () => {
  if (!currentAudio) return;
  currentAudio.volume = volumeSlider.value / 100;
});

// Helper Function to convert seconds to clean timestamp MM:SS
function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
