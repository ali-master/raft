import { it, expect, describe } from "vitest";
import { createHash } from "node:crypto";

describe("dataValidation", () => {
  describe("input validation", () => {
    it("should handle various data types for checksums", () => {
      const testCases = [
        { data: "string", expected: "string" },
        { data: 123, expected: "number" },
        { data: true, expected: "boolean" },
        { data: null, expected: "object" },
        { data: undefined, expected: "undefined" },
        { data: [], expected: "object" },
        { data: {}, expected: "object" },
      ];

      for (const testCase of testCases) {
        // Handle undefined specially since JSON.stringify(undefined) returns undefined
        const dataToHash =
          testCase.data === undefined
            ? "undefined"
            : JSON.stringify(testCase.data);

        const checksum = createHash("sha256").update(dataToHash).digest("hex");

        expect(checksum).toHaveLength(64);
        expect(checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(typeof testCase.data).toBe(testCase.expected);
      }
    });

    it("should validate complex nested structures", () => {
      const complexData = {
        command: {
          type: "COMPLEX_UPDATE",
          metadata: {
            timestamp: Date.now(),
            version: "1.0.0",
            flags: ["urgent", "validated", "encrypted"],
          },
        },
        payload: {
          user: {
            id: 12345,
            preferences: {
              theme: "dark",
              notifications: {
                email: true,
                push: false,
                sms: undefined,
              },
            },
          },
          data: new Array(100).fill(0).map((_, i) => ({
            index: i,
            value: Math.random(),
          })),
        },
      };

      const checksum = createHash("sha256")
        .update(JSON.stringify(complexData))
        .digest("hex");

      expect(checksum).toHaveLength(64);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);

      // Verify consistency
      const checksum2 = createHash("sha256")
        .update(JSON.stringify(complexData))
        .digest("hex");

      expect(checksum).toBe(checksum2);
    });

    it("should handle edge cases in JSON serialization", () => {
      const edgeCases = [
        { name: "empty object", data: {} },
        { name: "empty array", data: [] },
        { name: "deep nesting", data: { a: { b: { c: { d: "deep" } } } } },
        {
          name: "special characters",
          data: { "key with spaces": "value\nwith\nnewlines" },
        },
        {
          name: "unicode",
          data: { emoji: "🚀", chinese: "你好", arabic: "مرحبا" },
        },
        {
          name: "numbers",
          data: { int: 42, float: 3.14159, negative: -1, zero: 0 },
        },
        {
          name: "arrays",
          data: { mixed: [1, "two", true, null, { nested: "object" }] },
        },
      ];

      for (const testCase of edgeCases) {
        const checksum = createHash("sha256")
          .update(JSON.stringify(testCase.data))
          .digest("hex");

        expect(checksum).toHaveLength(64);
        expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it("should detect data corruption through checksums", () => {
      const originalData = {
        transactionId: "tx_123456789",
        amount: 1000.5,
        currency: "USD",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const originalChecksum = createHash("sha256")
        .update(JSON.stringify(originalData))
        .digest("hex");

      // Simulate various types of corruption
      const corruptionTests = [
        { ...originalData, amount: 1000.51 }, // Small change
        { ...originalData, currency: "EUR" }, // Field change
        { ...originalData, extra: "field" }, // Added field
        { transactionId: originalData.transactionId }, // Missing fields
      ];

      for (const corruptedData of corruptionTests) {
        const corruptedChecksum = createHash("sha256")
          .update(JSON.stringify(corruptedData))
          .digest("hex");

        expect(corruptedChecksum).not.toBe(originalChecksum);
        expect(corruptedChecksum).toHaveLength(64);
      }
    });
  });

  describe("performance characteristics", () => {
    it("should handle large data efficiently", () => {
      const largeData = {
        metadata: "large dataset test",
        records: new Array(1000).fill(0).map((_, i) => ({
          id: `record_${i}`,
          timestamp: Date.now() + i,
          data: {
            values: new Array(10).fill(0).map(() => Math.random()),
            metadata: {
              processed: true,
              version: `v1.${i}`,
              tags: [`tag_${i % 5}`, `category_${i % 3}`],
            },
          },
        })),
      };

      const startTime = performance.now();
      const checksum = createHash("sha256")
        .update(JSON.stringify(largeData))
        .digest("hex");
      const endTime = performance.now();

      expect(checksum).toHaveLength(64);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it("should have consistent performance for similar data sizes", () => {
      const sizes = [100, 200, 300, 400, 500];
      const times = [];

      for (const size of sizes) {
        const data = {
          size,
          data: new Array(size)
            .fill(0)
            .map((_, i) => ({ index: i, value: Math.random() })),
        };

        const startTime = performance.now();
        createHash("sha256").update(JSON.stringify(data)).digest("hex");
        const endTime = performance.now();

        times.push(endTime - startTime);
      }

      // Performance should scale roughly linearly
      expect(times.every((time) => time < 100)).toBe(true); // All should be under 100ms
    });
  });

  describe("data integrity verification", () => {
    it("should verify round-trip data integrity", () => {
      const originalData = {
        command: "CRITICAL_UPDATE",
        sequence: 123456,
        checksum: null, // Will be calculated
        payload: {
          operation: "transfer",
          from: "account_a",
          to: "account_b",
          amount: 500.75,
          metadata: {
            reference: "ref_789",
            description: "Monthly transfer",
            category: "recurring",
          },
        },
      };

      // Calculate initial checksum
      const initialChecksum = createHash("sha256")
        .update(JSON.stringify(originalData))
        .digest("hex");

      // Simulate serialization/deserialization
      const serialized = JSON.stringify(originalData);
      const deserialized = JSON.parse(serialized);

      // Verify data integrity
      const finalChecksum = createHash("sha256")
        .update(JSON.stringify(deserialized))
        .digest("hex");

      expect(finalChecksum).toBe(initialChecksum);
      expect(deserialized).toEqual(originalData);
    });

    it("should detect subtle data modifications", () => {
      const baseData = {
        id: "important_record_123",
        balance: 1000.0,
        status: "active",
        metadata: {
          lastUpdated: "2024-01-01T12:00:00Z",
          version: 1,
        },
      };

      const baseChecksum = createHash("sha256")
        .update(JSON.stringify(baseData))
        .digest("hex");

      // Test subtle modifications
      const modifications = [
        { ...baseData, balance: 1000.01 }, // Tiny change
        { ...baseData, status: "Active" }, // Case change
        { ...baseData, metadata: { ...baseData.metadata, version: 2 } }, // Nested change
        { ...baseData, id: "important_record_124" }, // ID change
      ];

      for (const modified of modifications) {
        const modifiedChecksum = createHash("sha256")
          .update(JSON.stringify(modified))
          .digest("hex");

        expect(modifiedChecksum).not.toBe(baseChecksum);
      }
    });
  });

  describe("security considerations", () => {
    it("should handle potentially malicious data safely", () => {
      const maliciousInputs = [
        { script: "<script>alert('xss')</script>" },
        { sql: "'; DROP TABLE users; --" },
        { path: "../../../etc/passwd" },
        { overflow: "A".repeat(10000) },
        { unicode: "\u0000\u0001\u0002\u0003" },
        { circular: null as unknown }, // Will be handled by JSON.stringify
      ];

      // Create circular reference
      const circularObj: { name: string; circular?: unknown } = {
        name: "circular",
      };
      circularObj.circular = circularObj;
      maliciousInputs[maliciousInputs.length - 1] = { circular: circularObj };

      for (let i = 0; i < maliciousInputs.length - 1; i++) {
        const input = maliciousInputs[i];

        expect(() => {
          const checksum = createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex");
          expect(checksum).toHaveLength(64);
        }).not.toThrow();
      }

      // Circular reference should throw
      expect(() => {
        JSON.stringify(maliciousInputs[maliciousInputs.length - 1]);
      }).toThrow();
    });
  });
});
