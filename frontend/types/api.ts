/**
 * TypeScript definitions mirroring the REAL AASRA backend responses.
 *
 * Derived by inspecting:
 *   backend/app/main.py       (GET /health, POST /api/analyze, error envelope)
 *   backend/app/pipeline.py   (the analysis payload that /api/analyze returns)
 *   backend/app/services/*    (classification strings, score breakdown fields)
 *
 * Nothing here is invented. Every field below exists in the backend payload.
 */

/** `analysis_mode` — config.ANALYSIS_MODE, surfaced by /health and /api/analyze. */
export interface AnalysisMode {
  opencv: boolean;
  ai: boolean;
}

/* -------------------------------------------------------------------------- */
/* GET /health                                                                */
/* -------------------------------------------------------------------------- */

export interface HealthLimits {
  max_file_size_mb: number;
  max_image_dimension: number;
  allowed_extensions: string[];
  max_zones: number;
}

export interface HealthResponse {
  success: true;
  status: string;
  service: string;
  version: string;
  analysis_mode: AnalysisMode;
  limits: HealthLimits;
}

/* -------------------------------------------------------------------------- */
/* POST /api/analyze — success payload                                        */
/* -------------------------------------------------------------------------- */

export interface ImageInfo {
  original_width: number;
  original_height: number;
  processed_width: number;
  processed_height: number;
  /** processed / original. Multiply back to map to original coordinates. */
  scale: number;
}

export interface ScoreWeights {
  area: number;
  water_clearance: number;
  openness: number;
}

export interface DropScoreWeights {
  clearance: number;
  water_clearance: number;
  proximity: number;
}

/** config.py storage / drop-zone settings used for this run. */
export interface StorageParameters {
  radius_margin_px: number;
  min_radius_px: number;
  max_radius_px: number;
  drop_zone_radius_px: number;
  min_drop_point_distance_px: number;
  max_drop_points_per_storage_zone: number;
  drop_score_weights: DropScoreWeights;
}

export interface AnalysisParameters {
  water_buffer_px: number;
  min_region_area_px: number;
  min_isolated_area_px: number;
  max_zones: number;
  storage: StorageParameters;
  score_weights: ScoreWeights;
}

export interface AnalysisMetrics {
  water_percentage: number;
  non_water_percentage: number;
  /** Total candidate regions found — may exceed `zones.length` (capped at max_zones). */
  candidate_regions: number;
  isolated_regions: number;
  /** Ranked zones that produced a probable storage zone. */
  storage_zones: number;
  /** Probable drop zones across all storage zones. */
  drop_zones: number;
  candidate_area_percentage: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** scoring.classify_score() — the only four values the backend emits. */
export type ZoneClassification =
  | "HIGH POTENTIAL"
  | "MODERATE POTENTIAL"
  | "LOW POTENTIAL"
  | "NOT RECOMMENDED";

export interface ZoneScoreBreakdown {
  area_score: number;
  water_clearance_score: number;
  openness_score: number;
}

export interface Zone {
  id: number;
  /** 0-100 weighted score. */
  score: number;
  classification: ZoneClassification;
  /** Processed-image pixels — never metres. */
  pixel_area: number;
  water_clearance: number;
  region_clearance: number;
  bounding_box: BoundingBox;
  centroid: Point;
  drop_point: Point;
  score_breakdown: ZoneScoreBreakdown;
}

/* -------------------------------------------------------------------------- */
/* Probable storage zones / probable drop zones (services/storage_zones.py)    */
/* -------------------------------------------------------------------------- */

export interface DropZoneScoreBreakdown {
  /** min(1, clearance / storage radius) * 100 */
  clearance_score: number;
  /** min(1, water clearance / saturation) * 100 */
  water_clearance_score: number;
  /** (1 - distance from centre / storage radius) * 100 */
  proximity_score: number;
}

/** One probable drop zone: a small circle around an exact drop point. */
export interface DropZone {
  id: number;
  point: Point;
  radius_px: number;
  /** 0-100 spatial drop-point score — separate from the zone score. */
  score: number;
  classification: ZoneClassification;
  /** Distance to the nearest excluded pixel or image edge. */
  clearance_px: number;
  /** Distance to the nearest detected water pixel. */
  water_clearance_px: number;
  distance_from_storage_center_px: number;
  score_breakdown: DropZoneScoreBreakdown;
}

export type LimitingFactor =
  | "water_buffer"
  | "candidate_boundary"
  | "image_boundary"
  | "max_radius";

export type RejectionReason =
  | "outside_image"
  | "outside_storage_zone"
  | "water"
  | "water_buffer"
  | "outside_candidate_region"
  | "insufficient_clearance";

export interface RejectedPoint {
  x: number;
  y: number;
  reason: RejectionReason;
}

/**
 * One probable storage zone. `id` equals `zone_id`, the ranked zone it
 * extends; `score` and `classification` are that zone's.
 */
export interface StorageZone {
  id: number;
  zone_id: number;
  score: number;
  classification: ZoneClassification;
  /** The ranked zone's max-clearance point, unchanged. */
  center: Point;
  radius_px: number;
  limiting_factor: LimitingFactor;
  /** Distance from the centre to the limiting pixel, before the margin. */
  limiting_distance_px: number;
  /** Null when the radius cap was the limit. */
  limiting_point: Point | null;
  water_clearance_px: number;
  sampled_points: number;
  sampling_ring_radii_px: number[];
  candidate_drop_zones: DropZone[];
  rejected_points: RejectedPoint[];
}

export type NotViableReason =
  | "radius_below_minimum"
  | "center_in_excluded_area"
  | "duplicate_center";

export interface StorageAnalysis {
  evaluated: number;
  viable: number;
  not_viable: { zone_id: number; reason: NotViableReason; radius_px: number }[];
}

/** isolated_regions.classify_isolation() — the only three values emitted. */
export type IsolationClassification =
  | "HIGH ISOLATION"
  | "MODERATE ISOLATION"
  | "LOW ISOLATION";

export interface IsolationScoreBreakdown {
  /** 0..1 share of the region border touching water. */
  water_contact_ratio: number;
  /** Pixel distance to the largest land component. */
  separation_px: number;
  /** 0..1, larger = smaller relative to the main landmass. */
  relative_size: number;
}

export interface IsolatedRegion {
  id: number;
  isolation_score: number;
  classification: IsolationClassification;
  pixel_area: number;
  bounding_box: BoundingBox;
  centroid: Point;
  score_breakdown: IsolationScoreBreakdown;
}

/**
 * The six visualisations from services/visualization.py, plus ai_context.
 * Each value is a RAW base64 PNG string (no `data:` prefix) — see toDataUrl().
 * An empty string means the backend could not encode that view.
 */
export interface AnalysisImages {
  original: string;
  water_mask: string;
  candidate_mask: string;
  /** How each storage zone and its drop zones were derived. */
  drop_zones: string;
  isolated_regions: string;
  final_analysis: string;
  /** Present only when AI inference actually succeeded for this request. */
  ai_context: string;
}

export type AnalysisImageKey = keyof AnalysisImages;

/** Pixel box in processed-image coordinates — same space as `image_info`. */
export interface AIBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * One YOLO detection. A label + confidence only — detecting a "person" or
 * "car" is not evidence of a flood victim, a stranded person, or a rescue
 * asset. It is visible-object context only.
 */
export interface AIDetection {
  label: string;
  /** 0..1 model confidence. */
  confidence: number;
  bbox: AIBoundingBox;
}

/** Per-class detection counts. Only classes YOLO11n actually supports appear. */
export interface AIDetectionCounts {
  person?: number;
  car?: number;
  truck?: number;
  bus?: number;
  boat?: number;
  motorcycle?: number;
  bicycle?: number;
}

/**
 * services/ai_detection.py — optional, supplementary object-detection
 * context (YOLO11n). `status` is "active" only when the model loaded AND
 * inference succeeded for this request; otherwise "unavailable" with a
 * safe, generic `message`. `detections` can legitimately be an empty array
 * while `status` is "active" — AI success and "found something" are
 * different things.
 */
export interface AIContext {
  status: "active" | "unavailable";
  message: string;
  model?: string;
  detections?: AIDetection[];
  counts?: AIDetectionCounts;
}

export interface AnalysisResponse {
  success: true;
  analysis_mode: AnalysisMode;
  ai: AIContext;
  image_info: ImageInfo;
  parameters: AnalysisParameters;
  metrics: AnalysisMetrics;
  zones: Zone[];
  storage_zones: StorageZone[];
  storage_analysis: StorageAnalysis;
  isolated_regions: IsolatedRegion[];
  /** Non-fatal notes, e.g. "No water was detected in this image." */
  warnings: string[];
  images: AnalysisImages;
  notice: string;
}

/* -------------------------------------------------------------------------- */
/* Error envelope — main.py `_error()`                                        */
/* -------------------------------------------------------------------------- */

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
