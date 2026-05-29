const { open } = window.__TAURI__.dialog;
const { Command } = window.__TAURI__.shell;

// DOM Elements
const btnAddFolder = document.getElementById('btn-add-folder');
const trackListContainer = document.getElementById('track-list');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playerCover = document.getElementById('player-cover');
const btnPlay = document.getElementById('btn-play');
const searchBar = document.getElementById('search-bar');
const viewTitle = document.getElementById('view-title');

// Sidebar Nav Elements
const navLibrary = document.getElementById('nav-library');
const navArtists = document.getElementById('nav-artists');
const navAlbums = document.getElementById('nav-albums');
const playlistNavList = document.getElementById('playlist-nav-list');
const btnCreatePlaylist = document.getElementById('btn-create-playlist');

// Skip Controls
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// Progress & Volume UX Elements
const progressSlider = document.getElementById('progress-slider');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');

// --- RUNTIME STATE ---
let allTracks = [];             
let displayedTracks = [];       
let playlists = []; // Array of playlist objects containing nested track configurations
let currentTrackIndex = -1;     
let currentAudio = null;
let isPlaying = false;
let updateInterval = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  loadLibraryFromDatabase();
  loadPlaylistsFromDatabase();
  setupNavigation();
});

function setupNavigation() {
  navLibrary.addEventListener('click', () => {
    setActiveNav(navLibrary);
    viewTitle.textContent = "All Songs";
    displayedTracks = [...allTracks];
    renderTracklist(displayedTracks);
  });

  navArtists.addEventListener('click', () => {
    setActiveNav(navArtists);
    viewTitle.textContent = "Browse by Artist";
    renderGroupedView('artist');
  });

  navAlbums.addEventListener('click', () => {
    setActiveNav(navAlbums);
    viewTitle.textContent = "Browse by Album";
    renderGroupedView('album');
  });

  // Handle "Create Playlist" Button trigger
  btnCreatePlaylist.addEventListener('click', () => {
    const name = prompt("Enter playlist name:");
    if (name && name.trim() !== "") {
      executePlaylistCommand(['create_playlist', name.trim()]);
    }
  });
}

function setActiveNav(element) {
  // Clear out active state from all buttons in sidebar
  document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
  if (element) element.classList.add('active');
}

// Fetch Master Tracks Table Cache
async function loadLibraryFromDatabase() {
  const command = Command.sidecar('metadata_engine', ['get_all']);
  const output = await command.execute();
  if (output.code === 0) {
    const cleanJson = output.stdout.slice(output.stdout.indexOf('['), output.stdout.lastIndexOf(']') + 1);
    allTracks = JSON.parse(cleanJson);
    displayedTracks = [...allTracks];
    renderTracklist(displayedTracks);
  }
}

// Fetch Playlists relational configuration mapping data
async function loadPlaylistsFromDatabase() {
  const command = Command.sidecar('metadata_engine', ['get_playlists']);
  const output = await command.execute();
  if (output.code === 0) {
    const cleanJson = output.stdout.slice(output.stdout.indexOf('['), output.stdout.lastIndexOf(']') + 1);
    playlists = JSON.parse(cleanJson);
    renderPlaylistSidebar();
  }
}

// Utility dispatcher to mutate playlist records in background database
async function executePlaylistCommand(argssss) {
  console.log(argssss)
  const command = Command.sidecar('metadata_engine', argssss);
  const output = await command.execute();
  if (output.code === 0) {
    const cleanJson = output.stdout.slice(output.stdout.indexOf('['), output.stdout.lastIndexOf(']') + 1);
    playlists = JSON.parse(cleanJson);
    renderPlaylistSidebar();
    renderTracklist(displayedTracks); // Redraw track lists to display options changes
  }
}

// Inject customized playlist items directly into the Sidebar menu node
function renderPlaylistSidebar() {
  playlistNavList.innerHTML = '';
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = `📜 ${pl.name}`;
    
    btn.addEventListener('click', () => {
      setActiveNav(btn);
      viewTitle.textContent = pl.name;
      displayedTracks = [...pl.tracks]; // Swap queue mapping exclusively to selected playlist tracks
      renderTracklist(displayedTracks);
    });
    playlistNavList.appendChild(btn);
  });
}

function renderGroupedView(property) {
  trackListContainer.innerHTML = '';
  const groups = [...new Set(allTracks.map(track => track[property]))].sort();

  groups.forEach(groupName => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.style.gridTemplateColumns = '1fr';
    row.innerHTML = `
      <div class="track-info">
        <span class="track-name" style="font-size: 1.1rem;">${groupName}</span>
        <span class="track-artist">${allTracks.filter(t => t[property] === groupName).length} tracks available</span>
      </div>
    `;
    row.addEventListener('click', () => {
      viewTitle.textContent = `${groupName}`;
      displayedTracks = allTracks.filter(t => t[property] === groupName);
      renderTracklist(displayedTracks);
    });
    trackListContainer.appendChild(row);
  });
}

// Dynamically generate tracks table overlay display
function renderTracklist(tracks) {
  trackListContainer.innerHTML = ''; 

  if (!tracks || tracks.length === 0) {
    trackListContainer.innerHTML = "<p style='padding: 16px; color: var(--text-muted);'>No tracks inside this collection.</p>";
    return;
  }

  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    if (currentTrackIndex !== -1 && displayedTracks[currentTrackIndex]?.path === track.path) {
      row.style.backgroundColor = 'var(--bg-hover)';
      row.style.borderLeft = '3px solid var(--accent)';
    }
    
    // Create dropdown selection block options for adding track context to playlists
    let playlistOptions = `<option value="" disabled selected>➕ Add to...</option>`;
    playlists.forEach(pl => {
      playlistOptions += `<option value="${pl.id}">${pl.name}</option>`;
    });

    row.innerHTML = `
      <span class="track-number">${index + 1}</span>
      <div class="track-info">
        <span class="track-name" style="${currentTrackIndex !== -1 && displayedTracks[currentTrackIndex]?.path === track.path ? 'color: var(--accent);' : ''}">${track.name}</span>
        <span class="track-artist">${track.artist}</span>
      </div>
      <span class="track-album">${track.album}</span>
      <div>
        <select class="playlist-selector" data-trackid="${track.id}">
          ${playlistOptions}
        </select>
      </div>
    `;

    // Click track entry parameters (ignore if user clicked dropdown selection box)
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('playlist-selector')) return;
      currentTrackIndex = index;
      playTrack(track);
      renderTracklist(displayedTracks);
    });

    // Dropdown change trigger listener
    const selector = row.querySelector('.playlist-selector');
    selector.addEventListener('change', (e) => {
      const playlistId = String(e.target.value); // Ensure string conversion
      const trackId = String(track.id);          // Convert integer ID to string
      executePlaylistCommand(['add_to_playlist', playlistId, trackId]);
    });

    trackListContainer.appendChild(row);
  });
}

// Native Playback Controller
function playTrack(track) {
  if (!track) return;
  if (currentAudio) {
    currentAudio.pause();
    clearInterval(updateInterval);
  }

  const assetUrl = window.__TAURI__.core.convertFileSrc(track.path);
  currentAudio = new Audio(assetUrl);
  currentAudio.volume = volumeSlider.value / 100;
  currentAudio.play();

  playerTitle.textContent = track.name;
  playerArtist.textContent = track.artist;
  isPlaying = true;
  btnPlay.textContent = '⏸';

  if (track.cover) {
    playerCover.innerHTML = `<img src="${track.cover}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;" />`;
  } else {
    playerCover.innerHTML = '⚡';
  }

  currentAudio.addEventListener('loadedmetadata', () => {
    progressSlider.max = Math.floor(currentAudio.duration);
    timeTotal.textContent = formatTime(currentAudio.duration);
  });

  updateInterval = setInterval(() => {
    if (!currentAudio) return;
    progressSlider.value = Math.floor(currentAudio.currentTime);
    timeCurrent.textContent = formatTime(currentAudio.currentTime);

    if (currentAudio.ended) {
      handleNextTrack();
    }
  }, 250);
}

function handleNextTrack() {
  if (displayedTracks.length === 0) return;
  currentTrackIndex++;
  if (currentTrackIndex >= displayedTracks.length) currentTrackIndex = 0;
  playTrack(displayedTracks[currentTrackIndex]);
  renderTracklist(displayedTracks);
}

function handlePrevTrack() {
  if (displayedTracks.length === 0) return;
  currentTrackIndex--;
  if (currentTrackIndex < 0) currentTrackIndex = displayedTracks.length - 1;
  playTrack(displayedTracks[currentTrackIndex]);
  renderTracklist(displayedTracks);
}

// Trigger handlers for interactive layout control bars
searchBar.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  displayedTracks = allTracks.filter(track => {
    return (track.name.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query) || track.album.toLowerCase().includes(query));
  });
  renderTracklist(displayedTracks);
});

btnNext.addEventListener('click', handleNextTrack);
btnPrev.addEventListener('click', handlePrevTrack);
btnPlay.addEventListener('click', () => {
  if (!currentAudio) return;
  if (isPlaying) { currentAudio.pause(); btnPlay.textContent = '▶'; }
  else { currentAudio.play(); btnPlay.textContent = '⏸'; }
  isPlaying = !isPlaying;
});
progressSlider.addEventListener('input', () => {
  if (!currentAudio) return;
  currentAudio.currentTime = progressSlider.value;
  timeCurrent.textContent = formatTime(currentAudio.currentTime);
});
volumeSlider.addEventListener('input', () => {
  if (!currentAudio) return;
  currentAudio.volume = volumeSlider.value / 100;
});
btnAddFolder.addEventListener('click', async () => {
  try {
    const selectedFolder = await open({ directory: true, multiple: false, title: 'Select Music Folder' });
    if (selectedFolder) {
      const command = Command.sidecar('metadata_engine', ['scan', selectedFolder]);
      const output = await command.execute();
      if (output.code === 0) { loadLibraryFromDatabase(); }
    }
  } catch (err) { console.error(err); }
});
function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}