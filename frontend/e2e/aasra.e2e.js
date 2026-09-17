// End-to-end QA for AASRA, driven by playwright-cli.
//
//   1. backend on http://127.0.0.1:8000, frontend on http://localhost:3000
//   2. cd frontend/e2e && <python> make_fixtures.py
//   3. playwright-cli open http://localhost:3000
//      playwright-cli run-code --filename=aasra.e2e.js
//
// Screenshots go to ./screenshots. Every check prints PASS/FAIL; the run
// throws at the end if anything failed. The script is a single function
// expression because run-code evaluates it as one.
async (page) => {
  const APP = "http://localhost:3000";
  const results = [];
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
  };
  const shot = (name, options = {}) =>
    page.screenshot({ path: `screenshots/${name}.png`, ...options });

  async function fresh(width = 1440, height = 900) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.setViewportSize({ width, height });
    await page.goto(APP);
    await page.getByTestId("upload-zone").waitFor();
  }

  async function analyse(filePath) {
    await page.getByTestId("file-input").setInputFiles(filePath);
    await page.getByRole("button", { name: "Run analysis" }).click();
    await Promise.race([
      page.getByRole("heading", { name: "AASRA Analysis Results" }).waitFor({ timeout: 90000 }),
      page.getByText("Analysis could not be completed").waitFor({ timeout: 90000 }),
    ]);
  }

  /** Letterboxed content box of an object-contain <img>, in page pixels. */
  async function contentBox(locator) {
    return locator.evaluate((img) => {
      const r = img.getBoundingClientRect();
      const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      return {
        left: r.left + (r.width - w) / 2,
        top: r.top + (r.height - h) / 2,
        scale,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    });
  }

  // ------------------------------------------------------------ landing
  await fresh();
  check("landing: title", (await page.title()).includes("AASRA"));
  check("landing: hero heading", await page.getByRole("heading", { name: "AASRA", exact: true }).isVisible());
  check("landing: method has 9 steps", (await page.locator("#method ol > li").count()) === 9);
  check("landing: service online", await page.getByText("Service online").isVisible({ timeout: 10000 }).catch(() => false));
  await shot("landing-desktop");

  // ----------------------------------------------- client-side rejection
  await page.getByTestId("file-input").setInputFiles("fixtures/notes.txt");
  check(
    "invalid type rejected in browser",
    await page.getByText("Unsupported file type").isVisible(),
  );

  // ----------------------------------------------- backend rejections
  await fresh();
  await analyse("fixtures/corrupt.jpg");
  check("corrupt image -> clean error", await page.getByText("Code: CORRUPT_IMAGE").isVisible());
  await page.waitForTimeout(700); // let the fade-in finish
  await page.locator("#analyze").screenshot({ path: "screenshots/error-corrupt.png" });
  await page.getByRole("button", { name: "Try another image" }).click();
  check("retry returns to upload", await page.getByTestId("upload-zone").isVisible());

  await analyse("fixtures/tiny-32px.png");
  check("tiny image -> IMAGE_TOO_SMALL", await page.getByText("Code: IMAGE_TOO_SMALL").isVisible());

  // ----------------------------------------------- main flow (sample)
  await fresh();
  await page.getByRole("button", { name: /Pakistan 2010/ }).click();
  await page.getByRole("button", { name: "Run analysis" }).waitFor();
  await page.waitForTimeout(600);
  await shot("ready-preview");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await page.getByText("Analysis in progress").waitFor();
  await shot("analyzing");
  await page.getByRole("heading", { name: "AASRA Analysis Results" }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);
  await shot("results-top");

  const storageCount = Number(await page.getByTestId("metric-storage").innerText());
  const dropCount = Number(await page.getByTestId("metric-drops").innerText());
  const storageCards = await page.locator('[data-testid^="storage-card-"]').count();
  check("results: storage metric matches cards", storageCount === storageCards && storageCards > 0, `${storageCount} vs ${storageCards}`);
  check("results: drop zones reported", dropCount > 0, String(dropCount));

  const tabs = ["Original", "Water Analysis", "Candidate Areas", "Drop Zones", "Land Isolation", "Final Result", "AI Context"];
  for (const tab of tabs) {
    const button = page.getByRole("tab", { name: tab, exact: true });
    if (!(await button.count())) {
      check(`tab present: ${tab}`, false);
      continue;
    }
    await button.click();
    const img = page.getByTestId("stage-image");
    await img.evaluate((el) => (el.complete ? null : new Promise((r) => (el.onload = r))));
    const box = await contentBox(img);
    check(`tab renders: ${tab}`, box.naturalWidth === 1024, `${box.naturalWidth}x${box.naturalHeight}`);
    await page.locator("#stage-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400); // let the image fade-in finish
    await page.locator("#stage-panel").screenshot({ path: `screenshots/tab-${tab.replace(/ /g, "-")}.png` });
  }

  await page.getByRole("tab", { name: "Drop Zones", exact: true }).click();
  check(
    "drop zones tab explains every storage zone",
    (await page.locator('[data-testid^="explain-storage-"]').count()) === storageCards,
  );

  // Storage/drop chapter + highlight alignment.
  const chapter = page.locator('[aria-label="Probable storage and drop zones"]');
  const map = page.getByTestId("zone-map");
  await map.scrollIntoViewIfNeeded();
  await page.getByTestId("storage-card-1").hover();
  const storageRing = chapter.getByTestId("highlight-storage");
  check("hover storage card rings it", (await storageRing.count()) === 1);

  const centreText = await page.getByTestId("storage-center-1").innerText();
  const [cx, cy] = centreText.split(",").map((v) => Number(v.trim()));
  const mapBox = await contentBox(map);
  const ringBox = await storageRing.boundingBox();
  const expectedX = mapBox.left + (cx + 0.5) * mapBox.scale;
  const expectedY = mapBox.top + (cy + 0.5) * mapBox.scale;
  const dx = Math.abs(ringBox.x + ringBox.width / 2 - expectedX);
  const dy = Math.abs(ringBox.y + ringBox.height / 2 - expectedY);
  check("storage highlight centred on reported centre (<=1px)", dx <= 1 && dy <= 1, `dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);

  // The baked marker must sit on the same screen pixel: sample the rendered
  // screenshot at the expected position and expect the green centre core.
  const pngBase64 = (await page.screenshot()).toString("base64");
  const vp = page.viewportSize();
  const centrePixel = await page.evaluate(
    async ({ b64, x, y, w }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const ratio = img.naturalWidth / w;
      return Array.from(ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data);
    },
    { b64: pngBase64, x: expectedX, y: expectedY, w: vp.width },
  );
  const [r, g, b] = centrePixel;
  check("baked centre marker under the reported centre", g > 150 && g > r + 60 && g > b + 20, `rgb(${r},${g},${b})`);

  await page.getByTestId("drop-card-1").hover();
  const dropRing = chapter.getByTestId("highlight-drop");
  check("hover drop card rings the drop zone", (await dropRing.count()) === 1);
  await page.waitForTimeout(200);
  await chapter.screenshot({ path: "screenshots/storage-and-drop-zones.png" });

  // Selecting another storage zone swaps the drop list.
  if (storageCards > 1) {
    await page.getByTestId("storage-card-2").locator("button").first().click();
    check("selecting storage zone 2 updates drop heading", await page.getByText("Probable drop zones · Storage zone 02").isVisible());
  }

  check("AI context section present", await page.getByRole("heading", { name: "AI object context" }).isVisible());
  check("limitations present", await page.getByRole("heading", { name: /not a clearance/ }).isVisible());
  await shot("results-full", { fullPage: true });

  const text = await page.locator("body").innerText();
  const banned = /safe (landing|drop) zone|guaranteed|rescue zone|autonomous rescue|unlock the power|revolutioni[sz]/i;
  check("no banned claims in results", !banned.test(text), (text.match(banned) || [""])[0]);

  // ------------------------------------------------ refresh after results
  await page.reload();
  await page.getByTestId("upload-zone").waitFor();
  check("refresh returns cleanly to the landing page", await page.getByRole("heading", { name: "AASRA", exact: true }).isVisible());

  // ------------------------------------------------ large image
  await fresh();
  await analyse("fixtures/large-6000x4000.jpg");
  const largeOk = await page.getByRole("heading", { name: "AASRA Analysis Results" }).isVisible();
  check("large 6000x4000 image analysed", largeOk);
  if (largeOk) {
    check("large image downscaled to 1024 px", await page.getByText("analysed at 1024 × 683 px").isVisible());
  }

  // ------------------------------------------------ no candidate zone
  await fresh();
  await analyse("fixtures/all-water.png");
  check("all-water: empty storage state", await page.getByText("No probable storage zone identified").first().isVisible());
  await page.locator('[aria-label="Probable storage and drop zones"]').screenshot({ path: "screenshots/empty-storage.png" });

  // ------------------------------------------------ small storage zone
  await fresh();
  await analyse("fixtures/small-island.png");
  const smallStorage = await page.locator('[data-testid^="storage-card-"]').count();
  const smallNotViable = await page.locator('[data-testid^="not-viable-"]').count();
  check("small island: storage zone or not-viable card shown", smallStorage + smallNotViable === 1, `${smallStorage}/${smallNotViable}`);
  if (smallStorage === 1) {
    const drops = await page.locator('[data-testid^="drop-card-"]').count();
    check("small storage zone: drop zones or explained empty state", drops > 0 || (await page.getByText("No probable drop zones").isVisible()), `${drops} drop zones`);
  }
  await page.locator('[aria-label="Probable storage and drop zones"]').screenshot({ path: "screenshots/small-storage-zone.png" });

  for (const [fixture, message] of [
    ["island-all-rejected", /All [0-9]+ sampled points were rejected/],
    ["island-no-ring", /leaves no room for a drop point/],
  ]) {
    await fresh();
    await analyse(`fixtures/${fixture}.png`);
    check(`${fixture}: storage zone with explained empty drop list`,
      (await page.getByText("No probable drop zones").isVisible()) && (await page.getByText(message).isVisible()));
    await page.locator('[aria-label="Probable storage and drop zones"]').screenshot({ path: `screenshots/${fixture}.png` });
  }

  // ------------------------------------------------ responsive
  for (const [label, w, h] of [["mobile", 390, 844], ["tablet", 820, 1180]]) {
    await fresh(w, h);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: landing has no horizontal overflow`, overflow <= 0, String(overflow));
    await shot(`landing-${label}`, { fullPage: true });
    await page.getByRole("button", { name: /Pakistan 2010/ }).click();
    await page.getByRole("button", { name: "Run analysis" }).click();
    await page.getByRole("heading", { name: "AASRA Analysis Results" }).waitFor({ timeout: 90000 });
    await page.waitForTimeout(400);
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label}: results have no horizontal overflow`, overflow2 <= 0, String(overflow2));
    await shot(`results-${label}`, { fullPage: true });
  }

  // ------------------------------------------------ backend unavailable
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/:8000\//, (route) => route.abort("connectionrefused"));
  await page.goto(APP);
  await page.getByTestId("offline-notice").waitFor({ timeout: 15000 });
  check("offline: notice shown", true);
  check("offline: upload disabled", await page.getByRole("button", { name: "Choose image" }).isDisabled());
  check("offline: header status", await page.getByText("Service offline").isVisible());
  await page.waitForTimeout(700);
  await page.locator("#analyze").screenshot({ path: "screenshots/offline.png" });

  // Health fine, but the analysis request fails mid-flight.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(/:8000\/api\/analyze/, (route) => route.abort("connectionreset"));
  await page.goto(APP);
  await page.getByText("Service online").waitFor({ timeout: 15000 });
  await analyse("fixtures/small-island.png");
  check("network failure during analysis -> NETWORK_ERROR", await page.getByText("Code: NETWORK_ERROR").isVisible());
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // An older backend (no storage_zones) must fail cleanly, not crash the page.
  await page.route(/:8000\/api\/analyze/, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: { success: true, metrics: { water_percentage: 1 }, zones: [], images: {} },
    }),
  );
  await page.goto(APP);
  await page.getByText("Service online").waitFor({ timeout: 15000 });
  await analyse("fixtures/small-island.png");
  check("older backend response -> INCOMPATIBLE_BACKEND", await page.getByText("Code: INCOMPATIBLE_BACKEND").isVisible());
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // ------------------------------------------------ console
  const relevant = consoleErrors.filter((e) => !/ERR_CONNECTION|Failed to load resource|net::/i.test(e));
  check("no unexpected console errors", relevant.length === 0, relevant.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.ok);
  const report = results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` [${r.detail}]` : ""}`).join("\n");
  if (failed.length) throw new Error(`${failed.length} of ${results.length} checks failed\n${report}`);
  return `${results.length}/${results.length} checks passed\n${report}`;
}
