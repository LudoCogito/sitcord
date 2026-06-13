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
- **R3 + LB together** (right-stick click + left bumper) minimizes the window to
  the taskbar — a deliberate two-button chord, distinct from Select+Start and
  from the LB+RB combo games commonly use. Restore it with the global minimize
  hotkey below or the tray icon — a minimized window stops reading the gamepad,
  so the chord itself only parks it.

### Bringing the window back from inside a game

The Select+Start chord works whenever Discord Big Picture has input focus
(including behind the Steam overlay). But while a **different** fullscreen game
holds the controller, this app can't read the gamepad, so the chord can't
summon it from there. Three reliable ways to bring it back regardless:

- **System-tray / menu-bar icon** — Discord Big Picture parks a microphone icon
  there the whole time it's running (so you can always tell it's active).
  Click it (Windows/Linux) or use its **Show / Hide** menu item (macOS) to
  toggle the window.
- **Global hotkeys** — `Ctrl/Cmd + Shift + backtick` shows/hides it from any
  app; `Ctrl/Cmd + Shift + M` minimizes/restores it.
- **Re-select it from Big Picture** — the most game-independent path, with no
  per-game setup: press the Guide button to open Big Picture, then pick the
  pinned Discord Big Picture entry. The app only ever runs one copy, so a second
  launch is caught and turned into "bring the running window to the front"
  rather than opening a duplicate. (Works as long as Steam still offers **Play**
  for the entry; if Steam has it marked as running with **Stop**, use a hotkey
  or the tray instead.)
- **Steam Input chord** — map a controller button/chord to send one of the
  global hotkeys above, so a controller combo summons or minimizes the window
  even mid-game. Step-by-step below.

#### Binding a controller button to the global hotkey

The two hotkeys are registered by the app at the **OS level**, so they fire no
matter which app has focus. That means the job isn't to bind the controller
inside *this* app — it's to get Steam to **emit the keystroke** while another
game is in the foreground. The chain is:

> controller chord → Steam Input sends `Ctrl/Cmd+Shift+\`` → the OS routes it to
> this app's global shortcut → the window appears.

Because Steam Input layouts are **per-game** (the active layout belongs to
whatever game currently has focus), you configure the layout of the **game you
are playing**, not this app's layout:

1. In Steam, enable Steam Input for that game — its **Controller** settings →
   **Enable Steam Input**.
2. Open the game's layout: Steam → the game → the **controller icon** →
   **Edit Layout**.
3. Pick a trigger that won't clash with the game — a **back paddle** is ideal,
   or a chord such as "hold a bumper, then press a face button." Add a
   **Keyboard** command to that button.
4. Enter the combo:
   - Show / hide → `Ctrl + Shift + \`` (Windows/Linux) or `Cmd + Shift + \``
     (macOS).
   - Minimize / restore → `Ctrl/Cmd + Shift + M`.
5. For a chord, bind the command to one button and add the **"requires
   [other button] held"** activator (Steam calls this a chord/modifier).
6. Save.

Notes:

- **Don't bind the Guide/center button alone** — Steam and other overlays
  reserve it. Use a paddle or a multi-button chord.
- This is **per-game**: repeat for each game you want to summon from. There is
  no single Steam binding that works across all games (the only truly global
  controller chords are the Steam/Guide-button ones Steam reserves for itself).
- **Borderless / windowed-fullscreen games work best.** In *exclusive*
  fullscreen the OS may swallow the injected keystroke or refuse to draw this
  always-on-top window over the game; borderless avoids both.

## 5. Recommended: pin it and summon from Big Picture

The simplest controller-only, works-in-any-game setup needs **no per-game Steam
Input config**. It leans on the one truly universal controller input — the
Guide button, which opens Big Picture from inside any game — plus the fact that
the app only ever runs one copy, so re-selecting it focuses the running window
instead of opening a duplicate.

**One-time setup**

1. Add the app as a Non-Steam Game (section 2) and enable controller support
   (section 3).
2. In Big Picture, open its library page and **pin / favorite** it so it's a
   couple of inputs away rather than buried in the library.

**Each session**

1. Make sure Discord desktop is running and signed in.
2. **Launch Discord Big Picture first.** It connects, then you can tuck it away
   (Select+Start to hide, or it stays in the tray).
3. Launch your game as usual.

**To bring it back while gaming**

- Press the **Guide** button → Big Picture opens.
- Select the pinned Discord Big Picture entry → the running window comes to the
  front (the single-instance lock turns the "launch" into a focus). Switch your
  channel, then hide it again and tab back to your game.

### Can Steam run the app and a game at the same time?

- **Desktop (Windows / macOS / Linux, including Big Picture on a PC): yes.**
  Steam tracks one "currently running game" in its UI, but processes coexist
  fine. Launch the app (it lives in the tray), then launch your game — both run.
  When the game starts, Steam's running-indicator moves to the game and the app
  keeps running in the background (which also means its entry usually shows
  **Play** again, so re-selecting it focuses via the single-instance lock).
- **Steam Deck *Game Mode* is the exception.** Game Mode is built around a
  single foreground game and may **suspend or close** the previous app when you
  launch another, so "launch the app, then a game" won't reliably keep it alive
  there. On a Deck, lean on the global hotkey (mapped through Steam Input) or
  autostart instead. Desktop Big Picture has no such restriction.

Tip: launch the app **before** your game so it's already in the tray.

## 6. Quitting

To fully quit the app, use the tray icon's **Quit** item, the Steam overlay's
"Stop" / quit option for the non-Steam game entry, or `Ctrl/Cmd+Q` on a
keyboard — the window itself has no title bar or close button.
