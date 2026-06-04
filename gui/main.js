const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous";
let isPlaying = false;
let masterLibraryData = []; 
let libraryData = [];       
let currentTrackIndex = -1; 
let isShuffle = false;
let repeatMode = 'off';
const placeholderImg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23b3b3b3'><path d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/></svg>`;

let selectedPaths = new Set(); 
let lastClickedIndex = null;   
let currentPlayingPath = null; 

let audioCtx;
let audioSource;
let compressor;
let isNormalized = false;

let currentView = 'list'; // NEW: Tracks 'list' or 'grid'
let gridAlbums = [];      // NEW: Holds parsed album data
let playbackContext = { type: 'list', key: null }; // Tracks 'list' or 'album' context

// --- Global Context Menu Suppression ---
document.addEventListener('contextmenu', (e) => {
    // Prevent the default browser context menu everywhere
    e.preventDefault();
    
    // Optional: If you want to show a custom context menu for empty areas
    // or specific elements, you can handle that logic here.
    // Otherwise, this stops it globally.
});

// Dynamic Status Bar Count Handler
function updateStatusCount() {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.innerText = `${masterLibraryData.length.toLocaleString()} tracks in library`;
    }
}

function initWebAudio() {
    if (audioCtx) return; 
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioCtx.createMediaElementSource(audioPlayer); 
    compressor = audioCtx.createDynamicsCompressor();
    
    compressor.threshold.setValueAtTime(-50, audioCtx.currentTime); 
    compressor.knee.setValueAtTime(40, audioCtx.currentTime);        
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);       
    compressor.attack.setValueAtTime(0, audioCtx.currentTime);       
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);   

    audioSource.connect(audioCtx.destination);
}

document.addEventListener('DOMContentLoaded', () => {
    const normalizeBtn = document.getElementById('normalize-btn');
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
        masterLibraryData = tracks;
        libraryData = [...masterLibraryData]; 
        updateStatusCount();
        renderVirtualList(); 
    } catch (e) {
        console.error("Failed to load library:", e);
    }
});

const addMusicBtn = document.getElementById('add-music-btn');
addMusicBtn.addEventListener('click', async () => {
    const response = await window.pywebview.api.add_music();
    
    if (response.status === 'started') {
        const container = document.getElementById('import-progress-container');
        const fill = document.getElementById('import-progress-fill');
        const countText = document.getElementById('import-count');
        
        addMusicBtn.disabled = true;
        addMusicBtn.style.opacity = '0.5';
        container.classList.remove('hidden');
        fill.style.width = '0%';

        const pollInterval = setInterval(async () => {
            const state = await window.pywebview.api.get_import_progress();
            countText.innerText = `${state.current} / ${state.total}`;
            const percentage = (state.current / state.total) * 100;
            fill.style.width = `${percentage}%`;
            
            if (!state.is_running && state.current === state.total) {
                clearInterval(pollInterval); 
                if (state.new_tracks.length > 0) {
                    masterLibraryData.push(...state.new_tracks);
                    updateStatusCount();
                    document.getElementById('search-input').dispatchEvent(new Event('input'));
                }
                setTimeout(() => {
                    container.classList.add('hidden');
                    addMusicBtn.disabled = false;
                    addMusicBtn.style.opacity = '1';
                }, 1500);
            }
        }, 500);
    } else if (response.status === 'busy') {
        alert("An import is already running in the background.");
    }
});

const ROW_HEIGHT = 52; 
const ROW_BUFFER = 10; 
const coverCache = {}; 

const listContainer = document.getElementById('track-list-container');
const trackList = document.getElementById('track-list');

function renderVirtualList() {
    if (!libraryData.length) {
        trackList.innerHTML = '';
        return;
    }

    const scrollTop = listContainer.scrollTop;
    const containerHeight = listContainer.clientHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
    const endIndex = Math.min(libraryData.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + ROW_BUFFER);
    
    trackList.style.height = `${libraryData.length * ROW_HEIGHT}px`;
    const fragment = document.createDocumentFragment();
    
    for (let i = startIndex; i < endIndex; i++) {
        const track = libraryData[i];
        const li = document.createElement('li');
        
        const isSelected = selectedPaths.has(track.file_path) ? ' track-selected' : '';
        const isMissing = track.missing ? ' track-missing' : '';
        const isPlaying = (currentPlayingPath && track.file_path === currentPlayingPath) ? ' track-playing' : '';
        const missingWarning = track.missing ? '<span class="missing-icon" title="File not found">⚠️</span>' : '';
        
        li.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
        li.dataset.index = i; 
        li.className = `${isMissing}${isSelected}${isPlaying}`;

        li.innerHTML = `
            <img class="track-cover" id="cover-${i}" src="${coverCache[track.file_path] || 'placeholder.png'}" alt="">
            <div class="track-title">${missingWarning}${track.title}</div>
            <div class="track-artist">${track.artist}</div>
            <div class="track-album">${track.album}</div>
            <div class="track-year">${track.year}</div>
            <div class="track-duration">${track.duration}</div>
        `;
        fragment.appendChild(li);

        if (!coverCache[track.file_path]) {
            loadCoverArt(track.file_path, i);
        }
    }
    trackList.innerHTML = '';
    trackList.appendChild(fragment);
}

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

listContainer.addEventListener('scroll', () => {
    window.requestAnimationFrame(renderVirtualList);
});

const doubleClickDelay = 200;
let doubleClickOnTrackPossible = false;

document.getElementById('track-list').addEventListener('click', (e) => {
    if (!doubleClickOnTrackPossible) {
        singleClickOnTrack(e);
        doubleClickOnTrackPossible = true;
        setTimeout(() => { doubleClickOnTrackPossible = false; }, doubleClickDelay);
    } else {
        doubleClickOnTrack(e);
    }    
});

async function doubleClickOnTrack(e) {
    const row = e.target.closest('li');
    if (!row) return;
    const trackIndex = parseInt(row.dataset.index);
    window.getSelection().removeAllRanges(); 
    
    // NEW: Set context back to the full list
    playbackContext = { type: 'list', key: null };
    
    await requestPlayback(trackIndex, 1, true);
}

function singleClickOnTrack(e) {
    const row = e.target.closest('li');
    if (!row) return;
    
    const trackIndex = parseInt(row.dataset.index);
    const track = libraryData[trackIndex];
    
    if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, trackIndex);
        const end = Math.max(lastClickedIndex, trackIndex);
        if (!e.ctrlKey && !e.metaKey) { selectedPaths.clear(); }
        for (let i = start; i <= end; i++) {
            selectedPaths.add(libraryData[i].file_path);
        }
    } else if (e.ctrlKey || e.metaKey) {
        if (selectedPaths.has(track.file_path)) {
            selectedPaths.delete(track.file_path);
        } else {
            selectedPaths.add(track.file_path);
        }
        lastClickedIndex = trackIndex;
    } else {
        selectedPaths.clear();
        selectedPaths.add(track.file_path);
        lastClickedIndex = trackIndex;
    }
    renderVirtualList();
}

document.getElementById('track-list').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('li');
    if (row) {
        const trackIndex = parseInt(row.dataset.index);
        const track = libraryData[trackIndex];
        if (!selectedPaths.has(track.file_path)) {
            selectedPaths.clear();
            selectedPaths.add(track.file_path);
            renderVirtualList();
        }
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.remove('hidden');
    }
});

document.addEventListener('click', () => { contextMenu.classList.add('hidden'); });

document.getElementById('ctx-remove').addEventListener('click', async () => {
    const count = selectedPaths.size;
    if (count === 0) return;

    if (confirm(`Are you sure you want to remove ${count} track(s) from your library?\n\n(This will not delete the actual files from your hard drive).`)) {
        const pathsArray = Array.from(selectedPaths);
        const result = await window.pywebview.api.remove_tracks(pathsArray);
        
        if (result.status === 'success') {
            masterLibraryData = masterLibraryData.filter(t => !selectedPaths.has(t.file_path));
            libraryData = libraryData.filter(t => !selectedPaths.has(t.file_path));
            selectedPaths.clear();
            updateStatusCount();
            
            // NEW: Update the correct view
            if (currentView === 'list') {
                renderVirtualList();
            } else {
                renderAlbumGrid();
            }
        }
    }
});

document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (query === '') {
        libraryData = [...masterLibraryData];
    } else {
        const searchTerms = query.split(/\s+/);
        libraryData = masterLibraryData.filter(track => {
            const searchableText = `${track.title || ''} ${track.artist || ''} ${track.album || ''}`.toLowerCase();
            return searchTerms.every(term => searchableText.includes(term));
        });
    }
    document.getElementById('track-list-container').scrollTop = 0;
    renderVirtualList();
});

function playTrack(track, coverSrc) {
    currentPlayingPath = track.file_path;
    
    // Always render list so it's accurate when switching back
    renderVirtualList();
    
    // NEW: Update grid expansion highlights dynamically without closing the album!
    const expandedList = document.getElementById('expanded-track-list');
    if (expandedList) {
        Array.from(expandedList.children).forEach(li => {
            if (li.dataset.filepath === currentPlayingPath) li.classList.add('track-playing');
            else li.classList.remove('track-playing');
        });
    }

    initWebAudio(); 
    const safePath = `http://127.0.0.1:65432/?file=${encodeURIComponent(track.file_path)}`;
    
    audioPlayer.src = safePath;
    audioPlayer.play();
    isPlaying = true;
    document.getElementById('play-pause-btn').innerText = '⏸ Pause';
    document.getElementById('np-title').innerText = track.title;
    document.getElementById('np-artist').innerText = track.artist;
    document.getElementById('np-cover').src = coverSrc;
}

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

document.getElementById('shuffle-btn').addEventListener('click', (e) => {
    isShuffle = !isShuffle;
    e.target.classList.toggle('active', isShuffle);
});

const repeatBtn = document.getElementById('repeat-btn');
repeatBtn.addEventListener('click', () => {
    if (repeatMode === 'off') {
        // State 1: Repeat All
        repeatMode = 'all';
        repeatBtn.classList.add('active');
        repeatBtn.innerText = '🔁';
        repeatBtn.title = 'Repeat: All';
    } else if (repeatMode === 'all') {
        // State 2: Repeat One (Uses the standard '1' repeat emoji)
        repeatMode = 'one';
        repeatBtn.classList.add('active');
        repeatBtn.innerText = '🔂'; 
        repeatBtn.title = 'Repeat: One';
    } else {
        // State 3: Off
        repeatMode = 'off';
        repeatBtn.classList.remove('active');
        repeatBtn.innerText = '🔁';
        repeatBtn.title = 'Repeat: Off';
    }
});

document.getElementById('next-btn').addEventListener('click', async () => {
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, 1, false);
    if (targetIndex !== -1) await requestPlayback(targetIndex, 1, false);
});

document.getElementById('prev-btn').addEventListener('click', async () => {
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, -1, false);
    if (targetIndex !== -1) await requestPlayback(targetIndex, -1, false);
});

audioPlayer.addEventListener('ended', async () => {
    // 1. Intercept "Repeat One" immediately
    if (repeatMode === 'one') {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
        return;
    }

    // 2. Otherwise, hunt for the next track (passing true for isAutoPlay)
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, 1, true);
    
    if (targetIndex !== -1) {
        await requestPlayback(targetIndex, 1, false);
    } else {
        // 3. End of library reached and Repeat All is OFF. Reset the UI.
        isPlaying = false;
        document.getElementById('play-pause-btn').innerText = '▶ Play';
        audioPlayer.currentTime = 0;
    }
});

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

const volumeBar = document.getElementById('volume-bar');
volumeBar.addEventListener('input', () => {
    audioPlayer.volume = volumeBar.value;
});

let currentSort = { field: null, ascending: true };

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
    renderVirtualList();
}

document.querySelectorAll('.col-sortable').forEach(header => {
    header.addEventListener('click', () => { sortLibrary(header.dataset.sort); });
});

let trackBeingEdited = null;
const contextMenu = document.getElementById('context-menu');

async function getTrackCover(filePath) {
    if (coverCache[filePath]) { return coverCache[filePath]; }
    try {
        const base64Data = await window.pywebview.api.get_cover(filePath);
        if (base64Data) {
            coverCache[filePath] = base64Data; 
            return base64Data;
        }
    } catch (e) {
        console.error("Cover fetch failed during playback:", e);
    }
    return 'placeholder.png'; 
}

// NEW: Added an 'isAutoPlay' flag so the player knows if a song ended naturally 
// or if the user actively clicked the "Next" button.
// --- UPDATED: Context-Aware Index Hunter ---
function getNextValidTrackIndex(startIndex, direction = 1, isAutoPlay = false) {
    if (libraryData.length === 0) return -1;

    // 1. Define the "pool" of tracks we are allowed to play from
    let pool = [];
    if (playbackContext.type === 'album') {
        const album = gridAlbums.find(a => a.key === playbackContext.key);
        if (album) {
            pool = album.tracks.map(t => t.globalIndex); // Only use tracks from this album
        } else {
            pool = libraryData.map((_, i) => i); // Fallback to list
        }
    } else {
        pool = libraryData.map((_, i) => i); // Standard list context
    }

    // 2. Find where we currently are in the allowed pool
    let poolIndex = pool.indexOf(startIndex);
    if (poolIndex === -1) poolIndex = 0;

    // --- SHUFFLE LOGIC ---
    if (isShuffle && direction === 1) {
        let attempts = 0;
        while (attempts < pool.length) {
            let randomPoolIndex = Math.floor(Math.random() * pool.length);
            let targetGlobalIndex = pool[randomPoolIndex];
            if (!libraryData[targetGlobalIndex].missing && targetGlobalIndex !== startIndex) {
                return targetGlobalIndex;
            }
            attempts++;
        }
        return startIndex; 
    }

    // --- SEQUENTIAL LOGIC ---
    let attempts = 0;
    while (attempts < pool.length) {
        poolIndex += direction;

        // Boundaries
        if (poolIndex >= pool.length) {
            // STOP playback if the context naturally ended and repeat is off
            if (isAutoPlay && repeatMode === 'off') {
                return -1; 
            }
            poolIndex = 0; // Wrap around to start of pool
        } else if (poolIndex < 0) {
            poolIndex = pool.length - 1; // Wrap around to end
        }

        let targetGlobalIndex = pool[poolIndex];
        if (libraryData[targetGlobalIndex] && !libraryData[targetGlobalIndex].missing) {
            return targetGlobalIndex;
        }
        attempts++;
    }
    return -1;
}

async function requestPlayback(targetIndex, direction = 1, isManualClick = false) {
    if (libraryData.length === 0 || targetIndex === -1) return;
    const track = libraryData[targetIndex];
    const exists = await window.pywebview.api.check_file_exists(track.file_path);

    if (!exists) {
        track.missing = true;
        renderVirtualList();
        if (isManualClick) {
            if (confirm(`The file for "${track.title}" has been moved or deleted since the app opened.\n\nWould you like to locate it manually?`)) {
                const response = await window.pywebview.api.locate_missing_file(track.file_path);
                if (response.status === 'success') {
                    const oldPath = track.file_path;
                    track.file_path = response.new_path;
                    track.missing = false;
                    delete coverCache[oldPath];
                    renderVirtualList(); 
                    requestPlayback(targetIndex, direction, isManualClick);
                }
            }
        } else {
            console.warn(`Skipping missing track: ${track.title}`);
            const nextValidIndex = getNextValidTrackIndex(targetIndex, direction);
            if (nextValidIndex !== -1 && nextValidIndex !== targetIndex) {
                requestPlayback(nextValidIndex, direction, false);
            }
        }
        return; 
    }

    currentTrackIndex = targetIndex;
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
}

const editModal = document.getElementById('edit-modal-overlay');
const fieldsToEdit = ['title', 'artist', 'album', 'album_artist', 'genre', 'year', 'track_num', 'disc_num', 'comments'];

document.getElementById('ctx-edit').addEventListener('click', () => {
    const pathsArray = Array.from(selectedPaths);
    if (pathsArray.length === 0) return;
    document.getElementById('context-menu').classList.add('hidden');
    editModal.classList.remove('hidden');
    
    fieldsToEdit.forEach(field => {
        const input = document.getElementById(`edit-${field}`);
        const firstVal = masterLibraryData.find(t => t.file_path === pathsArray[0])[field];
        const allSame = pathsArray.every(path => masterLibraryData.find(t => t.file_path === path)[field] === firstVal);

        if (allSame) {
            input.value = firstVal || "";
            input.placeholder = "";
        } else {
            input.value = "";
            input.placeholder = "(Multiple Values)";
        }
        input.dataset.original = input.value;
    });

    const compBox = document.getElementById('edit-compilation');
    const firstComp = masterLibraryData.find(t => t.file_path === pathsArray[0]).compilation;
    const allSameComp = pathsArray.every(path => masterLibraryData.find(t => t.file_path === path).compilation === firstComp);
    
    compBox.indeterminate = !allSameComp; 
    compBox.checked = allSameComp ? (firstComp === 1) : false;
    compBox.dataset.originalState = allSameComp ? (firstComp === 1).toString() : "mixed";
});

document.getElementById('btn-cancel-edit').addEventListener('click', () => { editModal.classList.add('hidden'); });

document.getElementById('btn-save-edit').addEventListener('click', async () => {
    const pathsArray = Array.from(selectedPaths);
    const saveBtn = document.getElementById('btn-save-edit');
    const modifiedData = {};

    fieldsToEdit.forEach(field => {
        const input = document.getElementById(`edit-${field}`);
        if (input.value !== input.dataset.original) {
            if (!(input.placeholder === "(Multiple Values)" && input.value === "")) {
                modifiedData[field] = input.value;
            }
        }
    });

    const compBox = document.getElementById('edit-compilation');
    if (compBox.dataset.originalState === "mixed" && !compBox.indeterminate) {
        modifiedData['compilation'] = compBox.checked ? 1 : 0;
    } else if (compBox.dataset.originalState !== "mixed" && compBox.checked.toString() !== compBox.dataset.originalState) {
        modifiedData['compilation'] = compBox.checked ? 1 : 0;
    }

    if (Object.keys(modifiedData).length === 0) {
        editModal.classList.add('hidden');
        return;
    }

    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    const result = await window.pywebview.api.update_metadata(pathsArray, modifiedData);

    if (result.status === 'success') {
        pathsArray.forEach(path => {
            const masterTrack = masterLibraryData.find(t => t.file_path === path);
            Object.keys(modifiedData).forEach(key => {
                masterTrack[key] = modifiedData[key];
            });
        });
        document.getElementById('search-input').dispatchEvent(new Event('input'));
        editModal.classList.add('hidden');
    } else {
        alert("An error occurred while saving metadata. Check the console.");
    }

    saveBtn.innerText = "Save Changes";
    saveBtn.disabled = false;
});

// --- NEW: VIEW TOGGLING ---
const listViewWrapper = document.getElementById('list-view-wrapper');
const gridViewWrapper = document.getElementById('grid-view-wrapper');
const toggleListBtn = document.getElementById('toggle-list-btn');
const toggleGridBtn = document.getElementById('toggle-grid-btn');

toggleListBtn.addEventListener('click', () => {
    currentView = 'list';
    toggleListBtn.classList.add('active');
    toggleGridBtn.classList.remove('active');
    gridViewWrapper.classList.add('hidden');
    listViewWrapper.classList.remove('hidden');
    renderVirtualList();
});

toggleGridBtn.addEventListener('click', () => {
    currentView = 'grid';
    toggleGridBtn.classList.add('active');
    toggleListBtn.classList.remove('active');
    listViewWrapper.classList.add('hidden');
    gridViewWrapper.classList.remove('hidden');
    renderAlbumGrid();
});

// Update the end of your live search listener to respect the active view:
document.getElementById('search-input').addEventListener('input', (e) => {
    // ... (keep existing filtering logic) ...
    
    if (currentView === 'list') {
        document.getElementById('track-list-container').scrollTop = 0;
        renderVirtualList();
    } else {
        renderAlbumGrid();
    }
});

// --- NEW: ALBUM GRID ENGINE ---

const albumGrid = document.getElementById('album-grid');
let activeExpandedCard = null; // Tracks which album is currently open

// 1. Group the flat libraryData into distinct albums
function processAlbums() {
    const albumMap = new Map();
    
    libraryData.forEach((track, index) => {
        // Prevent compilation collisions by binding album to artist
        const key = `${track.album}||${track.album_artist || track.artist}`;
        
        if (!albumMap.has(key)) {
            albumMap.set(key, {
                key: key, // NEW: Store the unique key
                title: track.album || 'Unknown Album',
                artist: track.album_artist || track.artist || 'Unknown Artist',
                coverPath: track.file_path, 
                tracks: []
            });
        }
        
        // Push track with its GLOBAL index so double-clicks map perfectly
        albumMap.get(key).tracks.push({ ...track, globalIndex: index });
    });
    
    // Sort tracks within each album by Disc and Track Number
    albumMap.forEach(album => {
        album.tracks.sort((a, b) => {
            const discA = parseInt(a.disc_num) || 1;
            const discB = parseInt(b.disc_num) || 1;
            if (discA !== discB) return discA - discB;
            
            const trackA = parseInt(a.track_num) || 0;
            const trackB = parseInt(b.track_num) || 0;
            return trackA - trackB;
        });
    });

    
    
    gridAlbums = Array.from(albumMap.values());
}

// 2. Render the Grid
function renderAlbumGrid() {
    processAlbums();
    albumGrid.innerHTML = '';
    closeExpandedAlbum(); 
    
    const fragment = document.createDocumentFragment();

    // Intersection Observer to lazy load covers as they scroll into view
    const coverObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(async entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const path = img.dataset.path;
                const coverSrc = await getTrackCover(path);
                img.src = coverSrc;
                observer.unobserve(img);
            }
        });
    }, { root: document.getElementById('grid-view-wrapper'), rootMargin: '200px' });

    gridAlbums.forEach((album, idx) => {
        const card = document.createElement('div');
        card.className = 'album-card';
        card.dataset.index = idx;
        
        // Try cache first, otherwise use placeholder and observe
        const cachedCover = coverCache[album.coverPath];
        const imgSrc = cachedCover ? cachedCover : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

        card.innerHTML = `
            <img class="album-card-cover" src="${imgSrc}" data-path="${album.coverPath}" alt="">
            <div class="album-card-title">${album.title}</div>
            <div class="album-card-artist">${album.artist}</div>
        `;
        
        if (!cachedCover) {
            coverObserver.observe(card.querySelector('img'));
        }

        // Open expansion on click
        card.addEventListener('click', (e) => {
            if (activeExpandedCard === card) {
                closeExpandedAlbum(); // Toggle off if clicking the same album
            } else {
                openExpandedAlbum(album, card);
            }
        });

        fragment.appendChild(card);
    });

    albumGrid.appendChild(fragment);
}

// 3. The Inline Expansion Logic
function openExpandedAlbum(albumData, cardElement) {
    closeExpandedAlbum(); 
    
    activeExpandedCard = cardElement;
    cardElement.classList.add('active-card');

    const cards = Array.from(albumGrid.querySelectorAll('.album-card'));
    const clickedIndex = cards.indexOf(cardElement);
    const clickedTop = cardElement.offsetTop;
    
    let insertIndex = clickedIndex;
    while (insertIndex + 1 < cards.length && cards[insertIndex + 1].offsetTop === clickedTop) {
        insertIndex++;
    }

    // ==========================================
    // 1. DYNAMIC METADATA AGGREGATION
    // ==========================================
    
    // Process Years
    const validYears = albumData.tracks.map(t => parseInt(t.year)).filter(y => !isNaN(y) && y > 0);
    let yearString = "Unknown Year";
    if (validYears.length > 0) {
        const minYear = Math.min(...validYears);
        const maxYear = Math.max(...validYears);
        yearString = minYear === maxYear ? `${minYear}` : `${minYear} - ${maxYear}`;
    }

    // Process Genres (Splitting CSVs and deduplicating via Set)
    const genreSet = new Set();
    albumData.tracks.forEach(t => {
        if (t.genre) {
            t.genre.split(',').forEach(g => {
                const trimmed = g.trim();
                if (trimmed) genreSet.add(trimmed);
            });
        }
    });
    const genreString = genreSet.size > 0 ? Array.from(genreSet).join(', ') : "Unknown Genre";

    // Process Total Runtime
    let totalSeconds = 0;
    albumData.tracks.forEach(t => {
        totalSeconds += parseDurationToSeconds(t.duration);
    });
    const runtimeString = formatTotalSeconds(totalSeconds);

    // ==========================================
    // 2. TRACKLIST & MULTI-DISC GENERATION
    // ==========================================
    
    // Check if album actually spans multiple discs
    const uniqueDiscs = new Set(albumData.tracks.map(t => parseInt(t.disc_num) || 1));
    const hasMultipleDiscs = uniqueDiscs.size > 1;

    // --- NEW: Calculate Grid Columns ---
    // We count how many cards share the same Y position (offsetTop) as the very first card.
    const firstRowY = cards[0].offsetTop;
    const currentColumns = cards.filter(c => c.offsetTop === firstRowY).length;
    
    // Apply two-column class if conditions are met
    const useTwoColumns = currentColumns > 4 && albumData.tracks.length > 4;
    let trackListHTML = `<ul class="expanded-track-list ${useTwoColumns ? 'two-column' : ''}" id="expanded-track-list">`;    let currentDisc = null;

    albumData.tracks.forEach(t => {
        const trackDisc = parseInt(t.disc_num) || 1;
        
        // Inject Disc Header if it's a new disc in a multi-disc album
        if (hasMultipleDiscs && trackDisc !== currentDisc) {
            trackListHTML += `<li class="disc-header">Disc ${trackDisc}</li>`;
            currentDisc = trackDisc;
        }

        const isPlaying = (currentPlayingPath && t.file_path === currentPlayingPath) ? ' track-playing' : '';
        const isSelected = selectedPaths.has(t.file_path) ? ' track-selected' : '';
        const missingWarning = t.missing ? '⚠️ ' : '';
        
        trackListHTML += `
            <li class="${isPlaying}${isSelected}" data-index="${t.globalIndex}" data-filepath="${t.file_path}">
                <div>${t.track_num || '-'}</div>
                <div class="track-title">${missingWarning}${t.title}</div>
                <div>${t.duration}</div>
            </li>
        `;
    });
    trackListHTML += '</ul>';

    // ==========================================
    // 3. DOM INJECTION
    // ==========================================

    const expansionContainer = document.createElement('div');
    expansionContainer.className = 'album-expanded-row';
    expansionContainer.id = 'active-expansion-row';

    // Inject the aggregated metadata directly under the title
    expansionContainer.innerHTML = `
        <div class="expanded-cover-container">
            <img id="expanded-highres-cover" src="${coverCache[albumData.coverPath] || 'placeholder.png'}">
        </div>
        <div class="expanded-tracklist-container">
            <h2 style="margin:0 0 5px 0;">${albumData.title}</h2>
            <div style="color:var(--text-secondary); font-size:13px; margin-bottom:4px;">
                ${albumData.artist} • ${albumData.tracks.length} Tracks • ${yearString}
            </div>
            <div style="color:var(--text-muted); font-size:12px; margin-bottom:20px;">
                ${genreString} • ${runtimeString}
            </div>
            ${trackListHTML}
        </div>
    `;

    if (insertIndex === cards.length - 1) {
        albumGrid.appendChild(expansionContainer);
    } else {
        albumGrid.insertBefore(expansionContainer, cards[insertIndex + 1]);
    }

    getTrackCover(albumData.coverPath).then(src => {
        document.getElementById('expanded-highres-cover').src = src;
    });

    const expandedList = document.getElementById('expanded-track-list');
    
    // --- UPDATED: Click Delegation with Header Bypass ---
    expandedList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        
        // Ignore clicks if they didn't hit a list item, OR if they hit a disc header
        if (!li || li.classList.contains('disc-header')) return;
        
        if (!doubleClickOnTrackPossible) {
            singleClickOnTrack(e); 
            
            Array.from(expandedList.children).forEach(child => {
                // Skip headers during highlighting
                if (child.classList.contains('disc-header')) return; 
                
                if (selectedPaths.has(child.dataset.filepath)) child.classList.add('track-selected');
                else child.classList.remove('track-selected');
            });
            
            doubleClickOnTrackPossible = true;
            setTimeout(() => { doubleClickOnTrackPossible = false; }, doubleClickDelay);
        } else {
            window.getSelection().removeAllRanges(); 
            playbackContext = { type: 'album', key: albumData.key };
            requestPlayback(parseInt(li.dataset.index), 1, true);
        }    
    });

    expandedList.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const li = e.target.closest('li');
        
        // Ignore right-clicks on disc headers
        if (li && !li.classList.contains('disc-header')) {
            const trackIndex = parseInt(li.dataset.index);
            const track = libraryData[trackIndex];
            
            if (!selectedPaths.has(track.file_path)) {
                selectedPaths.clear();
                selectedPaths.add(track.file_path);
                
                Array.from(expandedList.children).forEach(child => {
                    if (child.classList.contains('disc-header')) return;
                    if (selectedPaths.has(child.dataset.filepath)) child.classList.add('track-selected');
                    else child.classList.remove('track-selected');
                });
            }

            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.remove('hidden');
        }
    });
    
    setTimeout(() => {
        expansionContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
}

function closeExpandedAlbum() {
    const existingRow = document.getElementById('active-expansion-row');
    if (existingRow) existingRow.remove();
    if (activeExpandedCard) activeExpandedCard.classList.remove('active-card');
    activeExpandedCard = null;
}

// Ensure the expanded row closes if the window resizes, as column counts will shift!
window.addEventListener('resize', () => {
    if (currentView === 'grid' && activeExpandedCard) {
        closeExpandedAlbum();
    }
});

// --- NEW: Album Metadata Calculators ---

// Converts MM:SS or HH:MM:SS strings into total seconds
function parseDurationToSeconds(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').reverse();
    let secs = 0;
    if (parts[0]) secs += parseInt(parts[0]) || 0; // Seconds
    if (parts[1]) secs += (parseInt(parts[1]) || 0) * 60; // Minutes
    if (parts[2]) secs += (parseInt(parts[2]) || 0) * 3600; // Hours
    return secs;
}

// Converts raw seconds into a readable album total (e.g. "1 hr 15 min" or "45 min 30 sec")
function formatTotalSeconds(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    
    if (h > 0) return `${h} hr ${m} min`;
    return `${m} min ${s} sec`;
}
