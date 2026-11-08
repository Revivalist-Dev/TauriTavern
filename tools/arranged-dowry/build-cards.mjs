#!/usr/bin/env node
/**
 * Build portable character-card PNGs for the Arranged Dowry experiment.
 *
 * Reads characters/source/cards.json, renders a deterministic monogram portrait
 * per card, embeds Character Card V2 JSON in `chara` and `ccv3` PNG text chunks,
 * and writes the cards to characters/cards/.
 *
 * No third-party dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(
    SCRIPT_DIR,
    '..',
    '..',
    '..',
    'project-roleplay',
    'lorebook-naruto',
    'Narrative-Experiments',
    'arranged-dowry',
);

const root = path.resolve(process.argv[2] ?? DEFAULT_ROOT);
const sourcePath = path.join(root, 'characters', 'source', 'cards.json');
const cardsDir = path.join(root, 'characters', 'cards');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const WIDTH = 512;
const HEIGHT = 768;
const FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function hex(value) {
    const clean = String(value).replace('#', '');
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function mix(a, b, t) {
    return Math.round(a + (b - a) * t);
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function textChunk(keyword, value) {
    return chunk('tEXt', Buffer.concat([
        Buffer.from(keyword, 'latin1'),
        Buffer.from([0]),
        Buffer.from(value, 'latin1'),
    ]));
}

function renderPortrait(colors, initial) {
    const [start, end] = colors.map(hex);
    const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
    const pixelScale = 26;
    const gap = 18;
    const glyphWidth = 5 * pixelScale;
    const glyphHeight = 7 * pixelScale;
    const totalWidth = initial.length * glyphWidth + (initial.length - 1) * gap;
    const startX = Math.round((WIDTH - totalWidth) / 2);
    const startY = Math.round((HEIGHT - glyphHeight) / 2) - 24;

    for (let y = 0; y < HEIGHT; y += 1) {
        const rowStart = y * (WIDTH * 4 + 1);
        raw[rowStart] = 0;
        for (let x = 0; x < WIDTH; x += 1) {
            const offset = rowStart + 1 + x * 4;
            const v = y / HEIGHT;
            const diagonal = Math.min(1, Math.max(0, (x / WIDTH) * 0.35 + v * 0.65));
            const base = [
                mix(start[0], end[0], diagonal),
                mix(start[1], end[1], diagonal),
                mix(start[2], end[2], diagonal),
            ];
            const vignette = Math.max(0.58, 1 - Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) / 620);
            const grain = ((x * 17 + y * 29 + x * y * 3) % 9) - 4;
            raw[offset] = Math.max(0, Math.min(255, Math.round(base[0] * vignette + grain)));
            raw[offset + 1] = Math.max(0, Math.min(255, Math.round(base[1] * vignette + grain)));
            raw[offset + 2] = Math.max(0, Math.min(255, Math.round(base[2] * vignette + grain)));
            raw[offset + 3] = 255;
        }
    }

    const drawPixel = (x, y, color, alpha = 255) => {
        if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
        const offset = y * (WIDTH * 4 + 1) + 1 + x * 4;
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
        raw[offset + 3] = alpha;
    };

    let cursor = startX;
    for (const character of initial) {
        const glyph = FONT[character] ?? FONT[' '];
        for (let gy = 0; gy < 7; gy += 1) {
            for (let gx = 0; gx < 5; gx += 1) {
                if (glyph[gy][gx] !== '1') continue;
                for (let py = 0; py < pixelScale; py += 1) {
                    for (let px = 0; px < pixelScale; px += 1) {
                        drawPixel(cursor + gx * pixelScale + px, startY + gy * pixelScale + py, [245, 240, 230]);
                    }
                }
            }
        }
        cursor += glyphWidth + gap;
    }

    for (let x = 24; x < WIDTH - 24; x += 1) {
        drawPixel(x, 24, [245, 240, 230], 150);
        drawPixel(x, HEIGHT - 25, [245, 240, 230], 150);
    }
    for (let y = 24; y < HEIGHT - 24; y += 1) {
        drawPixel(24, y, [245, 240, 230], 150);
        drawPixel(WIDTH - 25, y, [245, 240, 230], 150);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(WIDTH, 0);
    ihdr.writeUInt32BE(HEIGHT, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    ]);
}

fs.mkdirSync(cardsDir, { recursive: true });

for (const { file, colors, initial, data } of source.cards) {
    const card = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: data.name,
            description: data.description,
            personality: data.personality,
            scenario: data.scenario,
            first_mes: data.first_mes,
            mes_example: data.mes_example,
            creator_notes: data.creator_notes,
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: data.tags,
            creator: 'BB for senpai',
            character_version: '1.0',
            extensions: {
                talkativeness: String(data.talkativeness ?? 0.5),
                world: '',
                depth_prompt: { prompt: '', depth: 4, role: 'system' },
            },
        },
    };
    const encoded = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
    const png = Buffer.concat([
        renderPortrait(colors, initial),
        textChunk('chara', encoded),
        textChunk('ccv3', encoded),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(path.join(cardsDir, file), png);
    console.log(`wrote ${file}`);
}

fs.writeFileSync(
    path.join(cardsDir, 'index.json'),
    `${JSON.stringify(source.cards.map(({ file, data }) => ({ file, name: data.name })), null, 2)}\n`,
);
console.log(`built ${source.cards.length} cards in ${cardsDir}`);
