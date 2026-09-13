"""
AASRA — central configuration.

Every tunable threshold used by the computer-vision pipeline lives here so that
behaviour can be adjusted without touching algorithm code.

IMPORTANT SEMANTICS
-------------------
All distances/areas expressed in "px" refer to pixels of the *processed*
(resized) image, not the original upload and NOT real-world metres.
The pipeline is a decision-support prototype: nothing here encodes safety.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Upload / input validation
# ---------------------------------------------------------------------------

#: Accepted upload extensions (lower-case, with dot).
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}

#: Accepted MIME types for the multipart upload.
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}

#: Hard limit on upload size. Requests above this are rejected before decoding.
MAX_FILE_SIZE_MB = 15

#: Smallest accepted image edge (px). Anything smaller carries no usable structure.
MIN_IMAGE_DIMENSION = 64

#: Longest edge of the processed image (px). Larger uploads are downscaled
#: while preserving aspect ratio. Keeps runtime and pixel thresholds stable.
MAX_IMAGE_DIMENSION = 1024

# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

#: Apply a light Gaussian blur to the *analysis copy* only (noise suppression).
USE_GAUSSIAN_BLUR = True

#: Gaussian kernel size (odd). Deliberately small — do not over-smooth.
GAUSSIAN_KERNEL_SIZE = 5

#: Apply CLAHE on the LAB L-channel of the analysis copy (local contrast).
USE_CLAHE = True

#: CLAHE clip limit and tile grid. Modest values avoid amplifying noise.
CLAHE_CLIP_LIMIT = 2.0
CLAHE_TILE_GRID_SIZE = 8

# ---------------------------------------------------------------------------
# Water detection — multi-stage heuristic (see services/water_detection.py)
# ---------------------------------------------------------------------------

# -- Stage A: blue / clear water -------------------------------------------
#: OpenCV hue range (0-179) considered "blue-cyan".
BLUE_HUE_MIN = 85
BLUE_HUE_MAX = 135
#: Minimum saturation for a blue pixel to count as a water candidate.
BLUE_MIN_SATURATION = 35
#: Minimum brightness (V) for blue water candidates.
BLUE_MIN_VALUE = 25
#: Blue channel must exceed max(G, R) by at least this much (blue dominance).
BLUE_DOMINANCE_MIN = 6

# -- Stage B: muddy / turbid (brown-yellow) water ---------------------------
#: Hue range covering brown/ochre turbid water.
TURBID_HUE_MIN = 5
TURBID_HUE_MAX = 35
#: Saturation window — turbid water is coloured but rarely vivid.
TURBID_MIN_SATURATION = 25
TURBID_MAX_SATURATION = 215
#: Brightness window for turbid water.
#: NOTE: heavily sediment-laden water is BRIGHT — measured V = 200-250 on real
#: aerial imagery. The previous 225 ceiling silently excluded exactly the
#: muddy floodwater this stage exists to find, so it now reaches full range.
TURBID_MIN_VALUE = 35
TURBID_MAX_VALUE = 255

# -- Stage C: dark / shadowed water -----------------------------------------
#: Pixels darker than this V are dark-water candidates.
DARK_MAX_VALUE = 70
#: Dark water is usually weakly saturated.
DARK_MAX_SATURATION = 110

# -- Stage D: low-saturation / reflective (grey, sky-reflecting) water ------
LOW_SAT_MAX_SATURATION = 45
LOW_SAT_MIN_VALUE = 55
LOW_SAT_MAX_VALUE = 235

# -- Support cue 1: luminance texture (smoothness) ---------------------------
#: Window size for the local standard-deviation (texture) estimate.
TEXTURE_WINDOW = 9
#: Graded smoothness ramp on local luminance std-dev. Full support at or below
#: MIN, no support at or above MAX, linear in between.
#: Values are wide because the analysis copy is CLAHE-enhanced, which inflates
#: local std: real floodwater measures 3-30 here, not the 0-12 a raw image gives.
TEXTURE_SMOOTH_MIN_STD = 10.0
TEXTURE_SMOOTH_MAX_STD = 34.0

# -- Support cue 2: local chromatic homogeneity ------------------------------
#: Window for the local std-dev of the Lab a*/b* (colour-opponent) channels.
#: This is the strongest muddy-water / brown-land discriminator available from
#: RGB alone: a water surface holds one sediment colour across a whole body, so
#: its *colour* stays constant even where waves make its *brightness* vary.
#: Roof tiles, soil and vegetation vary in colour at small scale.
#: Measured on real aerial imagery: floodwater 1-12, terracotta roofs 12-20.
CHROMA_WINDOW = 15
CHROMA_HOMOGENEOUS_MIN = 6.0
CHROMA_HOMOGENEOUS_MAX = 16.0

# -- Support cue 3: freedom from structural edges ----------------------------
#: Canny thresholds and the window over which edge density is averaged.
#: Buildings, roads and field boundaries carry long coherent edges; open water
#: carries few, even when its surface is disturbed.
EDGE_CANNY_LOW = 60
EDGE_CANNY_HIGH = 150
EDGE_DENSITY_WINDOW = 15
EDGE_DENSITY_MIN = 0.05
EDGE_DENSITY_MAX = 0.22

#: Relative weight of the three support cues (must sum to 1.0).
#: Chosen by sweeping them over the available real imagery and the synthetic
#: land scenes. Luminance smoothness is deliberately the weakest of the three:
#: measured water (std 3-30) and measured roofs (std 21-29) overlap almost
#: completely, so on its own it separates very little. Edge freedom carries
#: more weight because cultivated and built land is defined by linear
#: structure that open water does not have.
SUPPORT_WEIGHT_CHROMA = 0.40
SUPPORT_WEIGHT_SMOOTH = 0.20
SUPPORT_WEIGHT_EDGE = 0.40

# -- Vegetation veto ---------------------------------------------------------
#: Green hue band used to penalise vegetation (a common false positive).
VEGETATION_HUE_MIN = 36
VEGETATION_HUE_MAX = 84
VEGETATION_MIN_SATURATION = 45
#: Excess-green index (2G - R - B on normalised channels) above which a pixel is
#: treated as fully vegetated. Catches vegetation whose hue is unstable.
VEGETATION_EXG_MIN = 0.02
VEGETATION_EXG_MAX = 0.14
WATER_WEIGHT_VEGETATION_PENALTY = 0.45

# -- Evidence combination ----------------------------------------------------
# Colour tells us what a pixel *could* be; the support cues decide whether it
# behaves like a water surface. The two are combined multiplicatively:
#
#     likelihood_c = strength_c * (floor_c + (1 - floor_c) * support)
#     likelihood   = max over cues c, minus the vegetation penalty
#
# `floor_c` is how much of a cue survives with NO supporting evidence, i.e. how
# trustworthy that colour is on its own. Blue-dominant water is highly specific,
# so it needs almost no support. Brown is shared with soil, tile and dry
# terrain, so it is deliberately given almost no standing of its own — a brown
# pixel becomes water only when the support cues agree. This is what stops the
# detector from labelling ordinary brown land as floodwater.
#
# Floors are set so that each cue still needs a minimum amount of support to
# clear WATER_LIKELIHOOD_THRESHOLD at full colour strength:
#     floor = (threshold - required_support) / (1 - required_support)
# giving roughly: blue 0.25, dark 0.35, low-saturation 0.38, brown 0.42.
SUPPORT_FLOOR_BLUE = 0.27
SUPPORT_FLOOR_TURBID = 0.05
SUPPORT_FLOOR_DARK = 0.15
SUPPORT_FLOOR_LOW_SAT = 0.12

#: A pixel is water when its combined likelihood reaches this threshold (0-1).
WATER_LIKELIHOOD_THRESHOLD = 0.45

# -- Region-level verification ------------------------------------------------
# Per-pixel decisions are noisy; whole regions are far more informative. After
# morphology, each connected component is re-checked against the support map.
# A component is rejected only when it is BOTH weakly supported AND small —
# smallness alone never rejects a region, so genuine small flooded pockets
# survive.
REGION_MIN_MEAN_SUPPORT = 0.22
#: Area (as a fraction of the image) at or above which a region is kept
#: regardless of mean support, on spatial-continuity grounds.
REGION_LARGE_AREA_FRACTION = 0.02

# -- Morphological cleanup / component filtering -----------------------------
#: Kernel size for opening (despeckle) and closing (hole bridging).
WATER_MORPH_OPEN_KERNEL = 3
WATER_MORPH_CLOSE_KERNEL = 7
#: Connected water blobs smaller than this (px) are discarded as noise.
MIN_WATER_COMPONENT_AREA = 400
#: Holes inside water smaller than this (px) are filled.
MAX_WATER_HOLE_AREA = 300

# ---------------------------------------------------------------------------
# Water safety buffer (Phase 4)
# ---------------------------------------------------------------------------

#: Dilation radius (px) applied to the water mask to create spatial clearance
#: around water. PIXEL-BASED ONLY — this is not metres.
WATER_BUFFER_SIZE = 18

# ---------------------------------------------------------------------------
# Candidate regions / connected components
# ---------------------------------------------------------------------------

#: Kernel used to clean the candidate mask before component labelling.
CANDIDATE_MORPH_KERNEL = 5
#: Candidate regions smaller than this (px) are rejected outright.
MIN_REGION_AREA = 1500
#: Candidate regions whose maximum inner clearance is below this (px) are
#: rejected — they are slivers rather than usable open areas.
MIN_REGION_CLEARANCE = 6

# ---------------------------------------------------------------------------
# Potentially isolated land regions (Phase 9)
# ---------------------------------------------------------------------------

#: Minimum area (px) for a disconnected land component to be reported.
MIN_ISOLATED_AREA = 800
#: Separation distance (px) at which the separation sub-score saturates.
ISOLATION_SEPARATION_SATURATION_PX = 120
#: Weights of the three isolation sub-features (must sum to 1.0).
ISOLATION_WEIGHT_WATER_CONTACT = 0.45
ISOLATION_WEIGHT_SEPARATION = 0.35
ISOLATION_WEIGHT_RELATIVE_SIZE = 0.20
#: Classification bands for the 0-100 isolation score.
ISOLATION_HIGH_MIN = 80
ISOLATION_MODERATE_MIN = 50

# ---------------------------------------------------------------------------
# Zone scoring (Phase 10)
# ---------------------------------------------------------------------------

#: Scoring weights. Must sum to 1.0.
SCORE_WEIGHT_AREA = 0.40
SCORE_WEIGHT_WATER_CLEARANCE = 0.40
SCORE_WEIGHT_OPENNESS = 0.20

#: Region area (as a fraction of the processed image) at which area_score = 100.
AREA_SCORE_SATURATION_FRACTION = 0.06
#: Pixel clearance at which water_clearance_score = 100.
CLEARANCE_SCORE_SATURATION_PX = 70.0

#: Openness sub-feature weights (must sum to 1.0) — see region_analysis.py.
OPENNESS_WEIGHT_CLEARANCE = 0.50
OPENNESS_WEIGHT_COMPACTNESS = 0.30
OPENNESS_WEIGHT_EXTENT = 0.20

#: Classification bands for the 0-100 zone score.
SCORE_HIGH_MIN = 80
SCORE_MODERATE_MIN = 60
SCORE_LOW_MIN = 40

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

#: Maximum number of ranked zones returned by /api/analyze.
MAX_ZONES = 3

#: PNG compression level (0-9) for the base64 visualisations.
PNG_COMPRESSION = 6

#: Include the (possibly large) base64 images in the response.
INCLUDE_IMAGES = True

# ---------------------------------------------------------------------------
# Application metadata
# ---------------------------------------------------------------------------

APP_NAME = "AASRA"
APP_TITLE = "AASRA — AI-Assisted Relief Area Identification"
APP_VERSION = "0.1.0"
APP_DESCRIPTION = (
    "Computer-vision decision-support prototype. Identifies floodwater, "
    "non-water land, candidate supply-drop regions and potentially isolated "
    "land regions in aerial flood imagery. Output is advisory only."
)

#: Analysis mode flags surfaced in the API response.
ANALYSIS_MODE = {"opencv": True, "ai": False}
