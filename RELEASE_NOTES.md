## ⚡ FTC ATEM Auto-Switcher v1.0.0

The FTC ATEM Auto-Switcher is a **fully standalone Desktop Application!** 🎉

No more command lines, no terminal windows, and no need to open a browser. Everything is bundled into a single, beautiful desktop app.

### 🚀 Getting Started

1. Download and run **`FTC-ATEM-Switcher-Setup.exe`** below to install the app.
2. It will create a shortcut in your Start Menu and Desktop. Launch it!
3. On your first launch, a sleek setup screen will appear directly in the app to ask for your Event Code, API keys, and ATEM IP.
4. Once filled out, the main switcher dashboard loads automatically in the same window!

> **Note:** If you want to completely reset your configuration, just delete the `.env` file that appears next to the `.exe` and restart the app.

### ✨ Features

- **Full Electron Desktop App** — The dashboard runs in its own native window.
- **In-App Setup GUI** — Beautiful, dark-themed setup screen appears on first run.
- **Zero Dependencies** — You no longer need Node.js or a web browser.
- **Automatic Camera Switching** — Switches your ATEM to the correct field camera as matches progress
- **Two Switch Modes:**
  - **Score-Based** — Switches when a match score is committed (most reliable)
  - **Timer-Based (2:45)** — Switches 2 minutes 45 seconds after a match starts (best for late score commits)
- **Automatic Playoff Transition** — Detects when quals end and switches to playoffs automatically
- **Full Runtime Configuration** — Change ATEM IP, HDMI inputs, event code, and API credentials on the fly

### 🎛 Supported Hardware

Works with **all Blackmagic ATEM switchers** — Mini, Mini Pro, Mini Extreme, Television Studio, Constellation, and more.

### 📋 Requirements

- Windows 10/11
- Internet connection (for FTC Events API)
- Network access to your ATEM switcher
- [FTC Events API account](https://ftc-events.firstinspires.org/services/API)
