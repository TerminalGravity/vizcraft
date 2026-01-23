/**
 * Zod Validation Schemas
 *
 * Type-safe request validation for all API endpoints.
 * Provides security, automatic error messages, and documentation.
 */

import { z } from "zod";
import { createLogger } from "../logging";

const log = createLogger("validation");

// ==================== Constants ====================

/**
 * Validation limits to prevent abuse and ensure reasonable performance
 */
export const LIMITS = {
  // String lengths
  ID_MAX: 100,
  NAME_MAX: 500,
  LABEL_MAX: 1000,
  DETAILS_MAX: 5000,
  MESSAGE_MAX: 500,
  PROJECT_MAX: 200,

  // Array sizes
  MAX_NODES: 1000,
  MAX_EDGES: 5000,
  MAX_GROUPS: 100,
  MAX_MESSAGES: 500,
  MAX_RELATIONSHIPS: 500,
  MAX_ATTRIBUTES: 50,
  MAX_METHODS: 50,
  MAX_NODE_IDS_IN_GROUP: 500,

  // Numeric limits
  POSITION_MIN: -100000,
  POSITION_MAX: 100000,
  DIMENSION_MIN: 1,
  DIMENSION_MAX: 10000,

  // Thumbnail limits
  THUMBNAIL_MAX_LENGTH: 5 * 1024 * 1024, // 5MB base64
} as const;

// ==================== Base Schemas ====================

/**
 * Valid CSS color names (CSS Level 4 + common names)
 * Using a whitelist prevents accepting invalid names like "xyzabc"
 */
const CSS_COLOR_NAMES = new Set([
  // Basic colors
  "black", "silver", "gray", "grey", "white", "maroon", "red", "purple", "fuchsia",
  "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua",
  // Extended colors (most common)
  "aliceblue", "antiquewhite", "aquamarine", "azure", "beige", "bisque", "blanchedalmond",
  "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
  "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod",
  "darkgray", "darkgrey", "darkgreen", "darkkhaki", "darkmagenta", "darkolivegreen",
  "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue",
  "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "gainsboro", "ghostwhite", "gold", "goldenrod", "greenyellow", "honeydew", "hotpink",
  "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen",
  "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow",
  "lightgray", "lightgrey", "lightgreen", "lightpink", "lightsalmon", "lightseagreen",
  "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow",
  "limegreen", "linen", "magenta", "mediumaquamarine", "mediumblue", "mediumorchid",
  "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise",
  "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite",
  "oldlace", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen",
  "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum",
  "powderblue", "rebeccapurple", "rosybrown", "royalblue", "saddlebrown", "salmon",
  "sandybrown", "seagreen", "seashell", "sienna", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "thistle", "tomato", "turquoise",
  "violet", "wheat", "whitesmoke", "yellowgreen",
  // Special values
  "transparent", "currentcolor", "inherit",
]);

/**
 * Color validation - hex color or valid CSS color name
 */
export const ColorSchema = z.string().refine(
  (val) => {
    // Check hex format first (#RGB, #RRGGBB, #RRGGBBAA)
    if (/^#[0-9a-fA-F]{3,8}$/.test(val)) return true;
    // Check against whitelist of valid CSS color names (case-insensitive)
    return CSS_COLOR_NAMES.has(val.toLowerCase());
  },
  { message: "Invalid color format. Use hex (#RGB, #RRGGBB, #RRGGBBAA) or a valid CSS color name" }
);

/**
 * Position schema with reasonable bounds
 */
export const PositionSchema = z.object({
  x: z.number().min(LIMITS.POSITION_MIN).max(LIMITS.POSITION_MAX),
  y: z.number().min(LIMITS.POSITION_MIN).max(LIMITS.POSITION_MAX),
});

/**
 * Node shape - all supported shapes across diagram types
 */
export const NodeShapeSchema = z.enum([
  // General shapes
  "box", "diamond", "circle", "database", "cloud", "cylinder",
  // Sequence diagram shapes
  "actor", "lifeline", "activation",
  // ER diagram shapes
  "entity", "attribute", "relationship", "weak-entity",
  // State machine shapes
  "state", "initial", "final", "choice", "fork", "join",
  // Class diagram shapes
  "class", "interface", "abstract", "enum",
  // Mind map shapes
  "central", "branch", "topic",
  // Network shapes
  "server", "router", "switch", "firewall", "client", "internet",
]);

/**
 * Edge style
 */
export const EdgeStyleSchema = z.enum(["solid", "dashed", "dotted"]);

/**
 * Diagram type
 */
export const DiagramTypeSchema = z.enum([
  "flowchart",
  "architecture",
  "sequence",
  "er",
  "state",
  "class",
  "mindmap",
  "network",
  "freeform",
]);

/**
 * Valid diagram types as a Set for O(1) lookup validation
 * Typed as Set<string> to allow validation of arbitrary input strings
 */
export const VALID_DIAGRAM_TYPES: Set<string> = new Set(DiagramTypeSchema.options);

/**
 * Type for diagram type values
 */
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

/**
 * Theme
 */
export const ThemeSchema = z.enum(["dark", "light", "professional"]);

// ==================== Diagram Component Schemas ====================

/**
 * Diagram node with all optional extended properties
 */
export const DiagramNodeSchema = z.object({
  id: z.string().min(1).max(LIMITS.ID_MAX),
  label: z.string().min(1, "Node label is required").max(LIMITS.LABEL_MAX),
  type: NodeShapeSchema.optional(),
  color: ColorSchema.optional(),
  position: PositionSchema.optional(),
  details: z.string().max(LIMITS.DETAILS_MAX).optional(),
  width: z.number().min(LIMITS.DIMENSION_MIN).max(LIMITS.DIMENSION_MAX).optional(),
  height: z.number().min(LIMITS.DIMENSION_MIN).max(LIMITS.DIMENSION_MAX).optional(),
  // Extended properties
  stereotype: z.string().max(100).optional(),
  attributes: z.array(z.string().max(500)).max(LIMITS.MAX_ATTRIBUTES).optional(),
  methods: z.array(z.string().max(500)).max(LIMITS.MAX_METHODS).optional(),
  swimlane: z.string().max(200).optional(),
});

/**
 * Diagram edge
 */
export const DiagramEdgeSchema = z.object({
  id: z.string().max(LIMITS.ID_MAX).optional(),
  from: z.string().min(1).max(LIMITS.ID_MAX),
  to: z.string().min(1).max(LIMITS.ID_MAX),
  label: z.string().max(LIMITS.LABEL_MAX).optional(),
  style: EdgeStyleSchema.optional(),
  color: ColorSchema.optional(),
});

/**
 * Diagram group
 */
export const DiagramGroupSchema = z.object({
  id: z.string().min(1).max(LIMITS.ID_MAX),
  label: z.string().min(1, "Group label is required").max(LIMITS.LABEL_MAX),
  nodeIds: z.array(z.string().max(LIMITS.ID_MAX)).max(LIMITS.MAX_NODE_IDS_IN_GROUP),
  color: ColorSchema.optional(),
});

/**
 * Sequence diagram message
 */
export const SequenceMessageSchema = z.object({
  id: z.string().max(LIMITS.ID_MAX).optional(),
  from: z.string().min(1).max(LIMITS.ID_MAX),
  to: z.string().min(1).max(LIMITS.ID_MAX),
  label: z.string().max(LIMITS.LABEL_MAX),
  type: z.enum(["sync", "async", "return", "create", "destroy"]),
  order: z.number().int().min(0).max(10000),
});

/**
 * ER relationship with cardinality
 */
export const ERRelationshipSchema = z.object({
  id: z.string().max(LIMITS.ID_MAX).optional(),
  entity1: z.string().min(1).max(LIMITS.ID_MAX),
  entity2: z.string().min(1).max(LIMITS.ID_MAX),
  label: z.string().max(LIMITS.LABEL_MAX).optional(),
  cardinality: z.enum(["1:1", "1:N", "N:1", "N:M"]),
  participation1: z.enum(["total", "partial"]).optional(),
  participation2: z.enum(["total", "partial"]).optional(),
});

// ==================== Full Diagram Spec Schema ====================

/**
 * Complete diagram specification
 */
export const DiagramSpecSchema = z.object({
  type: DiagramTypeSchema,
  theme: ThemeSchema.optional(),
  title: z.string().max(LIMITS.NAME_MAX).optional(),
  nodes: z.array(DiagramNodeSchema).max(LIMITS.MAX_NODES),
  edges: z.array(DiagramEdgeSchema).max(LIMITS.MAX_EDGES),
  groups: z.array(DiagramGroupSchema).max(LIMITS.MAX_GROUPS).optional(),
  // Sequence diagram specific
  messages: z.array(SequenceMessageSchema).max(LIMITS.MAX_MESSAGES).optional(),
  // ER diagram specific
  relationships: z.array(ERRelationshipSchema).max(LIMITS.MAX_RELATIONSHIPS).optional(),
}).superRefine((spec, ctx) => {
  // Build nodeId Set once for all reference validations (performance optimization)
  const nodeIds = new Set(spec.nodes.map(n => n.id));

  // Validate edges reference existing nodes
  for (const edge of spec.edges) {
    if (!nodeIds.has(edge.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Edge references non-existent node: "${edge.from}"`,
        path: ["edges"],
      });
    }
    if (!nodeIds.has(edge.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Edge references non-existent node: "${edge.to}"`,
        path: ["edges"],
      });
    }
  }

  // Validate groups reference existing nodes
  if (spec.groups) {
    for (const group of spec.groups) {
      for (const nodeId of group.nodeIds) {
        if (!nodeIds.has(nodeId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Group "${group.id}" references non-existent node: "${nodeId}"`,
            path: ["groups"],
          });
        }
      }
    }
  }

  // Validate sequence messages reference existing nodes
  if (spec.messages) {
    for (const msg of spec.messages) {
      if (!nodeIds.has(msg.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sequence message references non-existent node: "${msg.from}"`,
          path: ["messages"],
        });
      }
      if (!nodeIds.has(msg.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sequence message references non-existent node: "${msg.to}"`,
          path: ["messages"],
        });
      }
    }
  }

  // Validate ER relationships reference existing nodes
  if (spec.relationships) {
    for (const rel of spec.relationships) {
      if (!nodeIds.has(rel.entity1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ER relationship references non-existent entity: "${rel.entity1}"`,
          path: ["relationships"],
        });
      }
      if (!nodeIds.has(rel.entity2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ER relationship references non-existent entity: "${rel.entity2}"`,
          path: ["relationships"],
        });
      }
    }
  }
});

// ==================== API Request Schemas ====================

/**
 * Create diagram request
 */
export const CreateDiagramRequestSchema = z.object({
  name: z.string().min(1, "Name is required").max(LIMITS.NAME_MAX).trim(),
  project: z.string().max(LIMITS.PROJECT_MAX).trim().optional(),
  spec: DiagramSpecSchema,
  isPublic: z.boolean().optional(),
});

/**
 * Update diagram request
 */
export const UpdateDiagramRequestSchema = z.object({
  spec: DiagramSpecSchema,
  message: z.string().max(LIMITS.MESSAGE_MAX).optional(),
});

/**
 * Fork diagram request
 */
export const ForkDiagramRequestSchema = z.object({
  name: z.string().max(LIMITS.NAME_MAX).trim().optional(),
  project: z.string().max(LIMITS.PROJECT_MAX).trim().optional(),
});

/**
 * Update thumbnail request
 */
/**
 * Safe MIME types for thumbnails (no SVG - can contain scripts)
 */
const SAFE_THUMBNAIL_PREFIXES = [
  "data:image/png",
  "data:image/jpeg",
  "data:image/jpg",
  "data:image/webp",
  "data:image/gif",
];

export const UpdateThumbnailRequestSchema = z.object({
  thumbnail: z.string()
    .min(1, "Thumbnail data URL is required")
    .max(LIMITS.THUMBNAIL_MAX_LENGTH, "Thumbnail too large (max 5MB)")
    .refine(
      (val) => SAFE_THUMBNAIL_PREFIXES.some(prefix => val.startsWith(prefix)),
      { message: "Thumbnail must be a valid image data URL (PNG, JPEG, WebP, or GIF)" }
    ),
});

/**
 * Apply layout request
 */
export const ApplyLayoutRequestSchema = z.object({
  algorithm: z.enum(["dagre", "elk-layered", "elk-force", "elk-radial", "grid", "circular"]),
  direction: z.enum(["DOWN", "RIGHT", "UP", "LEFT"]).optional(),
  spacing: z.object({
    nodeSpacing: z.number().min(10).max(500).optional(),
    edgeSpacing: z.number().min(5).max(200).optional(),
    layerSpacing: z.number().min(20).max(500).optional(),
  }).optional(),
  padding: z.number().min(0).max(200).optional(),
});

/**
 * Apply theme request
 */
export const ApplyThemeRequestSchema = z.object({
  themeId: z.string().min(1).max(100),
});

/**
 * Restore version request (URL params validated)
 */
export const VersionNumberSchema = z.coerce.number().int().positive();

// ==================== Query Parameter Schemas ====================

/**
 * List diagrams query params
 */
export const ListDiagramsQuerySchema = z.object({
  project: z.string().max(LIMITS.PROJECT_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  // Default is minimal response (no spec); use full=true for complete specs
  full: z.enum(["true", "false"]).optional().transform(val => val === "true"),
});

/**
 * Diff query params
 */
export const DiffQuerySchema = z.object({
  v1: z.coerce.number().int().positive().optional(),
  v2: z.coerce.number().int().positive().optional(),
});

/**
 * Timeline query params
 */
export const TimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ==================== Type Exports ====================

export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>;
export type SequenceMessage = z.infer<typeof SequenceMessageSchema>;
export type ERRelationship = z.infer<typeof ERRelationshipSchema>;
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;
export type CreateDiagramRequest = z.infer<typeof CreateDiagramRequestSchema>;
export type UpdateDiagramRequest = z.infer<typeof UpdateDiagramRequestSchema>;
export type ForkDiagramRequest = z.infer<typeof ForkDiagramRequestSchema>;
export type UpdateThumbnailRequest = z.infer<typeof UpdateThumbnailRequestSchema>;
export type ApplyLayoutRequest = z.infer<typeof ApplyLayoutRequestSchema>;
export type ApplyThemeRequest = z.infer<typeof ApplyThemeRequestSchema>;

// ==================== Validation Helpers ====================

/**
 * Validate and parse data, returning result with typed error
 */
export function validateRequest<T extends z.ZodType>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string; details: z.ZodIssue[] } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message
  const errorMessages = result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return {
    success: false,
    error: errorMessages.join("; "),
    details: result.error.issues,
  };
}

/**
 * Result of safe spec parsing
 */
export type SafeParseSpecResult =
  | { valid: true; spec: DiagramSpec; raw?: never }
  | { valid: false; spec: DiagramSpec; raw: unknown; errors: string[] };

/**
 * Safely parse and validate a diagram spec from JSON string
 *
 * This function:
 * 1. Parses the JSON string
 * 2. Validates against DiagramSpecSchema
 * 3. Returns the spec with validity info
 *
 * For database reads, this allows returning potentially corrupted data
 * while flagging it as invalid (for logging/monitoring purposes).
 *
 * @param json - JSON string to parse
 * @param context - Optional context for logging (e.g., "diagram:abc123")
 * @returns Parsed spec with validity status
 */
export function safeParseSpec(json: string, context?: string): SafeParseSpecResult {
  let parsed: unknown;

  // Step 1: Parse JSON
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    // JSON parse failure - this is a critical error
    // Return empty spec as fallback
    const errorMsg = err instanceof Error ? err.message : "Unknown JSON parse error";
    if (context) {
      log.error("JSON parse failed", { context, error: errorMsg });
    }
    const fallbackSpec: DiagramSpec = {
      type: "freeform",
      nodes: [],
      edges: [],
    };
    return {
      valid: false,
      spec: fallbackSpec,
      raw: json,
      errors: [`JSON parse error: ${errorMsg}`],
    };
  }

  // Step 2: Validate against schema
  const result = DiagramSpecSchema.safeParse(parsed);

  if (result.success) {
    return { valid: true, spec: result.data };
  }

  // Validation failed - return the raw parsed data cast to DiagramSpec
  // This allows existing data to continue working even if validation rules changed
  const errors = result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  if (context) {
    log.warn("Invalid spec", {
      context,
      errors: errors.slice(0, 3).join("; "),
      additionalErrors: errors.length > 3 ? errors.length - 3 : 0,
    });
  }

  // Return the raw parsed data as DiagramSpec (type assertion)
  // This is intentionally lenient to avoid breaking reads of old data
  return {
    valid: false,
    spec: parsed as DiagramSpec,
    raw: parsed,
    errors,
  };
}

/**
 * Parse spec with strict validation (throws on invalid)
 *
 * Use this for API input validation where invalid data should be rejected.
 *
 * @param json - JSON string to parse
 * @param context - Context for error messages
 * @throws Error if parsing or validation fails
 */
export function parseSpecStrict(json: string, context?: string): DiagramSpec {
  const result = safeParseSpec(json, context);

  if (!result.valid) {
    const errorContext = context ? ` (${context})` : "";
    throw new Error(`Invalid diagram spec${errorContext}: ${result.errors.join("; ")}`);
  }

  return result.spec;
}

/**
 * Create Hono middleware for request validation
 */
export function createValidator<T extends z.ZodType>(schema: T) {
  return async (data: unknown): Promise<z.infer<T>> => {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errorMessages = result.error.issues.map(issue => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      });
      throw new ValidationError(errorMessages.join("; "), result.error.issues);
    }
    return result.data;
  };
}

/**
 * Custom validation error for API responses
 */
export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  public readonly status = 400;

  constructor(
    message: string,
    public readonly details: z.ZodIssue[]
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
