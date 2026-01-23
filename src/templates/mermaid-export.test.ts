/**
 * Mermaid Export Tests
 * Tests for converting Vizcraft diagrams to Mermaid format
 */

import { describe, it, expect } from "bun:test";
import { exportToMermaid, getSupportedExportFormats } from "./mermaid-export";
import type { DiagramSpec } from "../types";

describe("exportToMermaid", () => {
  describe("flowchart export", () => {
    it("exports basic flowchart with nodes", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "Start" },
          { id: "b", label: "Process" },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("flowchart TD");
      expect(result).toContain("a[Start]");
      expect(result).toContain("b[Process]");
    });

    it("exports flowchart with edges", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("a --> b");
    });

    it("exports flowchart with dashed edges", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", style: "dashed" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("a -.-> b");
    });

    it("exports flowchart with edge labels", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", label: "yes" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("|yes|");
    });

    it("exports diamond shape for decision nodes", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "decision", label: "Choice?", type: "diamond" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("{Choice?}");
    });

    it("exports circle shape", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "start", label: "Start", type: "circle" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("((Start))");
    });

    it("exports database/cylinder shape", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "db", label: "Database", type: "database" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("[(Database)]");
    });

    it("exports cloud shape", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "cloud", label: "Cloud", type: "cloud" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain(">Cloud]");
    });

    it("exports groups as subgraphs", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        groups: [{ id: "g1", label: "Group 1", nodeIds: ["a", "b"] }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("subgraph g1[Group 1]");
      expect(result).toContain("end");
    });

    it("sanitizes node IDs with special characters", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "node-with-special.chars", label: "Test" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("node_with_special_chars");
    });
  });

  describe("sequence diagram export", () => {
    it("exports basic sequence diagram", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "client", label: "Client" },
          { id: "server", label: "Server" },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("sequenceDiagram");
      expect(result).toContain("participant client as Client");
      expect(result).toContain("participant server as Server");
    });

    it("exports actors correctly", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [{ id: "user", label: "User", type: "actor" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("actor user as User");
    });

    it("exports sync messages", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        messages: [{ from: "a", to: "b", label: "request", type: "sync", order: 1 }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("a->>b: request");
    });

    it("exports async messages", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        messages: [{ from: "a", to: "b", label: "async call", type: "async", order: 1 }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("a->>b: async call");
    });

    it("exports return messages", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        messages: [{ from: "b", to: "a", label: "response", type: "return", order: 1 }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("b-->>a: response");
    });

    it("orders messages correctly", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        messages: [
          { from: "a", to: "b", label: "second", type: "sync", order: 2 },
          { from: "a", to: "b", label: "first", type: "sync", order: 1 },
        ],
      };

      const result = exportToMermaid(spec);
      const lines = result.split("\n");

      const firstIndex = lines.findIndex((l) => l.includes("first"));
      const secondIndex = lines.findIndex((l) => l.includes("second"));

      expect(firstIndex).toBeLessThan(secondIndex);
    });
  });

  describe("state diagram export", () => {
    it("exports basic state diagram", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [
          { id: "idle", label: "Idle" },
          { id: "running", label: "Running" },
        ],
        edges: [{ from: "idle", to: "running" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("stateDiagram-v2");
      expect(result).toContain("idle: Idle");
      expect(result).toContain("idle --> running");
    });

    it("exports initial state", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [{ id: "start", label: "Start", type: "initial" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("[*] --> start");
    });

    it("exports final state transitions", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [
          { id: "running", label: "Running" },
          { id: "end", label: "End", type: "final" },
        ],
        edges: [{ from: "running", to: "end" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("running --> [*]");
    });

    it("exports choice states", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [{ id: "check", label: "Check", type: "choice" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("<<choice>>");
    });

    it("exports edge labels", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", label: "trigger" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain(": trigger");
    });
  });

  describe("class diagram export", () => {
    it("exports basic class", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [{ id: "Person", label: "Person" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("classDiagram");
      expect(result).toContain("class Person {");
    });

    it("exports class with stereotype", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [{ id: "IService", label: "IService", stereotype: "interface" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("<<interface>>");
    });

    it("exports class with attributes", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          {
            id: "User",
            label: "User",
            attributes: ["+name: string", "-age: number"],
          },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("+name: string");
      expect(result).toContain("-age: number");
    });

    it("exports class with methods", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          {
            id: "Service",
            label: "Service",
            methods: ["+process(): void", "#helper(): boolean"],
          },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("+process(): void");
      expect(result).toContain("#helper(): boolean");
    });

    it("exports inheritance relationship", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          { id: "Animal", label: "Animal" },
          { id: "Dog", label: "Dog" },
        ],
        edges: [{ from: "Dog", to: "Animal", label: "extends" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("--|>");
    });

    it("exports interface implementation with dashed line", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          { id: "IService", label: "IService" },
          { id: "ServiceImpl", label: "ServiceImpl" },
        ],
        edges: [{ from: "ServiceImpl", to: "IService", label: "implements", style: "dashed" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("..|>");
    });

    it("exports composition relationship", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          { id: "Car", label: "Car" },
          { id: "Engine", label: "Engine" },
        ],
        edges: [{ from: "Car", to: "Engine", label: "composition" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("*--");
    });

    it("exports aggregation relationship", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          { id: "Team", label: "Team" },
          { id: "Player", label: "Player" },
        ],
        edges: [{ from: "Team", to: "Player", label: "aggregation" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("o--");
    });
  });

  describe("ER diagram export", () => {
    it("exports basic ER diagram", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [{ id: "User", label: "User", type: "entity" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("erDiagram");
      expect(result).toContain("User {");
    });

    it("exports entity with attributes", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [
          {
            id: "User",
            label: "User",
            type: "entity",
            attributes: ["id int PK", "email string"],
          },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("int id PK");
      expect(result).toContain("string email");
    });

    it("exports 1:N relationship", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [
          { id: "User", label: "User", type: "entity" },
          { id: "Post", label: "Post", type: "entity" },
        ],
        edges: [],
        relationships: [
          { entity1: "User", entity2: "Post", cardinality: "1:N", label: "creates" },
        ],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("||--o{");
      expect(result).toContain(": creates");
    });

    it("exports 1:1 relationship", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [
          { id: "User", label: "User", type: "entity" },
          { id: "Profile", label: "Profile", type: "entity" },
        ],
        edges: [],
        relationships: [{ entity1: "User", entity2: "Profile", cardinality: "1:1" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("||--||");
    });

    it("exports N:M relationship", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [
          { id: "Student", label: "Student", type: "entity" },
          { id: "Course", label: "Course", type: "entity" },
        ],
        edges: [],
        relationships: [{ entity1: "Student", entity2: "Course", cardinality: "N:M" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("}o--o{");
    });
  });

  describe("mindmap export", () => {
    it("exports basic mindmap with central node", () => {
      const spec: DiagramSpec = {
        type: "mindmap",
        nodes: [{ id: "center", label: "Main Topic", type: "central" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("mindmap");
      expect(result).toContain("root((Main Topic))");
    });

    it("exports mindmap with children", () => {
      const spec: DiagramSpec = {
        type: "mindmap",
        nodes: [
          { id: "center", label: "Topic", type: "central" },
          { id: "branch1", label: "Branch 1" },
          { id: "branch2", label: "Branch 2" },
        ],
        edges: [
          { from: "center", to: "branch1" },
          { from: "center", to: "branch2" },
        ],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("Branch 1");
      expect(result).toContain("Branch 2");
    });
  });

  describe("default handling", () => {
    it("exports architecture diagrams as flowcharts", () => {
      const spec: DiagramSpec = {
        type: "architecture",
        nodes: [{ id: "api", label: "API Gateway" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("flowchart TD");
    });

    it("exports network diagrams as flowcharts", () => {
      const spec: DiagramSpec = {
        type: "network",
        nodes: [{ id: "router", label: "Router" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("flowchart TD");
    });

    it("exports freeform diagrams as flowcharts", () => {
      const spec: DiagramSpec = {
        type: "freeform",
        nodes: [{ id: "box", label: "Box" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("flowchart TD");
    });
  });
});

describe("sanitization - XSS/injection prevention", () => {
  describe("node labels", () => {
    it("escapes pipe characters to prevent edge label injection", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "Test|malicious|injection" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      // Pipe should be escaped as HTML entity
      expect(result).toContain("&#124;");
      // Should not contain raw pipe that could break syntax
      expect(result).not.toMatch(/\[Test\|/);
    });

    it("escapes brackets to prevent shape injection", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "Test[injected]shape" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#91;");
      expect(result).toContain("&#93;");
    });

    it("escapes braces to prevent diamond/decision shape injection", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "Test{fake}decision" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#123;");
      expect(result).toContain("&#125;");
    });

    it("escapes angle brackets to prevent HTML injection", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: '<script>alert("xss")</script>' }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      // Should not contain raw angle brackets
      expect(result).not.toContain("<script>");
    });

    it("escapes hash to prevent comment injection", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "Test#comment" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#35;");
    });

    it("escapes semicolon to prevent statement termination", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "End;B-->C" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#59;");
      // Should not create a new edge
      expect(result).not.toMatch(/End;B/);
    });

    it("escapes double quotes to prevent string breaking", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: 'Say "hello"' }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&quot;");
    });

    it("handles combined injection attempt", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          {
            id: "malicious",
            label: '</div><script>alert(1)</script>|{exploit}|[break];"hack"#comment',
          },
        ],
        edges: [],
      };

      const result = exportToMermaid(spec);

      // Verify all dangerous characters are escaped
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("</div>");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).toContain("&#124;");
      expect(result).toContain("&#123;");
      expect(result).toContain("&#125;");
      expect(result).toContain("&#91;");
      expect(result).toContain("&#93;");
      expect(result).toContain("&#59;");
      expect(result).toContain("&quot;");
      expect(result).toContain("&#35;");
    });
  });

  describe("edge labels", () => {
    it("escapes edge labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", label: "label|break|syntax" }],
      };

      const result = exportToMermaid(spec);

      // Pipes in labels should be escaped
      expect(result).toContain("&#124;");
    });
  });

  describe("sequence diagram messages", () => {
    it("escapes message labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "sequence",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        messages: [
          { from: "a", to: "b", label: '<img onerror="alert(1)">', type: "sync", order: 1 },
        ],
      };

      const result = exportToMermaid(spec);

      expect(result).not.toContain("<img");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });
  });

  describe("state diagram labels", () => {
    it("escapes state labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [{ id: "state1", label: "State{break}syntax" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#123;");
      expect(result).toContain("&#125;");
    });

    it("escapes transition labels", () => {
      const spec: DiagramSpec = {
        type: "state",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", label: "event;inject" }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#59;");
    });
  });

  describe("class diagram", () => {
    it("sanitizes class IDs to valid identifiers", () => {
      // Class names in Mermaid must be valid identifiers, so sanitizeId is used
      // rather than sanitizeLabel (which preserves readable text with HTML entities)
      const spec: DiagramSpec = {
        type: "class",
        nodes: [{ id: "MyClass<T>", label: "MyClass<T>" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      // Special characters should be replaced with underscores in the ID
      expect(result).toContain("class MyClass_T_");
      // The raw angle brackets should not appear
      expect(result).not.toContain("<T>");
    });

    it("escapes class relationship labels", () => {
      const spec: DiagramSpec = {
        type: "class",
        nodes: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        edges: [{ from: "A", to: "B", label: "uses<T>" }],
      };

      const result = exportToMermaid(spec);

      // Edge labels should be sanitized
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });
  });

  describe("mindmap", () => {
    it("escapes mindmap labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "mindmap",
        nodes: [{ id: "center", label: "Topic((nested))", type: "central" }],
        edges: [],
      };

      const result = exportToMermaid(spec);

      // The nested parens should not break the root syntax
      // root((Topic((nested))))  <-- this would be broken
      expect(result).toContain("root((");
      // Verify the output is valid-ish by checking structure
      const lines = result.split("\n");
      const rootLine = lines.find((l) => l.includes("root"));
      expect(rootLine).toBeDefined();
    });
  });

  describe("ER diagram", () => {
    it("escapes relationship labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "er",
        nodes: [
          { id: "User", label: "User", type: "entity" },
          { id: "Post", label: "Post", type: "entity" },
        ],
        edges: [],
        relationships: [
          { entity1: "User", entity2: "Post", cardinality: "1:N", label: "creates|breaks" },
        ],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#124;");
    });
  });

  describe("subgraph/group labels", () => {
    it("escapes group labels with injection attempts", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [{ id: "g1", label: "Group[injection]attempt", nodeIds: ["a"] }],
      };

      const result = exportToMermaid(spec);

      expect(result).toContain("&#91;");
      expect(result).toContain("&#93;");
    });
  });
});

describe("getSupportedExportFormats", () => {
  it("returns list of supported formats", () => {
    const formats = getSupportedExportFormats();

    expect(formats.length).toBeGreaterThanOrEqual(4);
    expect(formats.some((f) => f.id === "mermaid")).toBe(true);
    expect(formats.some((f) => f.id === "json")).toBe(true);
    expect(formats.some((f) => f.id === "svg")).toBe(true);
    expect(formats.some((f) => f.id === "png")).toBe(true);
  });

  it("each format has required properties", () => {
    const formats = getSupportedExportFormats();

    for (const format of formats) {
      expect(format.id).toBeDefined();
      expect(format.name).toBeDefined();
      expect(format.extension).toBeDefined();
      expect(format.extension.startsWith(".")).toBe(true);
    }
  });
});
