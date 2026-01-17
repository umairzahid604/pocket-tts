/**
 * pocket-tts
 * Text-to-Speech with voice cloning using Kyutai's Pocket-TTS model
 */
export { PocketTTS, createTTS } from './tts';
export { GenerateOptions, VoiceListResponse, SetupStatus, PythonInfo, TTSError, PREDEFINED_VOICES, PredefinedVoice } from './types';
export { findAllPythons, findBestPython, findPythonSync } from './pythonFinder';
export { processAudio, validateAudioOptions, AudioProcessingOptions } from './audioProcessor';
import { PocketTTS } from './tts';
/**
 * Get a shared, pre-initialized TTS instance.
 * First call initializes the model (slow), subsequent calls reuse it (instant).
 *
 * @example
 * const tts = await getSharedTTS();
 * await tts.generate({ text: "Fast every time!" });
 */
export declare function getSharedTTS(): Promise<PocketTTS>;
/**
 * Close the shared TTS instance and free resources.
 */
export declare function closeSharedTTS(): void;
