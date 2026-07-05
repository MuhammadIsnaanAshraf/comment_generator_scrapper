/**
 * Abstraction over "turn a video URL into a text transcript" so the
 * transcription backend (currently Groq Whisper) can be swapped later
 * without touching any caller.
 */
export interface TranscriptionProvider {
  transcribeFromUrl(videoUrl: string): Promise<string>;
}
