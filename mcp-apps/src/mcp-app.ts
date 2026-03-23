import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import type { SynthesizeResult } from "./aivis-client";

function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(base64);
  const buffer = new ArrayBuffer(binaryString.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

class TtsPlayer {
  private app: App;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private isPlaying = false;
  private audioData: SynthesizeResult | null = null;

  private playBtn: HTMLButtonElement;
  private playIcon: SVGElement;
  private pauseIcon: SVGElement;
  private downloadBtn: HTMLButtonElement;
  private textDisplay: HTMLSpanElement;

  constructor() {
    this.app = new App({ name: "TtsPlayer", version: "1.0.0" }, {});
    this.playBtn = document.getElementById("play-btn") as HTMLButtonElement;
    this.playIcon = document.getElementById("play-icon") as unknown as SVGElement;
    this.pauseIcon = document.getElementById("pause-icon") as unknown as SVGElement;
    this.downloadBtn = document.getElementById("download-btn") as HTMLButtonElement;
    this.textDisplay = document.getElementById("text-display") as HTMLSpanElement;

    this.setupEventListeners();
    this.setupAppHandlers();
    this.setupTeardownHandler();
    this.setupThemeHandler();
    void this.connect();
  }

  private setupEventListeners(): void {
    this.playBtn.addEventListener("click", () => this.togglePlayback());
    this.downloadBtn.addEventListener("click", () => this.download());
  }

  private setupAppHandlers(): void {
    // Handle tool result containing audio data
    this.app.ontoolresult = (params) => {
      if (params.isError) {
        console.error("Tool execution failed:", params.content);
        this.textDisplay.textContent = "Error";
        return;
      }

      const content = params.structuredContent as SynthesizeResult | undefined;
      if (content?.audio && content?.mimeType && content?.text) {
        this.audioData = content;
        this.textDisplay.textContent = this.truncateText(content.text, 50);
        this.playBtn.disabled = false;
        this.downloadBtn.disabled = false;
      }
    };

    this.app.ontoolcancelled = () => {
      this.stop();
      this.textDisplay.textContent = "キャンセルされました";
    };
  }

  private setupTeardownHandler(): void {
    this.app.onteardown = () => {
      this.cleanup();
      return {};
    };
  }

  private setupThemeHandler(): void {
    this.app.onhostcontextchanged = (context) => {
      if (context.theme) {
        applyDocumentTheme(context.theme);
      }
      if (context.styles?.variables) {
        applyHostStyleVariables(context.styles.variables);
      }
    };
  }

  private cleanup(): void {
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.isPlaying = false;
  }

  private async connect(): Promise<void> {
    try {
      await this.app.connect();
      console.log("Connected to MCP host");
    } catch (error) {
      console.error("Failed to connect:", error);
      this.textDisplay.textContent = "Connection error";
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  }

  private async togglePlayback(): Promise<void> {
    if (this.isPlaying) {
      this.stop();
    } else {
      await this.play();
    }
  }

  private async play(): Promise<void> {
    if (!this.audioData) return;

    // Stop existing playback if play() is called while already playing
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode = null;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      const bytes = decodeBase64ToBytes(this.audioData.audio);
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);
      this.sourceNode = this.audioContext.createBufferSource();
      this.sourceNode.buffer = audioBuffer;
      this.sourceNode.connect(this.audioContext.destination);

      this.sourceNode.onended = () => {
        this.isPlaying = false;
        this.updatePlayButton();
      };

      this.sourceNode.start();
      this.isPlaying = true;
      this.updatePlayButton();
    } catch (error) {
      console.error("Playback error:", error);
    }
  }

  private stop(): void {
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this.updatePlayButton();
  }

  private updatePlayButton(): void {
    if (this.isPlaying) {
      this.playIcon.classList.add("hidden");
      this.pauseIcon.classList.remove("hidden");
    } else {
      this.playIcon.classList.remove("hidden");
      this.pauseIcon.classList.add("hidden");
    }
  }

  private download(): void {
    if (!this.audioData) return;

    const bytes = decodeBase64ToBytes(this.audioData.audio);
    const blob = new Blob([bytes], { type: this.audioData.mimeType });
    const url = URL.createObjectURL(blob);
    const extension = this.audioData.mimeType.split("/")[1] || "mp3";

    const a = document.createElement("a");
    a.href = url;
    a.download = `tts-audio.${extension}`;
    a.click();

    URL.revokeObjectURL(url);
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new TtsPlayer();
});
