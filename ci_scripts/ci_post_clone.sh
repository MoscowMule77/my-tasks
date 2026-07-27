#!/bin/sh
# Xcode Cloud runs this right after cloning the repo, before building.
# The repo deliberately doesn't commit generated folders (www/, Pods/, node_modules/),
# so we rebuild them here on Apple's build machine.
set -e

echo "--- Node dependencies ---"
brew install node@22 || true
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v
npm -v

cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "--- Build the web bundle into www/ ---"
npm run build

echo "--- Sync Capacitor + install Pods ---"
npx cap sync ios
cd ios/App
pod install --repo-update

echo "--- Post-clone complete ---"
