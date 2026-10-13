// Records the Mulligan demo scenes against the live site, captions drawn in-page.
//   node record.mjs            all scenes;  ONLY=s3,s4 node record.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname;
const SITE = "https://mulligan-hyperevm.vercel.app";
const LOCAL = "http://127.0.0.1:5199"; // static server for brand/terminal/stats pages
const dur = Object.fromEntries(readFileSync(DIR + "durations.txt", "utf8").trim().split("\n").map((l) => l.split(" ")).map(([k, v]) => [k, Number(v)]));
const marks = existsSync(DIR + "marks.json") ? JSON.parse(readFileSync(DIR + "marks.json", "utf8")) : {};
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAPTION = `
  window.__cap = (t) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div"); el.id = "__cap";
      el.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;padding:12px 22px;background:rgba(2,21,18,.92);border:1px solid rgba(151,252,228,.45);color:#f2fbf8;font:500 22px 'Inter Tight',Inter,sans-serif;letter-spacing:-.01em;box-shadow:0 14px 34px rgba(0,0,0,.45);transition:opacity .3s;text-align:center;pointer-events:none";
      document.documentElement.appendChild(el);
    }
    el.style.opacity = t ? "1" : "0"; if (t) el.textContent = t;
  };`;

const smooth = (page, y, ms = 1400) =>
  page.evaluate(([y, ms]) => new Promise((res) => {
    const s = window.scrollY, d = y - s, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, s + d * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [y, ms]);
const yOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + window.scrollY - 40 : 0; }, sel);

async function scene(id, { url, w = 1600, h = 900, need, run }) {
  if (ONLY && !ONLY.includes(id)) return;
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir: DIR + "raw", size: { width: w, height: h } } });
  await ctx.addInitScript(CAPTION);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await sleep(1500); // let live prices land
  const start = (Date.now() - t0) / 1000;
  const want = need ?? (dur[id] ?? 4) + 1.2;
  await run(page);
  const el = (Date.now() - t0) / 1000 - start;
  if (el < want) await sleep((want - el) * 1000);
  const v = page.video();
  await ctx.close(); await browser.close();
  renameSync(await v.path(), `${DIR}raw/${id}.webm`);
  marks[id] = { start };
  writeFileSync(DIR + "marks.json", JSON.stringify(marks, null, 1));
  console.log(id, "recorded, starts at", start.toFixed(2));
}

// Open and close cards, full frame.
await scene("open", { url: `${LOCAL}/brand.html`, w: 1920, h: 1080, need: 11.5, run: async () => {} });
await scene("close", { url: `${LOCAL}/brand.html#close`, w: 1920, h: 1080, need: 6, run: async () => {} });

await scene("s2", { url: `${SITE}/#/`, run: async (p) => {
  await p.evaluate(() => __cap("Mulligan: perps where a losing trade buys you a piece of the house"));
  await sleep(2600);
  await smooth(p, await yOf(p, ".lp-ticker"), 1800);
}});

await scene("s3", { url: `${SITE}/#/trade`, run: async (p) => {
  await p.evaluate(() => __cap("Live HyperCore oracle + mark prices, read on HyperEVM mainnet"));
  await sleep(2200);
  for (const t of ["ETH-USD", "HYPE-USD", "BTC-USD"]) { await p.getByText(t, { exact: false }).first().click().catch(() => {}); await sleep(1700); }
  await p.evaluate(() => __cap("Entry = the worse of oracle and mark: latency games don't pay"));
}});

await scene("s4", { url: `${SITE}/#/trade`, run: async (p) => {
  await p.evaluate(() => __cap("Max profit (9× margin) is reserved the moment a position opens"));
  await sleep(1200);
  const slider = p.locator('input[type="range"]');
  for (const v of [5, 15, 25]) { await slider.fill(String(v)).catch(() => {}); await sleep(900); }
  await sleep(1200);
  await p.goto(`${SITE}/#/docs`); await sleep(1500);
  await p.evaluate(() => __cap("Winners are always paid in full, instantly. No payout queue."));
  await smooth(p, 260, 1600);
}});

await scene("s5", { url: `${SITE}/#/`, run: async (p) => {
  await smooth(p, await yOf(p, ".lp-field"), 1400);
  await p.evaluate(() => __cap("Lose after 10 minutes: half the loss comes back as MULL, a share of the house"));
  await sleep(4200);
  await smooth(p, await yOf(p, "#how"), 1600);
}});

await scene("s6", { url: `${LOCAL}/stats.html`, run: async (p) => {
  await p.evaluate(() => __cap("Rust keeper liquidated on its own. Every loser got exactly half back."));
  await sleep(2500);
  await sleep(3000);
}});

await scene("s7", { url: `${LOCAL}/terminal.html`, run: async (p) => {
  await p.evaluate(() => __cap("13 Foundry tests, fuzzed for solvency and hedge farming"));
  await sleep(6200);
  await p.goto(`${SITE}/#/`); await sleep(1200);
  await smooth(p, await yOf(p, ".lp-compare"), 1200);
  await p.evaluate(() => __cap("The house always keeps at least half, plus fees. No owner, no upgrades."));
}});
