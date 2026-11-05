const form = document.querySelector('#credentials-form');
const playerCard = document.querySelector('#player-card');
const setupStatus = document.querySelector('#setup-status');
const playerStatus = document.querySelector('#player-status');
const stationSelect = document.querySelector('#station');
const title = document.querySelector('#track-title');
const artist = document.querySelector('#track-artist');
const playButton = document.querySelector('#play');
const pauseButton = document.querySelector('#pause');
const skipButton = document.querySelector('#skip');
const disconnectButton = document.querySelector('#disconnect');

let player = null;
let stations = [];

function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
}

function updateTrack(play) {
    const audioFile = play?.audio_file;
    const track = audioFile?.track;
    const nextTitle = track?.title || audioFile?.title;
    const nextArtist = audioFile?.artist?.name;

    if (nextTitle) title.textContent = nextTitle;
    if (nextArtist) artist.textContent = nextArtist;
    setStatus(playerStatus, 'Playing');
}

function setControlsEnabled(enabled) {
    playButton.disabled = !enabled;
    pauseButton.disabled = !enabled;
    skipButton.disabled = !enabled;
    stationSelect.disabled = !enabled || stations.length === 0;
}

function releasePlayer() {
    if (player) {
        player.stop();
        player.off();
        player = null;
    }
    stations = [];
    stationSelect.replaceChildren(new Option('No stations loaded', ''));
    stationSelect.disabled = true;
    setControlsEnabled(false);
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setupStatus.classList.remove('error');

    const tokenInput = form.elements.token;
    const secretInput = form.elements.secret;
    const token = tokenInput.value.trim();
    const secret = secretInput.value;
    if (!token || !secret) return;

    if (!window.Feed?.Player) {
        setStatus(setupStatus, 'The player library did not load. Refresh the page and try again.', true);
        return;
    }

    releasePlayer();
    setStatus(setupStatus, '');
    setStatus(playerStatus, 'Loading available stations…');
    playerCard.hidden = false;

    try {
        player = new window.Feed.Player(token, secret);
    } catch (error) {
        setStatus(setupStatus, error.message || 'Could not initialize the player.', true);
        playerCard.hidden = true;
        return;
    } finally {
        tokenInput.value = '';
        secretInput.value = '';
    }

    player.on('music-unavailable', () => {
        setStatus(playerStatus, 'Music is not available for this account or region.', true);
        setControlsEnabled(false);
    });
    player.on('play-started', updateTrack);
    player.on('play-paused', () => setStatus(playerStatus, 'Paused'));
    player.on('play-resumed', () => setStatus(playerStatus, 'Playing'));
    player.on('play-completed', () => {
        if (player?.getCurrentState() === 'idle') {
            title.textContent = 'Choose a station';
            artist.textContent = 'Your music will appear here';
            setStatus(playerStatus, 'Ready');
        }
    });
    player.on('plays-exhausted', () => setStatus(playerStatus, 'No more plays are available.', true));
    player.on('skip-denied', () => setStatus(playerStatus, 'Skipping is not available right now.', true));
    player.on('error', (error) => {
        console.error('Player error:', error);
        setStatus(playerStatus, 'The player encountered an error. Check your account and try again.', true);
    });

    try {
        stations = await player.tune();
        stationSelect.replaceChildren(
            ...stations.map((station) => new Option(station.name, station.id))
        );

        if (stations.length === 0) {
            stationSelect.replaceChildren(new Option('No stations available', ''));
            setStatus(playerStatus, 'No stations are available for this account.', true);
            return;
        }

        stationSelect.disabled = false;
        setControlsEnabled(true);
        setStatus(playerStatus, 'Choose a station, then press Play.');
    } catch (error) {
        console.error('Could not load stations:', error);
        setStatus(playerStatus, 'Could not load stations. Check the credentials and try again.', true);
        setControlsEnabled(false);
    }
});

stationSelect.addEventListener('change', () => {
    const stationId = stationSelect.value;
    if (!player || !stationId) return;

    try {
        player.setStationId(stationId);
        const station = stations.find((item) => String(item.id) === stationId);
        title.textContent = station?.name || 'Station selected';
        artist.textContent = 'Press Play to start listening';
        setStatus(playerStatus, 'Station selected');
    } catch (error) {
        console.error('Could not change station:', error);
        setStatus(playerStatus, 'Could not select that station.', true);
    }
});

playButton.addEventListener('click', () => {
    if (!player) return;
    try {
        player.play();
        setStatus(playerStatus, 'Starting playback…');
    } catch (error) {
        console.error('Could not start playback:', error);
        setStatus(playerStatus, 'Could not start playback.', true);
    }
});

pauseButton.addEventListener('click', () => {
    if (!player) return;
    try {
        player.pause();
    } catch (error) {
        console.error('Could not pause playback:', error);
        setStatus(playerStatus, 'Could not pause playback.', true);
    }
});

skipButton.addEventListener('click', () => {
    if (!player) return;
    try {
        player.skip();
        setStatus(playerStatus, 'Skip requested');
    } catch (error) {
        console.error('Could not skip track:', error);
        setStatus(playerStatus, 'Could not skip this track.', true);
    }
});

disconnectButton.addEventListener('click', () => {
    releasePlayer();
    playerCard.hidden = true;
    title.textContent = 'Choose a station';
    artist.textContent = 'Your music will appear here';
    setStatus(setupStatus, 'Disconnected');
});
