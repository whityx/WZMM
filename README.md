[English 🇺🇲](README.md) | [Русский 🇷🇺](README.ru.md)

<p align="center">
  <img src="icons/why-zenless-mod-manager.png" alt="WZMM Logo" width="128" height="128" />
</p>

<h1 align="center">WZMM</h1>

---

Launcher for Zenless Zone Zero capable of downloading mods from GameBanana and managing local mods.

## Requirements

* [XXMI](https://github.com/SpectrumQT/XXMI-Launcher)

## Getting Started

1. Download the latest release from the [Releases page](https://github.com/whityx/WZMM/releases).
2. Launch the application.
3. In Settings, specify the paths for XXMI.

## Building from Source (Linux)

### Prerequisites

Before building, ensure you have the following installed on your system:
* git
* Base build tools (C/C++ compiler and build utilities)
* Node.js and npm

### Build Instructions

1. Clone the repository and go to the project directory:

git clone https://github.com/whityx/WZMM.git
cd WZMM

2. Install dependencies:

npm install

3. Build the application for Linux:

npm run dist

After the build process completes, the output files will be located in the dist directory.