const audioPlayer = new Audio();
let isPlaying = false;
let libraryData = []; 
let currentTrackIndex = -1; 
let isShuffle = false;
let isRepeat = false;
const placeholderImg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23b3b3b3'><path d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/></svg>`;

window.addEventListener('pywebviewready', async function() {
    try {
        libraryData = await window.pywebview.api.get_library();
        libraryData.forEach(track => addTrackToUI(track));
    } catch (error) {
        console.error("Error loading library:", error);
    }
});

document.getElementById('add-music-btn').addEventListener('click', async () => {
    try {
        const result = await window.pywebview.api.add_music();
        if (result.status === 'success') {
            result.tracks.forEach(track => {
                libraryData.push(track); 
                addTrackToUI(track);
            });
        }
    } catch (error) {
        console.error("Error adding music:", error);
    }
});

// --- UPDATED: Track UI Rendering & Delete Logic ---
function addTrackToUI(track) {
    const list = document.getElementById('track-list');
    const li = document.createElement('li');
    const coverSrc = track.cover_base64 || placeholderImg;

    // Added track.year and the remove-btn
    li.innerHTML = `
        <img class="track-cover" src="${coverSrc}" alt="Cover">
        <div class="track-title">${track.title}</div>
        <div class="track-artist">${track.artist}</div>
        <div class="track-album">${track.album}</div>
        <div class="track-year">${track.year}</div>
        <div class="track-duration">${track.duration}</div>
        <button class="remove-btn" title="Remove Track">✖</button>
    `;

    // 1. Play Track Listener
    li.addEventListener('click', (e) => {
        // Prevent the track from playing if the user actually clicked the Delete button
        if (e.target.classList.contains('remove-btn')) return;
        
        currentTrackIndex = libraryData.findIndex(t => t.file_path === track.file_path);
        playTrack(track, coverSrc);
    });

    // 2. Remove Track Listener
    const removeBtn = li.querySelector('.remove-btn');
    removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Stops the click from bubbling up to the row
        
        try {
            // Send the file path in an array (supports multiple deletions structurally)
            const result = await window.pywebview.api.remove_tracks([track.file_path]);
            
            if (result.status === 'success') {
                // Remove from our JavaScript state
                libraryData = libraryData.filter(t => t.file_path !== track.file_path);
                
                // Remove the row from the HTML DOM entirely
                li.remove();
                
                // If they deleted the song that is currently playing, adjust index
                currentTrackIndex = libraryData.findIndex(t => t.file_path === track.file_path);
            }
        } catch (error) {
            console.error("Error removing track:", error);
        }
    });

    // NEW: Right-click listener for Context Menu
    li.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Stop standard browser menu
        trackBeingEdited = track;
        
        // Position the menu where the mouse clicked
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.remove('hidden');
    });

    list.appendChild(li);
}


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

document.getElementById('next-btn').addEventListener('click', playNext);
audioPlayer.addEventListener('ended', playNext);

// Previous Button Logic
document.getElementById('prev-btn').addEventListener('click', () => {
    if (libraryData.length === 0 || currentTrackIndex === -1) return;
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
    } else {
        currentTrackIndex = (currentTrackIndex - 1 + libraryData.length) % libraryData.length;
        const prevTrack = libraryData[currentTrackIndex];
        playTrack(prevTrack, prevTrack.cover_base64 || placeholderImg);
    }
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
    // Toggle direction if clicking the same header
    if (currentSort.field === field) {
        currentSort.ascending = !currentSort.ascending;
    } else {
        currentSort.field = field;
        currentSort.ascending = true;
    }

    libraryData.sort((a, b) => {
        let valA = a[field].toString().toLowerCase();
        let valB = b[field].toString().toLowerCase();
        
        // Custom sort for numeric strings (like Year)
        if (field === 'year') {
            valA = parseInt(valA) || 0;
            valB = parseInt(valB) || 0;
        }

        if (valA < valB) return currentSort.ascending ? -1 : 1;
        if (valA > valB) return currentSort.ascending ? 1 : -1;
        return 0;
    });

    // Refresh UI
    const list = document.getElementById('track-list');
    list.innerHTML = '';
    libraryData.forEach(track => addTrackToUI(track));
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

// Helper: Re-draws the whole list (useful for sorting and editing)
function renderLibrary() {
    const list = document.getElementById('track-list');
    list.innerHTML = '';
    libraryData.forEach(track => addTrackToUI(track));
}

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
            renderLibrary(); 
            
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
