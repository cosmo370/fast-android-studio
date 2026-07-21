<p align="center">
  <img src="build/icon.png" width="144" alt="Fast Android Studio logo">
</p>

<h1 align="center">Fast Android Studio</h1>

<p align="center">
  A lightweight, project-aware Android test console for web and Capacitor apps.
</p>

## Install

Download the latest Windows installer from [GitHub Releases](https://github.com/cosmo370/fast-android-studio/releases/latest).

The current installer is unsigned. Windows SmartScreen may require **More info → Run anyway**. The app runs locally and does not include telemetry.

## What it does

- Detects Capacitor, Next.js, Vite, and Android projects.
- Starts the local development server and installs missing npm dependencies.
- Finds USB devices and Android emulators automatically.
- Configures `adb reverse`, runs Capacitor sync, builds, installs, and launches the app.
- Preserves application data during restart and reinstall workflows.
- Streams logcat and highlights build, ADB, authentication, React, and HTTP errors.
- Connects directly to Android WebView through the Chrome DevTools Protocol.
- Shows WebView console and network events without opening `chrome://inspect`.
- Falls back to a browser preview when no Android device is available.
- Redacts common authentication tokens before logs reach the interface.

## Requirements

Quick Preview requires Node.js. Android runs require a JDK, Android SDK Platform Tools, and either an authorized USB device or an existing Android Virtual Device.

Fast Android Studio detects Android Studio's bundled JDK and the standard Android SDK locations automatically when available.

## Development

```powershell
npm install
npm run dev
```

Run verification and create the Windows installer:

```powershell
npm test
npm run build
npm run package:win
```

The environment-aware packaging script reuses a local Electron runtime when available and downloads it on CI. The installer is written to `packages/Fast-Android-Studio-Setup-<version>.exe`.

## Security

Do not paste production credentials into project commands or logs. Fast Android Studio masks JWTs and common token fields, but projects remain responsible for their own secret handling.

Please report security issues privately through the repository's Security tab rather than a public issue.

## License

[MIT](LICENSE)
