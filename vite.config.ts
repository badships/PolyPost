import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import baseManifest from './manifest.json';

type TargetBrowser = 'chrome' | 'firefox' | 'safari';
const X_MATCHES = [
    'https://x.com/*',
    'https://*.x.com/*',
    'https://twitter.com/*',
    'https://*.twitter.com/*',
];

const getTargetBrowser = (): TargetBrowser => {
    const candidate = (process.env.POLYPOST_BROWSER || process.env.TARGET_BROWSER || '')
        .trim()
        .toLowerCase();

    if (candidate === 'firefox' || candidate === 'safari' || candidate === 'chrome') {
        return candidate;
    }

    return 'chrome';
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getBackgroundForTarget = (target: TargetBrowser, manifest: any) => {
    const background = manifest?.background || {};
    const serviceWorker = background.service_worker;

    if (!serviceWorker) {
        return background;
    }

    if (target === 'chrome') {
        return {
            service_worker: serviceWorker,
            type: 'module',
        };
    }

    return {
        scripts: [serviceWorker],
        type: 'module',
    };
};

const removeActionPopup = (manifest: any) => {
    if (!manifest?.action || typeof manifest.action !== 'object') {
        return;
    }

    if ('default_popup' in manifest.action) {
        delete manifest.action.default_popup;
    }
};

const addSafariFloatingHostScript = (manifest: any) => {
    if (!Array.isArray(manifest.content_scripts)) {
        manifest.content_scripts = [];
    }

    const exists = manifest.content_scripts.some((entry: any) => {
        return Array.isArray(entry?.js) && entry.js.includes('src/content/floatingAppHost.ts');
    });
    if (exists) {
        return;
    }

    manifest.content_scripts.push({
        matches: X_MATCHES,
        js: ['src/content/floatingAppHost.ts'],
        run_at: 'document_idle',
    });
};

const addSafariFloatingHostResources = (manifest: any, command: 'build' | 'serve') => {
    if (!Array.isArray(manifest.web_accessible_resources)) {
        manifest.web_accessible_resources = [];
    }

    const resources =
        command === 'build'
            ? ['src/sidepanel/index.html', 'assets/*', 'icons/*']
            : ['assets/*', 'icons/*'];
    const exists = manifest.web_accessible_resources.some((entry: any) => {
        const entryResources = Array.isArray(entry?.resources) ? entry.resources : [];
        return resources.every((resource) => entryResources.includes(resource));
    });
    if (exists) {
        return;
    }

    manifest.web_accessible_resources.push({
        matches: X_MATCHES,
        resources,
    });
};

const sanitizeFirefoxInnerHtmlAssignments = async (target: TargetBrowser) => {
    if (target !== 'firefox') {
        return;
    }

    const assetsDir = resolve(__dirname, `dist/${target}/assets`);
    let assetNames: string[];
    try {
        assetNames = await fs.readdir(assetsDir);
    } catch {
        return;
    }

    const svgInnerHtmlPattern =
        /([A-Za-z_$][\w$]*)\.innerHTML="<svg>"\+([A-Za-z_$][\w$]*)\.valueOf\(\)\.toString\(\)\+"<\/svg>",/g;
    const dynamicInnerHtmlPattern = /([A-Za-z_$][\w$]*)\.innerHTML=([A-Za-z_$][\w$]*);/g;

    for (const assetName of assetNames) {
        if (!assetName.endsWith('.js')) {
            continue;
        }

        const assetPath = resolve(assetsDir, assetName);
        let source: string;
        try {
            source = await fs.readFile(assetPath, 'utf8');
        } catch {
            continue;
        }

        if (!source.includes('.innerHTML=')) {
            continue;
        }

        const withSvgReplaced = source.replace(
            svgInnerHtmlPattern,
            (_match: string, element: string, value: string) =>
                `(()=>{while(${element}.firstChild){${element}.removeChild(${element}.firstChild)}${element}.appendChild((${element}.ownerDocument||document).createTextNode("<svg>"+${value}.valueOf().toString()+"</svg>"));})(),`,
        );

        const sanitizedSource = withSvgReplaced.replace(
            dynamicInnerHtmlPattern,
            (_match: string, element: string, value: string) =>
                `(()=>{while(${element}.firstChild){${element}.removeChild(${element}.firstChild)}${element}.appendChild((${element}.ownerDocument||document).createTextNode(String(${value})));})();`,
        );

        if (sanitizedSource === source) {
            continue;
        }

        await fs.writeFile(assetPath, sanitizedSource, 'utf8');
    }
};

const sanitizeBuiltManifestPlugin = (target: TargetBrowser) => {
    return {
        name: 'polypost-sanitize-built-manifest',
        apply: 'build' as const,
        async closeBundle() {
            if (target === 'chrome') {
                return;
            }

            const manifestPath = resolve(__dirname, `dist/${target}/manifest.json`);
            let rawManifest: string;
            try {
                rawManifest = await fs.readFile(manifestPath, 'utf8');
            } catch {
                return;
            }

            const manifest = JSON.parse(rawManifest) as any;
            if (!Array.isArray(manifest.web_accessible_resources)) {
                return;
            }

            let mutated = false;
            manifest.web_accessible_resources = manifest.web_accessible_resources.map(
                (entry: any) => {
                    if (!entry || typeof entry !== 'object' || !('use_dynamic_url' in entry)) {
                        return entry;
                    }

                    const nextEntry = { ...entry };
                    delete nextEntry.use_dynamic_url;
                    mutated = true;
                    return nextEntry;
                },
            );

            if (!mutated) {
                await sanitizeFirefoxInnerHtmlAssignments(target);
                return;
            }

            await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
            await sanitizeFirefoxInnerHtmlAssignments(target);
        },
    };
};

const buildManifest = (command: 'build' | 'serve' = 'build') => {
    const target = getTargetBrowser();
    const manifest = clone(baseManifest) as any;

    manifest.background = getBackgroundForTarget(target, manifest);

    if (command === 'serve' && target === 'chrome') {
        manifest.content_security_policy = {
            extension_pages:
                "script-src 'self' http://localhost:5173; object-src 'self'; connect-src 'self' http://localhost:5173 ws://localhost:5173 https: http:;",
        };
    }

    if (target !== 'chrome') {
        delete manifest.side_panel;
        manifest.options_ui = {
            page: 'src/sidepanel/index.html',
        };
        if (Array.isArray(manifest.permissions)) {
            manifest.permissions = manifest.permissions.filter((permission: string) => {
                return permission !== 'sidePanel';
            });
        }
    }

    if (target === 'firefox') {
        removeActionPopup(manifest);

        const geckoId = process.env.POLYPOST_FIREFOX_ID?.trim() || 'polypost@local';
        manifest.browser_specific_settings = {
            gecko: {
                // This is required for signing. Replace with a real ID before publishing.
                id: geckoId,
                // Keep minimum versions aligned with manifest keys used by Firefox:
                // - background.type (Firefox 112+)
                // - optional_host_permissions (Firefox 128+)
                strict_min_version: '140.0',
                data_collection_permissions: {
                    required: [
                        // API key is sent to provider endpoints for authentication.
                        'authenticationInfo',
                        // User post text can be sent to AI providers for polishing/translation.
                        'personalCommunications',
                        // Text sourced from website content can be sent to AI providers.
                        'websiteContent',
                    ],
                },
            },
            gecko_android: {
                strict_min_version: '142.0',
            },
        };

        manifest.sidebar_action = {
            default_panel: 'src/sidepanel/index.html',
            default_title: 'PolyPost',
            default_icon: manifest.icons,
            open_at_install: false,
        };
    }

    if (target === 'safari') {
        removeActionPopup(manifest);
        addSafariFloatingHostScript(manifest);
        addSafariFloatingHostResources(manifest, command);
    }

    return manifest;
};

const target = getTargetBrowser();

export default defineConfig({
    plugins: [
        react(),
        crx({
            manifest: ({ command }) => buildManifest(command),
            browser: target === 'chrome' ? 'chrome' : 'firefox',
        }),
        sanitizeBuiltManifestPlugin(target),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: '*',
        },
    },
    build: {
        outDir: `dist/${target}`,
        rollupOptions: {
            input: {
                sidepanel: 'src/sidepanel/index.html',
            },
        },
    },
});
