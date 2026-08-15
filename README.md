# 🎬 Bhojpuri Vibe — Premium Glassmorphic Bhojpuri Music Platform

A modern, ultra-responsive, glassmorphic streaming web platform dedicated to top Bhojpuri artists including **Khesari Lal Yadav**, **Pawan Singh**, **Arvind Akela Kallu**, **Nirahua (Dinesh Lal Yadav)**, and **Bhojpuri Top Hits**.

## 🌟 Key Features

- **🎤 Singer-Specific Playlists**: Dynamic switching between curated playlists of top Bhojpuri superstars.
- **🪟 100% See-Through Glass Capsule Player**: Sleek floating glass capsule with spinning vinyl record disc animation, mini speaker floating pill, and sound manager.
- **🎲 Dynamic Random Shuffle Start**: Automatically selects a random hit song whenever switching playlists (No FIFO repeating).
- **🎬 Fullscreen Background Video & Art Switching**: Smooth dynamic toggle between cinematic video backgrounds (`/video/bhojpuri-bg.mp4`) and singer portrait artwork.
- **🎨 Singer Ambient Theme Switcher**: Dynamic CSS variables matching each singer's signature aesthetic.
- **⚡ Fast Express Backend & oEmbed Caching**: Node.js backend with 0ms in-memory YouTube oEmbed metadata caching.
- **📱 Universal Responsive System**: Tested for 100% pixel-perfect display across foldables, smartphones (with safe-area notch support), tablets, laptops, and 4K ultra-wide monitors.

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/prince2007-max/bhojpuri-vibe.git
   cd bhojpuri-vibe
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` in your web browser.

## 📁 Project Structure

```
new web/
├── index.html        # Main Responsive App Interface & Engine
├── server.js         # Express Backend API Proxy & Metadata Cache
├── package.json      # Dependencies & Scripts
├── .gitignore        # Git Ignored Files
└── video/            # Background Media Assets (Video & Images)
```

## 📜 License

MIT License — Created with ❤️ for Bhojpuri Music Lovers.
