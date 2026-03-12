const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const net = require("net");

/* ================= CONFIG ================= */

const TARGET_URL =
  process.env.TARGET_URL ||
  "https://bot-hosting.net/panel/earn";

const HY2_URL = process.env.HY2_URL || "";
const SOCKS_PORT = 51080;

const EXT_DIR = path.resolve(__dirname, "extensions/helper");

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

async function screenshot(page, name) {
  try {
    ensureScreenDir();
    const file = path.join(SCREEN_DIR, `${Date.now()}_${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("📸 Screenshot:", file);
  } catch {}
}

/* ================= HY2 ================= */

function parseHy2(url) {
  const u = url.replace("hysteria2://", "");
  const parsed = new URL("scheme://" + u);

  return {
    server: `${parsed.hostname}:${parsed.port}`,
    auth: decodeURIComponent(parsed.username),
    sni: parsed.searchParams.get("sni") || parsed.hostname,
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

      s.on("error", () => res(false));
    });

    if (ok) return true;
  }

  return false;
}

async function startHy2() {
  if (!HY2_URL) {
    console.log("⚠️ HY2 未设置，跳过代理");
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

  console.log("🚀 启动 hysteria2");

  const proc = spawn("hysteria", ["client", "-c", cfgPath], {
    stdio: "ignore",
    detached: true
  });

  if (!(await waitPort(SOCKS_PORT))) {
    throw new Error("❌ HY2 socks 未启动");
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
        console.log("🖱 点击:", s);
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
        HY2_URL ? `--proxy-server=socks5://127.0.0.1:${SOCKS_PORT}` : "",
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        "--no-sandbox",
        "--disable-dev-shm-usage"
      ].filter(Boolean)
    });

    const page = await context.newPage();

    console.log("🌍 打开页面");

    await page.goto(TARGET_URL, {
      waitUntil: "networkidle",
      timeout: 120000
    });

    await screenshot(page, "page_loaded");

    console.log("🟢 自动点击循环开始");

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
