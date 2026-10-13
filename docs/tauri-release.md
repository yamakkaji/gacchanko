Tauri 2 desktop edition of gacchanko.

- Shared graph editor with a Rust host for saving projects, generating specifications, reading reports, and reviewing agent proposals.
- Embedded libgit2 history: the installed app does not require Git, Rust, Node.js or Xcode Command Line Tools.
- Existing schemaVersion 1 projects and report fingerprints are preserved.
- macOS: select the Apple Silicon (aarch64) or Intel (x64) DMG.
- Windows: use the x64 NSIS installer. WebView2 is required; the installer can download it if missing.

These experimental builds are not Developer ID/notarization or Windows code signed. OS security prompts may appear. Review the source and publisher before opening.

Windows installers are built on GitHub Actions. A successful build does not replace testing drag-and-drop, file dialogs, display scaling, and project paths on a real Windows machine.
