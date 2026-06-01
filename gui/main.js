const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous";
let isPlaying = false;
let masterLibraryData = []; // NEW: Holds the absolute truth of all 5,000+ songs
let libraryData = [];       // What is currently visible (filtered/sorted)
let currentTrackIndex = -1; 
let isShuffle = false;
let isRepeat = false;
const placeholderImg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23b3b3b3'><path d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/></svg>`;

// --- NEW: WEB AUDIO API & NORMALIZATION ---

// Assuming you have an audio element somewhere like:
// const audioPlayer = new Audio(); or document.getElementById('audio-player');
// (Make sure this variable matches whatever you named your HTML5 audio object)

let audioCtx;
let audioSource;
let compressor;
let isNormalized = false;

function initWebAudio() {
    // The AudioContext must be created after the user interacts with the page (e.g., clicking Play)
    if (audioCtx) return; 

    // Create the audio context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create a source node from our HTML5 audio player
    // IMPORTANT: Replace 'audioPlayer' with the actual variable name of your Audio object
    audioSource = audioCtx.createMediaElementSource(audioPlayer); 
    
    // Create the Dynamics Compressor
    compressor = audioCtx.createDynamicsCompressor();
    
    // Configure the compressor for heavy leveling (Normalization)
    compressor.threshold.setValueAtTime(-50, audioCtx.currentTime); // Start compressing at very quiet levels
    compressor.knee.setValueAtTime(40, audioCtx.currentTime);        // Smooth transition into compression
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);       // High ratio to aggressively squash loud peaks
    compressor.attack.setValueAtTime(0, audioCtx.currentTime);       // React instantly
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);   // Release quickly

    // Default routing: Source -> Speakers (Bypassed)
    audioSource.connect(audioCtx.destination);
}

document.addEventListener('DOMContentLoaded', () => {
    
    // Grab the button AFTER the DOM is fully loaded
    const normalizeBtn = document.getElementById('normalize-btn');

    // Make sure the button actually exists before adding the listener
    if (normalizeBtn) {
        normalizeBtn.addEventListener('click', () => {
            initWebAudio();
            
            isNormalized = !isNormalized;
            
            audioSource.disconnect();
            
            if (isNormalized) {
                audioSource.connect(compressor);
                compressor.connect(audioCtx.destination);
                normalizeBtn.classList.add('active');
                normalizeBtn.style.backgroundColor = 'var(--accent)'; 
            } else {
                audioSource.connect(audioCtx.destination);
                normalizeBtn.classList.remove('active');
                normalizeBtn.style.backgroundColor = 'transparent'; 
            }
        });
    }
});

window.addEventListener('pywebviewready', async () => {
    try {
        const tracks = await window.pywebview.api.get_library();
        
        // Store the master list, then make a shallow copy for display
        masterLibraryData = tracks;
        libraryData = [...masterLibraryData]; 
        
        renderVirtualList(); 
    } catch (e) {
        console.error("Failed to load library:", e);
    }
});

document.getElementById('add-music-btn').addEventListener('click', async () => {
    const newTracks = await window.pywebview.api.add_music();
    
    if (newTracks && newTracks.length > 0) {
        // Push to master
        masterLibraryData.push(...newTracks);
        
        // Re-trigger the search input so the new tracks are filtered correctly
        document.getElementById('search-input').dispatchEvent(new Event('input'));
    }
});


// --- NEW: VIRTUAL SCROLLER & LAZY LOADING ---

const ROW_HEIGHT = 52; 
const ROW_BUFFER = 10; // How many rows to render off-screen to prevent flickering
const coverCache = {}; // Cache images so we don't request them from Python twice

const listContainer = document.getElementById('track-list-container');
const trackList = document.getElementById('track-list');

// High-performance Virtual Renderer
function renderVirtualList() {
    if (!libraryData.length) {
        trackList.innerHTML = '';
        return;
    }

    const scrollTop = listContainer.scrollTop;
    const containerHeight = listContainer.clientHeight;
    
    // Calculate which indexes should be visible
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
    const endIndex = Math.min(libraryData.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + ROW_BUFFER);
    
    // Stretch the invisible container to the total height of all 5,000 songs so the scrollbar is accurate
    trackList.style.height = `${libraryData.length * ROW_HEIGHT}px`;
    
    // Batch DOM updates
    const fragment = document.createDocumentFragment();
    
    for (let i = startIndex; i < endIndex; i++) {
        const track = libraryData[i];
        const li = document.createElement('li');
        
        // Mathematically position the row exactly where it belongs in the scroll area
        li.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
        li.dataset.index = i; // Store index for event delegation
        
        // Render with a placeholder image first
        li.innerHTML = `
            <img class="track-cover" id="cover-${i}" src="${coverCache[track.file_path] || placeholderImg}" alt="">
            <div class="track-title">${track.title}</div>
            <div class="track-artist">${track.artist}</div>
            <div class="track-album">${track.album}</div>
            <div class="track-year">${track.year}</div>
            <div class="track-duration">${track.duration}</div>
            <button class="remove-btn" title="Remove Track">✖</button>
        `;
        
        fragment.appendChild(li);

        // Lazy load the image asynchronously if it's not in the JS cache
        if (!coverCache[track.file_path]) {
            loadCoverArt(track.file_path, i);
        }
    }
    
    trackList.innerHTML = '';
    trackList.appendChild(fragment);
}

// Fetch image from Python without blocking the UI
async function loadCoverArt(filePath, index) {
    try {
        const base64Data = await window.pywebview.api.get_cover(filePath);
        if (base64Data) {
            coverCache[filePath] = base64Data;
            const imgElement = document.getElementById(`cover-${index}`);
            if (imgElement) imgElement.src = base64Data;
        }
    } catch (e) {
        console.error("Cover load failed", e);
    }
}

// Tie the renderer to the scroll wheel via requestAnimationFrame for 60FPS smoothness
listContainer.addEventListener('scroll', () => {
    window.requestAnimationFrame(renderVirtualList);
});

// --- NEW: EVENT DELEGATION FOR CLICKS ---
// One listener handles all 5,000 songs efficiently
trackList.addEventListener('click', async (e) => {
    const row = e.target.closest('li');
    if (!row) return;
    
    const trackIndex = parseInt(row.dataset.index);
    const track = libraryData[trackIndex];

    // Handle Delete Button Click
    if (e.target.classList.contains('remove-btn')) {
        const result = await window.pywebview.api.remove_tracks([track.file_path]);
        if (result.status === 'success') {
            
            // UPDATED: Remove from BOTH arrays based on file_path
            const fileToDelete = track.file_path;
            masterLibraryData = masterLibraryData.filter(t => t.file_path !== fileToDelete);
            libraryData = libraryData.filter(t => t.file_path !== fileToDelete);
            
            renderVirtualList(); 
        }
        return;
    }

    // Handle Play Click
    currentTrackIndex = trackIndex;
    
    // UPDATED: Use the universal helper here too
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
});

// Right Click Context Menu via Delegation
trackList.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('li');
    if (!row) return;

    trackBeingEdited = libraryData[parseInt(row.dataset.index)];
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.classList.remove('hidden');
});


// --- NEW: Live Search Logic ---
document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const listItems = document.querySelectorAll('#track-list li');
    
    listItems.forEach(li => {
        // Grab all text inside the row (title, artist, album)
        const trackText = li.innerText.toLowerCase();
        
        // Toggle visibility based on match. 
        // We use 'grid' instead of 'block' to maintain our CSS columns!
        if (trackText.includes(query)) {
            li.style.display = 'grid';
        } else {
            li.style.display = 'none';
        }
    });
});


// --- Audio Playback Engine ---
function playTrack(track, coverSrc) {
    initWebAudio(); // Initializes the routing if it hasn't been set up yet
    const safePath = `http://127.0.0.1:65432/?file=${encodeURIComponent(track.file_path)}`;
    
    audioPlayer.src = safePath;
    audioPlayer.play();
    
    isPlaying = true;
    document.getElementById('play-pause-btn').innerText = '⏸ Pause';

    document.getElementById('np-title').innerText = track.title;
    document.getElementById('np-artist').innerText = track.artist;
    document.getElementById('np-cover').src = coverSrc;
}


// --- Player Controls & Playback Modes ---

document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (!audioPlayer.src) return;
    if (isPlaying) {
        audioPlayer.pause();
        document.getElementById('play-pause-btn').innerText = '▶ Play';
    } else {
        audioPlayer.play();
        document.getElementById('play-pause-btn').innerText = '⏸ Pause';
    }
    isPlaying = !isPlaying;
});

// NEW: Toggle Shuffle
document.getElementById('shuffle-btn').addEventListener('click', (e) => {
    isShuffle = !isShuffle;
    e.target.classList.toggle('active', isShuffle);
});

// NEW: Toggle Repeat
document.getElementById('repeat-btn').addEventListener('click', (e) => {
    isRepeat = !isRepeat;
    e.target.classList.toggle('active', isRepeat);
});

// UPDATED: Next Button / Auto-Play Logic
function playNext() {
    if (libraryData.length === 0 || currentTrackIndex === -1) return;

    if (isRepeat) {
        // Repeat mode: replay the exact same track
        audioPlayer.currentTime = 0;
        audioPlayer.play();
        return;
    }

    if (isShuffle) {
        // Shuffle mode: pick a random track (ensure it's not the exact same one if possible)
        let randomIndex = currentTrackIndex;
        while (randomIndex === currentTrackIndex && libraryData.length > 1) {
            randomIndex = Math.floor(Math.random() * libraryData.length);
        }
        currentTrackIndex = randomIndex;
    } else {
        // Standard mode: next track sequentially
        currentTrackIndex = (currentTrackIndex + 1) % libraryData.length;
    }

    const nextTrack = libraryData[currentTrackIndex];
    playTrack(nextTrack, nextTrack.cover_base64 || placeholderImg);
}

// Example Next Button Logic
document.getElementById('next-btn').addEventListener('click', async () => {
    if (libraryData.length === 0) return;

    // Move to next index (looping back to start if at the end)
    currentTrackIndex = (currentTrackIndex + 1) % libraryData.length;
    const track = libraryData[currentTrackIndex];

    // UPDATED: Await the cover art safely before playing
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
});

// Example Previous Button Logic
document.getElementById('prev-btn').addEventListener('click', async () => {
    if (libraryData.length === 0) return;

    // Move to prev index (looping to end if at the start)
    currentTrackIndex = (currentTrackIndex - 1 + libraryData.length) % libraryData.length;
    const track = libraryData[currentTrackIndex];

    // UPDATED: Await the cover art safely before playing
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
});

// Example Auto-Play Next Song Logic (When current track finishes)
audioPlayer.addEventListener('ended', async () => {
    if (libraryData.length === 0) return;
    
    currentTrackIndex = (currentTrackIndex + 1) % libraryData.length;
    const track = libraryData[currentTrackIndex];
    
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
});


// --- Time and Scrubber Logic ---
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
let isDragging = false; 

audioPlayer.addEventListener('timeupdate', () => {
    if (isDragging) return; 
    currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
    if (audioPlayer.duration) {
        totalTimeEl.innerText = formatTime(audioPlayer.duration);
        progressBar.max = audioPlayer.duration;
        progressBar.value = audioPlayer.currentTime;
    }
});

progressBar.addEventListener('input', () => {
    isDragging = true;
    currentTimeEl.innerText = formatTime(progressBar.value);
});

progressBar.addEventListener('change', () => {
    audioPlayer.currentTime = progressBar.value;
    isDragging = false; 
});

// --- Volume Control ---
const volumeBar = document.getElementById('volume-bar');
volumeBar.addEventListener('input', () => {
    audioPlayer.volume = volumeBar.value;
});

let currentSort = { field: null, ascending: true };

// Add this function to your main.js

function sortLibrary(field) {
    if (currentSort.field === field) {
        currentSort.ascending = !currentSort.ascending;
    } else {
        currentSort.field = field;
        currentSort.ascending = true;
    }

    libraryData.sort((a, b) => {
        let valA = a[field].toString().toLowerCase();
        let valB = b[field].toString().toLowerCase();
        
        if (field === 'year') {
            valA = parseInt(valA) || 0;
            valB = parseInt(valB) || 0;
        }

        if (valA < valB) return currentSort.ascending ? -1 : 1;
        if (valA > valB) return currentSort.ascending ? 1 : -1;
        return 0;
    });

    // --- UPDATED: No more loops or addTrackToUI ---
    // Since the array is now sorted in memory, just tell the virtual 
    // scroller to redraw the current scroll position!
    renderVirtualList();
}

// Add this inside your 'pywebviewready' initialization
document.querySelectorAll('.col-sortable').forEach(header => {
    header.addEventListener('click', () => {
        sortLibrary(header.dataset.sort);
    });
});

// --- NEW: EDIT METADATA LOGIC ---

let trackBeingEdited = null;
const contextMenu = document.getElementById('context-menu');
const editModal = document.getElementById('edit-modal');

// Hide context menu when clicking anywhere else
document.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
});


// Show the Modal
document.getElementById('menu-edit').addEventListener('click', () => {
    if (!trackBeingEdited) return;
    
    // Pre-fill the inputs
    document.getElementById('edit-title').value = trackBeingEdited.title;
    document.getElementById('edit-artist').value = trackBeingEdited.artist;
    document.getElementById('edit-year').value = trackBeingEdited.year;
    
    editModal.classList.remove('hidden');
});

// Cancel Button
document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    editModal.classList.add('hidden');
    trackBeingEdited = null;
});

// Save Button
document.getElementById('save-edit-btn').addEventListener('click', async () => {
    if (!trackBeingEdited) return;
    
    const newTitle = document.getElementById('edit-title').value;
    const newArtist = document.getElementById('edit-artist').value;
    const newYear = document.getElementById('edit-year').value;
    
    // Visual feedback while saving
    document.getElementById('save-edit-btn').innerText = "Saving...";
    
    try {
        const result = await window.pywebview.api.edit_track_metadata(
            trackBeingEdited.file_path, newTitle, newArtist, newYear
        );
        
        if (result.status === 'success') {
            // Update JS State
            trackBeingEdited.title = newTitle;
            trackBeingEdited.artist = newArtist;
            trackBeingEdited.year = newYear;
            
            // Re-render the UI
            renderVirtualList(); 
            
            // If the playing track was edited, update the Now Playing UI
            if (currentTrackIndex !== -1 && libraryData[currentTrackIndex].file_path === trackBeingEdited.file_path) {
                document.getElementById('np-title').innerText = newTitle;
                document.getElementById('np-artist').innerText = newArtist;
            }
        } else {
            alert("Error saving file: " + result.message);
        }
    } catch (e) {
        console.error(e);
    }
    
    document.getElementById('save-edit-btn').innerText = "Save to File";
    editModal.classList.add('hidden');
    trackBeingEdited = null;
});

document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (query === '') {
        // If search is empty, restore the full library
        libraryData = [...masterLibraryData];
    } else {
        // Filter the master list based on Title, Artist, or Album
        libraryData = masterLibraryData.filter(track => {
            // Safely handle null/undefined fields just in case
            const title = (track.title || '').toLowerCase();
            const artist = (track.artist || '').toLowerCase();
            const album = (track.album || '').toLowerCase();
            
            return title.includes(query) || artist.includes(query) || album.includes(query);
        });
    }
    
    // CRITICAL: Reset scroll position to top. 
    // If you are scrolled down to song #4000 and search for a single track, 
    // the virtual scroller will render blank space unless we snap back to the top!
    document.getElementById('track-list-container').scrollTop = 0;
    
    // Re-draw the screen
    renderVirtualList();
});

// --- NEW: Universal Cover Art Fetcher ---
async function getTrackCover(filePath) {
    // 1. If we already have it in memory, return it instantly
    if (coverCache[filePath]) {
        return coverCache[filePath];
    }
    
    // 2. If not, ask the Python backend for it
    try {
        const base64Data = await window.pywebview.api.get_cover(filePath);
        if (base64Data) {
            coverCache[filePath] = base64Data; // Save it for later
            return base64Data;
        }
    } catch (e) {
        console.error("Cover fetch failed during playback:", e);
    }
    
    // 3. Fallback if the file has no cover art
    return 'placeholder.png'; 
}