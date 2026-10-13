// Background plate + rounded mask for framing screen recordings inside a 1920x1080 frame.
// Usage: node plates.mjs [outDir] [bgCss] [accentRgba]
//   defaults: soft light background, violet hairline. The window is 1600x900 at (160, 90).
import { chromium as firefox } from "playwright";
import { resolve } from "node:path";
const [dir = ".", bg = "radial-gradient(90% 80% at 50% 0%,#f6f3ff 0%,#efede8 60%)", accent = "rgba(94,14,255,.25)"] = process.argv.slice(2);
const b = await firefox.launch({ channel: "chrome" }); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const box = "position:absolute;left:160px;top:90px;width:1600px;height:900px;border-radius:22px";
await p.setContent(`<body style="margin:0;background:${bg}"><div style="${box};background:#121016;box-shadow:0 40px 90px -30px rgba(40,20,90,.45),0 0 0 1.5px ${accent}"></div></body>`);
await p.screenshot({ path: resolve(dir, "plate_bg.png") });
await p.setContent(`<body style="margin:0;background:#000"><div style="${box};background:#fff"></div></body>`);
await p.screenshot({ path: resolve(dir, "plate_mask.png") });
await b.close(); console.log("plate_bg.png, plate_mask.png");
