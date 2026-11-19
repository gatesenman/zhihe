import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const require = createRequire('/workspace/tabnest/package.json')
const { Resvg } = require('@resvg/resvg-js'); const pngToIco = require('png-to-ico').default ?? require('png-to-ico')
const r = (s) => new Resvg(readFileSync('build/icon.svg'), { fitTo: { mode: 'width', value: s } }).render().asPng()
mkdirSync('build/icons', { recursive: true }); writeFileSync('build/icon.png', r(512))
for (const s of [16, 24, 32, 48, 64, 128, 256]) writeFileSync(`build/icons/${s}.png`, r(s))
writeFileSync('build/icon.ico', await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => `build/icons/${s}.png`)))
console.log('ok')
