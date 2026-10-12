import { FEATURE_CATEGORIES, type FeatureCategory, type Geometry } from "@lawnquoter/shared";

export type ImageryIntegrationEnv = Record<string, string | undefined>;

export type SegmentationFeature = { category: FeatureCategory; geometry: Geometry };

export type SegmentationClient = () => Promise<SegmentationFeature[]>;

const NEARMAP_OFF = "Not connected - add NEARMAP_API_KEY to enable";
const VEXCEL_OFF = "Not connected - add VEXCEL_API_KEY to enable";
const SEGMENTATION_OFF = "Not connected - add SEGMENTATION_API_KEY to enable";

function saved(key: string | undefined) {
  return Boolean(key?.trim());
}

/** HD imagery and segmentation stay off until that key is set. A key never places a network call by itself. */
export function imageryIntegrationStatus(env: ImageryIntegrationEnv) {
  return {
    nearmap: saved(env.NEARMAP_API_KEY)
      ? { connected: true, message: "Nearmap key saved. HD imagery stays off." }
      : { connected: false, message: NEARMAP_OFF },
    vexcel: saved(env.VEXCEL_API_KEY)
      ? { connected: true, message: "Vexcel key saved. HD imagery stays off." }
      : { connected: false, message: VEXCEL_OFF },
    segmentation: saved(env.SEGMENTATION_API_KEY)
      ? { connected: true, message: "Segmentation key saved. Segmentation stays off." }
      : { connected: false, message: SEGMENTATION_OFF },
  };
}

export type ImageryIntegrationStatus = ReturnType<typeof imageryIntegrationStatus>;

/**
 * One-click area prefill from an injected segmentation client.
 * With no client, this never calls the network, even when a key is present.
 */
export async function prefillFromSegmentation(deps: {
  key?: string;
  client?: SegmentationClient;
}): Promise<{ ok: true; features: SegmentationFeature[] } | { ok: false; error: string }> {
  if (!deps.key?.trim()) return { ok: false, error: SEGMENTATION_OFF };
  if (!deps.client) return { ok: false, error: "Segmentation stays off." };
  const features = (await deps.client()).filter(
    (item) =>
      FEATURE_CATEGORIES.includes(item.category) &&
      (item.geometry.type === "Polygon" || item.geometry.type === "MultiPolygon"),
  );
  if (features.length === 0) return { ok: false, error: "Segmentation returned no areas." };
  return { ok: true, features };
}
