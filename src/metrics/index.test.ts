/**
 * Metrics Module Tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  incrementCounter,
  setGauge,
  observeHistogram,
  startTimer,
  renderMetrics,
  resetMetrics,
  getMetricValues,
  trackHttpRequest,
  trackDbOperation,
  trackMcpTool,
  setDiagramCount,
  trackDiagramOperation,
} from "./index";

describe("Metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("incrementCounter", () => {
    test("creates new counter with initial value", () => {
      incrementCounter("test_counter");
      const { counters } = getMetricValues();

      expect(counters.get("test_counter")).toBeDefined();
      expect(counters.get("test_counter")![0].value).toBe(1);
    });

    test("increments existing counter", () => {
      incrementCounter("test_counter");
      incrementCounter("test_counter");
      incrementCounter("test_counter", {}, 5);

      const { counters } = getMetricValues();
      expect(counters.get("test_counter")![0].value).toBe(7);
    });

    test("tracks separate values for different labels", () => {
      incrementCounter("test_counter", { method: "GET" });
      incrementCounter("test_counter", { method: "POST" });
      incrementCounter("test_counter", { method: "GET" });

      const { counters } = getMetricValues();
      const values = counters.get("test_counter")!;

      expect(values.length).toBe(2);

      const getCounter = values.find((v) => v.labels.method === "GET");
      const postCounter = values.find((v) => v.labels.method === "POST");

      expect(getCounter?.value).toBe(2);
      expect(postCounter?.value).toBe(1);
    });
  });

  describe("setGauge", () => {
    test("creates new gauge with value", () => {
      setGauge("test_gauge", 42);
      const { gauges } = getMetricValues();

      expect(gauges.get("test_gauge")![0].value).toBe(42);
    });

    test("overwrites existing gauge value", () => {
      setGauge("test_gauge", 10);
      setGauge("test_gauge", 20);
      setGauge("test_gauge", 30);

      const { gauges } = getMetricValues();
      expect(gauges.get("test_gauge")![0].value).toBe(30);
    });

    test("tracks separate values for different labels", () => {
      setGauge("memory", 100, { type: "heap" });
      setGauge("memory", 200, { type: "rss" });

      const { gauges } = getMetricValues();
      const values = gauges.get("memory")!;

      expect(values.length).toBe(2);
    });
  });

  describe("observeHistogram", () => {
    test("creates histogram with buckets", () => {
      observeHistogram("test_histogram", 50);
      const { histograms } = getMetricValues();

      const hist = histograms.get("test_histogram")![0];
      expect(hist.sum).toBe(50);
      expect(hist.count).toBe(1);
    });

    test("updates buckets correctly", () => {
      observeHistogram("latency", 15, {}, [10, 50, 100]);
      observeHistogram("latency", 75, {}, [10, 50, 100]);
      observeHistogram("latency", 5, {}, [10, 50, 100]);

      const { histograms } = getMetricValues();
      const hist = histograms.get("latency")![0];

      // 5ms -> in all buckets
      // 15ms -> in 50ms and 100ms buckets
      // 75ms -> in 100ms bucket
      expect(hist.buckets.find((b) => b.le === 10)?.count).toBe(1);
      expect(hist.buckets.find((b) => b.le === 50)?.count).toBe(2);
      expect(hist.buckets.find((b) => b.le === 100)?.count).toBe(3);

      expect(hist.sum).toBe(95);
      expect(hist.count).toBe(3);
    });
  });

  describe("startTimer", () => {
    test("measures elapsed time", async () => {
      const stopTimer = startTimer();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const elapsed = stopTimer();

      expect(elapsed).toBeGreaterThan(45);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("renderMetrics", () => {
    test("renders counters in Prometheus format", () => {
      incrementCounter("http_requests_total", { method: "GET", status: "200" }, 10);

      const output = renderMetrics();

      expect(output).toContain("# HELP http_requests_total");
      expect(output).toContain("# TYPE http_requests_total counter");
      expect(output).toContain('http_requests_total{method="GET",status="200"} 10');
    });

    test("renders gauges in Prometheus format", () => {
      setGauge("diagrams_total", 42);

      const output = renderMetrics();

      expect(output).toContain("# HELP diagrams_total");
      expect(output).toContain("# TYPE diagrams_total gauge");
      expect(output).toContain("diagrams_total 42");
    });

    test("renders histograms with buckets", () => {
      observeHistogram("http_request_duration_ms", 100, { method: "GET" }, [50, 100, 500]);
      observeHistogram("http_request_duration_ms", 50, { method: "GET" }, [50, 100, 500]);

      const output = renderMetrics();

      expect(output).toContain("# TYPE http_request_duration_ms histogram");
      expect(output).toContain('http_request_duration_ms_bucket{method="GET",le="50"} 1');
      expect(output).toContain('http_request_duration_ms_bucket{method="GET",le="100"} 2');
      expect(output).toContain('http_request_duration_ms_bucket{method="GET",le="+Inf"} 2');
      expect(output).toContain('http_request_duration_ms_sum{method="GET"} 150');
      expect(output).toContain('http_request_duration_ms_count{method="GET"} 2');
    });

    test("escapes label values", () => {
      incrementCounter("test", { path: '/path/with"quotes' });

      const output = renderMetrics();
      expect(output).toContain('path="/path/with\\"quotes"');
    });

    test("includes process metrics", () => {
      const output = renderMetrics();

      expect(output).toContain("process_memory_bytes");
      expect(output).toContain("process_uptime_seconds");
    });
  });

  describe("trackHttpRequest", () => {
    test("records HTTP metrics", () => {
      trackHttpRequest("GET", "/api/diagrams", 200, 50, 0, 1024);

      const { counters, histograms } = getMetricValues();

      expect(counters.get("http_requests_total")).toBeDefined();
      expect(histograms.get("http_request_duration_ms")).toBeDefined();
    });

    test("normalizes paths with UUIDs", () => {
      trackHttpRequest(
        "GET",
        "/api/diagrams/550e8400-e29b-41d4-a716-446655440000",
        200,
        50,
        0,
        1024
      );

      const { counters } = getMetricValues();
      const values = counters.get("http_requests_total")!;

      // Path should be normalized
      expect(values[0].labels.path).toBe("/api/diagrams/:id");
    });

    test("normalizes paths with nanoid format", () => {
      resetMetrics();
      // nanoid is 8-21 chars of alphanumeric + underscore/hyphen
      trackHttpRequest("GET", "/api/diagrams/abc123_XY", 200, 50, 0, 1024);

      const { counters } = getMetricValues();
      const values = counters.get("http_requests_total")!;
      expect(values[0].labels.path).toBe("/api/diagrams/:id");
    });

    test("normalizes paths with longer nanoid", () => {
      resetMetrics();
      // Typical nanoid length is ~21 chars
      trackHttpRequest("GET", "/api/diagrams/V1StGXR8_Z5jdHi6B-myT", 200, 50, 0, 1024);

      const { counters } = getMetricValues();
      const values = counters.get("http_requests_total")!;
      expect(values[0].labels.path).toBe("/api/diagrams/:id");
    });

    test("normalizes nested paths with IDs", () => {
      resetMetrics();
      trackHttpRequest("GET", "/api/diagrams/abc123XY/versions/42", 200, 50, 0, 1024);

      const { counters } = getMetricValues();
      const values = counters.get("http_requests_total")!;
      expect(values[0].labels.path).toBe("/api/diagrams/:id/versions/:id");
    });

    test("preserves short path segments (not IDs)", () => {
      resetMetrics();
      // Segments shorter than 8 chars shouldn't be normalized
      trackHttpRequest("GET", "/api/v1/list", 200, 50, 0, 1024);

      const { counters } = getMetricValues();
      const values = counters.get("http_requests_total")!;
      expect(values[0].labels.path).toBe("/api/v1/list");
    });
  });

  describe("trackDbOperation", () => {
    test("records database metrics", () => {
      trackDbOperation("SELECT", "diagrams", 10);
      trackDbOperation("INSERT", "diagrams", 5, true);

      const { counters, histograms } = getMetricValues();

      expect(counters.get("db_operations_total")).toBeDefined();
      expect(histograms.get("db_operation_duration_ms")).toBeDefined();
      expect(counters.get("db_errors_total")).toBeDefined();
    });
  });

  describe("trackMcpTool", () => {
    test("records MCP tool metrics", () => {
      trackMcpTool("create_diagram", 100);
      trackMcpTool("create_diagram", 50, true);

      const { counters, histograms } = getMetricValues();

      expect(counters.get("mcp_tool_calls_total")).toBeDefined();
      expect(histograms.get("mcp_tool_duration_ms")).toBeDefined();
      expect(counters.get("mcp_tool_errors_total")).toBeDefined();
    });
  });

  describe("setDiagramCount", () => {
    test("updates diagram count gauge", () => {
      setDiagramCount(100);

      const { gauges } = getMetricValues();
      expect(gauges.get("diagrams_total")![0].value).toBe(100);
    });
  });

  describe("trackDiagramOperation", () => {
    test("tracks diagram operations", () => {
      trackDiagramOperation("create");
      trackDiagramOperation("update");
      trackDiagramOperation("delete");

      const { counters } = getMetricValues();
      const values = counters.get("diagram_operations_total")!;

      expect(values.length).toBe(3);
    });
  });

  describe("resetMetrics", () => {
    test("clears all metrics", () => {
      incrementCounter("test_counter");
      setGauge("test_gauge", 10);
      observeHistogram("test_hist", 50);

      resetMetrics();

      const { counters, gauges, histograms } = getMetricValues();
      expect(counters.size).toBe(0);
      expect(gauges.size).toBe(0);
      expect(histograms.size).toBe(0);
    });
  });
});
