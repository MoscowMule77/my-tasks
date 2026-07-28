#!/bin/bash
# Build Flit and upload to App Store Connect — entirely from the command line,
# bypassing the Xcode GUI (which macOS 27 refuses to launch for release Xcode).
#
# Usage:   cd ~/Documents/GitHub/my-tasks && bash build-and-upload.sh
#
set -e
cd "$(dirname "$0")"

echo "=============================================="
echo " 1. Which Xcode are the command-line tools using?"
echo "=============================================="
xcode-select -p
xcodebuild -version
echo

case "$(xcodebuild -version | head -1)" in
  *"Xcode 27"*)
    echo "!! STOP: the tools are pointed at Xcode 27 (beta). App Store won't accept it."
    echo "   Point them at the release Xcode first, e.g. one of:"
    echo "     sudo xcode-select -s \"/Applications/Xcode copy.app/Contents/Developer\""
    echo "     sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    echo "   Then run this script again."
    exit 1
    ;;
esac
echo "Good — not a beta Xcode. Continuing."
echo

echo "=============================================="
echo " 2. Rebuild the web bundle and sync into iOS"
echo "=============================================="
npm run build
npx cap sync ios
echo

echo "=============================================="
echo " 3. Find your Team ID"
echo "=============================================="
TEAM_ID=$(security find-identity -v -p codesigning | grep -m1 "Apple Distribution\|Apple Development" | sed -n 's/.*(\([A-Z0-9]\{10\}\)).*/\1/p')
if [ -z "$TEAM_ID" ]; then
  echo "!! Could not detect a Team ID from your signing identities."
  security find-identity -v -p codesigning
  echo "   Copy the 10-character code in brackets and re-run as:"
  echo "     TEAM_ID=XXXXXXXXXX bash build-and-upload.sh"
  exit 1
fi
echo "Team ID: $TEAM_ID"
echo

cat > ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>$TEAM_ID</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>destination</key>
	<string>upload</string>
</dict>
</plist>
PLIST

echo "=============================================="
echo " 4. Archive (a few minutes — grab a cup of tea)"
echo "=============================================="
rm -rf build/Flit.xcarchive
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Flit.xcarchive \
  -allowProvisioningUpdates
echo

echo "=============================================="
echo " 5. Export and upload to App Store Connect"
echo "=============================================="
xcodebuild -exportArchive \
  -archivePath build/Flit.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates
echo

echo "=============================================="
echo " DONE — check App Store Connect in ~15 minutes"
echo " for build 1.0 (2) under TestFlight / Builds."
echo "=============================================="
