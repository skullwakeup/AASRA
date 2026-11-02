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
    // Uploads stay disabled until the first health check succeeds.
    await page.getByText("Service online").waitFor({ timeout: 15000 }).catch(() => {});
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

  const sensorCount = Number(await page.getByTestId("metric-sensor").innerText());
  const sensorCards = await page.locator('[data-testid^="sensor-card-"]').count();
  check("results: sensor metric matches cards", sensorCount === sensorCards && sensorCards > 0, `${sensorCount} vs ${sensorCards}`);
  const supplyCards = await page.locator('[data-testid^="supply-card-"]').count();
  check("results: supply drop zone segments listed", supplyCards > 0, String(supplyCards));

  const tabs = ["Combined", "Sensor Drop Zones", "Supply Drop Zones", "Original", "Water Analysis", "Candidate Areas", "Land Isolation", "AI Context"];
  for (const tab of tabs) {
    const button = page.getByRole("tab", { name: tab, exact: true });
    if (!(await button.count())) {
      check(`tab present: ${tab}`, false);
      continue;
    }
    await button.first().click();
    const img = page.getByTestId("stage-image");
    await img.evaluate((el) => (el.complete ? null : new Promise((r) => (el.onload = r))));
    const box = await contentBox(img);
    check(`tab renders: ${tab}`, box.naturalWidth === 1024, `${box.naturalWidth}x${box.naturalHeight}`);
    await page.locator("#stage-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400); // let the image fade-in finish
    await page.locator("#stage-panel").screenshot({ path: `screenshots/tab-${tab.replace(/ /g, "-")}.png` });
  }

  await page.getByRole("tab", { name: "Sensor Drop Zones", exact: true }).click();
  check(
    "sensor tab explains every sensor zone",
    (await page.locator('[data-testid^="explain-sensor-"]').count()) === sensorCards,
  );

  // Drop-zone chapter + highlight alignment.
  const chapter = page.locator('[aria-label="Probable drop zones"]');
  const map = page.getByTestId("zone-map");
  await map.scrollIntoViewIfNeeded();
  await page.getByTestId("sensor-card-1").hover();
  const sensorRing = chapter.getByTestId("highlight-sensor");
  check("hover sensor card rings it", (await sensorRing.count()) === 1);

  const centreText = await page.getByTestId("sensor-center-1").innerText();
  const [cx, cy] = centreText.split(",").map((v) => Number(v.trim()));
  const mapBox = await contentBox(map);
  const ringBox = await sensorRing.boundingBox();
  const expectedX = mapBox.left + (cx + 0.5) * mapBox.scale;
  const expectedY = mapBox.top + (cy + 0.5) * mapBox.scale;
  const dx = Math.abs(ringBox.x + ringBox.width / 2 - expectedX);
  const dy = Math.abs(ringBox.y + ringBox.height / 2 - expectedY);
  check("sensor highlight centred on reported centre (<=1px)", dx <= 1 && dy <= 1, `dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);

  await page.getByTestId("supply-card-1").hover();
  check("hover supply card boxes the segment", (await chapter.getByTestId("highlight-supply").count()) === 1);

  for (const view of ["sensor_zones", "supply_zones", "final_analysis"]) {
    await page.getByTestId(`map-view-${view}`).click();
    await page.waitForTimeout(200);
    check(`map view ${view} selected`, (await page.getByTestId(`map-view-${view}`).getAttribute("aria-selected")) === "true");
    await chapter.screenshot({ path: `screenshots/drop-zones-${view}.png` });
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
  check("all-water: empty drop-zone state", await page.getByText("No probable drop zone identified").first().isVisible());
  await page.locator('[aria-label="Probable drop zones"]').screenshot({ path: "screenshots/empty-drop-zones.png" });

  // ------------------------------------------------ small sensor zone
  await fresh();
  await analyse("fixtures/small-island.png");
  const smallSensor = await page.locator('[data-testid^="sensor-card-"]').count();
  const smallNotViable = await page.locator('[data-testid^="not-viable-"]').count();
  check("small island: sensor zone or not-viable card shown", smallSensor + smallNotViable === 1, `${smallSensor}/${smallNotViable}`);
  check("small island: supply band shown around the shore", (await page.locator('[data-testid^="supply-card-"]').count()) > 0);
  await page.locator('[aria-label="Probable drop zones"]').screenshot({ path: "screenshots/small-island.png" });

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

  // An older backend (no sensor_zones / supply_zone) must fail cleanly, not crash the page.
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
