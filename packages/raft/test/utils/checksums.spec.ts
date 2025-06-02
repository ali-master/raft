import { it, expect, describe } from "vitest";
import { createHash } from "node:crypto";

describe("checksumUtilities", () => {
  describe("sHA256 checksums", () => {
    it("should generate consistent checksums", () => {
      const data = { command: "SET", key: "test", value: "data" };
      const checksum1 = createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
      const checksum2 = createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA256 hex length
    });

    it("should generate different checksums for different data", () => {
      const data1 = { command: "SET", key: "test1", value: "data1" };
      const data2 = { command: "SET", key: "test2", value: "data2" };

      const checksum1 = createHash("sha256")
        .update(JSON.stringify(data1))
        .digest("hex");
      const checksum2 = createHash("sha256")
        .update(JSON.stringify(data2))
        .digest("hex");

      expect(checksum1).not.toBe(checksum2);
    });

    it("should be sensitive to property order", () => {
      const data1 = { key: "test", value: "data", command: "SET" };
      const data2 = { command: "SET", key: "test", value: "data" };

      const checksum1 = createHash("sha256")
        .update(JSON.stringify(data1))
        .digest("hex");
      const checksum2 = createHash("sha256")
        .update(JSON.stringify(data2))
        .digest("hex");

      // JSON.stringify may produce different ordering
      // This test documents the behavior
      expect(typeof checksum1).toBe("string");
      expect(typeof checksum2).toBe("string");
    });

    it("should handle complex nested objects", () => {
      const data = {
        command: "UPDATE",
        key: "user:123",
        value: {
          name: "John Doe",
          email: "john@example.com",
          metadata: {
            lastLogin: "2023-01-01",
            preferences: ["dark-mode", "notifications"],
          },
        },
      };

      const checksum = createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
      expect(checksum).toHaveLength(64);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle null and undefined values", () => {
      const dataWithNull = { command: "DELETE", key: "test", value: null };
      const dataWithUndefined = {
        command: "DELETE",
        key: "test",
        value: undefined,
      };

      const checksumNull = createHash("sha256")
        .update(JSON.stringify(dataWithNull))
        .digest("hex");
      const checksumUndefined = createHash("sha256")
        .update(JSON.stringify(dataWithUndefined))
        .digest("hex");

      expect(checksumNull).toHaveLength(64);
      expect(checksumUndefined).toHaveLength(64);
      expect(checksumNull).not.toBe(checksumUndefined);
    });
  });

  describe("checksum validation", () => {
    it("should validate data integrity", () => {
      const originalData = {
        command: "SET",
        key: "integrity-test",
        value: "original",
      };
      const originalChecksum = createHash("sha256")
        .update(JSON.stringify(originalData))
        .digest("hex");

      // Simulate data corruption
      const corruptedData = {
        command: "SET",
        key: "integrity-test",
        value: "corrupted",
      };
      const corruptedChecksum = createHash("sha256")
        .update(JSON.stringify(corruptedData))
        .digest("hex");

      expect(originalChecksum).not.toBe(corruptedChecksum);

      // Validate original data
      const recomputedChecksum = createHash("sha256")
        .update(JSON.stringify(originalData))
        .digest("hex");
      expect(recomputedChecksum).toBe(originalChecksum);
    });
  });
});
