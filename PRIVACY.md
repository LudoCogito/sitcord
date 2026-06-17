# Privacy Policy

**Effective date:** June 16, 2026

This Privacy Policy explains how **Sitcord** ("the App", "we", "us") handles
information. Sitcord is a free, open-source desktop application for joining and
controlling Discord voice channels with a game controller.

## The short version

Sitcord runs entirely on your own computer. It has **no servers**, performs
**no analytics or tracking**, and **sends nothing to us**. The author of
Sitcord never receives, stores, or sees any of your data.

## What Sitcord stores, and where

Sitcord saves a small amount of data **locally on your device** so it can
remember your preferences between sessions. This data lives in a configuration
file in your operating system's standard application-data directory and is
**never transmitted to the developer or any third party** by the App. It
includes:

- **Favorites** — the voice channels you have pinned.
- **Usage counts** — how many times and when you last joined each channel,
  used only to rank your channel list on your own machine.
- **Settings** — your in-app preferences (e.g. window and volume settings).
- **Authentication token** — an access token issued by Discord during login,
  stored so you do not have to re-authorize every launch.

You can delete all of this at any time by removing Sitcord's configuration file
or uninstalling the App.

## How Sitcord interacts with Discord

Sitcord communicates **directly with your locally running Discord client** over
Discord's local RPC (IPC) interface, and with Discord's own OAuth2 and API
endpoints to authenticate and to read your servers, voice channels, and voice
state. This communication is between **your device and Discord**.

When you authorize Sitcord, you grant it permission to read your voice
channels and to control your own voice connection (join, switch, disconnect,
mute, deafen, and adjust input/output volume). Sitcord requests only the scopes
needed for these functions.

Your use of Discord is governed by Discord's own Privacy Policy and Terms of
Service:

- https://discord.com/privacy
- https://discord.com/terms

## Data we collect

**None.** Sitcord has no backend, no telemetry, and no account system of its
own. We do not collect, store, sell, or share any personal information.

## Updates

Sitcord may check for new releases (for example, via GitHub) so it can offer
software updates. These requests are standard download/version checks and are
not used to identify or track you.

## Children's privacy

Sitcord is not directed at children and does not knowingly collect information
from anyone. Use of Discord is subject to Discord's own minimum-age
requirements.

## Changes to this policy

If this policy changes, the updated version will be published at this same
location with a new effective date.

## Contact

Questions about this policy can be raised via the project's issue tracker at
https://github.com/LudoCogito/sitcord/issues, or by email at
**[your-contact-email]**.
