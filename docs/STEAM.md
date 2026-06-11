# Running Discord Big Picture as a Steam Non-Steam Game

Discord Big Picture is a small always-on-top, controller-driven overlay for
switching Discord voice channels without leaving Big Picture Mode. It isn't
distributed on Steam itself, but Steam can launch it like any other game and
will then apply its normal controller input/overlay support to it.

**Discord desktop must already be running** (and you must have approved the
app's RPC connection once) before you launch Discord Big Picture — it talks
to Discord over its local RPC socket and has nothing to connect to otherwise.

## 1. Build the app

```bash
npm run package
```

This produces platform-specific artifacts under `dist/`:

| Platform | Artifacts |
| --- | --- |
| Windows | `Discord Big Picture Setup <version>.exe` (NSIS installer) and `Discord Big Picture <version>.exe` (portable, no install needed) |
| macOS | `Discord Big Picture-<version>-<arch>.dmg`, containing `Discord Big Picture.app` |
| Linux | `Discord Big Picture-<version>-<arch>.AppImage` |

Run the installer/portable exe (Windows), copy `Discord Big Picture.app` out
of the mounted DMG to `/Applications` (macOS), or `chmod +x` and run the
AppImage directly (Linux) to install it.

### macOS Gatekeeper

The macOS build is **not code-signed or notarized** (no Apple Developer
account is configured). The first time you open it, macOS will refuse to run
it. To allow it:

- Right-click (or Control-click) `Discord Big Picture.app` → **Open** → confirm
  **Open** in the dialog. This only needs to be done once.
- Or: **System Settings → Privacy & Security**, scroll to the "Discord Big
  Picture was blocked" message, and click **Open Anyway**.

## 2. Add it to Steam as a Non-Steam Game

1. In Steam, go to **Library** (or the **+ Add a Game** button at the bottom
   left of the Library/Big Picture view).
2. Choose **Add a Non-Steam Game**.
3. Click **Browse...** and select the installed binary:
   - Windows: the installed `Discord Big Picture.exe` (or the portable exe)
   - macOS: `Discord Big Picture.app` (in `/Applications`)
   - Linux: the `.AppImage` file
4. Click **Add Selected Programs**.

The app now shows up in your Steam Library like any other game.

## 3. Enable controller support

1. Right-click the new entry in your Steam Library → **Properties**.
2. Open the **Controller** tab and set the layout (e.g. **Gamepad with
   Joystick Trackpad** or **Desktop Configuration**) so Steam Input passes
   standard gamepad button/axis input through to the app — Discord Big
   Picture reads the browser Gamepad API directly (D-pad/left stick to
   navigate, A/B/X/Y, bumpers, Start, Select).
3. If you primarily play other games with this controller, you may want a
   per-game configuration so Steam Input doesn't remap buttons while the
   overlay app is focused.

## 4. Launch from Big Picture Mode

From Steam's Big Picture Mode, the app appears in your library and launches
like any other entry. Once launched it opens as a small always-on-top window:

- Navigate with the D-pad/left stick, switch servers with the bumpers.
- **A** joins the selected channel, **B** disconnects, **X**/**Y** toggle
  mute/deafen, **Start** toggles favorite, **LT/RT** zoom the UI in/out for
  your viewing distance.
- **Select + Start together** hides/shows the window without closing it — a
  two-button chord (present on every controller, hard to press by accident) so
  you can tuck it away once you've joined a channel and bring it back to
  switch.

### Bringing the window back from inside a game

The Select+Start chord works whenever Discord Big Picture has input focus
(including behind the Steam overlay). But while a **different** fullscreen game
holds the controller, this app can't read the gamepad, so the chord can't
summon it from there. Three reliable ways to bring it back regardless:

- **System-tray / menu-bar icon** — Discord Big Picture parks a microphone icon
  there the whole time it's running (so you can always tell it's active).
  Click it (Windows/Linux) or use its **Show / Hide** menu item (macOS) to
  toggle the window.
- **Global hotkey** — `Ctrl/Cmd + Shift + backtick` shows/hides it from any app.
- **Steam Input chord** — in the per-game controller layout, map a button chord
  to that global hotkey so a controller combo summons it even mid-game.

To fully quit the app, use the tray icon's **Quit** item, the Steam overlay's
"Stop" / quit option for the non-Steam game entry, or `Ctrl/Cmd+Q` on a
keyboard — the window itself has no title bar or close button.
