#!/usr/bin/env node
/**
 * CSS layout guardrails for the first-party UI.
 *
 * The first-party pass is a gate: it fails when a panel container is allowed to
 * escape the drawer, when the extension columns can force horizontal overflow,
 * or when geometry uses !important. Installed extensions are user data, so they
 * are reported but never fail the build.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const PANEL_SELECTORS = [
    '#top-settings-holder',
    '.drawer-content',
    '.tauri-panel-content',
    '.tauri-panel-drawer',
    '#extensions_settings',
    '#extensions_settings2',
    '.extensions_block',
    '.extension_container',
    '#tt-file-explorer',
];

const GEOMETRY_PROPERTIES = new Set([
    'width',
    'height',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'left',
    'right',
    'top',
    'bottom',
    'position',
    'inset',
]);

const ALLOWED_FIXED = [
    // The shell deliberately turns the stock drawers into fixed rail panels.
    { file: 'src/css/tauritavern-shell.css', selector: '.drawer-content' },
    { file: 'src/css/tauritavern-shell.css', selector: '#top-settings-holder' },
    // Maximized drawers intentionally cover the viewport.
    { selector: '.drawer-content.maximized' },
    // Mobile-only rules are retained from upstream and are not used on Windows.
    { file: 'src/css/mobile-styles.css' },
    // Dialogs and popups are expected to sit above the drawer.
    { selector: '.popup' },
    { selector: '.dialog' },
    // The right-hand vault dock is a fixed application panel, not a drawer.
    { selector: '#tt-file-explorer' },
];

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'lib' || entry.name === 'node_modules') continue;
            out.push(...walk(full));
        } else if (entry.name.endsWith('.css') && !entry.name.endsWith('.min.css')) {
            out.push(full);
        }
    }
    return out;
}

function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(text) {
    const rules = [];
    let buffer = '';
    let selector = null;
    let bodyStart = 0;
    let atRuleDepth = 0;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') {
            if (selector === null) {
                const head = buffer.trim();
                if (head.startsWith('@')) {
                    atRuleDepth += 1;
                } else if (head.length > 0) {
                    selector = head;
                    bodyStart = i + 1;
                }
            }
            buffer = '';
        } else if (ch === '}') {
            if (selector !== null) {
                rules.push({ selector, body: text.slice(bodyStart, i) });
                selector = null;
            } else if (atRuleDepth > 0) {
                atRuleDepth -= 1;
            }
            buffer = '';
        } else if (selector === null) {
            buffer += ch;
        }
    }
    return rules;
}

function declarations(body) {
    const map = new Map();
    for (const part of body.split(';')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const property = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (property && value) map.set(property, value);
    }
    return map;
}

function isPanelSelector(selector) {
    return PANEL_SELECTORS.some((needle) => selector.includes(needle));
}

function isAllowedFixed(file, selector) {
    return ALLOWED_FIXED.some((rule) => {
        if (rule.file && !file.endsWith(rule.file)) return false;
        if (!rule.selector) return true;
        return selector.includes(rule.selector);
    });
}

function auditFirstParty() {
    const errors = [];
    const warnings = [];
    const files = walk(SRC);
    let ruleCount = 0;

    for (const file of files) {
        const relative = path.relative(ROOT, file).replaceAll('\\', '/');
        const text = stripComments(fs.readFileSync(file, 'utf8'));
        for (const rule of parseRules(text)) {
            ruleCount += 1;
            const decl = declarations(rule.body);
            const panel = isPanelSelector(rule.selector);

            if (decl.get('position') === 'fixed' && panel && !isAllowedFixed(relative, rule.selector)) {
                errors.push(`${relative}: fixed panel "${rule.selector}"`);
            }

            const width = decl.get('width') ?? '';
            if (panel && /(^|[^c])100vw/.test(width) && !width.includes('calc(')) {
                errors.push(`${relative}: 100vw panel width "${rule.selector}"`);
            }

            if (panel) {
                for (const [property, value] of decl) {
                    if (value.includes('!important') && GEOMETRY_PROPERTIES.has(property)
                        && !isAllowedFixed(relative, rule.selector)) {
                        errors.push(`${relative}: !important ${property} on "${rule.selector}"`);
                    }
                }
                if (decl.has('min-width') && parseInt(decl.get('min-width'), 10) > 400) {
                    warnings.push(`${relative}: min-width ${decl.get('min-width')} on "${rule.selector}"`);
                }
            }

            const zIndex = parseInt(decl.get('z-index') ?? '', 10);
            if (Number.isFinite(zIndex) && zIndex > 4000 && panel) {
                warnings.push(`${relative}: z-index ${zIndex} on "${rule.selector}"`);
            }
        }
    }

    const extensionCss = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    if (!/#extensions_settings\s*,\s*#extensions_settings2[^{]*\{[^}]*min-width:\s*0/s.test(extensionCss)) {
        errors.push('src/css/extensions-panel.css: #extensions_settings / #extensions_settings2 need min-width: 0');
    }
    if (!/#extensions_settings\s*>\s*\*[\s\S]{0,160}min-width:\s*0/.test(extensionCss)) {
        errors.push('src/css/extensions-panel.css: extension column children need min-width: 0');
    }

    return { errors, warnings, files: files.length, rules: ruleCount };
}

function installedExtensionsReport() {
    const base = path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'com.tauritavern.client',
        'data',
        'default-user',
        'extensions',
    );
    if (!fs.existsSync(base)) {
        return { base, extensions: [] };
    }

    const extensions = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(base, entry.name);
        let css = [];
        try {
            css = walk(dir);
        } catch {
            continue;
        }
        let fixed = 0;
        let viewport = 0;
        let important = 0;
        for (const file of css) {
            const text = stripComments(fs.readFileSync(file, 'utf8'));
            fixed += (text.match(/position\s*:\s*fixed/gi) ?? []).length;
            viewport += (text.match(/(^|[^c])100vw/gi) ?? []).length;
            important += (text.match(/!important/gi) ?? []).length;
        }
        extensions.push({ name: entry.name, cssFiles: css.length, fixed, viewport, important });
    }
    extensions.sort((a, b) => a.name.localeCompare(b.name));
    return { base, extensions };
}

const first = auditFirstParty();
const installed = installedExtensionsReport();

console.log(`CSS layout audit: ${first.files} first-party files, ${first.rules} rules`);
for (const warning of first.warnings) console.warn(`warning: ${warning}`);
for (const error of first.errors) console.error(`error: ${error}`);

if (installed.extensions.length > 0) {
    console.log(`\nInstalled extensions (${installed.base}):`);
    for (const ext of installed.extensions) {
        console.log(
            `  ${ext.name}: css=${ext.cssFiles} fixed=${ext.fixed} 100vw=${ext.viewport} important=${ext.important}`,
        );
    }
}

if (first.errors.length > 0) {
    process.exitCode = 1;
} else {
    console.log('\nFirst-party CSS layout guardrails passed.');
}


