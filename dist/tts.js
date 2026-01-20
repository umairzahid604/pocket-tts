"use strict";
/**
 * PocketTTS - Main TTS class
 * Provides high-level API for text-to-speech generation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PocketTTS = void 0;
exports.createTTS = createTTS;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pythonBridge_1 = require("./pythonBridge");
const audioProcessor_1 = require("./audioProcessor");
const pythonFinder_1 = require("./pythonFinder");
const types_1 = require("./types");
/**
 * Normalize text to ASCII-clean version for TTS
 * Converts Unicode punctuation and special characters that pocket-tts can't handle
 */
function normalizeText(text) {
    return text
        // Smart/curly quotes and apostrophes - comprehensive Unicode coverage
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`']/g, "'") // All single quotes/apostrophes
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036""„]/g, '"') // All double quotes
        // Dashes, hyphens, minus signs
        .replace(/[\u2014\u2013\u2012\u2011\u2010\u2212—–−‐‑‒]/g, '-')
        // Ellipsis
        .replace(/[\u2026…]/g, '...')
        // Ampersand - replace with "and"
        .replace(/&/g, ' and ')
        // Newlines to spaces (important for multiline text)
        .replace(/[\r\n]+/g, ' ')
        // Other problematic characters
        .replace(/[•·●○◦‣⁃]/g, '-') // All bullet types
        .replace(/[©®™℠]/g, '') // Copyright/trademark
        .replace(/[°]/g, ' degrees ')
        .replace(/[€£¥₹₽₿¢]/g, '$') // Currency symbols
        .replace(/[×✕✖]/g, 'x') // Multiplication/cross marks
        .replace(/[÷]/g, '/') // Division
        .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, '') // Fractions - remove
        .replace(/[←→↑↓↔↕]/g, '') // Arrows - remove
        // Clean up extra spaces
        .replace(/\s+/g, ' ')
        .trim();
}
class PocketTTS {
    constructor() {
        this.initialized = false;
        this.bridge = new pythonBridge_1.PythonBridge();
    }
    /**
     * Clear the cached setup status (call this if system changes)
     */
    static clearCache() {
        PocketTTS._cachedSetupStatus = null;
        PocketTTS._setupCheckInProgress = null;
    }
    /**
     * Check system setup status
     * Call this before init() to verify requirements are met.
     * Results are cached - call clearCache() to force re-check.
     */
    static async checkSetup() {
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
        }
        finally {
            PocketTTS._setupCheckInProgress = null;
        }
    }
    /**
     * Internal method that actually performs the setup check
     */
    static async _doCheckSetup() {
        const pythonInfo = await (0, pythonFinder_1.findBestPython)();
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
            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.on('close', (code) => {
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve({
                        pythonInstalled: true,
                        pythonVersion: pythonInfo.version,
                        pythonCommand: pythonInfo.command,
                        pythonPath: pythonInfo.path,
                        ...result
                    });
                }
                catch {
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
    static getSetupInstructions(status) {
        const instructions = [];
        if (!status.pythonInstalled) {
            instructions.push('1. Install Python 3.10 or higher:', '   - Download from: https://www.python.org/downloads/', '   - Make sure to check "Add Python to PATH" during installation');
        }
        else if (!status.pocketTtsInstalled) {
            instructions.push(`1. Install pocket-tts package (using ${status.pythonCommand}):`, `   ${status.pythonCommand} -m pip install pocket-tts`);
        }
        if (status.pocketTtsInstalled && !status.voiceCloningAvailable) {
            instructions.push('', 'Voice Cloning Setup (optional):', '   1. Accept terms at: https://huggingface.co/kyutai/pocket-tts', '   2. Login with: uvx hf auth login', '', 'Note: Predefined voices (alba, marius, etc.) work without this setup.');
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
    async init() {
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
    async generate(options) {
        if (!this.initialized) {
            await this.init();
        }
        const { text, voice = 'alba', volume = 1.0, playbackSpeed = 1.0, outputPath } = options;
        // Validate audio options
        (0, audioProcessor_1.validateAudioOptions)({ volume, playbackSpeed });
        // Validate text
        if (!text || text.trim().length === 0) {
            const error = new Error('Text cannot be empty');
            error.code = 'GENERATION_FAILED';
            throw error;
        }
        // Normalize text to ASCII-clean version
        const normalizedText = normalizeText(text);
        // Generate audio via Python bridge
        let audioBuffer = await this.bridge.generate(normalizedText, voice);
        // Apply audio processing if needed
        if (volume !== 1.0 || playbackSpeed !== 1.0) {
            audioBuffer = await (0, audioProcessor_1.processAudio)(audioBuffer, { volume, playbackSpeed });
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
    async generateToFile(options) {
        await this.generate(options);
        return options.outputPath;
    }
    /**
     * Get list of available voices
     */
    async getVoicesList() {
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
    async loadVoice(voice) {
        if (!this.initialized) {
            await this.init();
        }
        await this.bridge.loadVoice(voice);
    }
    /**
     * Check if a voice is a predefined voice (no voice cloning needed)
     */
    static isPredefinedVoice(voice) {
        return types_1.PREDEFINED_VOICES.includes(voice);
    }
    /**
     * Close the TTS engine and cleanup resources
     */
    close() {
        this.bridge.close();
        this.initialized = false;
    }
}
exports.PocketTTS = PocketTTS;
// Static cache for setup status (computed once, reused)
PocketTTS._cachedSetupStatus = null;
PocketTTS._setupCheckInProgress = null;
/**
 * Factory function for quick initialization
 */
function createTTS() {
    return new PocketTTS();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3R0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFtV0gsOEJBRUM7QUFuV0QsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3QixpREFBOEM7QUFDOUMscURBQXNFO0FBQ3RFLGlEQUFnRjtBQUNoRixtQ0FNaUI7QUFFakI7OztHQUdHO0FBQ0gsU0FBUyxhQUFhLENBQUMsSUFBWTtJQUMvQixPQUFPLElBQUk7UUFDUCxzRUFBc0U7U0FDckUsT0FBTyxDQUFDLDJDQUEyQyxFQUFFLEdBQUcsQ0FBQyxDQUFFLGdDQUFnQztTQUMzRixPQUFPLENBQUMsNENBQTRDLEVBQUUsR0FBRyxDQUFDLENBQUMsb0JBQW9CO1FBQ2hGLCtCQUErQjtTQUM5QixPQUFPLENBQUMsK0NBQStDLEVBQUUsR0FBRyxDQUFDO1FBQzlELFdBQVc7U0FDVixPQUFPLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQztRQUM3QixpQ0FBaUM7U0FDaEMsT0FBTyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUM7UUFDdkIsb0RBQW9EO1NBQ25ELE9BQU8sQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDO1FBQ3pCLCtCQUErQjtTQUM5QixPQUFPLENBQUMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxDQUFHLG1CQUFtQjtTQUNoRCxPQUFPLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFRLHNCQUFzQjtTQUNwRCxPQUFPLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQztTQUM1QixPQUFPLENBQUMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxDQUFJLG1CQUFtQjtTQUNqRCxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFRLDZCQUE2QjtTQUMzRCxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFXLFdBQVc7U0FDMUMsT0FBTyxDQUFDLG9C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Q3RCLENBQUM7UUFDRCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZDLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFhO1FBQ2xDLE9BQU8seUJBQWlCLENBQUMsUUFBUSxDQUFDLEtBQVksQ0FBQyxDQUFDO0lBQ3BELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUs7UUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO0lBQzdCLENBQUM7O0FBL1NMLDhCQWdUQztBQTVTRyx3REFBd0Q7QUFDekMsNEJBQWtCLEdBQXVCLElBQUksQUFBM0IsQ0FBNEI7QUFDOUMsK0JBQXFCLEdBQWdDLElBQUksQUFBcEMsQ0FBcUM7QUE0UzdFOztHQUVHO0FBQ0gsU0FBZ0IsU0FBUztJQUNyQixPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7QUFDM0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQb2NrZXRUVFMgLSBNYWluIFRUUyBjbGFzc1xyXG4gKiBQcm92aWRlcyBoaWdoLWxldmVsIEFQSSBmb3IgdGV4dC10by1zcGVlY2ggZ2VuZXJhdGlvblxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgUHl0aG9uQnJpZGdlIH0gZnJvbSAnLi9weXRob25CcmlkZ2UnO1xyXG5pbXBvcnQgeyBwcm9jZXNzQXVkaW8sIHZhbGlkYXRlQXVkaW9PcHRpb25zIH0gZnJvbSAnLi9hdWRpb1Byb2Nlc3Nvcic7XHJcbmltcG9ydCB7IGZpbmRCZXN0UHl0aG9uLCBmaW5kUHl0aG9uU3luYywgZmluZEFsbFB5dGhvbnMgfSBmcm9tICcuL3B5dGhvbkZpbmRlcic7XHJcbmltcG9ydCB7XHJcbiAgICBHZW5lcmF0ZU9wdGlvbnMsXHJcbiAgICBWb2ljZUxpc3RSZXNwb25zZSxcclxuICAgIFNldHVwU3RhdHVzLFxyXG4gICAgVFRTRXJyb3IsXHJcbiAgICBQUkVERUZJTkVEX1ZPSUNFU1xyXG59IGZyb20gJy4vdHlwZXMnO1xyXG5cclxuLyoqXHJcbiAqIE5vcm1hbGl6ZSB0ZXh0IHRvIEFTQ0lJLWNsZWFuIHZlcnNpb24gZm9yIFRUU1xyXG4gKiBDb252ZXJ0cyBVbmljb2RlIHB1bmN0dWF0aW9uIGFuZCBzcGVjaWFsIGNoYXJhY3RlcnMgdGhhdCBwb2NrZXQtdHRzIGNhbid0IGhhbmRsZVxyXG4gKi9cclxuZnVuY3Rpb24gbm9ybWFsaXplVGV4dCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIHRleHRcclxuICAgICAgICAvLyBTbWFydC9jdXJseSBxdW90ZXMgYW5kIGFwb3N0cm9waGVzIC0gY29tcHJlaGVuc2l2ZSBVbmljb2RlIGNvdmVyYWdlXHJcbiAgICAgICAgLnJlcGxhY2UoL1tcXHUyMDE4XFx1MjAxOVxcdTIwMUFcXHUyMDFCXFx1MjAzMlxcdTIwMzVgJ10vZywgXCInXCIpICAvLyBBbGwgc2luZ2xlIHF1b3Rlcy9hcG9zdHJvcGhlc1xyXG4gICAgICAgIC5yZXBsYWNlKC9bXFx1MjAxQ1xcdTIwMURcXHUyMDFFXFx1MjAxRlxcdTIwMzNcXHUyMDM2XCJcIuKAnl0vZywgJ1wiJykgLy8gQWxsIGRvdWJsZSBxdW90ZXNcclxuICAgICAgICAvLyBEYXNoZXMsIGh5cGhlbnMsIG1pbnVzIHNpZ25zXHJcbiAgICAgICAgLnJlcGxhY2UoL1tcXHUyMDE0XFx1MjAxM1xcdTIwMTJcXHUyMDExXFx1MjAxMFxcdTIyMTLigJTigJPiiJLigJDigJHigJJdL2csICctJylcclxuICAgICAgICAvLyBFbGxpcHNpc1xyXG4gICAgICAgIC5yZXBsYWNlKC9bXFx1MjAyNuKApl0vZywgJy4uLicpXHJcbiAgICAgICAgLy8gQW1wZXJzYW5kIC0gcmVwbGFjZSB3aXRoIFwiYW5kXCJcclxuICAgICAgICAucmVwbGFjZSgvJi9nLCAnIGFuZCAnKVxyXG4gICAgICAgIC8vIE5ld2xpbmVzIHRvIHNwYWNlcyAoaW1wb3J0YW50IGZvciBtdWx0aWxpbmUgdGV4dClcclxuICAgICAgICAucmVwbGFjZSgvW1xcclxcbl0rL2csICcgJylcclxuICAgICAgICAvLyBPdGhlciBwcm9ibGVtYXRpYyBjaGFyYWN0ZXJzXHJcbiAgICAgICAgLnJlcGxhY2UoL1vigKLCt+KXj+KXi+KXpuKAo+KBg10vZywgJy0nKSAgIC8vIEFsbCBidWxsZXQgdHlwZXNcclxuICAgICAgICAucmVwbGFjZSgvW8Kpwq7ihKLihKBdL2csICcnKSAgICAgICAgLy8gQ29weXJpZ2h0L3RyYWRlbWFya1xyXG4gICAgICAgIC5yZXBsYWNlKC9bwrBdL2csICcgZGVncmVlcyAnKVxyXG4gICAgICAgIC5yZXBsYWNlKC9b4oKswqPCpeKCueKCveKCv8KiXS9nLCAnJCcpICAgIC8vIEN1cnJlbmN5IHN5bWJvbHNcclxuICAgICAgICAucmVwbGFjZSgvW8OX4pyV4pyWXS9nLCAneCcpICAgICAgICAvLyBNdWx0aXBsaWNhdGlvbi9jcm9zcyBtYXJrc1xyXG4gICAgICAgIC5yZXBsYWNlKC9bw7ddL2csICcvJykgICAgICAgICAgIC8vIERpdmlzaW9uXHJcbiAgICAgICAgLnJlcGxhY2UoL1vCveKFk+KFlMK8wr7ihZXihZbihZfihZjihZnihZrihZvihZzihZ3ihZ5dL2csICcnKSAvLyBGcmFjdGlvbnMgLSByZW1vdmVcclxuICAgICAgICAucmVwbGFjZSgvW+KGkOKGkuKGkeKGk+KGlOKGlV0vZywgJycpICAgICAgLy8gQXJyb3dzIC0gcmVtb3ZlXHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgZXh0cmEgc3BhY2VzXHJcbiAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxyXG4gICAgICAgIC50cmltKCk7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQb2NrZXRUVFMge1xyXG4gICAgcHJpdmF0ZSBicmlkZ2U6IFB5dGhvbkJyaWRnZTtcclxuICAgIHByaXZhdGUgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuXHJcbiAgICAvLyBTdGF0aWMgY2FjaGUgZm9yIHNldHVwIHN0YXR1cyAoY29tcHV0ZWQgb25jZSwgcmV1c2VkKVxyXG4gICAgcHJpdmF0ZSBzdGF0aWMgX2NhY2hlZFNldHVwU3RhdHVzOiBTZXR1cFN0YXR1cyB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSBzdGF0aWMgX3NldHVwQ2hlY2tJblByb2dyZXNzOiBQcm9taXNlPFNldHVwU3RhdHVzPiB8IG51bGwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIHRoaXMuYnJpZGdlID0gbmV3IFB5dGhvbkJyaWRnZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xlYXIgdGhlIGNhY2hlZCBzZXR1cCBzdGF0dXMgKGNhbGwgdGhpcyBpZiBzeXN0ZW0gY2hhbmdlcylcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGNsZWFyQ2FjaGUoKTogdm9pZCB7XHJcbiAgICAgICAgUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cyA9IG51bGw7XHJcbiAgICAgICAgUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcyA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBzeXN0ZW0gc2V0dXAgc3RhdHVzXHJcbiAgICAgKiBDYWxsIHRoaXMgYmVmb3JlIGluaXQoKSB0byB2ZXJpZnkgcmVxdWlyZW1lbnRzIGFyZSBtZXQuXHJcbiAgICAgKiBSZXN1bHRzIGFyZSBjYWNoZWQgLSBjYWxsIGNsZWFyQ2FjaGUoKSB0byBmb3JjZSByZS1jaGVjay5cclxuICAgICAqL1xyXG4gICAgc3RhdGljIGFzeW5jIGNoZWNrU2V0dXAoKTogUHJvbWlzZTxTZXR1cFN0YXR1cz4ge1xyXG4gICAgICAgIC8vIFJldHVybiBjYWNoZWQgcmVzdWx0IGlmIGF2YWlsYWJsZVxyXG4gICAgICAgIGlmIChQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSWYgY2hlY2sgaXMgYWxyZWFkeSBpbiBwcm9ncmVzcywgd2FpdCBmb3IgaXRcclxuICAgICAgICBpZiAoUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcykge1xyXG4gICAgICAgICAgICByZXR1cm4gUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFN0YXJ0IG5ldyBjaGVja1xyXG4gICAgICAgIFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3MgPSBQb2NrZXRUVFMuX2RvQ2hlY2tTZXR1cCgpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXMgPSBhd2FpdCBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzO1xyXG4gICAgICAgICAgICByZXR1cm4gUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cztcclxuICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBJbnRlcm5hbCBtZXRob2QgdGhhdCBhY3R1YWxseSBwZXJmb3JtcyB0aGUgc2V0dXAgY2hlY2tcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgX2RvQ2hlY2tTZXR1cCgpOiBQcm9taXNlPFNldHVwU3RhdHVzPiB7XHJcbiAgICAgICAgY29uc3QgcHl0aG9uSW5mbyA9IGF3YWl0IGZpbmRCZXN0UHl0aG9uKCk7XHJcblxyXG4gICAgICAgIGlmICghcHl0aG9uSW5mbykge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHB5dGhvblZlcnNpb246IG51bGwsXHJcbiAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogbnVsbCxcclxuICAgICAgICAgICAgICAgIHBvY2tldFR0c0luc3RhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICB2b2ljZUNsb25pbmdBdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgaHVnZ2luZ0ZhY2VMb2dnZWRJbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBzZXR1cENvbXBsZXRlOiBmYWxzZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2sgcG9ja2V0LXR0cyBhbmQgdm9pY2UgY2xvbmluZyB2aWEgZGlyZWN0IFB5dGhvbiBjYWxsXHJcbiAgICAgICAgY29uc3QgY2hlY2tTY3JpcHQgPSBgXHJcbmltcG9ydCBzeXNcclxuaW1wb3J0IGpzb25cclxuXHJcbnJlc3VsdCA9IHtcclxuICAgIFwicG9ja2V0VHRzSW5zdGFsbGVkXCI6IEZhbHNlLFxyXG4gICAgXCJ2b2ljZUNsb25pbmdBdmFpbGFibGVcIjogRmFsc2UsXHJcbiAgICBcImh1Z2dpbmdGYWNlTG9nZ2VkSW5cIjogRmFsc2UsXHJcbiAgICBcInNldHVwQ29tcGxldGVcIjogRmFsc2VcclxufVxyXG5cclxudHJ5OlxyXG4gICAgZnJvbSBwb2NrZXRfdHRzIGltcG9ydCBUVFNNb2RlbFxyXG4gICAgcmVzdWx0W1wicG9ja2V0VHRzSW5zdGFsbGVkXCJdID0gVHJ1ZVxyXG4gICAgcmVzdWx0W1wic2V0dXBDb21wbGV0ZVwiXSA9IFRydWVcclxuICAgIFxyXG4gICAgIyBDaGVjayBIRiBsb2dpblxyXG4gICAgdHJ5OlxyXG4gICAgICAgIGZyb20gaHVnZ2luZ2ZhY2VfaHViIGltcG9ydCBIZkFwaVxyXG4gICAgICAgIGFwaSA9IEhmQXBpKClcclxuICAgICAgICByZXN1bHRbXCJodWdnaW5nRmFjZUxvZ2dlZEluXCJdID0gYXBpLnRva2VuIGlzIG5vdCBOb25lXHJcbiAgICBleGNlcHQ6IHBhc3NcclxuICAgIFxyXG4gICAgIyBDaGVjayB2b2ljZSBjbG9uaW5nICh0cnkgbG9hZGluZyBtb2RlbCBicmllZmx5KVxyXG4gICAgdHJ5OlxyXG4gICAgICAgIG1vZGVsID0gVFRTTW9kZWwubG9hZF9tb2RlbCgpXHJcbiAgICAgICAgcmVzdWx0W1widm9pY2VDbG9uaW5nQXZhaWxhYmxlXCJdID0gZ2V0YXR0cihtb2RlbCwgJ2hhc192b2ljZV9jbG9uaW5nJywgRmFsc2UpXHJcbiAgICAgICAgZGVsIG1vZGVsXHJcbiAgICBleGNlcHQ6IHBhc3NcclxuZXhjZXB0IEltcG9ydEVycm9yOlxyXG4gICAgcGFzc1xyXG5cclxucHJpbnQoanNvbi5kdW1wcyhyZXN1bHQpKVxyXG5gO1xyXG5cclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgeyBzcGF3biB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xyXG4gICAgICAgICAgICBjb25zdCBwYXJ0cyA9IHB5dGhvbkluZm8uY29tbWFuZC5zcGxpdCgnICcpO1xyXG4gICAgICAgICAgICBjb25zdCBjbWQgPSBwYXJ0c1swXTtcclxuICAgICAgICAgICAgY29uc3QgYXJncyA9IFsuLi5wYXJ0cy5zbGljZSgxKSwgJy1jJywgY2hlY2tTY3JpcHRdO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgcHJvYyA9IHNwYXduKGNtZCwgYXJncywge1xyXG4gICAgICAgICAgICAgICAgdGltZW91dDogNjAwMDAsXHJcbiAgICAgICAgICAgICAgICBzaGVsbDogcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGxldCBzdGRvdXQgPSAnJztcclxuICAgICAgICAgICAgcHJvYy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YTogQnVmZmVyKSA9PiB7IHN0ZG91dCArPSBkYXRhLnRvU3RyaW5nKCk7IH0pO1xyXG5cclxuICAgICAgICAgICAgcHJvYy5vbignY2xvc2UnLCAoY29kZTogbnVtYmVyKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2Uoc3Rkb3V0LnRyaW0oKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uVmVyc2lvbjogcHl0aG9uSW5mby52ZXJzaW9uLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBweXRob25JbmZvLmNvbW1hbmQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IHB5dGhvbkluZm8ucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ucmVzdWx0XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBweXRob25JbmZvLnZlcnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkNvbW1hbmQ6IHB5dGhvbkluZm8uY29tbWFuZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogcHl0aG9uSW5mby5wYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwb2NrZXRUdHNJbnN0YWxsZWQ6IHB5dGhvbkluZm8uaGFzUG9ja2V0VHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2b2ljZUNsb25pbmdBdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBodWdnaW5nRmFjZUxvZ2dlZEluOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0dXBDb21wbGV0ZTogcHl0aG9uSW5mby5oYXNQb2NrZXRUdHNcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBwcm9jLm9uKCdlcnJvcicsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBweXRob25JbmZvLnZlcnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcHl0aG9uQ29tbWFuZDogcHl0aG9uSW5mby5jb21tYW5kLFxyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IHB5dGhvbkluZm8ucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBwb2NrZXRUdHNJbnN0YWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHZvaWNlQ2xvbmluZ0F2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgaHVnZ2luZ0ZhY2VMb2dnZWRJbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgc2V0dXBDb21wbGV0ZTogZmFsc2VcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBzZXR1cCBpbnN0cnVjdGlvbnMgYmFzZWQgb24gY3VycmVudCBzdGF0dXNcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGdldFNldHVwSW5zdHJ1Y3Rpb25zKHN0YXR1czogU2V0dXBTdGF0dXMpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IGluc3RydWN0aW9uczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgaWYgKCFzdGF0dXMucHl0aG9uSW5zdGFsbGVkKSB7XHJcbiAgICAgICAgICAgIGluc3RydWN0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgJzEuIEluc3RhbGwgUHl0aG9uIDMuMTAgb3IgaGlnaGVyOicsXHJcbiAgICAgICAgICAgICAgICAnICAgLSBEb3dubG9hZCBmcm9tOiBodHRwczovL3d3dy5weXRob24ub3JnL2Rvd25sb2Fkcy8nLFxyXG4gICAgICAgICAgICAgICAgJyAgIC0gTWFrZSBzdXJlIHRvIGNoZWNrIFwiQWRkIFB5dGhvbiB0byBQQVRIXCIgZHVyaW5nIGluc3RhbGxhdGlvbidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9IGVsc2UgaWYgKCFzdGF0dXMucG9ja2V0VHRzSW5zdGFsbGVkKSB7XHJcbiAgICAgICAgICAgIGluc3RydWN0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgYDEuIEluc3RhbGwgcG9ja2V0LXR0cyBwYWNrYWdlICh1c2luZyAke3N0YXR1cy5weXRob25Db21tYW5kfSk6YCxcclxuICAgICAgICAgICAgICAgIGAgICAke3N0YXR1cy5weXRob25Db21tYW5kfSAtbSBwaXAgaW5zdGFsbCBwb2NrZXQtdHRzYFxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHN0YXR1cy5wb2NrZXRUdHNJbnN0YWxsZWQgJiYgIXN0YXR1cy52b2ljZUNsb25pbmdBdmFpbGFibGUpIHtcclxuICAgICAgICAgICAgaW5zdHJ1Y3Rpb25zLnB1c2goXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgICdWb2ljZSBDbG9uaW5nIFNldHVwIChvcHRpb25hbCk6JyxcclxuICAgICAgICAgICAgICAgICcgICAxLiBBY2NlcHQgdGVybXMgYXQ6IGh0dHBzOi8vaHVnZ2luZ2ZhY2UuY28va3l1dGFpL3BvY2tldC10dHMnLFxyXG4gICAgICAgICAgICAgICAgJyAgIDIuIExvZ2luIHdpdGg6IHV2eCBoZiBhdXRoIGxvZ2luJyxcclxuICAgICAgICAgICAgICAgICcnLFxyXG4gICAgICAgICAgICAgICAgJ05vdGU6IFByZWRlZmluZWQgdm9pY2VzIChhbGJhLCBtYXJpdXMsIGV0Yy4pIHdvcmsgd2l0aG91dCB0aGlzIHNldHVwLidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChpbnN0cnVjdGlvbnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnU2V0dXAgY29tcGxldGUhIFlvdSBjYW4gdXNlIFBvY2tldFRUUy4nO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGluc3RydWN0aW9ucy5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEluaXRpYWxpemUgdGhlIFRUUyBlbmdpbmVcclxuICAgICAqIE11c3QgYmUgY2FsbGVkIGJlZm9yZSBnZW5lcmF0ZSgpXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgaWYgKHRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgdGhpcy5icmlkZ2Uuc3RhcnQoKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmJyaWRnZS5pbml0TW9kZWwoKTtcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHNwZWVjaCBmcm9tIHRleHRcclxuICAgICAqIEByZXR1cm5zIEF1ZGlvIGJ1ZmZlciAoV0FWIGZvcm1hdClcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGUob3B0aW9uczogR2VuZXJhdGVPcHRpb25zKTogUHJvbWlzZTxCdWZmZXI+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB7XHJcbiAgICAgICAgICAgIHRleHQsXHJcbiAgICAgICAgICAgIHZvaWNlID0gJ2FsYmEnLFxyXG4gICAgICAgICAgICB2b2x1bWUgPSAxLjAsXHJcbiAgICAgICAgICAgIHBsYXliYWNrU3BlZWQgPSAxLjAsXHJcbiAgICAgICAgICAgIG91dHB1dFBhdGhcclxuICAgICAgICB9ID0gb3B0aW9ucztcclxuXHJcbiAgICAgICAgLy8gVmFsaWRhdGUgYXVkaW8gb3B0aW9uc1xyXG4gICAgICAgIHZhbGlkYXRlQXVkaW9PcHRpb25zKHsgdm9sdW1lLCBwbGF5YmFja1NwZWVkIH0pO1xyXG5cclxuICAgICAgICAvLyBWYWxpZGF0ZSB0ZXh0XHJcbiAgICAgICAgaWYgKCF0ZXh0IHx8IHRleHQudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVGV4dCBjYW5ub3QgYmUgZW1wdHknKSBhcyBUVFNFcnJvcjtcclxuICAgICAgICAgICAgZXJyb3IuY29kZSA9ICdHRU5FUkFUSU9OX0ZBSUxFRCc7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTm9ybWFsaXplIHRleHQgdG8gQVNDSUktY2xlYW4gdmVyc2lvblxyXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUZXh0ID0gbm9ybWFsaXplVGV4dCh0ZXh0KTtcclxuXHJcbiAgICAgICAgLy8gR2VuZXJhdGUgYXVkaW8gdmlhIFB5dGhvbiBicmlkZ2VcclxuICAgICAgICBsZXQgYXVkaW9CdWZmZXIgPSBhd2FpdCB0aGlzLmJyaWRnZS5nZW5lcmF0ZShub3JtYWxpemVkVGV4dCwgdm9pY2UpO1xyXG5cclxuICAgICAgICAvLyBBcHBseSBhdWRpbyBwcm9jZXNzaW5nIGlmIG5lZWRlZFxyXG4gICAgICAgIGlmICh2b2x1bWUgIT09IDEuMCB8fCBwbGF5YmFja1NwZWVkICE9PSAxLjApIHtcclxuICAgICAgICAgICAgYXVkaW9CdWZmZXIgPSBhd2FpdCBwcm9jZXNzQXVkaW8oYXVkaW9CdWZmZXIsIHsgdm9sdW1lLCBwbGF5YmFja1NwZWVkIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gU2F2ZSB0byBmaWxlIGlmIG91dHB1dFBhdGggc3BlY2lmaWVkXHJcbiAgICAgICAgaWYgKG91dHB1dFBhdGgpIHtcclxuICAgICAgICAgICAgY29uc3QgZGlyID0gcGF0aC5kaXJuYW1lKG91dHB1dFBhdGgpO1xyXG4gICAgICAgICAgICBpZiAoIWZzLmV4aXN0c1N5bmMoZGlyKSkge1xyXG4gICAgICAgICAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhvdXRwdXRQYXRoLCBhdWRpb0J1ZmZlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gYXVkaW9CdWZmZXI7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBzcGVlY2ggYW5kIHNhdmUgZGlyZWN0bHkgdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMgUGF0aCB0byB0aGUgc2F2ZWQgZmlsZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVRvRmlsZShvcHRpb25zOiBHZW5lcmF0ZU9wdGlvbnMgJiB7IG91dHB1dFBhdGg6IHN0cmluZyB9KTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgICAgICBhd2FpdCB0aGlzLmdlbmVyYXRlKG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBvcHRpb25zLm91dHB1dFBhdGg7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgbGlzdCBvZiBhdmFpbGFibGUgdm9pY2VzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFZvaWNlc0xpc3QoKTogUHJvbWlzZTxWb2ljZUxpc3RSZXNwb25zZT4ge1xyXG4gICAgICAgIGlmICghdGhpcy5pbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXQoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHZvaWNlcyA9IGF3YWl0IHRoaXMuYnJpZGdlLmdldFZvaWNlc0xpc3QoKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICB2b2ljZXMsXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6ICdhbGJhJyxcclxuICAgICAgICAgICAgdG90YWw6IHZvaWNlcy5sZW5ndGhcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJlLWxvYWQgYSB2b2ljZSBmb3IgZmFzdGVyIGdlbmVyYXRpb25cclxuICAgICAqL1xyXG4gICAgYXN5bmMgbG9hZFZvaWNlKHZvaWNlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGF3YWl0IHRoaXMuYnJpZGdlLmxvYWRWb2ljZSh2b2ljZSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiBhIHZvaWNlIGlzIGEgcHJlZGVmaW5lZCB2b2ljZSAobm8gdm9pY2UgY2xvbmluZyBuZWVkZWQpXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBpc1ByZWRlZmluZWRWb2ljZSh2b2ljZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICAgICAgcmV0dXJuIFBSRURFRklORURfVk9JQ0VTLmluY2x1ZGVzKHZvaWNlIGFzIGFueSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDbG9zZSB0aGUgVFRTIGVuZ2luZSBhbmQgY2xlYW51cCByZXNvdXJjZXNcclxuICAgICAqL1xyXG4gICAgY2xvc2UoKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5icmlkZ2UuY2xvc2UoKTtcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGYWN0b3J5IGZ1bmN0aW9uIGZvciBxdWljayBpbml0aWFsaXphdGlvblxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRUUygpOiBQb2NrZXRUVFMge1xyXG4gICAgcmV0dXJuIG5ldyBQb2NrZXRUVFMoKTtcclxufVxyXG4iXX0=