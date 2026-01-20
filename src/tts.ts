/**
 * PocketTTS - Main TTS class
 * Provides high-level API for text-to-speech generation
 */

import * as fs from 'fs';
import * as path from 'path';
import { PythonBridge } from './pythonBridge';
import { processAudio, validateAudioOptions } from './audioProcessor';
import { findBestPython, findPythonSync, findAllPythons } from './pythonFinder';
import {
    GenerateOptions,
    VoiceListResponse,
    SetupStatus,
    TTSError,
    PREDEFINED_VOICES
} from './types';

/**
 * Normalize text to ASCII-clean version for TTS
 * Converts Unicode punctuation and special characters that pocket-tts can't handle
 */
function normalizeText(text: string): string {
    return text
        // Smart quotes to regular
        .replace(/[''`]/g, "'")
        .replace(/[""„]/g, '"')
        // Dashes and hyphens
        .replace(/[—–−]/g, '-')
        // Ellipsis
        .replace(/…/g, '...')
        // Ampersand - replace with "and"
        .replace(/&/g, ' and ')
        // Other problematic characters
        .replace(/[•·]/g, '-')      // Bullets
        .replace(/[©®™]/g, '')      // Copyright/trademark
        .replace(/[°]/g, ' degrees ')
        .replace(/[€£¥₹]/g, '$')    // Currency symbols
        .replace(/[×]/g, 'x')       // Multiplication
        .replace(/[÷]/g, '/')       // Division
        // Clean up extra spaces
        .replace(/\s+/g, ' ')
        .trim();
}

export class PocketTTS {
    private bridge: PythonBridge;
    private initialized = false;

    // Static cache for setup status (computed once, reused)
    private static _cachedSetupStatus: SetupStatus | null = null;
    private static _setupCheckInProgress: Promise<SetupStatus> | null = null;

    constructor() {
        this.bridge = new PythonBridge();
    }

    /**
     * Clear the cached setup status (call this if system changes)
     */
    static clearCache(): void {
        PocketTTS._cachedSetupStatus = null;
        PocketTTS._setupCheckInProgress = null;
    }

    /**
     * Check system setup status
     * Call this before init() to verify requirements are met.
     * Results are cached - call clearCache() to force re-check.
     */
    static async checkSetup(): Promise<SetupStatus> {
        // Return cached result if available
        if (PocketTTS._cachedSetupStatus) {
            return PocketTTS._cachedSetupStatus;
        }

        // If check is already in progress, wait for it
        if (PocketTTS._setupCheckInProgress) {
            return PocketTTS._setupCheckInProgress;
        }

        // Start new check
        PocketTTS._setupCheckInProgress = PocketTTS._doCheckSetup();
        try {
            PocketTTS._cachedSetupStatus = await PocketTTS._setupCheckInProgress;
            return PocketTTS._cachedSetupStatus;
        } finally {
            PocketTTS._setupCheckInProgress = null;
        }
    }

    /**
     * Internal method that actually performs the setup check
     */
    private static async _doCheckSetup(): Promise<SetupStatus> {
        const pythonInfo = await findBestPython();

        if (!pythonInfo) {
            return {
                pythonInstalled: false,
                pythonVersion: null,
                pythonCommand: null,
                pythonPath: null,
                pocketTtsInstalled: false,
                voiceCloningAvailable: false,
                huggingFaceLoggedIn: false,
                setupComplete: false
            };
        }

        // Check pocket-tts and voice cloning via direct Python call
        const checkScript = `
import sys
import json

result = {
    "pocketTtsInstalled": False,
    "voiceCloningAvailable": False,
    "huggingFaceLoggedIn": False,
    "setupComplete": False
}

try:
    from pocket_tts import TTSModel
    result["pocketTtsInstalled"] = True
    result["setupComplete"] = True
    
    # Check HF login
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        result["huggingFaceLoggedIn"] = api.token is not None
    except: pass
    
    # Check voice cloning (try loading model briefly)
    try:
        model = TTSModel.load_model()
        result["voiceCloningAvailable"] = getattr(model, 'has_voice_cloning', False)
        del model
    except: pass
except ImportError:
    pass

print(json.dumps(result))
`;

        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            const parts = pythonInfo.command.split(' ');
            const cmd = parts[0];
            const args = [...parts.slice(1), '-c', checkScript];

            const proc = spawn(cmd, args, {
                timeout: 60000,
                shell: process.platform === 'win32'
            });

            let stdout = '';
            proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });

            proc.on('close', (code: number) => {
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve({
                        pythonInstalled: true,
                        pythonVersion: pythonInfo.version,
                        pythonCommand: pythonInfo.command,
                        pythonPath: pythonInfo.path,
                        ...result
                    });
                } catch {
                    resolve({
                        pythonInstalled: true,
                        pythonVersion: pythonInfo.version,
                        pythonCommand: pythonInfo.command,
                        pythonPath: pythonInfo.path,
                        pocketTtsInstalled: pythonInfo.hasPocketTts,
                        voiceCloningAvailable: false,
                        huggingFaceLoggedIn: false,
                        setupComplete: pythonInfo.hasPocketTts
                    });
                }
            });

            proc.on('error', () => {
                resolve({
                    pythonInstalled: true,
                    pythonVersion: pythonInfo.version,
                    pythonCommand: pythonInfo.command,
                    pythonPath: pythonInfo.path,
                    pocketTtsInstalled: false,
                    voiceCloningAvailable: false,
                    huggingFaceLoggedIn: false,
                    setupComplete: false
                });
            });
        });
    }

    /**
     * Get setup instructions based on current status
     */
    static getSetupInstructions(status: SetupStatus): string {
        const instructions: string[] = [];

        if (!status.pythonInstalled) {
            instructions.push(
                '1. Install Python 3.10 or higher:',
                '   - Download from: https://www.python.org/downloads/',
                '   - Make sure to check "Add Python to PATH" during installation'
            );
        } else if (!status.pocketTtsInstalled) {
            instructions.push(
                `1. Install pocket-tts package (using ${status.pythonCommand}):`,
                `   ${status.pythonCommand} -m pip install pocket-tts`
            );
        }

        if (status.pocketTtsInstalled && !status.voiceCloningAvailable) {
            instructions.push(
                '',
                'Voice Cloning Setup (optional):',
                '   1. Accept terms at: https://huggingface.co/kyutai/pocket-tts',
                '   2. Login with: uvx hf auth login',
                '',
                'Note: Predefined voices (alba, marius, etc.) work without this setup.'
            );
        }

        if (instructions.length === 0) {
            return 'Setup complete! You can use PocketTTS.';
        }

        return instructions.join('\n');
    }

    /**
     * Initialize the TTS engine
     * Must be called before generate()
     */
    async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.bridge.start();
        await this.bridge.initModel();
        this.initialized = true;
    }

    /**
     * Generate speech from text
     * @returns Audio buffer (WAV format)
     */
    async generate(options: GenerateOptions): Promise<Buffer> {
        if (!this.initialized) {
            await this.init();
        }

        const {
            text,
            voice = 'alba',
            volume = 1.0,
            playbackSpeed = 1.0,
            outputPath
        } = options;

        // Validate audio options
        validateAudioOptions({ volume, playbackSpeed });

        // Validate text
        if (!text || text.trim().length === 0) {
            const error = new Error('Text cannot be empty') as TTSError;
            error.code = 'GENERATION_FAILED';
            throw error;
        }

        // Normalize text to ASCII-clean version
        const normalizedText = normalizeText(text);

        // Generate audio via Python bridge
        let audioBuffer = await this.bridge.generate(normalizedText, voice);

        // Apply audio processing if needed
        if (volume !== 1.0 || playbackSpeed !== 1.0) {
            audioBuffer = await processAudio(audioBuffer, { volume, playbackSpeed });
        }

        // Save to file if outputPath specified
        if (outputPath) {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(outputPath, audioBuffer);
        }

        return audioBuffer;
    }

    /**
     * Generate speech and save directly to file
     * @returns Path to the saved file
     */
    async generateToFile(options: GenerateOptions & { outputPath: string }): Promise<string> {
        await this.generate(options);
        return options.outputPath;
    }

    /**
     * Get list of available voices
     */
    async getVoicesList(): Promise<VoiceListResponse> {
        if (!this.initialized) {
            await this.init();
        }

        const voices = await this.bridge.getVoicesList();
        return {
            voices,
            default: 'alba',
            total: voices.length
        };
    }

    /**
     * Pre-load a voice for faster generation
     */
    async loadVoice(voice: string): Promise<void> {
        if (!this.initialized) {
            await this.init();
        }
        await this.bridge.loadVoice(voice);
    }

    /**
     * Check if a voice is a predefined voice (no voice cloning needed)
     */
    static isPredefinedVoice(voice: string): boolean {
        return PREDEFINED_VOICES.includes(voice as any);
    }

    /**
     * Close the TTS engine and cleanup resources
     */
    close(): void {
        this.bridge.close();
        this.initialized = false;
    }
}

/**
 * Factory function for quick initialization
 */
export function createTTS(): PocketTTS {
    return new PocketTTS();
}
