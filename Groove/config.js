module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    CLIENT_ID: process.env.CLIENT_ID || '',
    OWNER_ID: process.env.OWNER_ID || '',
    ADMIN_USER_IDS: (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || '',
    DEBUG: process.env.DEBUG === 'true',
    PREFIX: ',',


    LAVALINK: {
        HOSTS: process.env.LAVALINK_HOSTS || '',
        PORTS: process.env.LAVALINK_PORTS || '',
        PASSWORDS: process.env.LAVALINK_PASSWORDS || '',
        SECURES: process.env.LAVALINK_SECURES || ''
    },


    MUSIC: {
        DEFAULT_PLATFORM: 'ytsearch',
        AUTOCOMPLETE_LIMIT: 5,
        PLAYLIST_LIMIT: 3,
        ARTWORK_STYLE: 'MusicCard' // 'Banner' for MediaGallery or 'MusicCard' for custom image card
    },

    GENIUS: {
        API_KEY: process.env.GENIUS_API_KEY || ''
    }
};

/*
 * Project: Groove Music
 * Author: faisaljs (Faisal)
 * Organization: Eleone Hub
 * GitHub: https://github.com/faisaljs
 * License: MIT
 * © 2026 Eleone Hub. All rights reserved.
 */
