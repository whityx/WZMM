[English 🇺🇲](README.md) | [Русский 🇷🇺](README.ru.md)

<p align="center">
  <img src="icons/why-zenless-mod-manager.png" alt="WZMM Logo" width="128" height="128" />
</p>

<h1 align="center">WZMM</h1>

---

Launcher for Zenless Zone Zero on Linux, capable of downloading mods from GameBanana and managing local mods.

## Requirements

* [XXMI](https://github.com/SpectrumQT/XXMI-Launcher)

## Getting Started

1. Download the latest release from the [Releases page](https://github.com/whityx/WZMM/releases).
2. Launch the application.
3. In the Settings menu, specify the paths for XXMI.

## Building from Source (Linux Only)

WZMM is an Electron application. If you prefer to build the app manually from the source code, follow the steps below. 

### Prerequisites

Before building, ensure you have the following installed on your system:

* **Git**
* **Node.js** and **npm**
* **Base build tools** (C/C++ compiler, `make`, `python3`, etc., which are required to compile native Node.js/Electron dependencies).

> **Note on Build Tools:** 
> The exact package names for these build tools vary depending on your Linux distribution. You will need to search for how to install the base development packages for your specific distro. 
> *(For example: search for `build-essential` if you are on Debian/Ubuntu, `base-devel` for Arch Linux, or `@development-tools` for Fedora).*

### Build Instructions

1. Clone the repository and navigate into the project directory:
```bash
git clone https://github.com/whityx/WZMM.git
cd WZMM
```
Install the required dependencies:
```bash
npm install
```
Build and package the application for Linux:
```bash
npm run dist
```
