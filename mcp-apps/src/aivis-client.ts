import { z } from "zod";

export const SynthesizeInputSchema = z.object({
  text: z.string().min(1).max(3000).describe("Text to synthesize (1-3000 characters)"),
  model_uuid: z.string().uuid().optional().describe("Model UUID (optional)"),
  speaker_uuid: z.string().uuid().optional().describe("Speaker UUID (optional)"),
  output_format: z
    .enum(["mp3", "wav", "flac"])
    .optional()
    .default("mp3")
    .describe("Output audio format"),
});

export type SynthesizeInput = z.infer<typeof SynthesizeInputSchema>;

/**
 * Result of speech synthesis.
 * Index signature is required because MCP SDK's structuredContent
 * expects Record<string, unknown> for open object compatibility.
 */
export interface SynthesizeResult {
  [key: string]: unknown;
  audio: string; // base64
  mimeType: string;
  text: string;
}

const AIVIS_API_BASE = "https://api.aivis-project.com";
const DEFAULT_MODEL_UUID = "7fc08a41-b64d-456d-8b22-8e1284674775";

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

export async function synthesizeSpeech(
  input: SynthesizeInput,
  apiKey: string,
): Promise<SynthesizeResult> {
  const modelUuid = input.model_uuid ?? Bun.env.AIVIS_DEFAULT_MODEL_UUID ?? DEFAULT_MODEL_UUID;

  const response = await fetch(`${AIVIS_API_BASE}/v1/tts/synthesize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_uuid: modelUuid,
      text: input.text,
      speaker_uuid: input.speaker_uuid,
      output_format: input.output_format,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Aivis API error (${response.status}): ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(audioBuffer).toString("base64");

  return {
    audio: base64Audio,
    mimeType: MIME_TYPES[input.output_format ?? "mp3"],
    text: input.text,
  };
}
