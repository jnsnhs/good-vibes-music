const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous";
let isPlaying = false;
let masterLibraryData = []; // NEW: Holds the absolute truth of all 5,000+ songs
let libraryData = [];       // What is currently visible (filtered/sorted)
let currentTrackIndex = -1; 
let isShuffle = false;
let isRepeat = false;
let selectedPaths = new Set(); // Stores the file_paths of selected tracks
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

const addMusicBtn = document.getElementById('add-music-btn');

addMusicBtn.addEventListener('click', async () => {
    const response = await window.pywebview.api.add_music();
    
    if (response.status === 'started') {
        const container = document.getElementById('import-progress-container');
        const fill = document.getElementById('import-progress-fill');
        const countText = document.getElementById('import-count');
        
        // Lock the button & show progress bar
        addMusicBtn.disabled = true;
        addMusicBtn.style.opacity = '0.5';
        container.classList.remove('hidden');
        fill.style.width = '0%';

        // Begin polling Python every 500ms
        const pollInterval = setInterval(async () => {
            const state = await window.pywebview.api.get_import_progress();
            
            // Update UI visuals
            countText.innerText = `${state.current} / ${state.total}`;
            const percentage = (state.current / state.total) * 100;
            fill.style.width = `${percentage}%`;
            
            // Check if thread is completely finished
            if (!state.is_running && state.current === state.total) {
                clearInterval(pollInterval); // Stop asking Python
                
                // Safely merge new tracks into our master list
                if (state.new_tracks.length > 0) {
                    masterLibraryData.push(...state.new_tracks);
                    
                    // Trigger the search input to push master to display & refresh the Virtual Scroller!
                    document.getElementById('search-input').dispatchEvent(new Event('input'));
                }
                
                // Let the bar sit at 100% for a second before hiding it
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
        
        // Inside renderVirtualList() loop:
        const isSelected = selectedPaths.has(track.file_path) ? ' track-selected' : '';
        const isMissing = track.missing ? ' track-missing' : '';
        const missingWarning = track.missing ? '<span class="missing-icon" title="File not found">⚠️</span>' : '';
        
        // Mathematically position the row exactly where it belongs
        li.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
        li.dataset.index = i; 
        li.className = `${isMissing}${isSelected}`; // Combine classes
        
        li.innerHTML = `
            <img class="track-cover" id="cover-${i}" src="${coverCache[track.file_path] || 'placeholder.png'}" alt="">
            <div class="track-title">${missingWarning}${track.title}</div>
            <div class="track-artist">${track.artist}</div>
            <div class="track-album">${track.album}</div>
            <div class="track-year">${track.year}</div>
            <div class="track-duration">${track.duration}</div>
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

const doubleClickDelay = 200;
let doubleClickOnTrackPossible = false;

document.getElementById('track-list').addEventListener('click', (e) => {
    if (!doubleClickOnTrackPossible) {
        singleClickOnTrack(e);
        doubleClickOnTrackPossible = true;
        let timer = setTimeout(() => {
            doubleClickOnTrackPossible = false;
        }, doubleClickDelay);
    } else {
        doubleClickOnTrack(e);
    }    
});

async function doubleClickOnTrack(e) {
    const row = e.target.closest('li');
    if (!row) return;
    const trackIndex = parseInt(row.dataset.index);
    // Clear user text-selection that happens accidentally when double-clicking
    window.getSelection().removeAllRanges(); 
    await requestPlayback(trackIndex, 1, true); // Send to your bouncer!
}

function singleClickOnTrack(e) {
    const row = e.target.closest('li');
    if (!row) return;
    const trackIndex = parseInt(row.dataset.index);
    const track = libraryData[trackIndex];
    // Multi-select logic
    if (e.ctrlKey || e.metaKey) {
        if (selectedPaths.has(track.file_path)) {
            selectedPaths.delete(track.file_path);
        } else {
            selectedPaths.add(track.file_path);
        }
    } else {
        // Standard single select
        selectedPaths.clear();
        selectedPaths.add(track.file_path);
    }
    renderVirtualList();
}

// // SINGLE CLICK: Selection Engine (with Ctrl/Cmd support)
// document.getElementById('track-list').addEventListener('click', (e) => {
//     const row = e.target.closest('li');
//     if (!row) return;

//     const trackIndex = parseInt(row.dataset.index);
//     const track = libraryData[trackIndex];

//     // Multi-select logic
//     if (e.ctrlKey || e.metaKey) {
//         if (selectedPaths.has(track.file_path)) {
//             selectedPaths.delete(track.file_path);
//         } else {
//             selectedPaths.add(track.file_path);
//         }
//     } else {
//         // Standard single select
//         selectedPaths.clear();
//         selectedPaths.add(track.file_path);
//     }
    
//     renderVirtualList();
// });

// // DOUBLE CLICK: Playback Engine
// document.getElementById('track-list').addEventListener('dblclick', async (e) => {
//     console.log("double clicked!")
//     const row = e.target.closest('li');
//     if (!row) return;

//     // Clear user text-selection that happens accidentally when double-clicking
//     window.getSelection().removeAllRanges(); 

//     const trackIndex = parseInt(row.dataset.index);
//     await requestPlayback(trackIndex, 1, true); // Send to your bouncer!
// });

// Show Menu on Right-Click
document.getElementById('track-list').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('li');
    
    if (row) {
        const trackIndex = parseInt(row.dataset.index);
        const track = libraryData[trackIndex];
        
        // If the user right-clicks an unselected row, select ONLY that row
        if (!selectedPaths.has(track.file_path)) {
            selectedPaths.clear();
            selectedPaths.add(track.file_path);
            renderVirtualList();
        }

        // Position and show menu
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.remove('hidden');
    }
});

// Hide menu when clicking elsewhere
document.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
});

// Bulk Remove Action
document.getElementById('ctx-remove').addEventListener('click', async () => {
    const count = selectedPaths.size;
    if (count === 0) return;

    if (confirm(`Are you sure you want to remove ${count} track(s) from your library?\n\n(This will not delete the actual files from your hard drive).`)) {
        
        const pathsArray = Array.from(selectedPaths);
        const result = await window.pywebview.api.remove_tracks(pathsArray);
        
        if (result.status === 'success') {
            // Remove from Master and Display arrays
            masterLibraryData = masterLibraryData.filter(t => !selectedPaths.has(t.file_path));
            libraryData = libraryData.filter(t => !selectedPaths.has(t.file_path));
            
            selectedPaths.clear();
            renderVirtualList();
        }
    }
});

// Bulk Edit Action
document.getElementById('ctx-edit').addEventListener('click', () => {
    const pathsArray = Array.from(selectedPaths);
    if (pathsArray.length === 0) return;
    
    // OPEN YOUR METADATA MODAL HERE. 
    // You will pass 'pathsArray' to your modal instead of a single track.
    // If pathsArray.length > 1, show placeholder text like "(Multiple Values)" 
    // in the input fields. When the user saves, apply ONLY the altered fields 
    // to every file path in the array!
    console.log("Opening edit modal for:", pathsArray);
});



// --- NEW: Live Search Logic ---
document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (query === '') {
        libraryData = [...masterLibraryData];
    } else {
        // Split the search query into an array of individual words
        const searchTerms = query.split(/\s+/);
        
        libraryData = masterLibraryData.filter(track => {
            // Combine all searchable fields into one giant string for easy checking
            const searchableText = `${track.title || ''} ${track.artist || ''} ${track.album || ''}`.toLowerCase();
            
            // Check if EVERY search term exists SOMEWHERE in the searchable text
            return searchTerms.every(term => searchableText.includes(term));
        });
    }
    
    document.getElementById('track-list-container').scrollTop = 0;
    renderVirtualList();
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
    // if (libraryData.length === 0) return;

    // // UPDATED: Use the smart skipping function
    // const validIndex = getNextValidTrackIndex(currentTrackIndex, 1);
    
    // if (validIndex !== -1) {
    //     currentTrackIndex = validIndex;
    //     const track = libraryData[currentTrackIndex];
    //     const coverSrc = await getTrackCover(track.file_path);
    //     playTrack(track, coverSrc);
    // } else {
    //     alert("No valid tracks found to play.");
    // }
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, 1);
    await requestPlayback(targetIndex, 1, false);
});

// Example Previous Button Logic
document.getElementById('prev-btn').addEventListener('click', async () => {
    // if (libraryData.length === 0) return;

    // // UPDATED: Use the smart skipping function
    // const validIndex = getNextValidTrackIndex(currentTrackIndex, -1);
    
    // if (validIndex !== -1) {
    //     currentTrackIndex = validIndex;
    //     const track = libraryData[currentTrackIndex];
    //     const coverSrc = await getTrackCover(track.file_path);
    //     playTrack(track, coverSrc);
    // } else {
    //     alert("No valid tracks found to play.");
    // }
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, -1);
    await requestPlayback(targetIndex, -1, false);
});

// Example Auto-Play Next Song Logic (When current track finishes)
audioPlayer.addEventListener('ended', async () => {
    // if (libraryData.length === 0) return;
    
    // // UPDATED: Use the smart skipping function
    // const validIndex = getNextValidTrackIndex(currentTrackIndex, 1);
    
    // if (validIndex !== -1) {
    //     currentTrackIndex = validIndex;
    //     const track = libraryData[currentTrackIndex];
    //     const coverSrc = await getTrackCover(track.file_path);
    //     playTrack(track, coverSrc);
    // } else {
    //     alert("No valid tracks found to play.");
    // }
    const targetIndex = getNextValidTrackIndex(currentTrackIndex, 1);
    await requestPlayback(targetIndex, 1, false);
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
// const editModal = document.getElementById('edit-modal');

// Hide context menu when clicking anywhere else
document.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
});


// // Show the Modal
// document.getElementById('menu-edit').addEventListener('click', () => {
//     if (!trackBeingEdited) return;
    
//     // Pre-fill the inputs
//     document.getElementById('edit-title').value = trackBeingEdited.title;
//     document.getElementById('edit-artist').value = trackBeingEdited.artist;
//     document.getElementById('edit-year').value = trackBeingEdited.year;
    
//     editModal.classList.remove('hidden');
// });

// Cancel Button
// document.getElementById('cancel-edit-btn').addEventListener('click', () => {
//     editModal.classList.add('hidden');
//     trackBeingEdited = null;
// });

// Save Button
// document.getElementById('save-edit-btn').addEventListener('click', async () => {
//     if (!trackBeingEdited) return;
    
//     const newTitle = document.getElementById('edit-title').value;
//     const newArtist = document.getElementById('edit-artist').value;
//     const newYear = document.getElementById('edit-year').value;
    
//     // Visual feedback while saving
//     document.getElementById('save-edit-btn').innerText = "Saving...";
    
//     try {
//         const result = await window.pywebview.api.edit_track_metadata(
//             trackBeingEdited.file_path, newTitle, newArtist, newYear
//         );
        
//         if (result.status === 'success') {
//             // Update JS State
//             trackBeingEdited.title = newTitle;
//             trackBeingEdited.artist = newArtist;
//             trackBeingEdited.year = newYear;
            
//             // Re-render the UI
//             renderVirtualList(); 
            
//             // If the playing track was edited, update the Now Playing UI
//             if (currentTrackIndex !== -1 && libraryData[currentTrackIndex].file_path === trackBeingEdited.file_path) {
//                 document.getElementById('np-title').innerText = newTitle;
//                 document.getElementById('np-artist').innerText = newArtist;
//             }
//         } else {
//             alert("Error saving file: " + result.message);
//         }
//     } catch (e) {
//         console.error(e);
//     }
    
//     document.getElementById('save-edit-btn').innerText = "Save to File";
//     editModal.classList.add('hidden');
//     trackBeingEdited = null;
// });

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

// Hunts for the next available song that actually exists on the hard drive
function getNextValidTrackIndex(startIndex, direction = 1) {
    let index = startIndex;
    let attempts = 0;
    
    // Prevent infinite loops if literally every song is missing
    while (attempts < libraryData.length) {
        index = (index + direction + libraryData.length) % libraryData.length;
        if (!libraryData[index].missing) {
            return index;
        }
        attempts++;
    }
    return -1; // Everything is dead
}

// --- NEW: Centralized Playback Request Manager ---
async function requestPlayback(targetIndex, direction = 1, isManualClick = false) {
    if (libraryData.length === 0 || targetIndex === -1) return;

    const track = libraryData[targetIndex];

    // 1. JIT VERIFICATION: Ping Python to see if the file is STILL there
    const exists = await window.pywebview.api.check_file_exists(track.file_path);

    if (!exists) {
        // Mark as missing in memory and visually update immediately
        track.missing = true;
        renderVirtualList();

        if (isManualClick) {
            // BEHAVIOR A: The user explicitly clicked a dead track. Ask them to fix it.
            if (confirm(`The file for "${track.title}" has been moved or deleted since the app opened.\n\nWould you like to locate it manually?`)) {
                
                const response = await window.pywebview.api.locate_missing_file(track.file_path);
                
                if (response.status === 'success') {
                    const oldPath = track.file_path;
                    track.file_path = response.new_path;
                    track.missing = false;
                    delete coverCache[oldPath];
                    renderVirtualList(); // Heal UI
                    
                    // Success! Recursively call this function to play the healed track
                    requestPlayback(targetIndex, direction, isManualClick);
                }
            }
        } else {
            // BEHAVIOR B: The app tried to auto-play a dead track. Skip it silently.
            console.warn(`Skipping missing track: ${track.title}`);
            const nextValidIndex = getNextValidTrackIndex(targetIndex, direction);
            
            if (nextValidIndex !== -1 && nextValidIndex !== targetIndex) {
                // Recursively move to the next valid track
                requestPlayback(nextValidIndex, direction, false);
            }
        }
        return; // Halt execution for this dead track so the audio engine doesn't crash
    }

    // 2. FILE EXISTS: Proceed with normal playback
    currentTrackIndex = targetIndex;
    const coverSrc = await getTrackCover(track.file_path);
    playTrack(track, coverSrc);
}

const editModal = document.getElementById('edit-modal-overlay');
const fieldsToEdit = ['title', 'artist', 'album', 'album_artist', 'genre', 'year', 'track_num', 'disc_num', 'comments'];

// 1. Open the Modal from Context Menu
document.getElementById('ctx-edit').addEventListener('click', () => {
    const pathsArray = Array.from(selectedPaths);
    if (pathsArray.length === 0) return;
    
    // Hide context menu, show modal
    document.getElementById('context-menu').classList.add('hidden');
    editModal.classList.remove('hidden');

    // Populate Fields securely
    fieldsToEdit.forEach(field => {
        const input = document.getElementById(`edit-${field}`);
        
        // Find the value of the first selected track
        const firstVal = masterLibraryData.find(t => t.file_path === pathsArray[0])[field];
        
        // Check if ALL selected tracks share this exact same value
        const allSame = pathsArray.every(path => {
            const track = masterLibraryData.find(t => t.file_path === path);
            return track[field] === firstVal;
        });

        if (allSame) {
            input.value = firstVal || "";
            input.placeholder = "";
        } else {
            input.value = "";
            input.placeholder = "(Multiple Values)";
        }
        
        // Store original state on the element so we know if they changed it
        input.dataset.original = input.value;
    });

    // Handle Compilation checkbox separately (as it's a boolean 1 or 0)
    const compBox = document.getElementById('edit-compilation');
    const firstComp = masterLibraryData.find(t => t.file_path === pathsArray[0]).compilation;
    const allSameComp = pathsArray.every(path => masterLibraryData.find(t => t.file_path === path).compilation === firstComp);
    
    compBox.indeterminate = !allSameComp; // Shows a dash if mixed values
    compBox.checked = allSameComp ? (firstComp === 1) : false;
    compBox.dataset.originalState = allSameComp ? (firstComp === 1).toString() : "mixed";
});

// 2. Close Modal
document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    editModal.classList.add('hidden');
});

// 3. Save Changes
document.getElementById('btn-save-edit').addEventListener('click', async () => {
    const pathsArray = Array.from(selectedPaths);
    const saveBtn = document.getElementById('btn-save-edit');
    const modifiedData = {};

    // Check which text fields were ACTUALLY modified by the user
    fieldsToEdit.forEach(field => {
        const input = document.getElementById(`edit-${field}`);
        
        // Only queue the data if they typed something new, or if they cleared a previously shared value
        if (input.value !== input.dataset.original) {
            // Protect against them typing nothing into a (Multiple Values) field
            if (!(input.placeholder === "(Multiple Values)" && input.value === "")) {
                modifiedData[field] = input.value;
            }
        }
    });

    // Check compilation checkbox
    const compBox = document.getElementById('edit-compilation');
    if (compBox.dataset.originalState === "mixed" && !compBox.indeterminate) {
        modifiedData['compilation'] = compBox.checked ? 1 : 0;
    } else if (compBox.dataset.originalState !== "mixed" && compBox.checked.toString() !== compBox.dataset.originalState) {
        modifiedData['compilation'] = compBox.checked ? 1 : 0;
    }

    // If nothing was actually changed, just close it
    if (Object.keys(modifiedData).length === 0) {
        editModal.classList.add('hidden');
        return;
    }

    // Disable button to prevent double-clicks while writing to disk
    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    // Send to Python
    const result = await window.pywebview.api.update_metadata(pathsArray, modifiedData);

    if (result.status === 'success') {
        // Update local memory so we don't need to query the database again
        pathsArray.forEach(path => {
            const masterTrack = masterLibraryData.find(t => t.file_path === path);
            Object.keys(modifiedData).forEach(key => {
                masterTrack[key] = modifiedData[key];
            });
        });
        
        // Re-run the current search to update the visual display
        document.getElementById('search-input').dispatchEvent(new Event('input'));
        
        editModal.classList.add('hidden');
    } else {
        alert("An error occurred while saving metadata. Check the console.");
    }

    // Reset button
    saveBtn.innerText = "Save Changes";
    saveBtn.disabled = false;
});
