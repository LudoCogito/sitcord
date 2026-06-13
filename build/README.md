# App icon

Drop your icon here as **`icon.png`** — square, ideally **1024×1024**.

- `npm run package` (electron-builder) reads this directory as its resources
  dir and generates the macOS/Windows/Linux app + installer icons from
  `icon.png` automatically. To hand-tune per platform you may instead/also add
  `icon.icns` (macOS) and `icon.ico` (Windows, 256×256 multi-res).
- In development (`npm run dev`), the main process loads `icon.png` for the
  macOS dock and the Windows/Linux window/taskbar so you don't see the default
  Electron logo. If the file is absent, it silently falls back to that logo.

The displayed app name comes from `productName` in `package.json` (packaged
app) and the `APP_NAME` constant in `src/renderer/main.ts` (the in-app
titlebar). Keep the two in sync.
