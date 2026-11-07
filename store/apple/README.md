# The App Store kit

What App Store Connect asks for, beside the Google Play kit in `../android` (the steps are in `docs/apple-app-store.md`, Step 6).

- `icon-1024.png`: the App Store icon, 1024 × 1024, no transparency (Apple refuses an icon with an alpha channel). It is the very file built into the app (`apple/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`), so App Store Connect takes it from the uploaded build; this copy is for the places that ask for the file itself.
- `screenshots/`: iPhone screenshots, taken on the phone (press the side button and volume up together), for the two sizes App Store Connect asks for: **6.7-inch** and **6.1-inch**. The app is iPhone-only in the store (an iPad runs it in compatibility mode), so no iPad screenshots. Take the Bookings calendar, a booking, the call sheet, the stripboard and the quote, as the Android set does.

The icon comes from `icons/icon.svg` on the brand background (#14110f), and the splash in the Xcode project is the same logo at a third of the width on that background. Nothing in this folder is published to the website: `tools/stage-site.mjs` copies only the site's own files.
