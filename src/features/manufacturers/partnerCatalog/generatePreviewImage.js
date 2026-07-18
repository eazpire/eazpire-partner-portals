/**
 * Admin Catalog Editor — Generate Preview Images from mockups via Replicate Seedream 4.5.
 * Generate returns a temporary Replicate output URL; Save persists into preview_images (MOCKUP_R2 + D1).
 */

import { MOCKUP_SET_PREVIEW_IMAGES } from "./mockupSet.js";
import { persistCatalogMockupImageBytes } from "./uploadCatalogMockupImage.js";
import { fetchUrlToBytes } from "../../artifacts/replicateImage.js";
import {
  getReplicateApiToken,
  PARTNER_REPLICATE_API_TOKEN_MISSING_HINT,
} from "../../../utils/replicateEnv.js";

const SEEDREAM_MODEL = "bytedance/seedream-4.5";
const MAX_PROMPT = 4000;

/**
 * Run Seedream 4.5 with prompt + one reference mock image.
 * @returns {{ ok: true, image_url: string, model: string } | { ok: false, error: string, message?: string }}
 */
export async function generatePreviewImage(env, { prompt, imageUrl }) {
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, error: "missing_prompt", message: "Prompt is required." };
  if (text.length > MAX_PROMPT) {
    return { ok: false, error: "prompt_too_long", message: `Prompt max ${MAX_PROMPT} characters.` };
  }

  const ref = String(imageUrl || "").trim();
  if (!ref.startsWith("http")) {
    return { ok: false, error: "missing_image_url", message: "Select a mockup image first." };
  }

  const token = getReplicateApiToken(env);
  if (!token) {
    return {
      ok: false,
      error: "replicate_not_configured",
      message: PARTNER_REPLICATE_API_TOKEN_MISSING_HINT,
    };
  }

  try {
    const outputUrl = await runSeedream45(token, {
      prompt: text,
      image_input: [ref],
      size: "2K",
      aspect_ratio: "match_input_image",
      sequential_image_generation: "disabled",
    });
    return { ok: true, image_url: outputUrl, model: SEEDREAM_MODEL };
  } catch (err) {
    console.error("[generatePreviewImage]", err?.message || err);
    return {
      ok: false,
      error: "generation_failed",
      message: String(err?.message || err || "Generation failed").slice(0, 400),
    };
  }
}

/**
 * Download a generated image URL and store it in the Preview Images set.
 */
export async function saveGeneratedPreviewImage(env, {
  productKey,
  imageUrl,
  printProviderId = 0,
  viewKey,
  colorName = "Generated",
}) {
  const pk = String(productKey || "").trim();
  const url = String(imageUrl || "").trim();
  if (!pk) return { ok: false, error: "missing_product_key" };
  if (!url.startsWith("http")) return { ok: false, error: "missing_image_url" };

  let bytes;
  try {
    bytes = await fetchUrlToBytes(url);
  } catch (err) {
    return {
      ok: false,
      error: "fetch_failed",
      message: String(err?.message || "Could not download generated image").slice(0, 300),
    };
  }

  const mime = guessMimeFromUrl(url) || "image/png";
  return persistCatalogMockupImageBytes(env, {
    productKey: pk,
    mockupSet: MOCKUP_SET_PREVIEW_IMAGES,
    bytes,
    mime,
    viewKey: viewKey || `generated_${Date.now().toString(36)}`,
    colorName: colorName || "Generated",
    printProviderId,
  });
}

async function runSeedream45(token, input) {
  const waitSec = 55;
  const createRes = await fetch(`https://api.replicate.com/v1/models/${SEEDREAM_MODEL}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: `wait=${waitSec}`,
    },
    body: JSON.stringify({ input }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Replicate error ${createRes.status}: ${errText.slice(0, 300)}`);
  }

  const prediction = await createRes.json();
  let output = prediction.output;

  if (!output && prediction.urls?.get) {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await poll.json();
      if (data.status === "succeeded") {
        output = data.output;
        break;
      }
      if (data.status === "failed" || data.status === "canceled") {
        throw new Error(data.error || "generation_failed");
      }
    }
  }

  const imageUrl = Array.isArray(output) ? output[0] : output;
  if (!imageUrl || typeof imageUrl !== "string") throw new Error("no_output_url");
  return imageUrl;
}

function guessMimeFromUrl(url) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png")) return "image/png";
  return "image/png";
}
