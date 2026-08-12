import type { Transcriber } from "../../domain/ports";

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/ogg": ".ogg",
  "audio/oga": ".oga",
  "audio/mp3": ".mp3",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/flac": ".flac",
};

export class WhisperTranscriber implements Transcriber {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const ext = MIME_EXTENSIONS[mimeType] ?? ".ogg";
    const filename = `audio${ext}`;
    const blob = new Blob([audioBuffer], { type: mimeType });

    const form = new FormData();
    form.append("audio_file", blob, filename);
    form.append("task", "transcribe");
    form.append("language", "es");
    form.append("output", "txt");

    const res = await fetch(`${this.baseUrl}/asr`, { method: "POST", body: form });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Whisper API error ${res.status}: ${body}`);
    }

    const text = await res.text();
    return text.trim();
  }
}
