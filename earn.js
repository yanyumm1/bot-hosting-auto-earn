const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

/* ================= CONFIG ================= */

const TARGET_URL =
  process.env.TARGET_URL ||
  "https://bot-hosting.net/panel/earn";

const HY2_URL = process.env.HY2_URL || "";

const SOCKS_PORT = 51080;

const COOKIE_FILE = path.resolve(__dirname, "cookies/discord.json");

const EXT_NOPECHA = path.resolve(__dirname, "extensions/nopecha/unpacked");

const SCREEN_DIR = path.resolve(__dirname, "screenshots");

/* ================= UTILS ================= */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureScreenDir() {
  if (!fs.existsSync(SCREEN_DIR)) {
    fs.mkdirSync(SCREEN_DIR, { recursive: true });
  }
}

async function snap(page, name) {
  try {
    ensureScreenDir();
    const file = path.join(SCREEN_DIR, `${Date.now()}_${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("📸 Screenshot:", file);
  } catch {}
}

/* ================= COOKIE ================= */

async function injectCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.log("⚠️ Cookie file missing");
    return;
  }

  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));

  await context.addCookies(cookies);

  console.log("🍪 Injected cookies:", cookies.length);
}

/* ================= HY2 ================= */

function parseHy2(url) {
  const u = url.replace("hysteria2://", "");
  const parsed = new URL("scheme://" + u);

  return {
    server: `${parsed.hostname}:${parsed.port}`,
    auth: decodeURIComponent(parsed.username),
    sni: parsed.searchParams.get("sni") || parsed.hostname
  };
}

async function waitPort(port) {
  const start = Date.now();

  while (Date.now() - start < 15000) {
    await sleep(1000);

    const ok = await new Promise((res) => {
      const s = net.createConnection(port, "127.0.0.1");

      s.on("connect", () => {
        s.destroy();
        res(true);
      });

      s.on("error", () => res(false);
    });

    if (ok) return true;
  }

  return false;
}

async function startHy2() {

  if (!HY2_URL) {
    console.log("⚠️ HY2_URL 未设置");
    return null;
  }

  const cfg = parseHy2(HY2_URL);

  const cfgPath = "/tmp/hy2.json";

  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        server: cfg.server,
        auth: cfg.auth,
        tls: {
          sni: cfg.sni,
          insecure: true
        },
        socks5: {
          listen: `127.0.0.1:${SOCKS_PORT}`
        }
      },
      null,
      2
    )
  );

  console.log("🚀 Start hysteria2");

  const proc = spawn("hysteria", ["client", "-c", cfgPath], {
    stdio: "ignore",
    detached: true
  });

  if (!(await waitPort(SOCKS_PORT))) {
    throw new Error("❌ HY2 socks 未就绪");
  }

  console.log("✅ HY2 socks ready");

  return proc;
}

/* ================= AUTO CLICK ================= */

async function autoClick(page) {

  const selectors = [
    "button.green",
    "button.swal-button",
    "span.close"
  ];

  for (const s of selectors) {
    try {

      const el = page.locator(s).first();

      if (await el.isVisible()) {
        await el.click({ force: true });
        console.log("🖱 Click:", s);
      }

    } catch {}
  }
}

/* ================= MAIN ================= */

async function main() {

  let hy2 = null;

  try {

    hy2 = await startHy2();

    const context = await chromium.launchPersistentContext("./profile", {

      headless: false,

      args: [
        HY2_URL
          ? `--proxy-server=socks5://127.0.0.1:${SOCKS_PORT}`
          : "",

        `--disable-extensions-except=${EXT_NOPECHA}`,
        `--load-extension=${EXT_NOPECHA}`,

        "--no-sandbox",
        "--disable-dev-shm-usage"
      ].filter(Boolean)
    });

    await injectCookies(context);

    const page = await context.newPage();

    console.log("🌍 Open:", TARGET_URL);

    await page.goto(TARGET_URL, {
      waitUntil: "networkidle",
      timeout: 120000
    });

    await snap(page, "page_loaded");

    while (true) {

      await autoClick(page);

      await sleep(2000);
    }

  } catch (e) {

    console.log("❌ Error:", e.message);

  } finally {

    if (hy2) {
      try {
        hy2.kill("SIGTERM");
      } catch {}
    }
  }
}

main();