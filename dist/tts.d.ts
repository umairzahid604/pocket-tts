/**
 * PocketTTS - Main TTS class
 * Provides high-level API for text-to-speech generation
 */
import { GenerateOptions, VoiceListResponse, SetupStatus } from './types';
export declare class PocketTTS {
    private bridge;
    private initialized;
    private static _cachedSetupStatus;
    private static _setupCheckInProgress;
    constructor();
    /**
     * Clear the cached setup status (call this if system changes)
     */
    static clearCache(): void;
    /**
     * Check system setup status
     * Call this before init() to verify requirements are met.
     * Results are cached - call clearCache() to force re-check.
     */
    static checkSetup(): Promise<SetupStatus>;
    /**
     * Internal method that actually performs the setup check
     */
    private static _doCheckSetup;
    /**
     * Get setup instructions based on current status
     */
    static getSetupInstructions(status: SetupStatus): string;
    /**
     * Initialize the TTS engine
     * Must be called before generate()
     */
    init(): Promise<void>;
    /**
     * Generate speech from text
     * @returns Audio buffer (WAV format)
     */
    generate(options: GenerateOptions): Promise<Buffer>;
    /**
     * Generate speech and save directly to file
     * @returns Path to the saved file
     */
    generateToFile(options: GenerateOptions & {
        outputPath: string;
    }): Promise<string>;
    /**
     * Get list of available voices
     */
    getVoicesList(): Promise<VoiceListResponse>;
    /**
     * Pre-load a voice for faster generation
     */
    loadVoice(voice: string): Promise<void>;
    /**
     * Check if a voice is a predefined voice (no voice cloning needed)
     */
    static isPredefinedVoice(voice: string): boolean;
    /**
     * Close the TTS engine and cleanup resources
     */
    close(): void;
}
/**
 * Factory function for quick initialization
 */
export declare function createTTS(): PocketTTS;
