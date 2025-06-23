# Contributing to Dashy

Thank you for your interest in contributing! To ensure a smooth development process, please follow these guidelines.

## Developer Prerequisites

Dashy uses `sharp`, a native Node.js module for image processing. To ensure `sharp` can be compiled with support for all required formats (including HEIC/HEIF), you must install its system-level dependencies before running `npm install`.

### macOS

Using [Homebrew](https://brew.sh/):
```bash
brew install vips libheif
```

### Windows
Using a PowerShell terminal with Administrator rights:

Install Chocolatey:
PowerShell

```
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.IO.Directory]::CreateDirectory($env:ProgramData + "\chocolatey"); [System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('[https://community.chocolatey.org/install.ps1](https://community.chocolatey.org/install.ps1)'))
```
Install the necessary libraries:
PowerShell
```
choco install vips libheif
```
Linux (Debian/Ubuntu)
Bash
```
sudo apt update
sudo apt install libvips-dev libheif-dev
```
After installing these prerequisites, you can proceed with the standard installation.

Installation
Switch to the correct Node.js version. If you have nvm, run:
Bash
```
nvm use
```
Install dependencies. This will also trigger electron-rebuild.
Bash
```
npm install
```
Development Workflow
To run the application in a development environment with hot-reloading:

Bash
```
npm run electron:dev
```
This script watches for changes in both the main process files and frontend files and will automatically restart or reload the application.

