import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const E2E_PROJECT_ID = "e2e-avatar-ep1";
const E2E_PROJECT_DIR = path.join(PROJECT_ROOT, "projects", E2E_PROJECT_ID);

function ensureE2EAvatarProject() {
  const scenesDest = path.join(E2E_PROJECT_DIR, "scenes.json");
  const npzDest = path.join(E2E_PROJECT_DIR, "siglip_embeddings.npz");
  const thumbsDest = path.join(E2E_PROJECT_DIR, "thumbnails");
  if (fs.existsSync(scenesDest) && fs.existsSync(npzDest) && fs.existsSync(thumbsDest)) {
    return;
  }

  fs.mkdirSync(thumbsDest, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(E2E_PROJECT_DIR, "project.json"),
    JSON.stringify(
      {
        id: E2E_PROJECT_ID,
        name: "E2E Avatar Ep1",
        created_at: now,
        updated_at: now,
        audio_file: null,
        user_prompt: "",
        audio_notes: [],
      },
      null,
      2
    )
  );

  // Seed from /tmp/avatar_ep1_* or projects/test1 if already analyzed
  const srcScenes = fs.existsSync("/tmp/avatar_ep1_scenes.json")
    ? "/tmp/avatar_ep1_scenes.json"
    : path.join(PROJECT_ROOT, "projects", "test1", "scenes.json");
  const srcNpz = fs.existsSync("/tmp/avatar_ep1_cache/siglip_embeddings.npz")
    ? "/tmp/avatar_ep1_cache/siglip_embeddings.npz"
    : path.join(PROJECT_ROOT, "projects", "test1", "siglip_embeddings.npz");
  const srcThumbs = fs.existsSync("/tmp/avatar_ep1_thumbs")
    ? "/tmp/avatar_ep1_thumbs"
    : path.join(PROJECT_ROOT, "projects", "test1", "thumbnails");

  if (!fs.existsSync(srcScenes) || !fs.existsSync(srcNpz) || !fs.existsSync(srcThumbs)) {
    throw new Error(
      "Missing pre-analyzed Episode 1 fixture (/tmp/avatar_ep1_* or projects/test1)."
    );
  }

  const catalog = JSON.parse(fs.readFileSync(srcScenes, "utf-8"));
  for (const s of catalog.scenes || []) {
    if (s.keyframe_path) {
      s.keyframe_path = `/cache/thumbnails/${path.basename(s.keyframe_path)}`;
    }
  }
  fs.writeFileSync(scenesDest, JSON.stringify(catalog, null, 2));
  fs.copyFileSync(srcNpz, npzDest);
  for (const f of fs.readdirSync(srcThumbs)) {
    if (f.endsWith(".jpg")) {
      fs.copyFileSync(path.join(srcThumbs, f), path.join(thumbsDest, f));
    }
  }
}

test.describe("Avatar Episode 1 Project & Vibe Search E2E", () => {
  test.beforeAll(() => {
    ensureE2EAvatarProject();
  });

  test("loads project, renders clip thumbnails, shows Vibe Search progress, and returns iceberg scenes", async ({
    page,
  }) => {
    await page.addInitScript((projectId) => {
      window.localStorage.setItem("amv_maker_active_project_id", projectId);
    }, E2E_PROJECT_ID);

    await page.goto("/");

    // Wait for project dropdown & Highlights tab with 491 scenes
    const highlightsTab = page.getByRole("button", { name: "Highlights (491)", exact: true });
    await expect(highlightsTab).toBeVisible();
    await highlightsTab.click();

    // Verify first visible clip thumbnails load cleanly (naturalWidth > 0)
    const firstThumb = page.locator("img[alt*='Avatar']").first();
    await expect(firstThumb).toBeVisible();
    await expect
      .poll(async () => {
        return await firstThumb.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
      })
      .toBe(true);

    // Trigger Vibe Search for "glowing blue iceberg beam of light"
    const searchInput = page.getByPlaceholder(/Search filenames, tags, or vibe/i);
    await searchInput.fill("glowing blue iceberg beam of light");
    const vibeButton = page.getByRole("button", { name: /^Vibe$/i });
    await vibeButton.click();

    // Verify in-progress feedback banner appears while SigLIP search runs
    await expect(page.getByTestId("vibe-search-status")).toBeVisible();

    // Wait for ranked results banner (25 matched clips)
    await expect(page.getByText(/AI Ranked: 25 clips matched/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("vibe-search-status")).toBeHidden();

    // Top result should be scene_id 95 (displayed as #96) with SigLIP similarity badge
    await expect(page.getByText(/#96\b/).first()).toBeVisible();
    await expect(page.getByText(/sim 0\.11/).first()).toBeVisible();

    // Verify matched result thumbnails also load
    const matchedThumb = page.locator("img[alt*='Avatar']").first();
    await expect(matchedThumb).toBeVisible();
    await expect
      .poll(async () => {
        return await matchedThumb.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
      })
      .toBe(true);

    // Save screenshot for visual verification
    await page.screenshot({ path: "/tmp/e2e_vibe_search_results.png", fullPage: false });

    // Click top matched card to preview it
    await matchedThumb.click();
    await expect(page.locator("video")).toBeVisible();

    // Reset ranking clears the query and restores the full list
    await page.getByRole("button", { name: /Reset ranking/i }).click();
    await expect(page.getByText("491/491")).toBeVisible();
    await expect(searchInput).toHaveValue("");
  });
});
