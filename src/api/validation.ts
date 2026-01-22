/**
 * Request Validation Middleware
 *
 * Provides type-safe validation for request bodies, query parameters,
 * and path parameters using Zod schemas.
 */

import { z, type ZodSchema, type ZodError } from "zod";
import type { Context, Next, MiddlewareHandler } from "hono";

/**
 * Standard validation error response format
 */
export interface ValidationErrorResponse {
  error: true;
  code: "VALIDATION_ERROR";
  message: string;
  details: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/**
 * Format Zod errors into a consistent structure
 */
function formatZodError(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => {
    const detail: ValidationErrorDetail = {
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    };

    // Add expected/received for type errors
    if (issue.code === "invalid_type" && "received" in issue) {
      detail.expected = issue.expected;
      detail.received = issue.received as string;
    }

    return detail;
  });
}

/**
 * Create validation error response
 */
function validationErrorResponse(
  details: ValidationErrorDetail[],
  target: "body" | "query" | "param"
): ValidationErrorResponse {
  const targetName = target === "body" ? "request body" : target === "query" ? "query parameters" : "path parameters";

  return {
    error: true,
    code: "VALIDATION_ERROR",
    message: `Invalid ${targetName}`,
    details,
  };
}

/**
 * Body validation middleware
 * Validates request body against a Zod schema
 */
export function validateBody<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{ Variables: { validatedBody: z.infer<T> } }> {
  return async (c, next) => {
    try {
      const body = await c.req.json();
      const result = schema.safeParse(body);

      if (!result.success) {
        const details = formatZodError(result.error);
        return c.json(validationErrorResponse(details, "body"), 400);
      }

      // Store validated data for handler access
      c.set("validatedBody", result.data);
      await next();
    } catch (err) {
      // JSON parse error
      if (err instanceof SyntaxError) {
        return c.json(
          {
            error: true,
            code: "VALIDATION_ERROR",
            message: "Invalid JSON in request body",
            details: [{ path: "(root)", message: "Could not parse JSON" }],
          },
          400
        );
      }
      throw err;
    }
  };
}

/**
 * Query parameter validation middleware
 * Validates query string against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{ Variables: { validatedQuery: z.infer<T> } }> {
  return async (c, next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);

    if (!result.success) {
      const details = formatZodError(result.error);
      return c.json(validationErrorResponse(details, "query"), 400);
    }

    c.set("validatedQuery", result.data);
    await next();
  };
}

/**
 * Path parameter validation middleware
 * Validates route parameters against a Zod schema
 */
export function validateParams<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{ Variables: { validatedParams: z.infer<T> } }> {
  return async (c, next) => {
    const params = c.req.param();
    const result = schema.safeParse(params);

    if (!result.success) {
      const details = formatZodError(result.error);
      return c.json(validationErrorResponse(details, "param"), 400);
    }

    c.set("validatedParams", result.data);
    await next();
  };
}

/**
 * Combined validation for body + params (common pattern)
 */
export function validateRequest<B extends ZodSchema, P extends ZodSchema>(config: {
  body?: B;
  params?: P;
}): MiddlewareHandler<{
  Variables: {
    validatedBody: B extends ZodSchema ? z.infer<B> : never;
    validatedParams: P extends ZodSchema ? z.infer<P> : never;
  };
}> {
  return async (c, next) => {
    // Validate params first (simpler, no async parsing)
    if (config.params) {
      const params = c.req.param();
      const result = config.params.safeParse(params);

      if (!result.success) {
        const details = formatZodError(result.error);
        return c.json(validationErrorResponse(details, "param"), 400);
      }

      c.set("validatedParams", result.data as z.infer<P>);
    }

    // Validate body
    if (config.body) {
      try {
        const body = await c.req.json();
        const result = config.body.safeParse(body);

        if (!result.success) {
          const details = formatZodError(result.error);
          return c.json(validationErrorResponse(details, "body"), 400);
        }

        c.set("validatedBody", result.data as z.infer<B>);
      } catch (err) {
        if (err instanceof SyntaxError) {
          return c.json(
            {
              error: true,
              code: "VALIDATION_ERROR",
              message: "Invalid JSON in request body",
              details: [{ path: "(root)", message: "Could not parse JSON" }],
            },
            400
          );
        }
        throw err;
      }
    }

    await next();
  };
}

// ============================================
// Common validation schemas
// ============================================

/**
 * Nanoid format validation (URL-safe characters: A-Za-z0-9_-)
 * Default length is 12 but we allow 8-21 for flexibility
 */
export const nanoidSchema = z
  .string()
  .min(8, "ID must be at least 8 characters")
  .max(21, "ID must be at most 21 characters")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "ID must contain only letters, numbers, underscores, or hyphens"
  );

/**
 * Diagram ID path parameter schema (nanoid format)
 */
export const diagramIdParamSchema = z.object({
  id: nanoidSchema,
});

/**
 * UUID path parameter schema
 * @deprecated Use diagramIdParamSchema for diagram IDs (which use nanoid, not UUID)
 */
export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid UUID format"),
});

/**
 * Pagination query parameters
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Sorting query parameters
 */
export const sortingSchema = z.object({
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
});

/**
 * Date range query parameters
 */
export const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Search query parameters
 */
export const searchSchema = z.object({
  q: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
});

/**
 * Diagram node schema (reusable)
 */
export const diagramNodeSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(500),
  type: z.enum(["box", "diamond", "circle", "database", "cloud", "cylinder"]).optional(),
  color: z.string().max(50).optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  details: z.string().max(2000).optional(),
});

/**
 * Diagram edge schema (reusable)
 */
export const diagramEdgeSchema = z.object({
  from: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
  label: z.string().max(200).optional(),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  color: z.string().max(50).optional(),
});

/**
 * Diagram group schema (reusable)
 */
export const diagramGroupSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  nodeIds: z.array(z.string().min(1).max(100)),
  color: z.string().max(50).optional(),
});

/**
 * Complete diagram spec schema
 */
export const diagramSpecSchema = z.object({
  type: z.enum(["flowchart", "architecture", "sequence", "freeform"]),
  theme: z.enum(["dark", "light", "professional"]).optional(),
  nodes: z.array(diagramNodeSchema).min(1).max(1000),
  edges: z.array(diagramEdgeSchema).max(5000).optional().default([]),
  groups: z.array(diagramGroupSchema).max(100).optional(),
});

/**
 * Create diagram request schema
 */
export const createDiagramSchema = z.object({
  name: z.string().min(1).max(200),
  project: z.string().max(200).optional(),
  spec: diagramSpecSchema,
});

/**
 * Update diagram request schema
 */
export const updateDiagramSchema = z.object({
  spec: diagramSpecSchema,
  message: z.string().max(500).optional(),
});

/**
 * Version parameter schema (for /diagrams/:id/versions/:version routes)
 */
export const versionParamSchema = z.object({
  id: nanoidSchema,
  version: z.coerce.number().int().min(1),
});

// Export type helpers
export type DiagramIdParams = z.infer<typeof diagramIdParamSchema>;
/** @deprecated Use DiagramIdParams instead */
export type UuidParams = z.infer<typeof uuidParamSchema>;
export type PaginationQuery = z.infer<typeof paginationSchema>;
export type SortingQuery = z.infer<typeof sortingSchema>;
export type CreateDiagramBody = z.infer<typeof createDiagramSchema>;
export type UpdateDiagramBody = z.infer<typeof updateDiagramSchema>;
export type VersionParams = z.infer<typeof versionParamSchema>;
