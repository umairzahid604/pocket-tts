/**
 * pocket-tts
 * Text-to-Speech with voice cloning using Kyutai's Pocket-TTS model
 */

// Main class and factory
export { PocketTTS, createTTS } from './tts';

// Types
export {
    GenerateOptions,
    VoiceListResponse,
    SetupStatus,
    PythonInfo,
    TTSError,
    PREDEFINED_VOICES,
    PredefinedVoice
} from './types';

// Utilities
export { findAllPythons, findBestPython, findPythonSync } from './pythonFinder';
export { processAudio, validateAudioOptions, AudioProcessingOptions } from './audioProcessor';

// Singleton - shared pre-initialized instance
import { PocketTTS } from './tts';

let sharedInstance: PocketTTS | null = null;
let initPromise: Promise<PocketTTS> | null = null;

/**
 * Get a shared, pre-initialized TTS instance.
 * First call initializes the model (slow), subsequent calls reuse it (instant).
 * 
 * @example
 * const tts = await getSharedTTS();
 * await tts.generate({ text: "Fast every time!" });
 */
export async function getSharedTTS(): Promise<PocketTTS> {
    if (sharedInstance) {
        return sharedInstance;
    }

    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        sharedInstance = new PocketTTS();
        await sharedInstance.init();
        return sharedInstance;
    })();

    return initPromise;
}

/**
 * Close the shared TTS instance and free resources.
 */
export function closeSharedTTS(): void {
    if (sharedInstance) {
        sharedInstance.close();
        sharedInstance = null;
        initPromise = null;
    }
}
