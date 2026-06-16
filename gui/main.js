const DOUBLE_CLICK_DELAY = 200;
const SKIP_TO_PREVIOUS_TRACK_THRESHOLD_SECONDS = 3;
const SEARCH_DEBOUNCE_TIME = 300;
let dimmedCoverArt = true;
let savedAccent = 'blue';

let selectedPaths = new Set();


class ApplicationMenu {

    constructor() {
        this.container = document.getElementById('application-menu');
        this.settingsItem = document.getElementById('app-settings-menu-item');
        this.exitItem = document.getElementById('quit-app-menu-item');
        this.initSettingsItem();
        this.initExitItem();
        document.addEventListener('click', (e) => {
            if (!gui.applicationMenu.isHidden && 
                !gui.applicationMenu.container.contains(e.target) &&
                !gui.appMenuBtn.contains(e.target)
            ) {
                gui.applicationMenu.setHidden = true;
            }
        });
        this.hidden = true;
    }

    initSettingsItem() {
        if (this.settingsItem) {
            this.settingsItem.addEventListener('mouseup', () => {
                this.setHidden = true;
                gui.appSettingsModal.show();
            });
        }
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === ',') {
                if (!GuiHelper.isAnyModalOpen()) {
                    e.preventDefault();
                    gui.appSettingsModal.show();
                }
            }
        });
    }

    initExitItem() {
        if (this.exitItem) {
            this.exitItem.addEventListener('mouseup', (e) => {
                window.pywebview.api.quit_application();
            });
        }
    }

    get isHidden() {
        return this.hidden;
    }

    set setHidden(boolVal) {
        if (boolVal == true) {
            this.container.classList.add('hidden');
        } else {
            this.container.classList.remove('hidden');
        }
        this.hidden = boolVal;
    }
}


class TrackContextMenu {

    constructor() {
        this.id = 'context-menu';
        this.container = document.getElementById(this.id);
        this.initPlayNextItem();
        this.initEditItem();
        this.initRemoveItem();
        document.addEventListener('click', () => {
            this.hide();
        });
    }

    initPlayNextItem() {
        const playNextItem = document.getElementById('ctx-play-next');
        playNextItem.addEventListener('click', () => {
            const pathsArray = Array.from(selectedPaths);
            myAudioPlayer.manualQueue = pathsArray.concat(myAudioPlayer.manualQueue);
            document.getElementById('context-menu').classList.add('hidden');
            if (!queuePopover.classList.contains('hidden')) {
                renderQueuePopover();
            }
        });
    }

    initRemoveItem() {
        const removeItem = document.getElementById('ctx-remove');
        removeItem.addEventListener('click', async () => {
            const count = selectedPaths.size;
            if (count === 0) return;
            const confirmMsg = `Are you sure you want to remove ${count} track(s)` + 
                `from your library?\n\n(This will not delete the actual files from ` +
                `your hard drive).`
            if (confirm(confirmMsg)) {
                const pathsArray = Array.from(selectedPaths);
                const result = await window.pywebview.api.remove_tracks_from_db(pathsArray);
                if (result.status === 'success') {
                    musicLibrary.masterData = musicLibrary.masterData.filter(
                        t => !selectedPaths.has(t.file_path));
                    musicLibrary.data = musicLibrary.data.filter(
                        t => !selectedPaths.has(t.file_path));
                    selectedPaths.clear();
                    if (gui.currentView === 'list') {
                        litsView.renderVirtualList();
                    } else {
                        albumsView.renderAlbumGrid();
                    }
                }
            }
        });
    }

    initEditItem() {
        const editItem = document.getElementById('ctx-edit');
        editItem.addEventListener('click', (e) => {
            const pathsArray = Array.from(selectedPaths);
            if (pathsArray.length === 0) return;
            gui.trackContextMenu.hide();
            gui.editModal.show(pathsArray);
        });
    }

    show(e) {
        this.container.style.opacity = '0';
        this.container.classList.remove('hidden');
        const menuWidth = this.container.offsetWidth;
        const menuHeight = this.container.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        let leftPos = e.clientX;
        let topPos = e.clientY;
        if (e.clientX + menuWidth > windowWidth) {
            leftPos = e.clientX - menuWidth;
        }
        if (e.clientY + menuHeight > windowHeight) {
            topPos = e.clientY - menuHeight;
        }
        if (leftPos < 0) leftPos = 0;
        if (topPos < 0) topPos = 0;
        this.container.style.left = `${leftPos}px`;
        this.container.style.top = `${topPos}px`;
        this.container.style.opacity = '1';
    }

    hide() {
        this.container.classList.add('hidden');
    }
}


class EditTrackModal {

    constructor() {
        this.id = 'edit-modal-overlay';
        this.container = document.getElementById(this.id);
        this.fieldsToEdit = [
            'title',
            'artist',
            'album',
            'album_artist',
            'genre',
            'year',
            'track_num',
            'disc_num',
            'comments'
        ];
        this.initSaveBtn();
        this.initCancelBtn();
    }

    show(pathsArray) {
        this.fieldsToEdit.forEach(field => {
            const input = document.getElementById(`edit-${field}`);
            const firstVal = musicLibrary.masterData.find(t => t.file_path === pathsArray[0])[field];
            const allSame = pathsArray.every(path => musicLibrary.masterData.find(t => t.file_path === path)[field] === firstVal);
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
        const firstComp = musicLibrary.masterData.find(t => t.file_path === pathsArray[0]).compilation;
        const allSameComp = pathsArray.every(path => musicLibrary.masterData.find(t => t.file_path === path).compilation === firstComp);
        compBox.indeterminate = !allSameComp; 
        compBox.checked = allSameComp ? (firstComp === 1) : false;
        compBox.dataset.originalState = allSameComp ? (firstComp === 1).toString() : "mixed";
        this.container.classList.remove('hidden');
    }

    hide() {
        this.container.classList.add('hidden');
        guiController.clearSelection();
    }

    initSaveBtn() {
        const saveBtn = document.getElementById('btn-save-edit');
        saveBtn.addEventListener('click', async () => {
            const pathsArray = Array.from(selectedPaths);
            const modifiedData = {};
            this.fieldsToEdit.forEach(field => {
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
                this.container.classList.add('hidden');
                return;
            }
            saveBtn.innerText = "Saving...";
            saveBtn.disabled = true;
            const result = await window.pywebview.api.update_metadata(
                pathsArray, modifiedData);
            if (result.status === 'success') {
                pathsArray.forEach(path => {
                    const masterTrack = musicLibrary.masterData.find(t => t.file_path === path);
                    Object.keys(modifiedData).forEach(key => {
                        masterTrack[key] = modifiedData[key];
                    });
                });
                document.getElementById('search-input').dispatchEvent(new Event('input'));
                this.container.classList.add('hidden');
            } else {
                alert("An error occurred while saving metadata. Check the console.");
            }
            saveBtn.innerText = "Save Changes";
            saveBtn.disabled = false;
        });
    }

    initCancelBtn() {
        const cancelBtn = document.getElementById('btn-cancel-edit');
        cancelBtn.addEventListener('click', () => {
            this.container.classList.add('hidden');
        });
    }

}


class ErrorMessageModal {

    constructor(title, message) {
        this.id = 'error-modal';
        this.container = document.getElementById(id);
        this.injectTitle(title);
        this.injectMessage(message);
        this.addEventListeners();
    }

    injectTitle(title) {
        const titleElement = document.getElementById('error-modal-title');
        titleElement.innerHTML = title;
    }

    injectMessage(message) {
        const messageElement = document.getElementById('error-modal-message');
        messageElement.innerHTML = message;
    }

    addEventListeners() {
        const errorModalOkBtn = document.getElementById('error-modal-ok-btn');
        errorModalOkBtn.addEventListener('click', () => {
            this.container.classList.add('hidden');
        });
    }

    show() {
        this.container.classList.remove('hidden');
    }

    static get containerId() {
        return this.id;
    }

}


class AlbumsViewSettingsModal {

    constructor() {
        this.id = 'grid-settings-modal';
        this.container = document.getElementById(this.id);
        this.saveBtn = document.getElementById('btn-save-grid-settings');
        this.saveBtn.addEventListener('click', () => {this.save();});
        this.cancelBtn = document.getElementById('btn-cancel-grid-settings');
        this.cancelBtn.addEventListener('click', () => {this.cancel();});
    }

    open() {
        document.querySelector(`input[name="grid-sort"][value="${albumsView.gridSortOrder}"]`).checked = true;
        document.querySelector(`input[name="grid-sort-dir"][value="${albumsView.gridSortDirection}"]`).checked = true;
        document.getElementById('grid-show-subheadings').checked = albumsView.showGridSubheadings;
        document.getElementById('grid-sticky-subheadings').checked = albumsView.stickyGridSubheadings;
        this.container.classList.remove('hidden');
    }

    save() {
        albumsView.gridSortOrder = document.querySelector('input[name="grid-sort"]:checked').value;
        albumsView.gridSortDirection = document.querySelector('input[name="grid-sort-dir"]:checked').value;
        albumsView.showGridSubheadings = document.getElementById('grid-show-subheadings').checked;
        albumsView.stickyGridSubheadings = document.getElementById('grid-sticky-subheadings').checked;
        albumsView.renderAlbumGrid(); 
        this.close();
    }

    cancel() {
        this.close();
    }

    close() {
        this.container.classList.add('hidden');
    }

    static get containerId() {
        return this.id;
    }

}


class SongsViewSettingsModal {

    constructor() {
        this.id = 'list-settings-modal';
        this.container = document.getElementById(this.id);
        this.saveBtn = document.getElementById('btn-save-list-settings');
        this.saveBtn.addEventListener('click', () => {this.save();});
        this.cancelBtn = document.getElementById('btn-cancel-list-settings');
        this.cancelBtn.addEventListener('click', () => {this.cancel();});
    }

    open() {
        document.getElementById('list-show-coverart').checked = songsView.showCoverArt;
        this.container.classList.remove('hidden');
    }

    save() {
        songsView.showCoverArt = document.getElementById('list-show-coverart').checked;
        songsView.renderVirtualList(); 
        this.close();
    }

    cancel() {
        this.close();
    }

    close() {
        this.container.classList.add('hidden');
    }

    static get containerId() {
        return this.id;
    }

}


class AppSettingsModal {
    constructor() {
        this.accentThemes = {
            green: '#1db954',
            blue: '#007aff',
            red: '#ff3b30'
        };
        this.id = 'app-settings-modal';
        this.container = document.getElementById(this.id);
        this.audio_normalization_checkbox = document.getElementById(
            'settings-audio-normalization');
        this.dimmed_coverart_checkbox = document.getElementById(
            'settings-dimmed-coverart');
        this.selectDropdown = document.getElementById('accent-color-select');
        this.addEventListeners();
    }
    addEventListeners() {
        const saveBtn = document.getElementById('btn-save-app-settings');
        saveBtn.addEventListener('click', () => {
            this.save();
            this.hide();
        });
        const cancelBtn = document.getElementById('btn-cancel-app-settings');
        cancelBtn.addEventListener('click', () => {
            this.hide();
        });
    }
    applyAudioOptions() {
        if (myAudioPlayer.isNormalized) {
            myAudioPlayer.audioSource.disconnect(myAudioPlayer.audioCtx.destination);
            myAudioPlayer.audioSource.connect(myAudioPlayer.compressor);
            myAudioPlayer.compressor.connect(myAudioPlayer.audioCtx.destination);
        } else {
            myAudioPlayer.audioSource.disconnect(myAudioPlayer.compressor);
            myAudioPlayer.compressor.disconnect(myAudioPlayer.audioCtx.destination);
            myAudioPlayer.audioSource.connect(myAudioPlayer.audioCtx.destination);
        }
    }
    applyVisualOptions() {
        //.album-card-cover
        const expandedCover = document.getElementById('expanded-highres-cover');
        if (expandedCover) {
            if (dimmedCoverArt) {
                expandedCover.classList.add('dimmed');
            } else {
                expandedCover.classList.remove('dimmed');
            }
        }
        document.querySelectorAll('.album-card-cover').forEach(c => {
            if (dimmedCoverArt) {
                c.classList.add('dimmed');
            } else {
                c.classList.remove('dimmed');
            }
        });
    }
    applyAccentTheme(colorName) {
        const hexValue = this.accentThemes[colorName] || this.accentThemes.green;
        document.documentElement.style.setProperty('--accent', hexValue);
    }
    show() {
        this.container.classList.remove('hidden');
        this.audio_normalization_checkbox.checked = myAudioPlayer.isNormalized;
        this.dimmed_coverart_checkbox.checked = dimmedCoverArt;
        if (this.selectDropdown) {
            this.selectDropdown.value = savedAccent;
        }

    }
    save() {
        myAudioPlayer.initWebAudio();
        if (myAudioPlayer.isNormalized != this.audio_normalization_checkbox.checked) {
            myAudioPlayer.isNormalized = this.audio_normalization_checkbox.checked;
            this.applyAudioOptions();
        }
        if (dimmedCoverArt != this.dimmed_coverart_checkbox.checked) {
            dimmedCoverArt = this.dimmed_coverart_checkbox.checked;
            this.applyVisualOptions();
        }
        savedAccent = this.selectDropdown.value;
        this.applyAccentTheme(savedAccent);
    }
    hide() {
        this.container.classList.add('hidden');
    }
    static get containerId() {
        return this.id;
    }
}


class Gui {

    constructor() {
        this.currentView = 'list';  // list or grid
        this.doubleClickOnTrackPossible = false;
        this.COVER_PLACEHOLDER_PATH = 'placeholder.png';
        this.playPauseBtnPausedIcon = document.getElementById('play-pause-btn-paused');
        this.playPauseBtnPlayingIcon = document.getElementById('play-pause-btn-playing');
        this.songsViewBtn = document.getElementById('toggle-list-btn');
        this.albumsViewBtn = document.getElementById('toggle-grid-btn');
        this.searchField = document.getElementById('search-input');
        this.addMusicBtn = document.getElementById('add-music-btn');
        this.appMenuBtn = document.getElementById('application-menu-btn');
        this.prevBtn = document.getElementById('prev-btn');
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.currentTimeEl = document.getElementById('current-time');
        this.progressBar = document.getElementById('progress-bar');
        this.totalTimeEl = document.getElementById('total-time');
        this.shuffleBtn = document.getElementById('shuffle-btn');
        this.repeatBtn = document.getElementById('repeat-btn');
        this.queueBtn = document.getElementById('queue-btn');
        this.volumeBtn = document.getElementById('volume-btn');
        this.volumeBar = document.getElementById('volume-bar');
        this.applicationMenu = new ApplicationMenu();
        this.appSettingsModal = new AppSettingsModal();
        this.trackContextMenu = new TrackContextMenu();
        this.editModal = new EditTrackModal();
    }

}


class GuiController {

    constructor() {
        this.isUserDraggingProgressHandle = false;
        this.searchDebounceTimeout;
        document.addEventListener('DOMContentLoaded', () => {
            this.speakerIcon = document.getElementById("volume-icon-max");
            this.mutedIcon = document.getElementById("volume-icon-muted");
            this.listViewWrapper = document.getElementById('list-view-wrapper');
            this.gridViewWrapper = document.getElementById('grid-view-wrapper');
            this.initAddMusicBtn();
            this.initApplicationMenuBtn();
            this.initVolumebar();
            this.initVolumeBtn();
            this.initPrevBtn();
            this.initPlayPauseBtn();
            this.initNextBtn();
            this.initProgressBar();
            this.initShuffleBtn();
            this.initRepeatBtn();
            this.initQueueBtn();
            this.initSongsViewBtn();
            this.initAlbumsViewBtn();
            this.initSearchField();
            this.initViewSettingsBtn();
        });
        document.addEventListener('scroll', () => {
            if (gui.trackContextMenu) {
                gui.trackContextMenu.hide();
            }
        }, { capture: true });
        this.suppressContextMenuGlobally();
        this.forceKeyboardFocusRelease();
        this.clearSelectionOnClick();
    }

    suppressContextMenuGlobally() {
        document.addEventListener('contextmenu', e => {
            e.preventDefault();
            const isTrack = e.target.closest('li:not(.disc-header)');
            const isCard = e.target.closest('.album-card');
            const isInteractive = e.target.closest(
                'button, input, .player-bar, .app-header, .list-header, #context-menu, #queue-popover, #edit-modal-overlay, #grid-settings-modal, #application-menu');    
            if (!isTrack && !isCard && !isInteractive) {
                clearSelection();
                gui.trackContextMenu.hide();
            }
        });
    }

    forceKeyboardFocusRelease() {
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            slider.addEventListener('pointerup', () => {slider.blur();});
        });
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('pointerup', () => {button.blur();});
        });
    }

    clearSelectionOnClick() {
        document.addEventListener('click', (e) => {
            const isTrack = e.target.closest('li:not(.disc-header)');
            const isCard = e.target.closest('.album-card');
            const isInteractive = e.target.closest(
                'button, input, .player-bar, .app-header, .list-header, #context-menu, #queue-popover, #edit-modal-overlay, #grid-settings-modal, #application-menu');    
            if (!isTrack && !isCard && !isInteractive) {
                this.clearSelection();
            }
        });
    }

    clearSelection() { // visual and logical
        if (selectedPaths.size > 0) {
            selectedPaths.clear();
            songsView.lastClickedIndex = null;
            albumsView.lastGridClickedIndex = null;
            if (gui.currentView === 'list') {
                songsView.renderVirtualList();
            } else { // currentView == 'grid'
                const expandedList = document.getElementById('expanded-track-list');
                if (expandedList) {
                    Array.from(expandedList.children).forEach(child => {
                        child.classList.remove('track-selected');
                    });
                }
            }
        }
    }

    initSongsViewBtn() {
        gui.songsViewBtn.addEventListener('click', () => {
            gui.currentView = 'list';
            gui.songsViewBtn.classList.add('active');
            gui.albumsViewBtn.classList.remove('active');
            this.gridViewWrapper.classList.add('hidden');
            this.listViewWrapper.classList.remove('hidden');
            songsView.renderVirtualList();
        });
    }

    initAlbumsViewBtn() {
        gui.albumsViewBtn.addEventListener('click', () => {
            gui.currentView = 'grid';
            gui.albumsViewBtn.classList.add('active');
            gui.songsViewBtn.classList.remove('active');
            this.listViewWrapper.classList.add('hidden');
            this.gridViewWrapper.classList.remove('hidden');
            albumsView.renderAlbumGrid();
        });
    }

    initViewSettingsBtn() {
        const viewSettingsBtn = document.getElementById('view-settings-btn');
        if (viewSettingsBtn) {
            viewSettingsBtn.addEventListener('click', () => {
                if (gui.currentView == 'grid') {
                    const albumsViewSettingsModal = new AlbumsViewSettingsModal();
                    albumsViewSettingsModal.open();
                }
                if (gui.currentView == 'list') {
                    const songsViewSettingsModal = new SongsViewSettingsModal();
                    songsViewSettingsModal.open();
                }
            });
        }
    }

    initSearchField() {
        gui.searchField.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounceTimeout);
            this.searchDebounceTimeout = setTimeout(() => {
                const query = e.target.value.trim();
                if (query === '') {
                    musicLibrary.data = [...musicLibrary.masterData];
                } else {
                    const parsedGroups = SearchEngine.parseSearchQuery(query);
                    const conditionGroups = parsedGroups.map(
                        group => group.map(SearchEngine.buildCondition)
                    );
                    musicLibrary.libraryData = musicLibrary.masterData.filter(track => {
                        return conditionGroups.some(group => {
                            return group.every(condition => SearchEngine.evaluateCondition(track, condition));
                        });
                    });
                }
                if (gui.currentView === 'list') {
                    document.getElementById('track-list-container').scrollTop = 0;
                    songsView.renderVirtualList();
                } else {
                    albumsView.renderAlbumGrid(); 
                }
                myAudioPlayer.refreshDynamicQueue();
            }, SEARCH_DEBOUNCE_TIME); 
        });
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                if (!GuiHelper.isAnyModalOpen()) {
                    e.preventDefault();
                    if (gui.searchField) {
                        gui.searchField.focus();
                        gui.searchField.select(); 
                    }
                }
            }
        });
    }

    initApplicationMenuBtn() {
        gui.appMenuBtn.addEventListener('mousedown', (e) => {
            queuePopover.container.classList.add('hidden');
            e.stopPropagation();
            if (gui.applicationMenu.isHidden) {
                gui.applicationMenu.setHidden = false;
            } else {
                gui.applicationMenu.setHidden = true;
            }
        });
    }

    initPlayPauseBtn() {
        gui.playPauseBtnPlayingIcon.style.display = 'none';
        gui.playPauseBtn.addEventListener('click', () => {
            if (!myAudioPlayer.htmlAudioElement.src) return;
            if (myAudioPlayer.isPlaying) {
                myAudioPlayer.htmlAudioElement.pause();
                gui.playPauseBtnPlayingIcon.style.display = 'none';
                gui.playPauseBtnPausedIcon.style.display = 'block';
            } else {
                myAudioPlayer.htmlAudioElement.play();
                gui.playPauseBtnPausedIcon.style.display = 'none';
                gui.playPauseBtnPlayingIcon.style.display = 'block';
            }
            myAudioPlayer.isPlaying = !myAudioPlayer.isPlaying;
        });
        document.addEventListener('keydown', e => {
            if (e.code === 'Space') {
                const activeEl = document.activeElement;
                const activeTag = activeEl.tagName;
                const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
                if (!GuiHelper.isAnyModalOpen() && !isTyping) {
                    e.preventDefault();
                    if (gui.playPauseBtn) gui.playPauseBtn.click();
                }
            }
        });
    }

    initShuffleBtn() {
        gui.shuffleBtn.addEventListener('click', (e) => {
            myAudioPlayer.isShuffle = !myAudioPlayer.isShuffle;
            // e.target.classList.toggle('active', myAudioPlayer.isShuffle);
            if (myAudioPlayer.isShuffle) {
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
            if (myAudioPlayer.currentPlayingPath) {
                myAudioPlayer.buildContextQueue(myAudioPlayer.currentPlayingPath);
            }
            if (queuePopover.container && !queuePopover.container.classList.contains('hidden')) {
                queuePopover.render();
            }
        });
    }

    initRepeatBtn() {
        gui.repeatBtn.addEventListener('click', () => {
            console.log('repeat was ' + myAudioPlayer.repeatMode);
            if (myAudioPlayer.repeatMode === 'off') {
                myAudioPlayer.repeatMode = 'all';
                console.log('repeat is now ' + myAudioPlayer.repeatMode);
                gui.repeatBtn.innerHTML = 
                    '<svg class="btn-icon" viewBox="0 -960 960 960">' +
                    '<path d="M120-40q-33 0-56.5-23.5T40-120v-720q0-33 23.5-56.5T120-920h720q33 0 56.5 23.5T920-840v720q0 33-23.5 56.5T840-40H120Zm154-160h406q33 0 56.5-23.5T760-280v-120q0-17-11.5-28.5T720-440q-17 0-28.5 11.5T680-400v120H274l34-34q12-12 11.5-28T308-370q-12-12-28.5-12.5T251-371L148-268q-6 6-8.5 13t-2.5 15q0 8 2.5 15t8.5 13l103 103q12 12 28.5 11.5T308-110q11-12 11.5-28T308-166l-34-34Zm412-480-34 34q-12 12-11.5 28t11.5 28q12 12 28.5 12.5T709-589l103-103q6-6 8.5-13t2.5-15q0-8-2.5-15t-8.5-13L709-851q-12-12-28.5-11.5T652-850q-11 12-11.5 28t11.5 28l34 34H280q-33 0-56.5 23.5T200-680v120q0 17 11.5 28.5T240-520q17 0 28.5-11.5T280-560v-120h406Z"/>' +
                    '</svg>'
                ;
                gui.repeatBtn.title = 'Repeat: All';
            } else if (myAudioPlayer.repeatMode === 'all') {
                myAudioPlayer.repeatMode = 'one';
                console.log('repeat is now ' + myAudioPlayer.repeatMode);
                gui.repeatBtn.innerHTML = 
                    '<svg class="btn-icon" viewBox="0 -960 960 960">' +
                    '<path d="M120-40q-33 0-56.5-23.5T40-120v-720q0-33 23.5-56.5T120-920h720q33 0 56.5 23.5T920-840v720q0 33-23.5 56.5T840-40H120Zm154-160h406q33 0 56.5-23.5T760-280v-120q0-17-11.5-28.5T720-440q-17 0-28.5 11.5T680-400v120H274l34-34q12-12 11.5-28T308-370q-12-12-28.5-12.5T251-371L148-268q-6 6-8.5 13t-2.5 15q0 8 2.5 15t8.5 13l103 103q12 12 28.5 11.5T308-110q11-12 11.5-28T308-166l-34-34Zm412-480-34 34q-12 12-11.5 28t11.5 28q12 12 28.5 12.5T709-589l103-103q6-6 8.5-13t2.5-15q0-8-2.5-15t-8.5-13L709-851q-12-12-28.5-11.5T652-850q-11 12-11.5 28t11.5 28l34 34H280q-33 0-56.5 23.5T200-680v120q0 17 11.5 28.5T240-520q17 0 28.5-11.5T280-560v-120h406ZM460-540v150q0 13 8.5 21.5T490-360q13 0 21.5-8.5T520-390v-170q0-17-11.5-28.5T480-600h-50q-13 0-21.5 8.5T400-570q0 13 8.5 21.5T430-540h30Z"/>' +
                    '</svg>'
                ;
                gui.repeatBtn.title = 'Repeat: One';
            } else {
                myAudioPlayer.repeatMode = 'off';
                console.log('repeat is now ' + myAudioPlayer.repeatMode);
                gui.repeatBtn.innerHTML = 
                    '<svg class="btn-icon" viewBox="0 -960 960 960">' +
                    '<path d="m274-200 34 34q12 12 11.5 28T308-110q-12 12-28.5 12.5T251-109L148-212q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l103-103q12-12 28.5-11.5T308-370q11 12 11.5 28T308-314l-34 34h406v-120q0-17 11.5-28.5T720-440q17 0 28.5 11.5T760-400v120q0 33-23.5 56.5T680-200H274Zm412-480H280v120q0 17-11.5 28.5T240-520q-17 0-28.5-11.5T200-560v-120q0-33 23.5-56.5T280-760h406l-34-34q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T709-851l103 103q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L709-589q-12 12-28.5 11.5T652-590q-11-12-11.5-28t11.5-28l34-34Z"/>' +
                    '</svg>'
                ;
                gui.repeatBtn.title = 'Repeat: Off';
            }
        });
    }

    initQueueBtn() {
        gui.queueBtn.addEventListener('mousedown', (e) => {
            gui.applicationMenu.sethidden = true;
            e.stopPropagation(); 
            queuePopover.container.classList.toggle('hidden');
            if (!queuePopover.container.classList.contains('hidden')) {
                queuePopover.render();
            }
        });
        document.addEventListener('mousedown', (e) => {
            if (!queuePopover.container.classList.contains('hidden') && !queuePopover.container.contains(e.target) && e.target !== gui.queueBtn && !gui.queueBtn.contains(e.target)) {
                queuePopover.container.classList.add('hidden');
            }
        });
    }

    initNextBtn() {
        gui.nextBtn.addEventListener('click', async () => {
            const targetPath = myAudioPlayer.popNextTrackFromQueue();
            if (targetPath) await myAudioPlayer.requestPlayback(targetPath, 1, false);
        });
    }

    initPrevBtn() {
        gui.prevBtn.addEventListener('click', async () => {
            if (!myAudioPlayer.currentPlayingPath) return;
            if (myAudioPlayer.htmlAudioElement.currentTime > SKIP_TO_PREVIOUS_TRACK_THRESHOLD_SECONDS) {
                myAudioPlayer.htmlAudioElement.currentTime = 0;
                gui.progressBar.value = myAudioPlayer.htmlAudioElement.currentTime;
            } else {
                const targetPath = myAudioPlayer.getPreviousTrackPath(myAudioPlayer.currentPlayingPath);
                if (targetPath) {
                    myAudioPlayer.manualQueue = [];
                    myAudioPlayer.buildContextQueue(targetPath);
                    await myAudioPlayer.requestPlayback(targetPath, -1, false);
                }
            }
        });
    }

    initProgressBar() {
        gui.currentTimeEl.style.visibility = 'hidden';
        gui.totalTimeEl.style.visibility = 'hidden';
        gui.progressBar.disabled = true;
        gui.progressBar.addEventListener('input', (e) => {
            this.isUserDraggingProgressHandle = true;
            gui.currentTimeEl.innerText = Utils.formatTime(gui.progressBar.value);
        });
        gui.progressBar.addEventListener('change', (e) => {
            myAudioPlayer.htmlAudioElement.currentTime = gui.progressBar.value;
            this.isUserDraggingProgressHandle = false;
        });
        myAudioPlayer.htmlAudioElement.addEventListener('timeupdate', () => {
            if (this.isUserDraggingProgressHandle) return; 
            gui.currentTimeEl.innerText = Utils.formatTime(myAudioPlayer.htmlAudioElement.currentTime);
            if (myAudioPlayer.htmlAudioElement.duration) {
                gui.totalTimeEl.innerText = Utils.formatTime(myAudioPlayer.htmlAudioElement.duration);
                gui.progressBar.max = myAudioPlayer.htmlAudioElement.duration;
                gui.progressBar.value = myAudioPlayer.htmlAudioElement.currentTime;
            }
        });
    }

    initAddMusicBtn() {
        if (gui.addMusicBtn) {
            gui.addMusicBtn.addEventListener('click', async () => {
                musicLibrary.importFiles();
            });
        }
    }

    initVolumeBtn() {
        if (gui.volumeBtn) {
            this.setVolumeIcon();
            gui.volumeBtn.addEventListener('click', () =>  {
                myAudioPlayer.htmlAudioElement.muted = !myAudioPlayer.htmlAudioElement.muted;
                if (myAudioPlayer.htmlAudioElement.muted) {
                    gui.volumeBar.value = gui.volumeBar.min;
                } else {
                    gui.volumeBar.value = GuiHelper.volumeToSlider(
                        myAudioPlayer.getVolumeLevel());
                }
                this.setVolumeIcon();
            });
        }
    }

    initVolumebar() {
        if (gui.volumeBar) {
            gui.volumeBar.min = 0;
            gui.volumeBar.max = myAudioPlayer.getVolumeMax();
            gui.volumeBar.step = gui.volumeBar.max / 100;
            gui.volumeBar.value = myAudioPlayer.getVolumeLevel();
            gui.volumeBar.addEventListener('input', () => {
                if (myAudioPlayer.htmlAudioElement.muted) myAudioPlayer.htmlAudioElement.muted = false;
                myAudioPlayer.setVolumeLevel(
                    GuiHelper.sliderToVolume(gui.volumeBar.value));
                myAudioPlayer.htmlAudioElement.volume = myAudioPlayer.getVolumeLevel();
                this.setVolumeIcon();
            });
        }
    }

    setVolumeIcon() {
        if (myAudioPlayer.htmlAudioElement.muted) {
            this.speakerIcon.style.display = 'none';
            this.mutedIcon.style.display = 'initial';
        } else {
            this.mutedIcon.style.display = 'none'
            this.speakerIcon.style.display = 'initial';
        }
    }

    renderDefaultView() {
        songsView.renderVirtualList(); 
    }
}


class GuiHelper {
    static isAnyModalOpen() {
        const MODAL_IDS = [
            ErrorMessageModal.containerId,
            AlbumsViewSettingsModal.containerId,
            AppSettingsModal.containerId,
            'edit-modal-overlay'
        ];
        const isModalOpen = MODAL_IDS.some(id => {
            const modal = document.getElementById(id);
            return modal && !modal.classList.contains('hidden');
        });
        return isModalOpen;
    }
    static sliderToVolume(val) {
        const minGain = myAudioPlayer.getVolumeMin();
        const maxGain = myAudioPlayer.getVolumeMax();
        return Math.exp(val * Math.log(maxGain) + (1 - val) * Math.log(minGain));
    }
    static volumeToSlider(val) {
        const minGain = myAudioPlayer.getVolumeMin();
        const maxGain = myAudioPlayer.getVolumeMax();
        const x = (Math.log(val) - Math.log(minGain)) / (Math.log(maxGain) - Math.log(minGain));
        const normalized = Math.max(0, Math.min(1, x));
        return normalized;
    }
    static getCoverUrl(coverHash) {
        if (coverHash) {
            return `http://127.0.0.1:65432/?art=${coverHash}`;
        }
        return gui.COVER_PLACEHOLDER_PATH;
    }
}


class SongsView {

    constructor() {
        this.trackListContainer = document.getElementById('track-list-container');
        this.trackList = document.getElementById('track-list');
        this.LIST_VIEW_ROW_HEIGHT = 52; 
        this.LIST_VIEW_ROW_BUFFER = 10;
        this.lastClickedIndex = null;
        this.currentSort = { field: null, ascending: true };
        this.showCoverArt = true;
        this.addEventListeners();
    }

    renderVirtualList() {
        if (!musicLibrary.data.length) {
            this.trackList.innerHTML = '';
            return;
        }
        const scrollTop = this.trackListContainer.scrollTop;
        const containerHeight = this.trackListContainer.clientHeight;
        const startIndex = Math.max(
            0,
            Math.floor(scrollTop / this.LIST_VIEW_ROW_HEIGHT) - this.LIST_VIEW_ROW_BUFFER
        );
        const endIndex = Math.min(
            musicLibrary.data.length,
            Math.ceil((scrollTop + containerHeight) / this.LIST_VIEW_ROW_HEIGHT) + this.LIST_VIEW_ROW_BUFFER
        );
        this.trackList.style.height = `${musicLibrary.data.length * this.LIST_VIEW_ROW_HEIGHT}px`;
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
            fragment.appendChild(this.createListItem(i));
        }
        this.trackList.innerHTML = '';
        this.trackList.appendChild(fragment);
    }

    createListItem(libraryIndex) {
        const i = libraryIndex;
        const track = musicLibrary.data[i];
        const li = document.createElement('li');
        const isSelected = selectedPaths.has(track.file_path) ? ' track-selected' : '';
        const isMissing = track.missing ? ' track-missing' : '';
        const isPlaying = (myAudioPlayer.currentPlayingPath && track.file_path === myAudioPlayer.currentPlayingPath) ? ' track-playing' : '';
        const missingWarning = track.missing ? '<span class="missing-icon" title="File not found">⚠️</span>' : '';      
        li.style.transform = `translateY(${i * this.LIST_VIEW_ROW_HEIGHT}px)`;
        li.dataset.index = i; 
        li.className = `${isMissing}${isSelected}${isPlaying}`;
        li.innerHTML = `
            <img class="track-cover" id="cover-${i}" src="${GuiHelper.getCoverUrl(track.cover_hash)}" alt="">
            <div class="track-title">${missingWarning}${track.title}</div>
            <div class="track-artist">${track.artist}</div>
            <div class="track-album">${track.album}</div>
            <div class="track-year">${track.year}</div>
            <div class="track-duration">${track.duration}</div>
        `;
        return li
    }

    sortLibrary(field) {
        if (this.currentSort.field === field) {
            this.currentSort.ascending = !this.currentSort.ascending;
        } else {
            this.currentSort.field = field;
            this.currentSort.ascending = true;
        }
        musicLibrary.data.sort((a, b) => {
            let valA = a[field].toString().toLowerCase();
            let valB = b[field].toString().toLowerCase();
            if (field === 'year') {
                valA = parseInt(valA) || 0;
                valB = parseInt(valB) || 0;
            }
            if (valA < valB) return this.currentSort.ascending ? -1 : 1;
            if (valA > valB) return this.currentSort.ascending ? 1 : -1;
            return 0;
        });
        this.renderVirtualList();
        myAudioPlayer.refreshDynamicQueue();
        this.updateSortIndicators();
    }

    updateSortIndicators() {
        document.querySelectorAll('.col-sortable').forEach(header => {
            header.classList.remove('sort-asc', 'sort-desc');
                        if (header.dataset.sort === this.currentSort.field) {
                header.classList.add(this.currentSort.ascending ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    singleClickOnListTrack(e) {
        const row = e.target.closest('li');
        if (!row) return;
        const trackIndex = parseInt(row.dataset.index);
        const track = musicLibrary.data[trackIndex];
        if (e.shiftKey && this.lastClickedIndex !== null) {
            const start = Math.min(this.lastClickedIndex, trackIndex);
            const end = Math.max(this.lastClickedIndex, trackIndex);
            if (!e.ctrlKey && !e.metaKey) { selectedPaths.clear(); }
            for (let i = start; i <= end; i++) {
                selectedPaths.add(musicLibrary.data[i].file_path);
            }
        } else if (e.ctrlKey || e.metaKey) {
            if (selectedPaths.has(track.file_path)) {
                selectedPaths.delete(track.file_path);
            } else {
                selectedPaths.add(track.file_path);
            }
            this.lastClickedIndex = trackIndex;
        } else {
            selectedPaths.clear();
            selectedPaths.add(track.file_path);
            this.lastClickedIndex = trackIndex;
        }
        this.renderVirtualList();
    }

    async doubleClickOnTrack(e) {
        const row = e.target.closest('li');
        if (!row) return;
        const trackIndex = parseInt(row.dataset.index);
        const targetPath = musicLibrary.data[trackIndex].file_path;
        window.getSelection().removeAllRanges();
        myAudioPlayer.playbackContext = { type: 'list', key: null };    
        await myAudioPlayer.requestPlayback(targetPath, 1, true);
    }

    addEventListeners() {
        this.trackListContainer.addEventListener('scroll', () => {
            window.requestAnimationFrame(() => {
                this.renderVirtualList();
            });
        });
        this.trackList.addEventListener('click', (e) => {
            if (!gui.doubleClickOnTrackPossible) {
                songsView.singleClickOnListTrack(e);
                gui.doubleClickOnTrackPossible = true;
                setTimeout(() => {
                    gui.doubleClickOnTrackPossible = false;
                }, DOUBLE_CLICK_DELAY);
            } else {
                this.doubleClickOnTrack(e);
            }
        });
        this.trackList.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const row = e.target.closest('li');
            if (row) {
                const trackIndex = parseInt(row.dataset.index);
                const track = musicLibrary.data[trackIndex];
                if (!selectedPaths.has(track.file_path)) {
                    selectedPaths.clear();
                    selectedPaths.add(track.file_path);
                    songsView.renderVirtualList();
                }
                gui.trackContextMenu.show(e);
            } else {
                gui.trackContextMenu.hide(e);
            }
        });
        document.querySelectorAll('.col-sortable').forEach(header => {
            header.addEventListener('click', () => {
                this.sortLibrary(header.dataset.sort); }
            );
        });
    }

}


class AlbumsView {
    constructor() {
        this.gridSortOrder = 'artist';
        this.gridSortDirection = 'asc';
        this.showGridSubheadings = false;
        this.stickyGridSubheadings = false;
        this.TWO_COLUMN_THRESHOLD = 1024;  // width of window in pixels
        this.gridAlbumsParsedData = [];      // NEW: Holds parsed album data
        this.albumGrid = document.getElementById('album-grid');
        this.activeExpandedCard = null; // Tracks which album is currently open
        this.lastGridClickedIndex = null;
    }
    processAlbums() {
        const albumMap = new Map();
        musicLibrary.data.forEach((track, index) => {
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
        this.gridAlbumsParsedData = Array.from(albumMap.values());
        this.gridAlbumsParsedData.sort((a, b) => {
            const direction = this.gridSortDirection === 'desc' ? -1 : 1;    
            if (this.gridSortOrder === 'year') {
                // Primary: Year (Affected by Direction)
                const yearA = Math.min(...a.tracks.map(t => parseInt(t.year) || 9999));
                const yearB = Math.min(...b.tracks.map(t => parseInt(t.year) || 9999));
                if (yearA !== yearB) return (yearA - yearB) * direction;
                // Secondary: Artist (Always A-Z)
                const artistA = (a.artist || '').toLowerCase();
                const artistB = (b.artist || '').toLowerCase();
                if (artistA !== artistB) return artistA.localeCompare(artistB);
            } else {
                // Primary: Artist (Affected by Direction)
                const artistA = (a.artist || '').toLowerCase();
                const artistB = (b.artist || '').toLowerCase();
                if (artistA !== artistB) return artistA.localeCompare(artistB) * direction;
                
                // Secondary: Year (Always Chronological)
                const yearA = Math.min(...a.tracks.map(t => parseInt(t.year) || 9999));
                const yearB = Math.min(...b.tracks.map(t => parseInt(t.year) || 9999));
                if (yearA !== yearB) return yearA - yearB;
            }
            // Tertiary: Album Title (Always A-Z)
            return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
        });
    }
    renderAlbumGrid() {
        this.processAlbums();
        this.albumGrid.innerHTML = '';
        this.closeExpandedAlbum(); 
        const fragment = document.createDocumentFragment();
        let currentGroup = null; // NEW: Tracks the current decade or letter
        this.gridAlbumsParsedData.forEach((album, idx) => {
            // --- NEW: Subheading Injection ---
            if (this.showGridSubheadings) {
                let albumGroup = "";
                if (this.gridSortOrder === 'year') {
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
                    if (this.stickyGridSubheadings) {
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
            const coverHash = album.tracks[0].cover_hash;
            card.innerHTML = `
                <img class="album-card-cover dimmed" src="${GuiHelper.getCoverUrl(coverHash)}" alt="">
                <div class="album-card-title">${album.title}</div>
                <div class="album-card-artist">${album.artist}</div>
            `;
            card.addEventListener('click', (e) => {
                if (this.activeExpandedCard === card) {
                    this.closeExpandedAlbum();
                } else {
                    this.openExpandedAlbum(album, card);
                }
            });
            fragment.appendChild(card);
        });
        this.albumGrid.appendChild(fragment);
    }
    openExpandedAlbum(albumData, cardElement) {
        this.closeExpandedAlbum(); 
        this.activeExpandedCard = cardElement;
        cardElement.classList.add('active-card');
        const cards = Array.from(this.albumGrid.querySelectorAll('.album-card'));
        const clickedIndex = cards.indexOf(cardElement);
        const clickedTop = cardElement.offsetTop;
        let insertIndex = clickedIndex;
        while (insertIndex + 1 < cards.length && cards[insertIndex + 1].offsetTop === clickedTop) {
            insertIndex++;
        }
        // DYNAMIC METADATA AGGREGATION
        //process years
        const validYears = albumData.tracks.map(t => parseInt(t.year)).filter(y => !isNaN(y) && y > 0);
        let yearString = "Unknown Year";
        if (validYears.length > 0) {
            const minYear = Math.min(...validYears);
            const maxYear = Math.max(...validYears);
            yearString = minYear === maxYear ? `${minYear}` : `${minYear} - ${maxYear}`;
        }
        // process genres
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
        // process total runtime
        let totalSeconds = 0;
        albumData.tracks.forEach(t => {
            totalSeconds += Utils.timeStrToSeconds(t.duration);
        });
        const runtimeString = Utils.secondsToTimeStr(totalSeconds);
        // TRACKLIST GENERATION
        const uniqueDiscs = new Set(albumData.tracks.map(t => parseInt(t.disc_num) || 1));
        const hasMultipleDiscs = uniqueDiscs.size > 1;
        const albumGridElement = document.getElementById('album-grid');
        const gridWidth = albumGridElement.clientWidth;
        const cardWidth = cardElement.getBoundingClientRect().width || 180; // Fallback to a standard card width if 0
        const currentColumns = Math.round(gridWidth / cardWidth);
        const useTwoColumns = window.innerWidth > this.TWO_COLUMN_THRESHOLD && albumData.tracks.length > 5;
        let trackListHTML = `<ul class="expanded-track-list ${useTwoColumns ? 'two-column' : ''}" id="expanded-track-list">`;
        let currentDisc = null;
        albumData.tracks.forEach((t, idx) => {
            const trackDisc = parseInt(t.disc_num) || 1;
            if (hasMultipleDiscs && trackDisc !== currentDisc) {
                trackListHTML += `<li class="disc-header">Disc ${trackDisc}</li>`;
                currentDisc = trackDisc;
            }
            const isPlaying = (myAudioPlayer.currentPlayingPath && t.file_path === myAudioPlayer.currentPlayingPath) ? ' track-playing' : '';
            const isSelected = selectedPaths.has(t.file_path) ? ' track-selected' : '';
            const missingWarning = t.missing ? '⚠️ ' : '';
            trackListHTML += `
                <li class="${isPlaying}${isSelected}" data-index="${t.globalIndex}" data-album-index="${idx}" data-filepath="${t.file_path}">
                    <div>${t.track_num || '-'}</div>
                    <div class="track-title">${missingWarning}${t.title}</div>
                    <div>${t.duration}</div>
                </li>
            `;
        });
        trackListHTML += '</ul>';
        // DOM INJECTION
        const expansionContainer = document.createElement('div');
        expansionContainer.className = 'album-expanded-row';
        expansionContainer.id = 'active-expansion-row';
        const coverHash = albumData.tracks[0].cover_hash;
        expansionContainer.innerHTML = `
            <div class="expanded-cover-container">
                <img id="expanded-highres-cover" class="dimmed" src="${GuiHelper.getCoverUrl(coverHash)}">
                <div class="expanded-cover-meta"></div>
            </div>
            <div class="expanded-tracklist-container">
                <h2 style="margin:0 0 5px 0; font-size: 22px;">${albumData.title}</h2>
                <div style="color:var(--text-secondary); font-size:14px; margin-bottom:12px;">
                    ${albumData.artist} • ${yearString} • ${runtimeString}
                </div>
                <div style="margin-bottom:20px;">
                    ${genreHTML}
                </div>
                ${trackListHTML}
            </div>
        `;
        const lastCardInRow = cards[insertIndex];
        this.albumGrid.insertBefore(expansionContainer, lastCardInRow.nextSibling);
        const expandedList = document.getElementById('expanded-track-list');
        this.addEventListeners(expandedList, albumData);
        setTimeout(() => {
            expansionContainer.scrollIntoView({
                behavior: 'smooth', block: 'nearest'
            });
        }, 50);
    }
    closeExpandedAlbum() {
        const existingRow = document.getElementById('active-expansion-row');
        if (existingRow) existingRow.remove();
        if (this.activeExpandedCard) this.activeExpandedCard.classList.remove(
            'active-card');
        this.activeExpandedCard = null;
    }
    addEventListeners(expandedList, albumData) {
        expandedList.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li || li.classList.contains('disc-header')) return;
            if (!gui.doubleClickOnTrackPossible) {
                const trackAlbumIndex = parseInt(li.dataset.albumIndex);
                const track = albumData.tracks[trackAlbumIndex];
                if (e.shiftKey && this.lastGridClickedIndex !== null) {
                    const start = Math.min(
                        this.lastGridClickedIndex, trackAlbumIndex);
                    const end = Math.max(this.lastGridClickedIndex, trackAlbumIndex);
                    if (!e.ctrlKey && !e.metaKey) { selectedPaths.clear(); }
                    for (let i = start; i <= end; i++) {
                        selectedPaths.add(albumData.tracks[i].file_path);
                    }
                } else if (e.ctrlKey || e.metaKey) {
                    if (selectedPaths.has(track.file_path)) {
                        selectedPaths.delete(track.file_path);
                    } else {
                        selectedPaths.add(track.file_path);
                    }
                    this.lastGridClickedIndex = trackAlbumIndex;
                } else {
                    selectedPaths.clear();
                    selectedPaths.add(track.file_path);
                    this.lastGridClickedIndex = trackAlbumIndex;
                }
                Array.from(expandedList.children).forEach(child => {
                    if (child.classList.contains('disc-header')) return; 
                    if (selectedPaths.has(child.dataset.filepath)) {
                        child.classList.add('track-selected');
                    }
                    else child.classList.remove('track-selected');
                });
                gui.doubleClickOnTrackPossible = true;
                setTimeout(
                    () => { gui.doubleClickOnTrackPossible = false; },
                    DOUBLE_CLICK_DELAY
                );
            } else {
                window.getSelection().removeAllRanges(); 
                myAudioPlayer.playbackContext = { type: 'album', key: albumData.key };
                musicLibrary.staticAlbumPool = albumData.tracks.map(
                    t => t.file_path
                );
                myAudioPlayer.requestPlayback(li.dataset.filepath, 1, true);
            }    
        });
        expandedList.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const li = e.target.closest('li');
            if (li && !li.classList.contains('disc-header')) {
                const trackIndex = parseInt(li.dataset.index);
                const track = musicLibrary.data[trackIndex];
                if (!selectedPaths.has(track.file_path)) {
                    selectedPaths.clear();
                    selectedPaths.add(track.file_path);
                    Array.from(expandedList.children).forEach(child => {
                        if (child.classList.contains('disc-header')) return;
                        if (selectedPaths.has(child.dataset.filepath)) {
                            child.classList.add('track-selected');
                        }
                        else child.classList.remove('track-selected');
                    });
                }
                gui.trackContextMenu.show(e);
            } else {
                gui.trackContextMenu.hide(e);
            }
        });
        window.addEventListener('resize', () => {
            if (gui.currentView === 'grid' && this.activeExpandedCard) {
                this.closeExpandedAlbum();
            }
        });
    }
}


class Utils {
    static timeStrToSeconds(timeString) {
        if (!timeString) return 0;
        const parts = timeString.split(':').reverse();
        let seconds = 0;
        if (parts[0]) seconds +=  parseInt(parts[0]) || 0;         // seconds
        if (parts[1]) seconds += (parseInt(parts[1]) || 0) * 60;   // minutes
        if (parts[2]) seconds += (parseInt(parts[2]) || 0) * 3600; // hours
        return seconds;
    }
    static secondsToTimeStr(totalSecs) {
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        if (h > 0) {
            return (m > 0) ? `${h} hr ${m} min` : `${h} hr`;
        } else if (s < 30) {
            return `${m} min`;
        } else {
            return `${m+1} min`;
        }
    }
    static formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
}


class MusicLibrary {

    constructor() {
        this.masterLibraryData = []; 
        this.libraryData = [];
        this.staticAlbumPool = []; // Locks in the grid view context so it ignores filters  
        this.fetchLibraryData();
    }

    fetchLibraryData() {
        window.addEventListener('pywebviewready', async () => {
            try {
                const tracks = await window.pywebview.api.get_library();
                this.masterData = tracks;
                this.data = [...this.masterData]; 
                guiController.renderDefaultView();
            } catch (e) {
                const errorMessageModal = new ErrorMessageModal(
                    'Error',`Failed to load library.: ${e}`);
                errorMessageModal.show();
            }
        });
    }

    async importFiles() {
        const response = await window.pywebview.api.add_files_to_db();
        if (response.status === 'started') {
            const container = document.getElementById('import-progress-container');
            const fill = document.getElementById('import-progress-fill');
            const countText = document.getElementById('import-count');
            gui.addMusicBtn.disabled = true;
            gui.addMusicBtn.style.opacity = '0.5';
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
                        this.masterData.push(...state.new_tracks);
                        document.getElementById('search-input').dispatchEvent(new Event('input'));
                    }
                    setTimeout(() => {
                        container.classList.add('hidden');
                        gui.addMusicBtn.disabled = false;
                        gui.addMusicBtn.style.opacity = '1';
                    }, 1500);
                }
            }, 500);
        } else if (response.status === 'busy') {
            alert("An import is already running in the background.");
        }
    }

    getPoolOfAllowedTracks() {
        if (myAudioPlayer.playbackContext.type === 'album') {
            return this.staticAlbumPool;
        } else {
            return this.libraryData.map(t => t.file_path);
        }
    }

    set masterData(masterData) { this.masterLibraryData = masterData; }
    get masterData() { return this.masterLibraryData; }
    set data(data) { this.libraryData = data; }
    get data() { return this.libraryData; }

}


class SearchEngine {

    static parseSearchQuery(queryString) {
    // Parse query into nested structure: OR Groups containing AND tokens
        const groups = [];
        let currentGroup = [];
        let currentToken = '';
        let inQuotes = false;
        for (let i = 0; i < queryString.length; i++) {
            const char = queryString[i];
            if (char === '"') {
                inQuotes = !inQuotes;
                currentToken += char;
            } else if (char === '|' && !inQuotes) {
                if (currentToken.trim()) {
                    currentGroup.push(currentToken.trim());
                    currentToken = '';
                }
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                    currentGroup = [];
                }
            } else if (char === ' ' && !inQuotes) {
                if (currentToken.trim()) {
                    currentGroup.push(currentToken.trim());
                    currentToken = '';
                }
            } else {
                currentToken += char;
            }
        }
        if (currentToken.trim()) currentGroup.push(currentToken.trim());
        if (currentGroup.length > 0) groups.push(currentGroup);
        return groups;
    }

    static buildCondition(token) {
    // Condition to convert string tokens into logical objects
        let isNegated = false;
        let rawToken = token;
        if (rawToken.startsWith('-')) {
            isNegated = true;
            rawToken = rawToken.substring(1);
        }
        const match = rawToken.match(/^([a-z_]+)([=><])(.+)$/i);
        let field = null;
        let operator = null;
        let value = rawToken;
        if (match) {
            let parsedField = match[1].toLowerCase();
            operator = match[2];
            value = match[3];
            const aliases = {
                'style': 'genre',
                'song': 'title',
                'release': 'year',
                'albumartist': 'album_artist'
            };
            if (aliases[parsedField]) parsedField = aliases[parsedField];
            const validFields = [
                'artist',
                'title',
                'album',
                'album_artist',
                'genre',
                'year'
            ];
            if (validFields.includes(parsedField)) {
                field = parsedField;
            } else {
                value = rawToken;
            }
        }
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
        }
        value = value.toLowerCase();
        return { isNegated, field, operator, value };
    }

    static evaluateCondition(track, condition) {
    // Evaluate if a single track passes a single condition
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
                trackVal = trackVal.toString().toLowerCase();
                isMatch = trackVal.includes(value); 
            }
        } else {
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

}    


class QueuePopover {

    constructor() {
        this.id = 'queue-popover';
        this.container = document.getElementById(this.id);
        this.queueList = document.getElementById('queue-list');
        this.queueFooter = document.getElementById('queue-footer');
        this.displayLimit = 20;
        this.initClearQueueBtn();
    }

    initClearQueueBtn() {
        const clearQueueBtn = document.getElementById('clear-queue-btn');
        clearQueueBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            myAudioPlayer.manualQueue = [];
            myAudioPlayer.contextQueue = [];
            this.render();
        });
    }

    render() {
        this.queueList.innerHTML = '';   
        const combinedQueue = myAudioPlayer.manualQueue.concat(myAudioPlayer.contextQueue); 
        this.visuallyCombineQueues(combinedQueue);
        this.initRemovalButtons();
        this.updateFooterText(combinedQueue);
        if (combinedQueue.length === 0) {
            this.displayEmptyList();
        }
    }

    visuallyCombineQueues(combinedQueue) {
        const displayQueue = combinedQueue.slice(0, this.displayLimit);
        displayQueue.forEach((trackPath, visualIndex) => {
            // Resolve the absolute path against the master library!
            const track = musicLibrary.masterData.find(t => t.file_path === trackPath);
            if (!track) return;
            const li = document.createElement('li');
            const isManual = visualIndex < myAudioPlayer.manualQueue.length;
            const sourceArray = isManual ? 'manual' : 'context';
            const sourceIndex = isManual ? visualIndex : visualIndex - myAudioPlayer.manualQueue.length;
            li.innerHTML = `
                <img src="${GuiHelper.getCoverUrl(track.cover_hash)}" style="width: 35px; height: 35px; border-radius: 4px; object-fit: cover;">
                <div class="queue-item-info">
                    <div class="queue-item-title">${track.title}</div>
                    <div class="queue-item-artist">${track.artist}</div>
                </div>
                <button class="queue-remove-btn" data-source="${sourceArray}" data-index="${sourceIndex}" title="Remove">✖</button>
            `;
            this.queueList.appendChild(li);
        });
    }

    displayEmptyList() {
        this.queueList.innerHTML = '<li style="text-align: center; color: var(--text-muted); display: block; padding: 30px;">Queue is empty</li>';
    }

    updateFooterText(combinedQueue) {
        const remaining = combinedQueue.length - this.displayLimit;
        if (remaining > 0) {
            this.queueFooter.innerText = `... and ${remaining} more tracks`;
            this.queueFooter.classList.remove('hidden');
        } else {
            this.queueFooter.classList.add('hidden');
        }
    }

    initRemovalButtons() {
        this.queueList.querySelectorAll('.queue-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const src = btn.dataset.source;
                const idx = parseInt(btn.dataset.index);
                if (src === 'manual') {
                    myAudioPlayer.manualQueue.splice(idx, 1);
                } else {
                    myAudioPlayer.contextQueue.splice(idx, 1);
                }
                this.render();
            });
        });
    }

}


class MyAudioPlayer {

    constructor () {
        this.htmlAudioElement;
        this.audioCtx;
        this.audioSource;
        this.compressor;
        this.volumeMin = 0.01
        this.volumeMax = 1;
        this.volumeLevel = this.volumeMax;
        this.isNormalized = true;
        this.isPlaying = false;

        this.isShuffle = false;
        this.repeatMode = 'off';

        this.playbackContext = { type: 'list', key: null }; // Tracks 'list' or 'album' context
        this.manualQueue = [];  // NEW: Tracks manually added by user
        this.contextQueue = []; // NEW: Tracks automatically generated by the album/list
        this.currentPlayingPath = null
        this.initHtmlAudio();
    }

    getVolumeLevel() {return this.volumeLevel;}
    getVolumeMax() {return this.volumeMax;}
    getVolumeMin() {return this.volumeMin;}
    setVolumeLevel(value) {this.volumeLevel = value;}

    initHtmlAudio() {
        this.htmlAudioElement = new Audio();
        this.htmlAudioElement.crossOrigin = "anonymous";
        this.htmlAudioElement.addEventListener('ended', async () => {
            if (this.repeatMode === 'one') {
                this.htmlAudioElement.currentTime = 0;
                this.htmlAudioElement.play();
                return;
            }
            const targetPath = this.popNextTrackFromQueue();
            if (targetPath) {
                await this.requestPlayback(targetPath, 1, false);
            } else {
                this.isPlaying = false;
                gui.playPauseBtnPausedIcon.style.display = 'block';
                gui.playPauseBtnPlayingIcon.style.display = "none";
                gui.currentTimeEl.style.visibility = 'hidden';
                gui.totalTimeEl.style.visibility = 'hidden';
                gui.progressBar.disabled = true;
                this.htmlAudioElement.currentTime = 0;
            }
        });
    }

    initWebAudio() {
        if (this.audioCtx) return; 
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.audioSource = this.audioCtx.createMediaElementSource(this.htmlAudioElement);
        this.compressor = new DynamicsCompressorNode(this.audioCtx, {
            threshold: -50,
            knee: 40,
            ratio: 12,
            attack: 0,
            release: 0.25,
        });
        if (this.isNormalized) {
            this.audioSource.connect(this.compressor);
            this.compressor.connect(this.audioCtx.destination);
        } else {
            this.audioSource.connect(this.audioCtx.destination);
        }
    }

    async requestPlayback(targetPath, direction = 1, isManualClick = false) {
        if (musicLibrary.data.length === 0 || !targetPath) return;
        const track = musicLibrary.masterData.find(t => t.file_path === targetPath);
        if (!track) return;
        const exists = await window.pywebview.api.check_file_exists(track.file_path);
        if (!exists) {
            track.missing = true;
            songsView.renderVirtualList();
            if (isManualClick) {
                if (confirm(`The file for "${track.title}" has been moved or deleted since the app opened.\n\nWould you like to locate it manually?`)) {
                    const response = await window.pywebview.api.locate_missing_file(track.file_path);
                    if (response.status === 'success') {
                        const newPath = response.new_path;
                        const replacePath = (arr) => arr.map(p => p === targetPath ? newPath : p);
                        this.manualQueue = replacePath(this.manualQueue);
                        myAudioPlayer.contextQueue = replacePath(myAudioPlayer.contextQueue);
                        musicLibrary.staticAlbumPool = replacePath(musicLibrary.staticAlbumPool);
                        track.file_path = newPath;
                        track.missing = false;
                        songsView.renderVirtualList(); 
                        this.requestPlayback(newPath, direction, isManualClick);
                    }
                }
            } else {
                console.warn(`Skipping missing track: ${track.title}`);
                const nextValidPath = direction === 1 ? this.FromQueue() : this.getPreviousTrackPath(targetPath);
                if (nextValidPath && nextValidPath !== targetPath) {
                    this.requestPlayback(nextValidPath, direction, false);
                }
            }
            return; 
        }
        if (isManualClick) {
            this.manualQueue = [];
            this.buildContextQueue(targetPath);
        }
        this.playTrack(track);
    }

    playTrack(track) {
        this.currentPlayingPath = track.file_path;
        songsView.renderVirtualList();
        const expandedList = document.getElementById('expanded-track-list');
        if (expandedList) {
            Array.from(expandedList.children).forEach(li => {
                if (li.dataset.filepath === this.currentPlayingPath) li.classList.add('track-playing');
                else li.classList.remove('track-playing');
            });
        }
        if (queuePopover.container && !queuePopover.container.classList.contains('hidden')) {
            queuePopover.render();
        }
        this.initWebAudio(); 
        const safePath = `http://127.0.0.1:65432/?file=${encodeURIComponent(track.file_path)}`;
        this.htmlAudioElement.src = safePath;
        this.htmlAudioElement.play();
        this.isPlaying = true;
        gui.playPauseBtnPlayingIcon.style.display = 'block';
        gui.playPauseBtnPausedIcon.style.display = 'none';
        gui.currentTimeEl.style.visibility = 'initial';
        gui.totalTimeEl.style.visibility = 'initial';
        gui.progressBar.disabled = false;
        document.getElementById('np-title').innerText = track.title;
        document.getElementById('np-artist').innerText = track.artist;
        document.getElementById('np-cover').src = GuiHelper.getCoverUrl(track.cover_hash);
    }

    buildContextQueue(startPath) { // returns queue array
        let pool = musicLibrary.getPoolOfAllowedTracks();
        let poolIndex = pool.indexOf(startPath);
        if (poolIndex === -1) {
            this.contextQueue = []; 
        }
        let remaining = pool.slice(poolIndex + 1);
        if (this.isShuffle) {
            for (let i = remaining.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
            }
        }
        this.contextQueue = remaining;
    }
    
    popNextTrackFromQueue() {
        while (this.manualQueue.length > 0) {
            const nextPath = this.manualQueue.shift();
            if (musicLibrary.masterData.find(
                t => t.file_path === nextPath && !t.missing
            )) return nextPath;
        }
        while (this.contextQueue.length > 0) {
            const nextPath = this.contextQueue.shift();
            if (musicLibrary.masterData.find(
                t => t.file_path === nextPath && !t.missing
            )) return nextPath;
        }
        if (this.repeatMode === 'all') {
            let pool = musicLibrary.getPoolOfAllowedTracks();
            if (pool.length > 0) {
                let firstPath = pool[0];
                if (this.isShuffle) {
                    let shuffled = [...pool];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    firstPath = shuffled.shift();
                    this.contextQueue = shuffled;
                } else {
                    this.contextQueue = pool.slice(1);
                }
                if (musicLibrary.masterData.find(t => t.file_path === firstPath && !t.missing)) return firstPath;
                return firstPath; // If missing, requestPlayback's bouncer will handle it naturally
            }
        }
        return null;
    }
    
    getPreviousTrackPath(startPath) {
        let pool = musicLibrary.getPoolOfAllowedTracks();
        let poolIndex = pool.indexOf(startPath);
        if (poolIndex <= 0) {
            if (this.repeatMode === 'all' && pool.length > 0) return pool[pool.length - 1];
            return null;
        }
        return pool[poolIndex - 1];
    }
    
    refreshDynamicQueue() {
        if (this.playbackContext.type === 'list' && this.currentPlayingPath) {
            this.buildContextQueue(this.currentPlayingPath);
            if (queuePopover.container && !queuePopover.container.classList.contains('hidden')) {
                queuePopover.render();
            }
        }
    }

}


const gui = new Gui();
const guiController = new GuiController();
const myAudioPlayer = new MyAudioPlayer();
const musicLibrary = new MusicLibrary();
const songsView = new SongsView();
const albumsView = new AlbumsView();
const queuePopover = new QueuePopover();
