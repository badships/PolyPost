# Privacy Policy for PolyPost

**Last Updated:** November 18, 2026

## Overview

PolyPost ("we", "our", or "us") is a cross-browser WebExtension (for Chrome, Firefox, and Safari) that helps you create and manage social media posts in a side panel, sidebar, or floating panel, with optional AI-powered polishing and translation. We do not operate any backend server or multi-user system. Most functionality runs entirely in your browser, except for optional requests you initiate to third-party services (such as AI providers or Twitter/X web intents).

## Data We Store Locally

PolyPost stores your data on your device using browser extension storage:

- **Content data**: posts, drafts, variants, and folder structures are saved in `storage.local`.
- **Settings**: preferences such as default language, UI language, theme, prompts, provider selection, custom API URL, model name, and API keys are saved in `storage.sync` (when supported and enabled) with fallback to `storage.local`.

We do not receive or store this data on our servers.

## Data We Transmit

PolyPost only transmits data when you explicitly use certain features:

1. **AI Features (OpenAI or compatible providers)**
    - When you click polish or translate, the selected content and relevant options are sent to the API endpoint you configure (OpenAI by default, or a compatible third-party provider).
    - Your API key is stored locally in browser extension storage and is used only to authenticate requests directly to that provider.
    - We do not receive or store your content or API key.
    - Data is processed under the chosen provider's own data usage policy.

2. **Twitter/X Publishing (Web Intent)**
    - When you choose to publish, the extension opens Twitter/X Web Intent in a new tab and passes the text as URL parameters.
    - The extension does not access or store your Twitter/X credentials and does not auto-post on your behalf.

## On-page Data Access (X follower filters)

- When you use the follower filter tool, the extension reads the visible follower/following list on the current X/Twitter page to hide entries that do not match your selected filters.
- This on-page data is processed locally in your browser, is not stored by the extension, and is not transmitted to any server.

## Permissions Usage

PolyPost requests the minimum permissions required to function:

- **`storage`**: Save your drafts, folders, variants, prompts, and settings locally.
- **`sidePanel`** (Chrome) / **`sidebar_action`** (Firefox): Display the main interface in the browser side panel or sidebar.
- **`tabs`**: Read the active tab URL, communicate with X/Twitter content scripts, and open X pages when using follower filter shortcuts.
- **Host permissions (`https://api.openai.com/*`, `https://x.com/*`, `https://*.x.com/*`, `https://twitter.com/*`, `https://*.twitter.com/*`) & content scripts**: Connect to the default OpenAI API endpoint and run the in-page follower filter panel (plus the floating panel host on Safari) on X/Twitter pages.
- **Optional host permissions (`http://*/*`, `https://*/*`)**:
    - Used only when you configure a custom AI API endpoint domain.
    - Your browser will prompt you before granting access to a new domain.

## No Central Server or Analytics

- We do not operate any server to collect, store, or analyze user data.
- We do not use analytics or tracking scripts.
- Your data remains accessible only to the current browser user.

## Remote Code Policy

PolyPost complies with Chrome Web Store policies on remote code. We do not execute remote code.

- All application logic is bundled within the extension package.
- We do not load remote scripts or use `eval()`.

## Changes to This Policy

We may update this Privacy Policy from time to time. If changes are made, we will update the "Last Updated" date and publish the new policy text.

## Contact

If you have questions about this Privacy Policy, please open an issue on GitHub: https://github.com/badships/PolyPost/issues
