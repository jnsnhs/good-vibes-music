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
let lastGridClickedIndex = null; // NEW: Tracks shift-click anchors exclusively for the Album Grid
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

// ==========================================
// GLOBAL KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', (e) => {
    // Shared check: Ensure NO modals are currently open
    const modalIds = ['grid-settings-modal', 'edit-modal-overlay'];
    const isModalOpen = modalIds.some(id => {
        const modal = document.getElementById(id);
        return modal && !modal.classList.contains('hidden');
    });

    // 1. Search Shortcut (Ctrl+F or Cmd+F)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (!isModalOpen) {
            e.preventDefault(); 
            
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.focus();
                searchInput.select(); 
            }
        }
    }

    // 2. Play/Pause Shortcut (Spacebar)
    if (e.code === 'Space') {
        const activeEl = document.activeElement;
        const activeTag = activeEl.tagName;
        
        // FIX: Treat text inputs and textareas as "typing", but EXCLUDE range sliders (volume/progress)
        const isTyping = (activeTag === 'INPUT' && activeEl.type !== 'range') || activeTag === 'TEXTAREA';

        if (!isModalOpen && !isTyping) {
            e.preventDefault(); // Prevents page scrolling AND stops slider-hijacking
            
            const playPauseBtn = document.getElementById('play-pause-btn');
            if (playPauseBtn) {
                playPauseBtn.click();
            }
        }
    }
});

// --- NEW: Focus Release for Range Sliders ---
// Automatically blurs the volume and progress bars as soon as the user finishes adjusting them
document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.addEventListener('pointerup', () => {
        slider.blur();
    });
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

// --- UPDATED: Advanced Filtering & Search Syntax ---
let searchTimeout; // Variable to hold the debounce timer

// 1. Custom Parser: Safely tokenizes the string while respecting quotes and pipes
function parseSearchQuery(queryString) {
    const groups = [];
    let currentGroup = [];
    let currentToken = '';
    let inQuotes = false;

    for (let i = 0; i < queryString.length; i++) {
        const char = queryString[i];

        if (char === '"') {
            inQuotes = !inQuotes;
            currentToken += char; // Keep quotes for stripping later
        } else if (char === '|' && !inQuotes) {
            // Pipe indicates a new OR group
            if (currentToken.trim()) {
                currentGroup.push(currentToken.trim());
                currentToken = '';
            }
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
                currentGroup = [];
            }
        } else if (char === ' ' && !inQuotes) {
            // Space indicates a new AND token within the current group
            if (currentToken.trim()) {
                currentGroup.push(currentToken.trim());
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }
    
    // Push the final dangling tokens and groups
    if (currentToken.trim()) currentGroup.push(currentToken.trim());
    if (currentGroup.length > 0) groups.push(currentGroup);
    
    return groups;
}

// 2. Condition Builder: Converts a string token into a logical object
function buildCondition(token) {
    let isNegated = false;
    let rawToken = token;

    // Detect Negation
    if (rawToken.startsWith('-')) {
        isNegated = true;
        rawToken = rawToken.substring(1);
    }

    // Regex to match field searches (e.g., artist="elton john", year>1980)
    // Allowed operators: =, >, <
    const match = rawToken.match(/^([a-z_]+)([=><])(.+)$/i);

    let field = null;
    let operator = null;
    let value = rawToken;

    if (match) {
        let parsedField = match[1].toLowerCase();
        operator = match[2];
        value = match[3];

        // Map Aliases
        const aliases = {
            'style': 'genre',
            'song': 'title',
            'release': 'year',
            'albumartist': 'album_artist'
        };
        if (aliases[parsedField]) parsedField = aliases[parsedField];

        // Validate the requested field
        const validFields = ['artist', 'title', 'album', 'album_artist', 'genre', 'year'];
        if (validFields.includes(parsedField)) {
            field = parsedField;
        } else {
            // If the user types an invalid field (e.g., food=pizza), treat it as a standard global text search
            value = rawToken;
        }
    }

    // Strip surrounding quotes if the user encapsulated their string
    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
    }

    value = value.toLowerCase();

    return { isNegated, field, operator, value };
}

// 3. Condition Evaluator: Checks if a single track passes a single condition
function evaluateCondition(track, condition) {
    const { isNegated, field, operator, value } = condition;
    let isMatch = false;

    if (field) {
        let trackVal = track[field] || '';

        if (field === 'year') {
            const tYear = parseInt(trackVal) || 0;
            const vYear = parseInt(value) || 0;
            
            if (operator === '=') isMatch = tYear === vYear;
            else if (operator === '>') isMatch = tYear > vYear;
            else if (operator === '<') isMatch = tYear < vYear;
        } else {
            // For string metadata (artist, title, etc.), we default to 'includes' logic
            trackVal = trackVal.toString().toLowerCase();
            isMatch = trackVal.includes(value); 
        }
    } else {
        // Fallback: Global Text Search
        const yearStr = track.year ? track.year.toString() : '';
        const searchableText = [
            track.title || '',
            track.artist || '',
            track.album || '',
            track.album_artist || '',
            track.genre || '',
            yearStr
        ].join(' ').toLowerCase();

        isMatch = searchableText.includes(value);
    }

    return isNegated ? !isMatch : isMatch;
}

// 4. The Main Listener
document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(() => {
        const query = e.target.value.trim();
        
        if (query === '') {
            libraryData = [...masterLibraryData];
        } else {
            // Step A: Parse query into nested structure -> OR Groups containing AND tokens
            const parsedGroups = parseSearchQuery(query);
            
            // Step B: Convert raw strings into logical objects
            const conditionGroups = parsedGroups.map(group => group.map(buildCondition));
            
            // Step C: Execute the filter against the library
            libraryData = masterLibraryData.filter(track => {
                // A track passes if it satisfies AT LEAST ONE OR-group (The | operator)
                return conditionGroups.some(group => {
                    // Within a group, a track must satisfy EVERY AND-condition (Space separation)
                    return group.every(condition => evaluateCondition(track, condition));
                });
            });
        }
        
        // Reset scroll position and re-render the active view
        document.getElementById('track-list-container').scrollTop = 0;
        
        if (currentView === 'list') {
            renderVirtualList();
        } else {
            renderAlbumGrid();
        }
    }, 300); 
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
    document.getElementById('play-pause-btn').innerHTML =
    '<svg class="btn-icon" viewBox="0 -960 960 960">' +
    '<path d="M640-200q-33 0-56.5-23.5T560-280v-400q0-33 23.5-56.5T640-760q33 0 56.5 23.5T720-680v400q0 33-23.5 56.5T640-200Zm-320 0q-33 0-56.5-23.5T240-280v-400q0-33 23.5-56.5T320-760q33 0 56.5 23.5T400-680v400q0 33-23.5 56.5T320-200Z"/>' +
    '</svg>';
    document.getElementById('np-title').innerText = track.title;
    document.getElementById('np-artist').innerText = track.artist;
    document.getElementById('np-cover').src = coverSrc;
}

document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (!audioPlayer.src) return;
    if (isPlaying) {
        audioPlayer.pause();
        document.getElementById('play-pause-btn').innerHTML =
            '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Z"/>' +
            '</svg>';
    } else {
        audioPlayer.play();
        document.getElementById('play-pause-btn').innerHTML =
            '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M640-200q-33 0-56.5-23.5T560-280v-400q0-33 23.5-56.5T640-760q33 0 56.5 23.5T720-680v400q0 33-23.5 56.5T640-200Zm-320 0q-33 0-56.5-23.5T240-280v-400q0-33 23.5-56.5T320-760q33 0 56.5 23.5T400-680v400q0 33-23.5 56.5T320-200Z"/>' +
            '</svg>';
    }
    isPlaying = !isPlaying;
});

document.getElementById('shuffle-btn').addEventListener('click', (e) => {
    isShuffle = !isShuffle;
    e.target.classList.toggle('active', isShuffle);
    if (isShuffle) {
        document.getElementById('shuffle-btn').innerHTML =
         '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M120-40q-33 0-56.5-23.5T40-120v-720q0-33 23.5-56.5T120-920h720q33 0 56.5 23.5T920-840v720q0 33-23.5 56.5T840-40H120Zm480-120h160q17 0 28.5-11.5T800-200v-160q0-17-11.5-28.5T760-400q-17 0-28.5 11.5T720-360v62l-97-97q-12-12-28.5-12T566-395q-12 12-12.5 28t11.5 28l99 99h-64q-17 0-28.5 11.5T560-200q0 17 11.5 28.5T600-160Zm-428-12q11 11 28 11t28-11l492-492v64q0 17 11.5 28.5T760-560q17 0 28.5-11.5T800-600v-160q0-17-11.5-28.5T760-800H600q-17 0-28.5 11.5T560-760q0 17 11.5 28.5T600-720h64L172-228q-11 11-11 28t11 28Zm-1-560 168 167q11 11 28 11t28-11q12-12 11.5-28.5T395-621L227-788q-12-11-28.5-11T171-788q-11 11-11 28t11 28Z"/>' +
            '</svg>'
        ;
    } else {
        document.getElementById('shuffle-btn').innerHTML = 
         '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M600-160q-17 0-28.5-11.5T560-200q0-17 11.5-28.5T600-240h64l-99-99q-12-12-11.5-28.5T566-396q12-12 28.5-12t28.5 12l97 98v-62q0-17 11.5-28.5T760-400q17 0 28.5 11.5T800-360v160q0 17-11.5 28.5T760-160H600Zm-428-12q-11-11-11-28t11-28l492-492h-64q-17 0-28.5-11.5T560-760q0-17 11.5-28.5T600-800h160q17 0 28.5 11.5T800-760v160q0 17-11.5 28.5T760-560q-17 0-28.5-11.5T720-600v-64L228-172q-11 11-28 11t-28-11Zm-1-560q-11-11-11-28t11-28q11-11 27.5-11t28.5 11l168 167q11 11 11.5 27.5T395-565q-11 11-28 11t-28-11L171-732Z"/>' +
            '</svg>'
        ;
    }
});

const repeatBtn = document.getElementById('repeat-btn');
repeatBtn.addEventListener('click', () => {
    if (repeatMode === 'off') {
        // State 1: Repeat All
        repeatMode = 'all';
        repeatBtn.classList.add('active');
        repeatBtn.innerHTML = 
            '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M120-40q-33 0-56.5-23.5T40-120v-720q0-33 23.5-56.5T120-920h720q33 0 56.5 23.5T920-840v720q0 33-23.5 56.5T840-40H120Zm154-160h406q33 0 56.5-23.5T760-280v-120q0-17-11.5-28.5T720-440q-17 0-28.5 11.5T680-400v120H274l34-34q12-12 11.5-28T308-370q-12-12-28.5-12.5T251-371L148-268q-6 6-8.5 13t-2.5 15q0 8 2.5 15t8.5 13l103 103q12 12 28.5 11.5T308-110q11-12 11.5-28T308-166l-34-34Zm412-480-34 34q-12 12-11.5 28t11.5 28q12 12 28.5 12.5T709-589l103-103q6-6 8.5-13t2.5-15q0-8-2.5-15t-8.5-13L709-851q-12-12-28.5-11.5T652-850q-11 12-11.5 28t11.5 28l34 34H280q-33 0-56.5 23.5T200-680v120q0 17 11.5 28.5T240-520q17 0 28.5-11.5T280-560v-120h406Z"/>' +
            '</svg>'
        ;
        repeatBtn.title = 'Repeat: All';
    } else if (repeatMode === 'all') {
        // State 2: Repeat One (Uses the standard '1' repeat emoji)
        repeatMode = 'one';
        repeatBtn.classList.add('active');
        repeatBtn.innerHTML = 
            '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M120-40q-33 0-56.5-23.5T40-120v-720q0-33 23.5-56.5T120-920h720q33 0 56.5 23.5T920-840v720q0 33-23.5 56.5T840-40H120Zm154-160h406q33 0 56.5-23.5T760-280v-120q0-17-11.5-28.5T720-440q-17 0-28.5 11.5T680-400v120H274l34-34q12-12 11.5-28T308-370q-12-12-28.5-12.5T251-371L148-268q-6 6-8.5 13t-2.5 15q0 8 2.5 15t8.5 13l103 103q12 12 28.5 11.5T308-110q11-12 11.5-28T308-166l-34-34Zm412-480-34 34q-12 12-11.5 28t11.5 28q12 12 28.5 12.5T709-589l103-103q6-6 8.5-13t2.5-15q0-8-2.5-15t-8.5-13L709-851q-12-12-28.5-11.5T652-850q-11 12-11.5 28t11.5 28l34 34H280q-33 0-56.5 23.5T200-680v120q0 17 11.5 28.5T240-520q17 0 28.5-11.5T280-560v-120h406ZM460-540v150q0 13 8.5 21.5T490-360q13 0 21.5-8.5T520-390v-170q0-17-11.5-28.5T480-600h-50q-13 0-21.5 8.5T400-570q0 13 8.5 21.5T430-540h30Z"/>' +
            '</svg>'
        ;
        repeatBtn.title = 'Repeat: One';
    } else {
        // State 3: Off
        repeatMode = 'off';
        repeatBtn.classList.remove('active');
        repeatBtn.innerHTML = 
            '<svg class="btn-icon" viewBox="0 -960 960 960">' +
          '<path d="m274-200 34 34q12 12 11.5 28T308-110q-12 12-28.5 12.5T251-109L148-212q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l103-103q12-12 28.5-11.5T308-370q11 12 11.5 28T308-314l-34 34h406v-120q0-17 11.5-28.5T720-440q17 0 28.5 11.5T760-400v120q0 33-23.5 56.5T680-200H274Zm412-480H280v120q0 17-11.5 28.5T240-520q-17 0-28.5-11.5T200-560v-120q0-33 23.5-56.5T280-760h406l-34-34q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T709-851l103 103q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L709-589q-12 12-28.5 11.5T652-590q-11-12-11.5-28t11.5-28l34-34Z"/>' +
        '</svg>'
        ;
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
        document.getElementById('play-pause-btn').innerHTML = 
        '<svg class="btn-icon" viewBox="0 -960 960 960">' +
            '<path d="M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Z"/>' +
            '</svg>'
        ;
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
    document.getElementById('grid-settings-btn').classList.add('hidden'); // Hide Cog
    toggleListBtn.classList.add('active');
    toggleGridBtn.classList.remove('active');
    gridViewWrapper.classList.add('hidden');
    listViewWrapper.classList.remove('hidden');
    renderVirtualList();
});

toggleGridBtn.addEventListener('click', () => {
    currentView = 'grid';
    document.getElementById('grid-settings-btn').classList.remove('hidden'); // Show Cog
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
        const key = `${track.album}||${track.album_artist || track.artist}`;
        
        if (!albumMap.has(key)) {
            albumMap.set(key, {
                key: key, 
                title: track.album || 'Unknown Album',
                artist: track.album_artist || track.artist || 'Unknown Artist',
                coverPath: track.file_path, 
                tracks: []
            });
        }
        albumMap.get(key).tracks.push({ ...track, globalIndex: index });
    });
    
    // Sort tracks inside the album
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

    // --- NEW: INDEPENDENT GRID SORTING ---
    // This explicitly sorts the grid by Artist -> Year -> Album Title,
    // completely ignoring how the List View is currently sorted!
    gridAlbums.sort((a, b) => {
        // Multiplier: 1 for Ascending, -1 for Descending
        const dir = gridSortDirection === 'desc' ? -1 : 1;

        if (gridSortOrder === 'year') {
            // Primary: Year (Affected by Direction)
            const yearA = Math.min(...a.tracks.map(t => parseInt(t.year) || 9999));
            const yearB = Math.min(...b.tracks.map(t => parseInt(t.year) || 9999));
            if (yearA !== yearB) return (yearA - yearB) * dir;
            
            // Secondary: Artist (Always A-Z)
            const artistA = (a.artist || '').toLowerCase();
            const artistB = (b.artist || '').toLowerCase();
            if (artistA !== artistB) return artistA.localeCompare(artistB);
        } else {
            // Primary: Artist (Affected by Direction)
            const artistA = (a.artist || '').toLowerCase();
            const artistB = (b.artist || '').toLowerCase();
            if (artistA !== artistB) return artistA.localeCompare(artistB) * dir;
            
            // Secondary: Year (Always Chronological)
            const yearA = Math.min(...a.tracks.map(t => parseInt(t.year) || 9999));
            const yearB = Math.min(...b.tracks.map(t => parseInt(t.year) || 9999));
            if (yearA !== yearB) return yearA - yearB;
        }
        
        // Tertiary: Album Title (Always A-Z)
        return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
    });
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

    let currentGroup = null; // NEW: Tracks the current decade or letter

gridAlbums.forEach((album, idx) => {
    // --- NEW: Subheading Injection ---
    if (showGridSubheadings) {
        let albumGroup = "";
        if (gridSortOrder === 'year') {
            const year = Math.min(...album.tracks.map(t => parseInt(t.year) || 9999));
            if (year === 9999) {
                albumGroup = "Unknown Year";
            } else {
                const decade = Math.floor(year / 10) * 10;
                albumGroup = `${String(decade).slice(-2)}s`; // Formats 1980 -> "80s"
            }
        } else {
            const firstChar = (album.artist || "Unknown").trim().charAt(0).toUpperCase();
            albumGroup = /[A-Z]/.test(firstChar) ? firstChar : "#"; // Groups symbols/numbers into #
        }

        if (albumGroup !== currentGroup) {
            const heading = document.createElement('div');
            heading.className = 'grid-subheading';
            
            // NEW: Apply sticky class if enabled
            if (stickyGridSubheadings) {
                heading.classList.add('sticky');
            }
            
            heading.innerText = albumGroup;
            fragment.appendChild(heading);
            currentGroup = albumGroup;
        }
    }
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
    let genreHTML = "";
    if (genreSet.size > 0) {
        Array.from(genreSet).forEach(g => {
            genreHTML += `<span class="genre-tag">${g}</span>`;
        });
    }

    // Process Total Runtime
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

// --- FIXED: Dimension-Based Column Calculation ---
    // We calculate how many columns fit by dividing the total grid width by an individual card's width.
    // This is 100% immune to offsetTop shifts, subheadings, or expansion container placements.
    const albumGridElement = document.getElementById('album-grid');
    const gridWidth = albumGridElement.clientWidth;
    const cardWidth = cardElement.getBoundingClientRect().width || 180; // Fallback to a standard card width if 0
    
    // Calculate the mathematical column count currently rendered by the browser
    const currentColumns = Math.round(gridWidth / cardWidth);

    // Apply two-column class if conditions are met
    const useTwoColumns = currentColumns > 4 && albumData.tracks.length > 4;
    let trackListHTML = `<ul class="expanded-track-list ${useTwoColumns ? 'two-column' : ''}" id="expanded-track-list">`;    let currentDisc = null;

    albumData.tracks.forEach((t, idx) => {
        const trackDisc = parseInt(t.disc_num) || 1;
        
        if (hasMultipleDiscs && trackDisc !== currentDisc) {
            trackListHTML += `<li class="disc-header">Disc ${trackDisc}</li>`;
            currentDisc = trackDisc;
        }

        const isPlaying = (currentPlayingPath && t.file_path === currentPlayingPath) ? ' track-playing' : '';
        const isSelected = selectedPaths.has(t.file_path) ? ' track-selected' : '';
        const missingWarning = t.missing ? '⚠️ ' : '';
        
        // UPDATED: Added data-album-index="${idx}"
        trackListHTML += `
            <li class="${isPlaying}${isSelected}" data-index="${t.globalIndex}" data-album-index="${idx}" data-filepath="${t.file_path}">
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

    expansionContainer.innerHTML = `
        <div class="expanded-cover-container">
            <img id="expanded-highres-cover" src="${coverCache[albumData.coverPath] || 'placeholder.png'}">
            <div class="expanded-cover-meta">
                ${albumData.tracks.length} Tracks • ${runtimeString}
            </div>
        </div>
        <div class="expanded-tracklist-container">
            <h2 style="margin:0 0 5px 0; font-size: 22px;">${albumData.title}</h2>
            <div style="color:var(--text-secondary); font-size:14px; margin-bottom:12px;">
                ${albumData.artist} • ${yearString}
            </div>
            <div style="margin-bottom:20px;">
                ${genreHTML}
            </div>
            ${trackListHTML}
        </div>
    `;

    // We insert the expansion container immediately AFTER the last card in the current row.
    // If nextSibling is a subheading, it inserts before the subheading.
    // If nextSibling is null (end of list), it naturally appends to the bottom.
    const lastCardInRow = cards[insertIndex];
    albumGrid.insertBefore(expansionContainer, lastCardInRow.nextSibling);

    getTrackCover(albumData.coverPath).then(src => {
        document.getElementById('expanded-highres-cover').src = src;
    });

    const expandedList = document.getElementById('expanded-track-list');
    
    // --- UPDATED: Click Delegation with Header Bypass ---
    // --- UPDATED: Grid-Specific Selection Engine ---
    expandedList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        
        if (!li || li.classList.contains('disc-header')) return;
        
        if (!doubleClickOnTrackPossible) {
            // NEW: Localized Grid Selection Logic
            const trackAlbumIndex = parseInt(li.dataset.albumIndex);
            const track = albumData.tracks[trackAlbumIndex];

            if (e.shiftKey && lastGridClickedIndex !== null) {
                const start = Math.min(lastGridClickedIndex, trackAlbumIndex);
                const end = Math.max(lastGridClickedIndex, trackAlbumIndex);
                if (!e.ctrlKey && !e.metaKey) { selectedPaths.clear(); }
                
                // Pull strictly from the visual album layout!
                for (let i = start; i <= end; i++) {
                    selectedPaths.add(albumData.tracks[i].file_path);
                }
            } else if (e.ctrlKey || e.metaKey) {
                if (selectedPaths.has(track.file_path)) {
                    selectedPaths.delete(track.file_path);
                } else {
                    selectedPaths.add(track.file_path);
                }
                lastGridClickedIndex = trackAlbumIndex;
            } else {
                selectedPaths.clear();
                selectedPaths.add(track.file_path);
                lastGridClickedIndex = trackAlbumIndex;
            }
            
            // Re-render visual highlights
            Array.from(expandedList.children).forEach(child => {
                if (child.classList.contains('disc-header')) return; 
                
                if (selectedPaths.has(child.dataset.filepath)) child.classList.add('track-selected');
                else child.classList.remove('track-selected');
            });
            
            doubleClickOnTrackPossible = true;
            setTimeout(() => { doubleClickOnTrackPossible = false; }, doubleClickDelay);
        } else {
            // Double click: Still passes the globalIndex to the bouncer for seamless playback!
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
    
    if (h > 0) {
        if (m > 0 ) return `${h} hr ${m} min`;
        return `${h} hr`;
    }
    if (s < 30) return `${m} min`;
    return `${m+1} min`;
}

// --- NEW: Global Deselection Logic ---
document.addEventListener('click', (e) => {
    // 1. Identify what the user just clicked on
    const isTrack = e.target.closest('li:not(.disc-header)'); // Actual songs
    const isCard = e.target.closest('.album-card'); // Grid covers
    const isInteractive = e.target.closest('button, input, .player-bar, .app-header, .list-header, #context-menu'); 
    
    

    // 2. If they clicked "empty space" (the background, a disc header, or empty grid padding)
    if (!isTrack && !isCard && !isInteractive) {
        
        // Only trigger DOM updates if there is actually a selection to clear
        if (selectedPaths.size > 0) {
            selectedPaths.clear();
            lastClickedIndex = null;
            lastGridClickedIndex = null; // NEW: Clear grid anchor
            
            // Clear the visual highlight based on the active view
            if (currentView === 'list') {
                renderVirtualList();
            } else {
                const expandedList = document.getElementById('expanded-track-list');
                if (expandedList) {
                    Array.from(expandedList.children).forEach(child => {
                        child.classList.remove('track-selected');
                    });
                }
            }
        }
    }
});

// --- NEW: Grid Settings State & Logic ---
let gridSortOrder = 'artist'; // 'artist' or 'year'
let gridSortDirection = 'asc'; // NEW: 'asc' or 'desc'
let showGridSubheadings = false;
let stickyGridSubheadings = false; // NEW: Tracks the sticky state

const gridSettingsModal = document.getElementById('grid-settings-modal');

document.getElementById('grid-settings-btn').addEventListener('click', () => {
    document.querySelector(`input[name="grid-sort"][value="${gridSortOrder}"]`).checked = true;
    document.querySelector(`input[name="grid-sort-dir"][value="${gridSortDirection}"]`).checked = true; // NEW
    document.getElementById('grid-show-subheadings').checked = showGridSubheadings;
    document.getElementById('grid-sticky-subheadings').checked = stickyGridSubheadings;
    gridSettingsModal.classList.remove('hidden');
});

document.getElementById('btn-cancel-grid-settings').addEventListener('click', () => {
    gridSettingsModal.classList.add('hidden');
});

document.getElementById('btn-save-grid-settings').addEventListener('click', () => {
    gridSortOrder = document.querySelector('input[name="grid-sort"]:checked').value;
    gridSortDirection = document.querySelector('input[name="grid-sort-dir"]:checked').value; // NEW
    showGridSubheadings = document.getElementById('grid-show-subheadings').checked;
    stickyGridSubheadings = document.getElementById('grid-sticky-subheadings').checked;
    
    gridSettingsModal.classList.add('hidden');
    renderAlbumGrid(); 
});

/* PROGRESS TRACKING HELPER FOR RANGE ELEMENTS*/

for (let e of document.querySelectorAll('input[type="range"].slider-progress')) {
  e.style.setProperty('--value', e.value);
  e.style.setProperty('--min', e.min == '' ? '0' : e.min);
  e.style.setProperty('--max', e.max == '' ? '100' : e.max);
  e.addEventListener('input', () => e.style.setProperty('--value', e.value));
}