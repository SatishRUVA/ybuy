import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.YBUY_SHOWCASE_URL ?? "http://127.0.0.1:4173/";
const captureDir = process.env.YBUY_SHOWCASE_CAPTURE_DIR;
const pages = [
  ["index.html", "gallery"],
  ["quiet-luxury.html", "quiet-luxury"],
  ["modern-minimal.html", "modern-minimal"],
  ["neighborhood-marketplace.html", "neighborhood-marketplace"],
  ["bold-contemporary.html", "bold-contemporary"],
  ["editorial-premium.html", "editorial-premium"],
  ["sophisticated-dark.html", "sophisticated-dark"],
  ["colorful-luxury.html", "colorful-luxury"],
  ["experimental.html", "experimental"],
];
const viewports = [
  { name: "small-mobile", width: 375, height: 812 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: viewports[4] });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
let checks = 0;

function pass(message) {
  checks += 1;
  console.log(`PASS ${message}`);
}

async function contrastAudit(selectors) {
  return page.evaluate((targets) => {
    const channels = (value) => {
      const values = (value.match(/[\d.]+/g) ?? []).map(Number);
      return value.trimStart().startsWith("color(srgb")
        ? values.map((channel, index) => index < 3 ? channel * 255 : channel)
        : values;
    };
    const luminance = (color) => {
      const [red, green, blue] = color.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const background = (element) => {
      const ancestors = [];
      for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      let color = [255, 255, 255];
      for (const node of ancestors) {
        const parts = channels(getComputedStyle(node).backgroundColor);
        if (parts.length < 3) continue;
        const alpha = parts.length >= 4 ? parts[3] : 1;
        color = parts.slice(0, 3).map((channel, index) => channel * alpha + color[index] * (1 - alpha));
      }
      return color;
    };
    const results = [];
    for (const selector of targets) {
      for (const element of document.querySelectorAll(selector)) {
        if (!element.getClientRects().length) continue;
        const foreground = channels(getComputedStyle(element).color);
        const surface = background(element);
        if (foreground.length < 3) continue;
        const values = [luminance(foreground.slice(0, 3)), luminance(surface)].sort((a, b) => a - b);
        const ratio = (values[1] + 0.05) / (values[0] + 0.05);
        const size = parseFloat(getComputedStyle(element).fontSize);
        const weight = parseInt(getComputedStyle(element).fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.67 && weight >= 700);
        results.push({ selector, ratio, minimum: large ? 3 : 4.5 });
      }
    }
    return results;
  }, selectors);
}

try {
  if (captureDir) await mkdir(captureDir, { recursive: true });

  for (const [file, name] of pages) {
    const response = await page.goto(new URL(file, baseUrl).href, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, `${file} should load`);
    await page.evaluate(async () => {
      for (const image of document.images) image.loading = "eager";
      await Promise.allSettled([...document.images].map((image) => image.decode()));
      await document.fonts.ready;
    });

    assert.equal(await page.locator("h1").count(), 1, `${file} should have one main heading`);
    assert.ok((await page.locator("h1").innerText()).trim(), `${file} should have a visible heading`);
    const structure = await page.evaluate(() => ({
      brokenImages: [...document.images]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.currentSrc),
      imagesWithoutDimensions: [...document.images]
        .filter((image) => !image.hasAttribute("width") || !image.hasAttribute("height")).length,
      unlabeledInputs: [...document.querySelectorAll("input")]
        .filter((input) => !input.name || !input.id || !document.querySelector(`label[for="${CSS.escape(input.id)}"]`)).length,
      unnamedButtons: [...document.querySelectorAll("button")]
        .filter((button) => !button.innerText.trim() && !button.getAttribute("aria-label")).length,
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
        .map((anchor) => anchor.getAttribute("href").slice(1))
        .filter((id) => !document.getElementById(id)),
    }));
    assert.deepEqual(structure.brokenImages, [], `${file} images should load`);
    assert.equal(structure.imagesWithoutDimensions, 0, `${file} images should declare dimensions`);
    assert.equal(structure.unlabeledInputs, 0, `${file} form controls should be labeled`);
    assert.equal(structure.unnamedButtons, 0, `${file} buttons should have names`);
    assert.deepEqual(structure.brokenAnchors, [], `${file} section links should resolve`);
    pass(`${file}: structure, images, and accessible names`);

    const smallTargets = await page.evaluate(() => [...document.querySelectorAll(
      "button, .site-brand, .site-header nav a, .site-footer a, .gallery-header nav a, .gallery-footer a, tbody th a",
    )]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ label: element.innerText.trim(), height: element.getBoundingClientRect().height }))
      .filter((element) => element.height < 44));
    assert.deepEqual(smallTargets, [], `${file} actionable controls should meet the 44px target`);
    pass(`${file}: primary touch targets meet 44px`);

    const contrastTargets = name === "gallery"
      ? [".gallery-header nav a", ".gallery-hero h1", ".hero-intro", ".section-heading h2", ".section-heading > p", ".card-copy h3", ".card-copy p", "tbody td", ".recommendation-copy p", ".recommendation .text-link"]
      : [".site-header nav a", ".hero h1", ".hero-lede", ".search-field label", ".search-field input", ".search-button", ".section-heading h2", ".listing-meta", ".listing-card h3", ".listing-price", ".sample-tag", ".save-button", ".steps span", ".owner-section p"];
    const contrast = await contrastAudit(contrastTargets);
    const lowContrast = contrast.filter((item) => item.ratio + 0.01 < item.minimum);
    assert.deepEqual(lowContrast, [], `${file} text contrast should meet WCAG AA`);
    pass(`${file}: sampled text contrast`);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const bounds = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(bounds.document <= bounds.viewport + 1, `${file} overflows at ${viewport.width}px: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.body <= bounds.viewport + 1, `${file} body overflows at ${viewport.width}px`);

      if (viewport.width <= 760 && name !== "gallery") {
        const overlappingCards = await page.evaluate(() => [...document.querySelectorAll("[data-listing-card]")].filter((card) => {
          const image = card.querySelector(".listing-image").getBoundingClientRect();
          const content = card.querySelector(".listing-content").getBoundingClientRect();
          return image.left < content.right && image.right > content.left && image.top < content.bottom && image.bottom > content.top;
        }).length);
        assert.equal(overlappingCards, 0, `${file} listing images and copy should not overlap at ${viewport.width}px`);
      }

      if (captureDir && viewport.name === "desktop") {
        await page.screenshot({ path: path.join(captureDir, `${name}-desktop.png`), fullPage: true, animations: "disabled" });
      }
      if (captureDir && viewport.name === "mobile") {
        await page.screenshot({ path: path.join(captureDir, `${name}-mobile.png`), fullPage: true, animations: "disabled" });
      }
    }
    pass(`${file}: no horizontal overflow at six viewport widths`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL(file, baseUrl).href, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({
      className: document.activeElement?.className,
      outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
      outlineWidth: parseFloat(getComputedStyle(document.activeElement).outlineWidth),
    }));
    assert.match(String(focus.className), /skip-link/, `${file} should put the skip link first in keyboard order`);
    assert.notEqual(focus.outlineStyle, "none", `${file} skip link should have visible focus`);
    assert.ok(focus.outlineWidth >= 2, `${file} focus indicator should be visible`);
    pass(`${file}: keyboard skip link and visible focus`);

    if (name !== "gallery") {
      const query = page.locator("[data-listing-search] input[name='q']");
      await query.fill("DeWalt");
      assert.equal(await page.locator("[data-listing-card]:visible").count(), 1, `${file} text search should filter`);
      await page.getByRole("button", { name: "Cameras", exact: true }).click();
      assert.equal(await page.locator("[data-listing-card]:visible").count(), 0, `${file} category and text filters should combine`);
      await query.fill("");
      assert.equal(await page.locator("[data-listing-card]:visible").count(), 1, `${file} category filter should remain active`);
      await page.locator("[data-filter='all']").click();
      await query.fill("not-a-sample-item");
      assert.equal(await page.locator("[data-listing-card]:visible").count(), 0, `${file} no-results search should filter`);
      assert.ok(await page.locator("[data-empty-state].is-visible").isVisible(), `${file} should show an empty state`);
      await query.fill("");
      await page.locator("[data-listing-card]:visible [data-save]").first().click();
      assert.equal(await page.locator("[data-listing-card]:visible [data-save]").first().getAttribute("aria-pressed"), "true", `${file} save action should toggle`);
      pass(`${file}: search, category filters, empty state, and save toggle`);
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page.evaluate(() => ({
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      transition: getComputedStyle(document.querySelector("a, button")).transitionDuration,
    }));
    assert.equal(motion.scroll, "auto", `${file} should disable smooth scrolling for reduced motion`);
    assert.ok(parseFloat(motion.transition) <= 0.001, `${file} should reduce motion durations`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    pass(`${file}: reduced-motion preference`);
  }

  const journeyScreens = ["search", "item", "checkout", "renter", "owner", "listing", "booking", "messages", "profile"];
  for (const screen of journeyScreens) {
    const response = await page.goto(new URL(`journey.html?screen=${screen}`, baseUrl).href, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, `journey ${screen} should load`);
    assert.equal(await page.locator(`[data-screen="${screen}"]:visible`).count(), 1, `journey ${screen} should be visible`);
    assert.equal(await page.locator(".journey-screen:visible h1").count(), 1, `journey ${screen} should have one visible heading`);

    const structure = await page.evaluate(() => ({
      unlabeledControls: [...document.querySelectorAll("input, select, textarea")]
        .filter((control) => !control.labels?.length && !control.getAttribute("aria-label")).length,
      unnamedButtons: [...document.querySelectorAll("button")]
        .filter((button) => !button.innerText.trim() && !button.getAttribute("aria-label")).length,
    }));
    assert.equal(structure.unlabeledControls, 0, `journey ${screen} controls should have accessible labels`);
    assert.equal(structure.unnamedButtons, 0, `journey ${screen} buttons should have accessible names`);

    for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        shortButtons: [...document.querySelectorAll("button, .journey-nav a")]
          .filter((control) => control.getClientRects().length && control.getBoundingClientRect().height < 44)
          .map((control) => control.innerText.trim()),
      }));
      assert.ok(layout.document <= layout.viewport + 1, `journey ${screen} overflows at ${viewport.width}px`);
      assert.deepEqual(layout.shortButtons, [], `journey ${screen} controls should meet the 44px touch target`);
      if (captureDir) {
        const viewportName = viewport.width < 600 ? "mobile" : "desktop";
        await page.screenshot({
          path: path.join(captureDir, `journey-${screen}-${viewportName}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    pass(`journey ${screen}: route, labels, responsive layout, and touch targets`);
  }

  await page.goto(new URL("journey.html?screen=search", baseUrl).href, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  assert.match(String(await page.evaluate(() => document.activeElement?.className)), /skip-link/, "journey should expose a keyboard skip link first");

  const directions = [
    "fresh-neighborhood",
    "quiet-luxury",
    "contemporary-commerce",
    "bold-creative",
    "editorial-lifestyle",
    "sophisticated-dark",
    "colorful-premium",
    "experimental-objects",
  ];
  const journeyContrastTargets = [
    ".journey-nav a",
    ".journey-screen h1",
    ".journey-listing h3",
    ".journey-listing p:not(.listing-overline)",
    ".listing-overline",
    ".listing-overline span",
    ".journey-listing strong",
    ".primary-button",
    ".secondary-button",
    ".text-button",
  ];
  for (const direction of directions) {
    await page.locator("[data-direction-select]").selectOption(direction);
    await page.waitForTimeout(180);
    assert.equal(await page.locator("[data-journey-app]").getAttribute("data-direction"), direction, `${direction} theme should apply`);
    const lowContrast = (await contrastAudit(journeyContrastTargets))
      .filter((item) => item.ratio + 0.01 < item.minimum);
    assert.deepEqual(lowContrast, [], `${direction} journey text should meet WCAG AA`);
  }
  await page.locator("[data-direction-select]").selectOption("fresh-neighborhood");
  await page.locator(".journey-nav a[data-screen-link='owner']").click();
  await page.getByRole("button", { name: "Approve sample request" }).click();
  assert.match(await page.locator("[data-request-status]").innerText(), /approved in this preview/, "owner approval should show its local-only result");
  assert.equal(await page.locator("[data-request-action]:disabled").count(), 2, "owner decision should prevent a second response");
  await page.locator(".journey-nav a[data-screen-link='renter']").click();
  await page.locator("[data-booking-filter='active']").click();
  assert.equal(await page.locator("[data-booking-row]:visible").count(), 1, "renter booking filters should narrow sample bookings");
  assert.equal(await page.locator("[data-booking-filter='active']").getAttribute("aria-pressed"), "true", "booking filter should expose its selected state");
  await page.locator(".journey-nav a[data-screen-link='search']").click();
  await page.getByLabel("Search items").fill("drill");
  await page.locator("#prototype-category").selectOption("Tools");
  assert.equal(await page.locator("[data-listing]:visible").count(), 1, "journey search and category filters should combine");
  await page.locator("[data-listing]:visible [data-save-item]").click();
  assert.equal(await page.locator("[data-listing]:visible [data-save-item]").getAttribute("aria-pressed"), "true", "journey save action should toggle");
  await page.locator(".journey-nav a[data-screen-link='item']").click();
  await page.locator("[name='end']").first().fill("2026-10-22");
  await page.getByRole("button", { name: "Review request" }).click();
  assert.match(await page.locator(".date-form .form-hint").innerText(), /after the start date/, "journey should reject an invalid date range");
  await page.locator("[name='end']").first().fill("2026-10-26");
  await page.getByRole("button", { name: "Review request" }).click();
  assert.equal(await page.locator(".journey-screen:visible").getAttribute("data-screen"), "checkout", "valid dates should open checkout preview");
  await page.locator(".checkbox-row input").check();
  await page.getByRole("button", { name: "Preview request confirmation" }).click();
  assert.match(await page.locator("[data-checkout-status]").innerText(), /No booking was created/, "checkout preview should not claim a real booking");
  await page.locator(".journey-nav a[data-screen-link='booking']").click();
  assert.equal(await page.locator("[data-booking-action='return']").isDisabled(), true, "return should stay unavailable before pickup");
  await page.locator("[data-booking-action='pickup']").click();
  assert.equal(await page.locator("[data-booking-action='return']").isEnabled(), true, "pickup should unlock return");
  await page.locator("[data-booking-action='return']").click();
  assert.equal(await page.locator("[data-review-link]").isVisible(), true, "return should unlock the review step");
  await page.locator(".journey-nav a[data-screen-link='messages']").click();
  await page.locator("#message-input").fill("Could you confirm the pickup window?");
  await page.getByRole("button", { name: "Add sample message" }).click();
  assert.equal(await page.locator(".message-bubble.from-me").last().innerText(), "Could you confirm the pickup window?", "message preview should append text safely");
  await page.locator(".journey-nav a[data-screen-link='profile']").click();
  await page.locator("[name='rating'][value='5']").check();
  await page.locator("#review-text").fill("Clear handoff and the sample item matched its details.");
  await page.getByRole("button", { name: "Preview review" }).click();
  assert.match(await page.locator("[data-review-status]").innerText(), /has not been published/, "review should remain a local preview");
  await page.locator(".journey-nav a[data-screen-link='listing']").click();
  await page.getByRole("button", { name: "Continue" }).click();
  assert.equal(await page.locator("[name='title']").evaluate((field) => field === document.activeElement), true, "listing wizard should focus its first invalid field");
  await page.locator("[name='title']").fill("Cordless drill kit");
  await page.locator("[data-listing-wizard] [name='category']").selectOption("Tools");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Description", { exact: true }).fill("A sample tool kit for home projects.");
  await page.locator("[name='condition']").selectOption("Good");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("[name='price']").fill("25");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("[name='area']").fill("Irving");
  await page.locator("[name='pickup']").fill("Arrange a public pickup point.");
  await page.getByRole("button", { name: "Save sample draft" }).click();
  assert.match(await page.locator("[data-wizard-status]").innerText(), /Nothing was published/, "listing wizard should not publish data");
  await page.locator("[data-direction-select]").selectOption("experimental-objects");
  await page.locator(".journey-nav a[data-screen-link='owner']").click();
  assert.equal(await page.locator("[data-journey-app]").getAttribute("data-direction"), "experimental-objects", "screen navigation should preserve the selected theme");
  assert.equal(new URL(page.url()).searchParams.get("direction"), "experimental-objects", "screen routes should preserve the theme in the URL");
  await page.goto(new URL("journey.html?screen=owner", baseUrl).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  assert.match(await page.locator("[data-request-status]").innerText(), /declined in this preview/, "owner decline should show its local-only result");
  pass("journey prototype: theme switching, search, dates, checkout safety, handover, messages, listing wizard, and review");

  assert.deepEqual(pageErrors, [], "Pages should not raise JavaScript errors");
  pass("No browser JavaScript errors");
  console.log(`\n${checks} checks passed across ${pages.length} concept/gallery pages and the journey prototype.`);
} finally {
  await browser.close();
}
