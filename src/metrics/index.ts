/**
 * Prometheus Metrics Module
 *
 * Exposes application metrics in Prometheus text format.
 * Tracks HTTP requests, database operations, and system health.
 */

/**
 * Metric types following Prometheus conventions
 */
type MetricType = "counter" | "gauge" | "histogram";

interface MetricValue {
  value: number;
  labels: Record<string, string>;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: Record<string, string>;
}

/**
 * Internal storage for metrics
 */
const counters = new Map<string, MetricValue[]>();
const gauges = new Map<string, MetricValue[]>();
const histograms = new Map<string, HistogramValue[]>();

/**
 * Default histogram buckets for latency measurements (ms)
 */
const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Metric definitions with descriptions
 */
const metricDefinitions: Record<string, { type: MetricType; help: string }> = {
  // HTTP metrics
  http_requests_total: {
    type: "counter",
    help: "Total number of HTTP requests",
  },
  http_request_duration_ms: {
    type: "histogram",
    help: "HTTP request latency in milliseconds",
  },
  http_request_size_bytes: {
    type: "histogram",
    help: "HTTP request body size in bytes",
  },
  http_response_size_bytes: {
    type: "histogram",
    help: "HTTP response body size in bytes",
  },

  // Database metrics
  db_operations_total: {
    type: "counter",
    help: "Total number of database operations",
  },
  db_operation_duration_ms: {
    type: "histogram",
    help: "Database operation latency in milliseconds",
  },
  db_errors_total: {
    type: "counter",
    help: "Total number of database errors",
  },

  // Diagram metrics
  diagrams_total: {
    type: "gauge",
    help: "Current total number of diagrams",
  },
  diagram_operations_total: {
    type: "counter",
    help: "Total diagram operations by type",
  },

  // MCP metrics
  mcp_tool_calls_total: {
    type: "counter",
    help: "Total MCP tool invocations",
  },
  mcp_tool_duration_ms: {
    type: "histogram",
    help: "MCP tool execution time in milliseconds",
  },
  mcp_tool_errors_total: {
    type: "counter",
    help: "Total MCP tool errors",
  },

  // System metrics
  process_memory_bytes: {
    type: "gauge",
    help: "Process memory usage in bytes",
  },
  process_uptime_seconds: {
    type: "gauge",
    help: "Process uptime in seconds",
  },

  // Circuit breaker metrics
  circuit_breaker_state: {
    type: "gauge",
    help: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
  },
  circuit_breaker_failures_total: {
    type: "counter",
    help: "Total circuit breaker failures",
  },
};

/**
 * Increment a counter metric
 */
export function incrementCounter(
  name: string,
  labels: Record<string, string> = {},
  amount: number = 1
): void {
  if (!counters.has(name)) {
    counters.set(name, []);
  }

  const values = counters.get(name)!;
  const existing = values.find((v) => labelsMatch(v.labels, labels));

  if (existing) {
    existing.value += amount;
  } else {
    values.push({ value: amount, labels });
  }
}

/**
 * Set a gauge metric value
 */
export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
  if (!gauges.has(name)) {
    gauges.set(name, []);
  }

  const values = gauges.get(name)!;
  const existing = values.find((v) => labelsMatch(v.labels, labels));

  if (existing) {
    existing.value = value;
  } else {
    values.push({ value, labels });
  }
}

/**
 * Record a histogram observation
 */
export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
  buckets: number[] = DEFAULT_LATENCY_BUCKETS
): void {
  if (!histograms.has(name)) {
    histograms.set(name, []);
  }

  const values = histograms.get(name)!;
  let existing = values.find((v) => labelsMatch(v.labels, labels));

  if (!existing) {
    existing = {
      buckets: buckets.map((le) => ({ le, count: 0 })),
      sum: 0,
      count: 0,
      labels,
    };
    values.push(existing);
  }

  // Update histogram
  existing.sum += value;
  existing.count += 1;

  // Update buckets
  for (const bucket of existing.buckets) {
    if (value <= bucket.le) {
      bucket.count += 1;
    }
  }
}

/**
 * Create a timer for measuring duration
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * Helper to check if labels match
 */
function labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();

  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const keyA = keysA[i];
    const keyB = keysB[i];
    if (!keyA || !keyB) return false;
    if (keyA !== keyB) return false;
    if (a[keyA] !== b[keyB]) return false;
  }

  return true;
}

/**
 * Format labels for Prometheus output
 */
function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";

  const parts = entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return `{${parts.join(",")}}`;
}

/**
 * Escape special characters in label values
 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Render all metrics in Prometheus text format
 */
export function renderMetrics(): string {
  const lines: string[] = [];
  const processedMetrics = new Set<string>();

  // Process counters
  for (const [name, values] of counters) {
    const def = metricDefinitions[name];
    if (def && !processedMetrics.has(name)) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} counter`);
      processedMetrics.add(name);
    }

    for (const { value, labels } of values) {
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
  }

  // Process gauges
  for (const [name, values] of gauges) {
    const def = metricDefinitions[name];
    if (def && !processedMetrics.has(name)) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} gauge`);
      processedMetrics.add(name);
    }

    for (const { value, labels } of values) {
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
  }

  // Process histograms
  for (const [name, values] of histograms) {
    const def = metricDefinitions[name];
    if (def && !processedMetrics.has(name)) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} histogram`);
      processedMetrics.add(name);
    }

    for (const { buckets, sum, count, labels } of values) {
      const baseLabels = formatLabels(labels);

      // Output buckets
      for (const bucket of buckets) {
        const bucketLabels = { ...labels, le: String(bucket.le) };
        lines.push(`${name}_bucket${formatLabels(bucketLabels)} ${bucket.count}`);
      }

      // Output +Inf bucket
      const infLabels = { ...labels, le: "+Inf" };
      lines.push(`${name}_bucket${formatLabels(infLabels)} ${count}`);

      // Output sum and count
      lines.push(`${name}_sum${baseLabels} ${sum}`);
      lines.push(`${name}_count${baseLabels} ${count}`);
    }
  }

  // Add process metrics (always fresh)
  lines.push("# HELP process_memory_bytes Process memory usage in bytes");
  lines.push("# TYPE process_memory_bytes gauge");
  lines.push(`process_memory_bytes{type="heapUsed"} ${process.memoryUsage().heapUsed}`);
  lines.push(`process_memory_bytes{type="heapTotal"} ${process.memoryUsage().heapTotal}`);
  lines.push(`process_memory_bytes{type="rss"} ${process.memoryUsage().rss}`);

  lines.push("# HELP process_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${process.uptime()}`);

  return lines.join("\n") + "\n";
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

/**
 * Get current metric values (for inspection/testing)
 */
export function getMetricValues(): {
  counters: Map<string, MetricValue[]>;
  gauges: Map<string, MetricValue[]>;
  histograms: Map<string, HistogramValue[]>;
} {
  return { counters, gauges, histograms };
}

/**
 * HTTP request tracking middleware helper
 */
export function trackHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
  requestSize: number,
  responseSize: number
): void {
  // Normalize path for cardinality control (replace IDs with :id)
  // Matches: UUIDs (36 chars), nanoid (8-21 chars with at least one digit or _-), and numeric IDs
  const normalizedPath = path
    .replace(/\/[a-f0-9-]{36}(?=\/|$)/gi, "/:id")  // UUID format
    .replace(/\/[a-zA-Z0-9_-]{8,21}(?=\/|$)/g, (match) => {
      // Only normalize if the segment contains at least one digit or underscore/hyphen
      // This avoids matching route words like "diagrams" which are pure letters
      return /[\d_-]/.test(match) ? "/:id" : match;
    })
    .replace(/\/\d+(?=\/|$)/g, "/:id");  // numeric IDs

  incrementCounter("http_requests_total", { method, path: normalizedPath, status: String(status) });
  observeHistogram("http_request_duration_ms", durationMs, { method, path: normalizedPath });
  observeHistogram("http_request_size_bytes", requestSize, { method });
  observeHistogram("http_response_size_bytes", responseSize, { method, status: String(status) });
}

/**
 * Database operation tracking helper
 */
export function trackDbOperation(
  operation: string,
  table: string,
  durationMs: number,
  error: boolean = false
): void {
  incrementCounter("db_operations_total", { operation, table });
  observeHistogram("db_operation_duration_ms", durationMs, { operation, table });

  if (error) {
    incrementCounter("db_errors_total", { operation, table });
  }
}

/**
 * MCP tool tracking helper
 */
export function trackMcpTool(
  tool: string,
  durationMs: number,
  error: boolean = false
): void {
  incrementCounter("mcp_tool_calls_total", { tool });
  observeHistogram("mcp_tool_duration_ms", durationMs, { tool });

  if (error) {
    incrementCounter("mcp_tool_errors_total", { tool });
  }
}

/**
 * Update diagram count gauge
 */
export function setDiagramCount(count: number): void {
  setGauge("diagrams_total", count);
}

/**
 * Track diagram operation
 */
export function trackDiagramOperation(operation: "create" | "update" | "delete"): void {
  incrementCounter("diagram_operations_total", { operation });
}
