# Application icons

`codexhost.png` is the 1024px Codex Connect brand icon: holographic double
brackets on a deep blue rounded tile, with the transparent margin of the macOS
icon grid. It is the source artwork; when replacing the brand icon, replace
this PNG with a 1024px image on the same grid.

macOS packaging creates its ICNS sizes directly from this PNG. Windows launchers
and the Inno Setup installer use `codexhost.ico`, with 16, 24, 32, 48, 64, 128,
and 256 pixel PNG frames. The uninstall listing uses the launcher icon.

After changing the PNG, regenerate the ICO on macOS:

```sh
node scripts/release/generate-brand-icons.mjs
```
