# PolyPost

English | [简体中文](README.zh-CN.md)

PolyPost is a WebExtension (Manifest V3) that helps you draft, polish, translate, and send posts to Twitter/X via web intent.
One codebase builds extensions for Chrome, Firefox, and Safari.

## Features

- Generate, polish, and translate social content (multi-language)
- Main app UI (Dashboard / Editor / Settings)
- Customizable polish prompt templates (`Prompts`) and configurable OpenAI / custom model selection (built-in presets such as `gpt-5.4-mini` or any custom model ID)
- Quick Translate tool for one-off reply translation without creating posts
- In-page X/Twitter Follower Filter for `/followers`, `/verified_followers`, and `/following` lists (mutuals, non-followers, verified/unverified)
- Bilingual UI (`English` / `简体中文`) and theme switching (`Light` / `Dark` / `System`)
- Browser-native entry behavior:
    - Chrome: toolbar click opens native side panel (`sidePanel`)
    - Firefox: toolbar click opens native sidebar (`sidebar_action`)
    - Safari: toolbar click toggles an in-page floating panel on X/Twitter
- Safari floating panel supports drag-to-resize width and falls back to a popup window if embedding is unavailable
- Works with OpenAI and OpenAI-compatible providers

## Project Structure

- `src/background/`: Service worker / background script entry
- `src/sidepanel/`: Main app UI (Dashboard, Editor, Settings, Prompts, Quick Translate, Follower Filter)
- `src/content/`: X/Twitter content scripts (`followersFilter.ts`, `floatingAppHost.ts`)
- `src/components/`: Shared UI, layout, library, and editor components
- `src/services/`: OpenAI, WebExtension storage, permissions, proxy fetch, prompts, and Twitter intent helpers
- `src/store/`: Zustand state slices (`postsStore`, `foldersStore`, `settingsStore`, `uiStore`)
- `src/hooks/` & `src/i18n/`: Typed translation hook and `en` / `zh` locale dictionaries
- `src/types/` & `src/utils/`: TypeScript definitions, utilities, and dev mock data seeder
- `src/styles/`: Tailwind + global theme styles
- `public/`: Static assets (`icons/`)

## Development & Build

Install dependencies:

```bash
npm install
```

Development (Vite + CRXJS):

```bash
npm run dev
```

Targeted development (`dev:chrome` runs the Vite/CRXJS dev server; `dev:firefox` and `dev:safari` run `vite build --watch` to keep `dist/firefox` and `dist/safari` runnable as extension bundles):

```bash
npm run dev:chrome   # Vite + CRXJS dev server
npm run dev:firefox  # vite build --watch -> dist/firefox
npm run dev:safari   # vite build --watch -> dist/safari
```

Production build (includes type-check):

```bash
npm run build
```

Targeted production build:

```bash
npm run build:chrome   # dist/chrome
npm run build:firefox  # dist/firefox
npm run build:safari   # dist/safari (WebExtension folder for Safari converter)
```

Preview production build (open `/src/sidepanel/index.html` in your browser):

```bash
npm run preview
npm run preview:chrome
npm run preview:firefox
npm run preview:safari
```

Lint & format:

```bash
npm run lint
npm run format
npm run format:check
```

## Load in Chrome

1. Run `npm run build:chrome` to generate `dist/chrome`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `dist/chrome`

## Load in Firefox (temporary add-on)

1. Run `npm run build:firefox` to generate `dist/firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on…"
4. Select `dist/firefox/manifest.json`
5. Click the extension toolbar icon: PolyPost opens in Firefox native sidebar (no new tab)

Note: `browser_specific_settings.gecko.id` defaults to `polypost@local` for local builds.
For release builds, set your own ID with `POLYPOST_FIREFOX_ID`:

```bash
POLYPOST_FIREFOX_ID=your-addon-id@example.com npm run build:firefox
```

## Package for Firefox Add-ons (AMO upload)

Use the packaging script to avoid missing-root-manifest and macOS hidden-file issues:

```bash
POLYPOST_FIREFOX_ID=your-addon-id@example.com npm run pack:firefox
```

Upload `dist/polypost-firefox.xpi` to AMO.
The archive root contains `manifest.json` directly (not wrapped in an extra `firefox/` directory).

## Build for Safari

Safari needs an Xcode project generated via Apple's converter.

1. Run `npm run build:safari` to generate `dist/safari`
2. Convert to an Xcode project:

```bash
xcrun safari-web-extension-converter dist/safari
```

3. Open the generated project in Xcode and run the app target once (`⌘R`)
4. In Safari:
    - Enable developer menu (`Settings > Advanced`)
    - Enable `Develop > Allow Unsigned Extensions`
    - Enable the extension in `Settings > Extensions`
5. Open `x.com` or `twitter.com` and click the toolbar icon:
    - First click: show floating panel
    - Second click: hide floating panel
    - Drag the panel's left edge to resize width

## Configuration & Security

- API keys are entered via Settings and stored in browser extension storage (`storage.local`, and `storage.sync` when available); do not hardcode secrets.
- If you add permissions, update `manifest.json` and explain the purpose.

## Contributing

PRs and suggestions are welcome. Please follow:

- Conventional Commits: `feat:`, `fix:`, `docs:`, etc.
- Provide screenshots for UI changes
- Call out manifest or permission changes

## License

MIT

## Privacy Policy

[Privacy Policy](privacy.md)
