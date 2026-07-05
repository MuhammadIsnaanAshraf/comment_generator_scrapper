import { GroqWhisperTranscriber } from './groq-whisper-transcriber';
import { TranscriptionProvider } from './types';

export type { TranscriptionProvider } from './types';

/**
 * Single swap point: to move off Groq Whisper (e.g. to AssemblyAI or
 * Deepgram), implement TranscriptionProvider in a new file and return an
 * instance of it here instead. Every caller only depends on
 * TranscriptionProvider, never on Groq-specific details.
 */
export function getTranscriber(): TranscriptionProvider {
  const apiKey = process.env.GROQ_KEY_1;
  if (!apiKey) {
    throw new Error('GROQ_KEY_1 is not set. Add it to backend/.env');
  }
  return new GroqWhisperTranscriber(apiKey);
}
