#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP="$PWD/dist/gacchanko.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$PWD/.build/module-cache"
xcrun swiftc -O -module-cache-path "$PWD/.build/module-cache" -framework Cocoa -framework WebKit Sources/Project.swift Sources/SelfTest.swift Sources/main.swift -o "$APP/Contents/MacOS/gacchanko"
cp web/* "$APP/Contents/Resources/web/"
cp tests/ui-smoke.js "$APP/Contents/Resources/ui-smoke.js"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>gacchanko</string>
<key>CFBundleDisplayName</key><string>がっちゃんこ gacchanko</string>
<key>CFBundleIdentifier</key><string>local.yamakkaji.gacchanko</string>
<key>CFBundleExecutable</key><string>gacchanko</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
printf 'Built: %s\n' "$APP"
