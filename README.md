<div align="center">

# 🎵 Groove Music

![Groove Music](https://img.shields.io/badge/Groove-Music%20Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)

**High-Quality • Fast • Reliable • Premium**

A powerful Discord music bot with LavaLink integration, featuring support for YouTube and Spotify, playlists, favorites, and much more!

[**Discord Server**](https://discord.gg/TGF3fCXtRm) • [**Bot-Hosting.net**](https://bot-hosting.net/?aff=alex) • [**Report Bug**](https://github.com/faisaljs/Groove-Music/issues) • [**Request Feature**](https://github.com/faisaljs/Groove-Music/issues)

</div>

---

## 🚀 Deploy on Bot-Hosting.net

Want to host **Groove Music** without setting up your own server? You can easily deploy it using **Bot-Hosting.net**.

### Host the Yapin music bot

The Yapin version is a separate deployment from the Discord bot:

1. Create a **Node.js** deployment from `Brage321/MusicFRtest` on Bot-Hosting.net.
2. Set the startup command to `npm run start:yapin`.
3. Add `YAPPER_BOT_TOKEN` as a secret environment variable in the deployment settings. Do not put the token in source code or commit it.
4. Add `AUDIUS_API_KEY` as a secret environment variable. Create a read-only key in [Audius app settings](https://audius.co/settings).
5. Start the deployment. The script installs the Yapin-specific dependencies and launches `Yapin/index.js`.
6. Add the bot to your Yapin server and grant it permission to view voice channels and connect.

Use the token from Yapin's Developer settings, and rotate it immediately if it has been shared or exposed. The existing `npm start` command still starts the Discord version.

## 💙 Get Started

👉 [**Click Here**](https://bot-hosting.net/?aff=alex) to create free **Bot-Hosting.net** account.

**After creating your account:**

1. Go to the **Templates** section in your Bot-Hosting.net dashboard.
2. Search for **Groove-Music**.
3. Select the **Groove-Music** template.
4. Deploy the template to your server.
5. Configure your required environment variables, including your Discord bot token and LavaLink credentials.
6. Start your bot and you're ready to enjoy **Groove Music**! 🎵

> 💡 **New to Bot-Hosting.net?** Use the button above to create your account, then find **Groove-Music** in the **Templates** section.

## 🎶 Quick & Easy

**Create Account → Templates → Groove-Music → Deploy → Configure → Start**

Enjoy hosting Groove Music on Bot-Hosting.net! 💙

---

## ✨ Features

- 🎶 **High-Quality Music Playback** - Powered by LavaLink for the best audio quality
- 🎵 **Multi-Platform Support** - Play from YouTube and Spotify
- 📝 **Playlist Management** - Create, save, and share custom playlists
- ⭐ **Favorites System** - Save your favorite tracks for quick access
- 🎼 **Queue Management** - Full control over your music queue
- 🎚️ **Audio Filters** - Apply various audio effects to customize your listening experience
- 🎤 **Lyrics Support** - Display lyrics for currently playing tracks
- 🔄 **Loop Modes** - Loop single tracks or entire queues
- ⏯️ **Playback Controls** - Play, pause, skip, shuffle, and more
- 🎲 **Autoplay** - Automatically queue similar songs when the queue ends
- 🖼️ **Beautiful Music Cards** - Custom artwork for now playing displays
- ⚡ **Slash Commands** - Modern Discord slash command support
- 📌 **Prefix Commands** - Traditional prefix commands (`,` by default)

---

## 📋 Commands Overview

### 🎵 Music Playback
- `/play` - Play a song or add it to the queue
- `/pause` - Pause the current track
- `/resume` - Resume playback
- `/skip` - Skip to the next track
- `/stop` - Stop playback and clear the queue
- `/nowplaying` - Display currently playing track
- `/queue` - View the current queue

### 🎛️ Queue Management
- `/shuffle` - Shuffle the queue
- `/clear` - Clear the entire queue
- `/remove` - Remove a specific track from the queue
- `/move` - Move a track to a different position
- `/back` - Go back to the previous track
- `/seek` - Seek to a specific position in the track

### 📝 Playlists
- `/playlistsave` - Save the current queue as a playlist
- `/playlistload` - Load a saved playlist
- `/playlistlist` - View your playlists
- `/playlistdelete` - Delete a playlist
- `/playlistrename` - Rename a playlist
- `/playlistshare` - Share a playlist with others
- `/playlistimport` - Import a playlist from a share code or Spotify URL
- `/playlisttrackadd` - Add a track to a playlist
- `/playlisttrackremove` - Remove a track from a playlist
- `/playlisttracklist` - View tracks in a playlist
- `/playlistcreate` - Create an empty playlist
- `/playlistappend` - Append a playlist to the queue

### ⭐ Favorites
- `/favoriteadd` - Add a track to favorites
- `/favoriteremove` - Remove a track from favorites
- `/favoritelist` - View your favorite tracks
- `/favoriteplay` - Play tracks from your favorites

### 🎚️ Audio Settings
- `/volume` - Adjust the volume
- `/filter` - Apply audio filters
- `/loop` - Set loop mode (off/track/queue)
- `/autoplay` - Toggle autoplay mode

### ℹ️ Information
- `/help` - Display help information
- `/ping` - Check bot latency
- `/lyrics` - Display lyrics for the current track

---

## 🚀 Quick Setup

### Feed.fm browser radio

A separate browser-based radio player is available in [`FeedFm/`](./FeedFm/README.md). It does not play into Yapin voice; Feed.fm's JavaScript SDK is browser-based and station/radio oriented.

### Yapin bot (experimental)

An initial Yapin music-bot port is available in [`Yapin/`](./Yapin/README.md). It searches and streams from the Audius catalog and supports a per-server queue through Yapin's LiveKit voice API. See its setup guide; the existing Discord bot and its `npm start` command are unchanged.

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot token ([Create one here](https://discord.com/developers/applications))
- LavaLink server (see [LavaLink Setup](#-lavalink-setup))
- (Optional) Spotify API credentials
- (Optional) Genius API key for lyrics

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/faisaljs/Groove-Music.git
   cd Groove-Music
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Bot Configuration
   BOT_TOKEN=your_discord_bot_token
   CLIENT_ID=your_bot_client_id
   
   # LavaLink Configuration
   LAVALINK_HOSTS=your.lavalink.host
   LAVALINK_PORTS=2333
   LAVALINK_PASSWORDS=youshallnotpass
   LAVALINK_SECURES=false
   
   # Optional: Genius Lyrics
   GENIUS_API_KEY=your_genius_api_key
   ```

4. **Configure bot settings**
   
   Edit `Groove/config.js` to customize your bot:
   - Change the prefix (default: `,`)
   - Adjust playlist limits
   - Configure default music platform
   - Set artwork style

5. **Start the bot**
   ```bash
   npm start
   ```

---

## 🎸 LavaLink Setup

Groove Music requires a LavaLink server to function. You have two options:

### Option 1: Use a Public LavaLink Server
You can use free public LavaLink servers (not recommended for production):
- [LavaLink Public Servers List](https://lavalink.darrennathanael.com/)

### Option 2: Host Your Own LavaLink Server
1. Download LavaLink from [GitHub](https://github.com/lavalink-devs/Lavalink/releases)
2. Create an `application.yml` configuration file
3. Run LavaLink: `java -jar Lavalink.jar`
4. Update your `.env` with your LavaLink credentials

---

## 🎨 Customization

### Changing the Prefix
Edit `Groove/config.js`:
```javascript
PREFIX: '!',  // Change to your desired prefix
```

### Adjusting Playlist Limits
```javascript
MUSIC: {
    PLAYLIST_LIMIT: 3,  // Maximum number of playlists per user
}
```

### Artwork Style
Choose between `MusicCard` (custom image card) or `Banner` (media gallery):
```javascript
MUSIC: {
    ARTWORK_STYLE: 'MusicCard'  // or 'Banner'
}
```

---

## 📁 Project Structure

```
Groove-Music/
├── Groove/
│   ├── commands/        # Slash commands
│   ├── pCommands/       # Prefix commands
│   ├── music/           # Poru event handlers
│   ├── helpers/         # Music helpers and card rendering
│   ├── utils/           # Permission helpers
│   ├── config.js        # Bot configuration
│   └── index.js         # Bot entry point
├── database/           # Database models (favorites, playlists)
│   └── models/
└── README.md
```

---

## 🔧 Troubleshooting

### Bot doesn't respond to commands
- Ensure the bot has proper permissions in your server
- Check that the bot token is correct
- Verify LavaLink is running and accessible

### Music doesn't play
- Confirm LavaLink server is online
- Check LavaLink credentials in `.env`
- Ensure the bot has `Connect` and `Speak` permissions in voice channels


---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 Credits

### Development Team

**Groove Music** is developed and maintained by **[Eleone Hub](https://discord.gg/TGF3fCXtRm)**

#### Lead Developer
- **Faisal** (faisaljs)
  - Discord: `alex.jsz`
  - Portfolio: [faisal.dev](https://faisaljs.github.io)

### Built With
- [Discord.js](https://discord.js.org/) - Discord API library
- [Poru](https://github.com/parasop/poru) - LavaLink client
- [LavaLink](https://github.com/lavalink-devs/Lavalink) - Audio delivery server
- [Sequelize](https://sequelize.org/) - Database ORM

### Special Thanks
- Eleone Hub community for testing and feedback
- All contributors who helped improve this project

---

## 📞 Support

Need help? Join our community!

- **Discord Server**: [https://discord.gg/TGF3fCXtRm](https://discord.gg/TGF3fCXtRm)
- **Developer Contact**: Discord @ `alex.jsz`
- **Portfolio**: [faisal.dev](https://faisaljs.github.io)

---

## 📄 License

This project is licensed under the MIT License.

---

## ⚠️ Disclaimer

This bot is for educational and entertainment purposes. Please respect copyright laws and Discord's Terms of Service when using this bot.

---

<div align="center">

**Made with ❤️ by [Eleone Hub](https://discord.gg/TGF3fCXtRm)**

[![Discord](https://img.shields.io/badge/Join-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/TGF3fCXtRm)
[![Portfolio](https://img.shields.io/badge/Visit-Portfolio-FF6B6B?style=for-the-badge&logo=google-chrome&logoColor=white)](https://faisaljs.github.io)

**If you like this project, please consider giving it a ⭐ on GitHub!**

</div>
