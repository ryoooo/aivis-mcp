import { readFile } from "fs/promises";
import { join } from "path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { synthesizeSpeech, SynthesizeInputSchema } from "./src/aivis-client.ts";

const AIVIS_API_KEY = Bun.env.AIVIS_API_KEY as string;
if (!AIVIS_API_KEY) {
  console.error("Error: AIVIS_API_KEY environment variable is required");
  process.exit(1);
}

const UI_HTML_PATH = join(import.meta.dirname, "dist", "mcp-app.html");
const RESOURCE_URI = "ui://aivis-tts/player.html";

// Cache built UI HTML at startup
let cachedUiHtml: string | null = null;
async function getUiHtml(): Promise<string> {
  if (!cachedUiHtml) {
    cachedUiHtml = await readFile(UI_HTML_PATH, "utf-8");
  }
  return cachedUiHtml;
}

// Create a new McpServer instance with tools and resources registered
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "aivis-mcp-apps",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "synthesize-speech",
    {
      title: "Synthesize Speech",
      description: "Synthesize speech from text using Aivis Cloud TTS API",
      inputSchema: SynthesizeInputSchema.shape,
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
        },
      },
    },
    async (params) => {
      const input = SynthesizeInputSchema.parse(params);
      const result = await synthesizeSpeech(input, AIVIS_API_KEY);

      return {
        content: [{ type: "text", text: "音声を生成しました" }],
        structuredContent: result,
      };
    },
  );

  registerAppResource(
    server,
    "TTS Player",
    RESOURCE_URI,
    {
      description: "Interactive TTS player interface",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await getUiHtml(),
        },
      ],
    }),
  );

  return server;
}

// Session management: each client gets its own McpServer + transport pair
const sessions = new Map<
  string,
  { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
>();

// Create Hono app
const app = new Hono();

// Enable CORS
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  }),
);

// Health check endpoint
app.get("/health", (c) => c.json({ status: "ok" }));

// Serve UI resource via HTTP
app.get("/ui", async (c) => {
  try {
    const html = await getUiHtml();
    return c.html(html);
  } catch {
    return c.json({ error: "UI not built. Run 'bun run build' first." }, 500);
  }
});

// MCP endpoint — per-session McpServer + transport
app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return session.transport.handleRequest(c.req.raw);
  }

  // New session: create dedicated McpServer + transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const server = createMcpServer();

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  await server.connect(transport);

  const response = await transport.handleRequest(c.req.raw);

  // Store session after initialization assigns the session ID
  if (transport.sessionId) {
    sessions.set(transport.sessionId, { server, transport });
  }

  return response;
});

const PORT = Number(Bun.env.PORT) || 3000;
console.log(`Starting Aivis MCP Apps server on port ${PORT}`);
console.log(`Health check: http://localhost:${PORT}/health`);
console.log(`UI endpoint: http://localhost:${PORT}/ui`);
console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);

export default {
  port: PORT,
  fetch: app.fetch,
};
