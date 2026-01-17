/**
 * Type definitions for pocket-tts
 */

export interface GenerateOptions {
    /** Text to convert to speech */
    text: string;
    /** Voice name (alba, marius, etc.) or path to .wav file for voice cloning */
    voice?: string;
    /** Output file path. If provided, saves audio directly to file */
    outputPath?: string;
    /** Volume level: 0.0 (silent) to 2.0 (2x volume). Default: 1.0 */
    volume?: number;
    /** Playback speed: 0.5 (half speed) to 2.0 (2x speed). Default: 1.0 */
    playbackSpeed?: number;
}

export interface VoiceListResponse {
    /** List of available voice names */
    voices: string[];
    /** Default voice name */
    default: string;
    /** Total number of voices */
    total: number;
}

export interface SetupStatus {
    /** Whether a compatible Python (3.10+) is installed */
    pythonInstalled: boolean;
    /** Python version string (e.g., "3.11.5") or null if not found */
    pythonVersion: string | null;
    /** Command to invoke Python (e.g., "python3.11" or "py -3.11") */
    pythonCommand: string | null;
    /** Full path to Python executable */
    pythonPath: string | null;
    /** Whether pocket-tts pip package is installed */
    pocketTtsInstalled: boolean;
    /** Whether voice cloning model is available (requires HF terms acceptance) */
    voiceCloningAvailable: boolean;
    /** Whether user is logged into HuggingFace */
    huggingFaceLoggedIn: boolean;
    /** Whether basic TTS is ready (predefined voices work) */
    setupComplete: boolean;
}

export interface PythonInfo {
    /** Command to invoke this Python (e.g., "python3.11") */
    command: string;
    /** Python version (e.g., "3.11.5") */
    version: string;
    /** Full path to Python executable */
    path: string;
    /** Whether pocket-tts is installed in this Python */
    hasPocketTts: boolean;
}

export interface TTSError extends Error {
    /** Error code for programmatic handling */
    code: 'PYTHON_NOT_FOUND' | 'POCKET_TTS_NOT_INSTALLED' | 'VOICE_CLONING_NOT_AVAILABLE' |
    'INVALID_VOICE' | 'GENERATION_FAILED' | 'FFMPEG_ERROR' | 'BRIDGE_ERROR';
    /** Setup instructions if applicable */
    setupInstructions?: string;
}

/** Predefined voice names available without voice cloning */
export const PREDEFINED_VOICES = [
    'alba', 'marius', 'javert', 'jean', 'fantine', 'cosette', 'eponine', 'azelma'
] as const;

export type PredefinedVoice = typeof PREDEFINED_VOICES[number];
