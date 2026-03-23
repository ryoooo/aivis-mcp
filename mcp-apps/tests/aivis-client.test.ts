import { describe, expect, test } from "bun:test";
import { SynthesizeInputSchema } from "../src/aivis-client";

describe("SynthesizeInputSchema", () => {
  test("valid input with required fields only", () => {
    const input = { text: "こんにちは" };
    const result = SynthesizeInputSchema.parse(input);
    expect(result.text).toBe("こんにちは");
    expect(result.output_format).toBe("mp3");
  });

  test("valid input with all fields", () => {
    const input = {
      text: "テスト",
      model_uuid: "7fc08a41-b64d-456d-8b22-8e1284674775",
      speaker_uuid: "123e4567-e89b-12d3-a456-426614174000",
      output_format: "wav" as const,
    };
    const result = SynthesizeInputSchema.parse(input);
    expect(result.text).toBe("テスト");
    expect(result.output_format).toBe("wav");
  });

  test("rejects empty text", () => {
    const input = { text: "" };
    expect(() => SynthesizeInputSchema.parse(input)).toThrow();
  });

  test("rejects text over 3000 characters", () => {
    const input = { text: "あ".repeat(3001) };
    expect(() => SynthesizeInputSchema.parse(input)).toThrow();
  });

  test("rejects invalid UUID", () => {
    const input = { text: "テスト", model_uuid: "invalid-uuid" };
    expect(() => SynthesizeInputSchema.parse(input)).toThrow();
  });

  test("rejects invalid output format", () => {
    const input = { text: "テスト", output_format: "ogg" };
    expect(() => SynthesizeInputSchema.parse(input)).toThrow();
  });
});
