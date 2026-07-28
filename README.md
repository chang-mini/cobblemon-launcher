# Cobblemon Launcher

A small, open-source Minecraft: Java Edition launcher for a single private
community server running the [Cobblemon](https://cobblemon.com/) mod on the
Fabric mod loader. It signs the player in with their own Microsoft account,
installs the server's exact mod set, and launches the game.

**Non-commercial.** Free to use, no monetization of any kind.
**Not affiliated with Mojang or Microsoft.**

---

## Why this exists

The server requires a specific, version-pinned set of Fabric mods. A mismatched
mod version prevents the player from connecting, and several of the mods are
pre-release builds where a silent version drift is very hard to diagnose.

This launcher installs and verifies that exact set, so players do not have to
install mods by hand and version mismatches cannot occur.

---

## Security and compliance

This section is written for reviewers.

### Credential handling

**The launcher never sees, handles, or stores the player's password.**

Authentication runs entirely through Microsoft's own OAuth flow, rendered in a
separate browser window by the [`msmc`](https://github.com/Hanro50/MSMC)
library. The launcher receives only the resulting tokens.

Requested scopes are the minimum required to obtain a Minecraft session:

```
XboxLive.signin
offline_access
```

The only thing persisted locally is the refresh token, written to the
per-user application data directory so the player does not have to sign in on
every launch. It is never transmitted anywhere except back to Microsoft on
refresh.

```
%APPDATA%\cobblemon-launcher\account.json
```

### No redistribution

**No Minecraft binaries or mod files are redistributed by this project.**

| Asset | Source |
|---|---|
| Minecraft client, libraries, assets | Mojang's official endpoints, via [`minecraft-launcher-core`](https://github.com/Pierce01/MinecraftLauncher-core) |
| Fabric loader profile | `meta.fabricmc.net` (official Fabric metadata API) |
| Mods | [Modrinth](https://modrinth.com/) CDN, verified by SHA-1 |

`src/pack.json` contains only mod **names, download URLs, and hashes** — no
binaries. Every downloaded file is hash-checked before use and deleted if it
does not match. See [`src/installer.js`](src/installer.js).

### Isolation

The launcher installs into its own directory and does **not** read from or
modify the official Minecraft Launcher's installation.

```
%APPDATA%\.cobblemon
```

---

## How it works

```
1.  Microsoft sign-in            msmc  →  Xbox Live  →  XSTS  →  Minecraft
2.  Fabric profile               fetched from meta.fabricmc.net, written to versions/
3.  Mod sync                     download from Modrinth, verify SHA-1,
                                 remove any jar not in the manifest
4.  Launch                       minecraft-launcher-core
```

Step 3 removes unknown jars deliberately: a mod the server does not expect will
be rejected at connect time, and with pre-release mods in the set the resulting
failure is very difficult to diagnose.

---

## Project layout

```
src/
├── main.js        Electron main process, IPC, launch orchestration
├── preload.js     contextBridge (explicit channel allowlist)
├── auth.js        Microsoft sign-in, refresh-token storage, error messages
├── installer.js   Fabric profile, mod sync, hash verification
└── pack.json      Mod manifest (name, URL, SHA-1, size)
ui/
├── index.html
├── style.css
└── app.js
```

Built with [Electron](https://www.electronjs.org/).
The UI is Korean, as the server's community is Korean-speaking.

---

## Development

```bash
npm install
npm start          # run
npm run dist       # build a Windows installer
```

Node 18 or newer.

### Azure application

Microsoft sign-in requires an Azure application registration. The client ID is
**not** a secret and is committed in `src/auth.js`.

```
Platform        Mobile and desktop applications
Redirect URI    https://login.microsoftonline.com/common/oauth2/nativeclient
Account types   Personal Microsoft accounts
```

A newly registered application must additionally be approved for the Minecraft
API before sign-in completes. Until approval, the flow completes Microsoft,
Xbox Live, and XSTS authentication and then fails at the final Minecraft step.

`USE_OWN_APP` in `src/auth.js` switches between this application and the
library's built-in default, for development while approval is pending.

---

## License

[MIT](LICENSE)

Minecraft is a trademark of Mojang AB. This project is not affiliated with,
endorsed by, or sponsored by Mojang AB or Microsoft.
