const { open, ask } = window.__TAURI__.dialog;
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
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');

// --- NEW STATE ENGINE REGISTERS ---
let isShuffleOn = false;
let repeatMode = 'off'; // Options: 'off', 'one', 'all'
let shuffledIndices = []; // Maps randomized track numbers
let shufflePointer = 0;   // Where we are inside the shuffled deck

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
    trackListContainer.removeAttribute('data-active-playlist-id'); // Clear out active playlist reference
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
    // Create a container wrapper for the playlist button and its trash icon
    const container = document.createElement('div');
    container.className = 'playlist-sidebar-row';
    
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = `📜 ${pl.name}`;
    
    btn.addEventListener('click', () => {
      setActiveNav(btn);
      viewTitle.textContent = pl.name;
      // Store the active playlist ID context globally on the HTML node for removal reference!
      trackListContainer.setAttribute('data-active-playlist-id', pl.id);
      displayedTracks = [...pl.tracks];
      renderTracklist(displayedTracks);
    });

    const trashBtn = document.createElement('button');
    trashBtn.className = 'btn-trash';
    trashBtn.innerHTML = '🗑️';
    trashBtn.title = `Delete ${pl.name}`;
    
    trashBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Stop sidebar navigation from firing
      
      // Fire Tauri's premium native OS dialogue box
      const confirmation = await ask(
        `Are you sure you want to permanently delete "${pl.name}"?`, 
        { title: 'Good Vibes Amp', type: 'warning' }
      );
      
      // 'confirmation' will return true ONLY if the user clicks "Yes/OK"
      if (confirmation) {
        if (viewTitle.textContent === pl.name) {
          navLibrary.click();
        }
        executePlaylistCommand(['delete_playlist', String(pl.id)]);
      }
    });

    container.appendChild(btn);
    container.appendChild(trashBtn);
    playlistNavList.appendChild(container);
  });
}

// Upgraded Grouped View Router to render text rows for Artists, and a Visual Grid for Albums!
function renderGroupedView(property) {
  trackListContainer.innerHTML = '';
  
  // Extract unique group values
  const groups = [...new Set(allTracks.map(track => track[property]))].sort();

  if (groups.length === 0) {
    trackListContainer.innerHTML = "<p style='padding:16px; color:var(--text-muted);'>No items found.</p>";
    return;
  }

  // --- CONDITION 1: RENDER ALBUM VISUAL ART GRID ---
  if (property === 'album') {
    // Add our grid class to the container dynamically
    trackListContainer.className = 'album-grid';

    groups.forEach(albumName => {
      // Find the first track in this album to use its cover art as the jacket!
      const representativeTrack = allTracks.find(t => t.album === albumName);
      const coverArtData = representativeTrack?.cover;
      const artistName = representativeTrack?.artist || "Unknown Artist";

      const card = document.createElement('div');
      card.className = 'album-card';

      // Set up the card HTML structure with fallback lightning emblem if no art exists
      card.innerHTML = `
        <div class="album-card-cover">
          ${coverArtData ? `<img src="${coverArtData}" alt="Album Cover" />` : '⚡'}
        </div>
        <div class="album-card-title" title="${albumName}">${albumName}</div>
        <div class="album-card-artist" title="${artistName}">${artistName}</div>
      `;

      // Clicking an album card opens its dedicated tracklist view!
      card.addEventListener('click', () => {
        // Reset container classes back to standard track layout list style
        trackListContainer.className = '';
        viewTitle.textContent = `${albumName}`;
        displayedTracks = allTracks.filter(t => t.album === albumName);
        renderTracklist(displayedTracks);
      });

      trackListContainer.appendChild(card);
    });

  // --- CONDITION 2: RENDER ARTIST LIST ROWS ---
  } else {
    // Reset wrapper classes back to linear track list styling layout
    trackListContainer.className = '';

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
}

// Dynamically generate tracks table overlay display
function renderTracklist(tracks) {
  trackListContainer.className = ''; // Reset container layout grid class configuration frame!
  trackListContainer.innerHTML = '';
  // ... rest of your code remains the same

  if (!tracks || tracks.length === 0) {
    trackListContainer.innerHTML = "<p style='padding: 16px; color: var(--text-muted);'>No tracks inside this collection.</p>";
    return;
  }

  // Determine if we are looking at a playlist view by checking sidebar active states
  const activePlaylistBtn = playlistNavList.querySelector('.menu-item.active');
  const isPlaylistView = activePlaylistBtn !== null;
  const activePlaylistId = trackListContainer.getAttribute('data-active-playlist-id');

  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    if (currentTrackIndex !== -1 && displayedTracks[currentTrackIndex]?.path === track.path) {
      row.style.backgroundColor = 'var(--bg-hover)';
      row.style.borderLeft = '3px solid var(--accent)';
    }
    
    let playlistOptions = `<option value="" disabled selected>➕ Add to...</option>`;
    playlists.forEach(pl => {
      playlistOptions += `<option value="${pl.id}">${pl.name}</option>`;
    });

    // Contextual Action Button item: Show dropdown selector if in Library view, or Trash can if inside custom Playlist view!
    const actionCell = isPlaylistView 
      ? `<button class="btn-trash row-remove-btn" title="Remove from playlist">🗑️</button>`
      : `<div><select class="playlist-selector">${playlistOptions}</select></div>`;

    row.innerHTML = `
      <span class="track-number">${index + 1}</span>
      <div class="track-info">
        <span class="track-name" style="${currentTrackIndex !== -1 && displayedTracks[currentTrackIndex]?.path === track.path ? 'color: var(--accent);' : ''}">${track.name}</span>
        <span class="track-artist">${track.artist}</span>
      </div>
      <span class="track-album">${track.album}</span>
      ${isPlaylistView ? '<div></div>' + actionCell : actionCell + '<div></div>'}
    `;

    // Row Click Interceptor 
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('playlist-selector') || e.target.classList.contains('row-remove-btn')) return;
      currentTrackIndex = index;
      playTrack(track);
      renderTracklist(displayedTracks);
    });

    // If it's a library view, attach dropdown event listener
    if (!isPlaylistView) {
      const selector = row.querySelector('.playlist-selector');
      selector.addEventListener('change', (e) => {
        executePlaylistCommand(['add_to_playlist', String(e.target.value), String(track.id)]);
      });
    } else {
      // If it's a playlist view, attach track entry removal event listener
      const removeBtn = row.querySelector('.row-remove-btn');
      removeBtn.addEventListener('click', () => {
        executePlaylistCommand(['remove_from_playlist', String(activePlaylistId), String(track.id)]);
        // Instantly force state sync updates to screen array map
        displayedTracks = displayedTracks.filter(t => t.id !== track.id);
        renderTracklist(displayedTracks);
      });
    }

    trackListContainer.appendChild(row);
  });
}

// Native Playback Controller
function playTrack(track) {
  if (!track) return;

  // Stop existing playback and clean up
  if (currentAudio) {
    currentAudio.pause();
    // Remove old event listeners so they don't stack up in memory
    currentAudio.ontimeupdate = null;
    currentAudio.onended = null;
  }

  const assetUrl = window.__TAURI__.core.convertFileSrc(track.path);
  currentAudio = new Audio(assetUrl);
  currentAudio.volume = volumeSlider.value / 100;
  currentAudio.play();

  // Update UI metadata cards
  playerTitle.textContent = track.name;
  playerArtist.textContent = track.artist;
  isPlaying = true;
  btnPlay.textContent = '⏸';

  if (track.cover) {
    playerCover.innerHTML = `<img src="${track.cover}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;" />`;
  } else {
    playerCover.innerHTML = '⚡';
  }

  // 1. Fire when track metadata loads (Sets up lengths)
  currentAudio.addEventListener('loadedmetadata', () => {
    progressSlider.max = Math.floor(currentAudio.duration);
    timeTotal.textContent = formatTime(currentAudio.duration);
  });

  // 2. NATIVE PROGRESS LOOP: Moves the slider perfectly synchronized with the hardware
  currentAudio.addEventListener('timeupdate', () => {
    if (!currentAudio) return;
    progressSlider.value = Math.floor(currentAudio.currentTime);
    timeCurrent.textContent = formatTime(currentAudio.currentTime);
  });

  // 3. NATIVE END-OF-TRACK INTERCEPT: Clean, decoupled playback routing
  currentAudio.addEventListener('ended', () => {
    if (repeatMode === 'one') {
      currentAudio.currentTime = 0;
      currentAudio.play();
    } else {
      handleNextTrack();
    }
  });
}

function handleNextTrack() {
  if (displayedTracks.length === 0) return;

  if (isShuffleOn) {
    shufflePointer++;
    if (shufflePointer >= shuffledIndices.length) {
      if (repeatMode === 'all') {
        shufflePointer = 0; // Wrap deck around
      } else {
        // End of deck, stop playback
        if (currentAudio) currentAudio.pause();
        isPlaying = false;
        btnPlay.textContent = '▶';
        return;
      }
    }
    currentTrackIndex = shuffledIndices[shufflePointer];
  } else {
    currentTrackIndex++;
    if (currentTrackIndex >= displayedTracks.length) {
      if (repeatMode === 'all') {
        currentTrackIndex = 0; // Wrap linear queue around
      } else {
        if (currentAudio) currentAudio.pause();
        isPlaying = false;
        btnPlay.textContent = '▶';
        return;
      }
    }
  }

  playTrack(displayedTracks[currentTrackIndex]);
  renderTracklist(displayedTracks);
}

function handlePrevTrack() {
  if (displayedTracks.length === 0) return;

  if (isShuffleOn) {
    shufflePointer--;
    if (shufflePointer < 0) shufflePointer = shuffledIndices.length - 1;
    currentTrackIndex = shuffledIndices[shufflePointer];
  } else {
    currentTrackIndex--;
    if (currentTrackIndex < 0) currentTrackIndex = displayedTracks.length - 1;
  }

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
btnShuffle.addEventListener('click', () => {
  isShuffleOn = !isShuffleOn;
  btnShuffle.classList.toggle('active', isShuffleOn);
  
  if (isShuffleOn && displayedTracks.length > 0) {
    generateShuffleDeck();
  }
});
btnRepeat.addEventListener('click', () => {
  if (repeatMode === 'off') {
    repeatMode = 'one';
    btnRepeat.textContent = '🔂'; // Single track icon
    btnRepeat.classList.add('active');
  } else if (repeatMode === 'one') {
    repeatMode = 'all';
    btnRepeat.textContent = '🔁'; // Full list icon
    btnRepeat.classList.add('active');
  } else {
    repeatMode = 'off';
    btnRepeat.textContent = '🔁';
    btnRepeat.classList.remove('active');
  }
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

// Helper to generate a randomized deck of indices
function generateShuffleDeck() {
  // Create an array [0, 1, 2, ..., tracks.length - 1]
  shuffledIndices = Array.from({ length: displayedTracks.length }, (_, i) => i);
  
  // Fisher-Yates Shuffle Algorithm to randomize the deck cleanly
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }
  
  // Set our pointer to match whatever song is currently playing, if any
  const currentActiveMatch = shuffledIndices.indexOf(currentTrackIndex);
  if (currentActiveMatch !== -1) {
    shufflePointer = currentActiveMatch;
  } else {
    shufflePointer = 0;
  }
}