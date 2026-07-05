import { TranscriptionProvider } from './types';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3';

// Groq's Whisper endpoint (like OpenAI's it's modeled on) rejects files over
// 25MB — skip the download entirely if the video is obviously too large
// rather than wasting bandwidth on a call that's guaranteed to fail.
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * Downloads the video from its (LinkedIn CDN) URL and sends the raw bytes to
 * Groq's Whisper transcription endpoint. Reuses the same GROQ_KEY_* already
 * configured for comment generation — no separate transcription account.
 */
export class GroqWhisperTranscriber implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribeFromUrl(videoUrl: string): Promise<string> {
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }

    const contentLength = Number(videoResponse.headers.get('content-length') ?? 0);
    if (contentLength > MAX_VIDEO_BYTES) {
      throw new Error(`Video is too large to transcribe (${Math.round(contentLength / 1024 / 1024)}MB, limit is 25MB)`);
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    if (videoBuffer.byteLength > MAX_VIDEO_BYTES) {
      throw new Error(`Video is too large to transcribe (${Math.round(videoBuffer.byteLength / 1024 / 1024)}MB, limit is 25MB)`);
    }

    const formData = new FormData();
    formData.append('file', new Blob([videoBuffer]), 'video.mp4');
    formData.append('model', WHISPER_MODEL);
    formData.append('response_format', 'text');

    const transcriptionResponse = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!transcriptionResponse.ok) {
      const bodyText = await transcriptionResponse.text().catch(() => '');
      throw new Error(`Groq transcription error: ${transcriptionResponse.status} ${bodyText}`);
    }

    const transcript = await transcriptionResponse.text();
    return transcript.trim();
  }
}
