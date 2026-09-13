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

export interface AnalysisParameters {
  water_buffer_px: number;
  min_region_area_px: number;
  min_isolated_area_px: number;
  max_zones: number;
  score_weights: ScoreWeights;
}

export interface AnalysisMetrics {
  water_percentage: number;
  non_water_percentage: number;
  /** Total candidate regions found — may exceed `zones.length` (capped at max_zones). */
  candidate_regions: number;
  isolated_regions: number;
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
 * The five visualisations from services/visualization.py.
 * Each value is a RAW base64 PNG string (no `data:` prefix) — see toDataUrl().
 * An empty string means the backend could not encode that view.
 */
export interface AnalysisImages {
  original: string;
  water_mask: string;
  candidate_mask: string;
  isolated_regions: string;
  final_analysis: string;
}

export type AnalysisImageKey = keyof AnalysisImages;

export interface AnalysisResponse {
  success: true;
  analysis_mode: AnalysisMode;
  image_info: ImageInfo;
  parameters: AnalysisParameters;
  metrics: AnalysisMetrics;
  zones: Zone[];
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
