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
        // Generate audio via Python bridge
        let audioBuffer = await this.bridge.generate(text, voice);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3R0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpVUgsOEJBRUM7QUFqVUQsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3QixpREFBOEM7QUFDOUMscURBQXNFO0FBQ3RFLGlEQUFnRjtBQUNoRixtQ0FNaUI7QUFFakIsTUFBYSxTQUFTO0lBUWxCO1FBTlEsZ0JBQVcsR0FBRyxLQUFLLENBQUM7UUFPeEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLDJCQUFZLEVBQUUsQ0FBQztJQUNyQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsVUFBVTtRQUNiLFNBQVMsQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUM7UUFDcEMsU0FBUyxDQUFDLHFCQUFxQixHQUFHLElBQUksQ0FBQztJQUMzQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVTtRQUNuQixvQ0FBb0M7UUFDcEMsSUFBSSxTQUFTLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUMvQixPQUFPLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQztRQUN4QyxDQUFDO1FBRUQsK0NBQStDO1FBQy9DLElBQUksU0FBUyxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDbEMsT0FBTyxTQUFTLENBQUMscUJBQXFCLENBQUM7UUFDM0MsQ0FBQztRQUVELGtCQUFrQjtRQUNsQixTQUFTLENBQUMscUJBQXFCLEdBQUcsU0FBUyxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQzVELElBQUksQ0FBQztZQUNELFNBQVMsQ0FBQyxrQkFBa0IsR0FBRyxNQUFNLFNBQVMsQ0FBQyxxQkFBcUIsQ0FBQztZQUNyRSxPQUFPLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQztRQUN4QyxDQUFDO2dCQUFTLENBQUM7WUFDUCxTQUFTLENBQUMscUJBQXFC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QUksRUFBRSxDQUFDO1FBQ3RCLENBQUM7UUFDRCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZDLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFhO1FBQ2xDLE9BQU8seUJBQWlCLENBQUMsUUFBUSxDQUFDLEtBQVksQ0FBQyxDQUFDO0lBQ3BELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUs7UUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO0lBQzdCLENBQUM7O0FBNVNMLDhCQTZTQztBQXpTRyx3REFBd0Q7QUFDekMsNEJBQWtCLEdBQXVCLElBQUksQUFBM0IsQ0FBNEI7QUFDOUMsK0JBQXFCLEdBQWdDLElBQUksQUFBcEMsQ0FBcUM7QUF5UzdFOztHQUVHO0FBQ0gsU0FBZ0IsU0FBUztJQUNyQixPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7QUFDM0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQb2NrZXRUVFMgLSBNYWluIFRUUyBjbGFzc1xyXG4gKiBQcm92aWRlcyBoaWdoLWxldmVsIEFQSSBmb3IgdGV4dC10by1zcGVlY2ggZ2VuZXJhdGlvblxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgUHl0aG9uQnJpZGdlIH0gZnJvbSAnLi9weXRob25CcmlkZ2UnO1xyXG5pbXBvcnQgeyBwcm9jZXNzQXVkaW8sIHZhbGlkYXRlQXVkaW9PcHRpb25zIH0gZnJvbSAnLi9hdWRpb1Byb2Nlc3Nvcic7XHJcbmltcG9ydCB7IGZpbmRCZXN0UHl0aG9uLCBmaW5kUHl0aG9uU3luYywgZmluZEFsbFB5dGhvbnMgfSBmcm9tICcuL3B5dGhvbkZpbmRlcic7XHJcbmltcG9ydCB7XHJcbiAgICBHZW5lcmF0ZU9wdGlvbnMsXHJcbiAgICBWb2ljZUxpc3RSZXNwb25zZSxcclxuICAgIFNldHVwU3RhdHVzLFxyXG4gICAgVFRTRXJyb3IsXHJcbiAgICBQUkVERUZJTkVEX1ZPSUNFU1xyXG59IGZyb20gJy4vdHlwZXMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFBvY2tldFRUUyB7XHJcbiAgICBwcml2YXRlIGJyaWRnZTogUHl0aG9uQnJpZGdlO1xyXG4gICAgcHJpdmF0ZSBpbml0aWFsaXplZCA9IGZhbHNlO1xyXG5cclxuICAgIC8vIFN0YXRpYyBjYWNoZSBmb3Igc2V0dXAgc3RhdHVzIChjb21wdXRlZCBvbmNlLCByZXVzZWQpXHJcbiAgICBwcml2YXRlIHN0YXRpYyBfY2FjaGVkU2V0dXBTdGF0dXM6IFNldHVwU3RhdHVzIHwgbnVsbCA9IG51bGw7XHJcbiAgICBwcml2YXRlIHN0YXRpYyBfc2V0dXBDaGVja0luUHJvZ3Jlc3M6IFByb21pc2U8U2V0dXBTdGF0dXM+IHwgbnVsbCA9IG51bGw7XHJcblxyXG4gICAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAgICAgdGhpcy5icmlkZ2UgPSBuZXcgUHl0aG9uQnJpZGdlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDbGVhciB0aGUgY2FjaGVkIHNldHVwIHN0YXR1cyAoY2FsbCB0aGlzIGlmIHN5c3RlbSBjaGFuZ2VzKVxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgY2xlYXJDYWNoZSgpOiB2b2lkIHtcclxuICAgICAgICBQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzID0gbnVsbDtcclxuICAgICAgICBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENoZWNrIHN5c3RlbSBzZXR1cCBzdGF0dXNcclxuICAgICAqIENhbGwgdGhpcyBiZWZvcmUgaW5pdCgpIHRvIHZlcmlmeSByZXF1aXJlbWVudHMgYXJlIG1ldC5cclxuICAgICAqIFJlc3VsdHMgYXJlIGNhY2hlZCAtIGNhbGwgY2xlYXJDYWNoZSgpIHRvIGZvcmNlIHJlLWNoZWNrLlxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgYXN5bmMgY2hlY2tTZXR1cCgpOiBQcm9taXNlPFNldHVwU3RhdHVzPiB7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNhY2hlZCByZXN1bHQgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXMpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXM7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBJZiBjaGVjayBpcyBhbHJlYWR5IGluIHByb2dyZXNzLCB3YWl0IGZvciBpdFxyXG4gICAgICAgIGlmIChQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gU3RhcnQgbmV3IGNoZWNrXHJcbiAgICAgICAgUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcyA9IFBvY2tldFRUUy5fZG9DaGVja1NldHVwKCk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cyA9IGF3YWl0IFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3M7XHJcbiAgICAgICAgICAgIHJldHVybiBQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzO1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgIFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3MgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEludGVybmFsIG1ldGhvZCB0aGF0IGFjdHVhbGx5IHBlcmZvcm1zIHRoZSBzZXR1cCBjaGVja1xyXG4gICAgICovXHJcbiAgICBwcml2YXRlIHN0YXRpYyBhc3luYyBfZG9DaGVja1NldHVwKCk6IFByb21pc2U8U2V0dXBTdGF0dXM+IHtcclxuICAgICAgICBjb25zdCBweXRob25JbmZvID0gYXdhaXQgZmluZEJlc3RQeXRob24oKTtcclxuXHJcbiAgICAgICAgaWYgKCFweXRob25JbmZvKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBweXRob25JbnN0YWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgcHl0aG9uVmVyc2lvbjogbnVsbCxcclxuICAgICAgICAgICAgICAgIHB5dGhvbkNvbW1hbmQ6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBweXRob25QYXRoOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcG9ja2V0VHRzSW5zdGFsbGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHZvaWNlQ2xvbmluZ0F2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBodWdnaW5nRmFjZUxvZ2dlZEluOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHNldHVwQ29tcGxldGU6IGZhbHNlXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDaGVjayBwb2NrZXQtdHRzIGFuZCB2b2ljZSBjbG9uaW5nIHZpYSBkaXJlY3QgUHl0aG9uIGNhbGxcclxuICAgICAgICBjb25zdCBjaGVja1NjcmlwdCA9IGBcclxuaW1wb3J0IHN5c1xyXG5pbXBvcnQganNvblxyXG5cclxucmVzdWx0ID0ge1xyXG4gICAgXCJwb2NrZXRUdHNJbnN0YWxsZWRcIjogRmFsc2UsXHJcbiAgICBcInZvaWNlQ2xvbmluZ0F2YWlsYWJsZVwiOiBGYWxzZSxcclxuICAgIFwiaHVnZ2luZ0ZhY2VMb2dnZWRJblwiOiBGYWxzZSxcclxuICAgIFwic2V0dXBDb21wbGV0ZVwiOiBGYWxzZVxyXG59XHJcblxyXG50cnk6XHJcbiAgICBmcm9tIHBvY2tldF90dHMgaW1wb3J0IFRUU01vZGVsXHJcbiAgICByZXN1bHRbXCJwb2NrZXRUdHNJbnN0YWxsZWRcIl0gPSBUcnVlXHJcbiAgICByZXN1bHRbXCJzZXR1cENvbXBsZXRlXCJdID0gVHJ1ZVxyXG4gICAgXHJcbiAgICAjIENoZWNrIEhGIGxvZ2luXHJcbiAgICB0cnk6XHJcbiAgICAgICAgZnJvbSBodWdnaW5nZmFjZV9odWIgaW1wb3J0IEhmQXBpXHJcbiAgICAgICAgYXBpID0gSGZBcGkoKVxyXG4gICAgICAgIHJlc3VsdFtcImh1Z2dpbmdGYWNlTG9nZ2VkSW5cIl0gPSBhcGkudG9rZW4gaXMgbm90IE5vbmVcclxuICAgIGV4Y2VwdDogcGFzc1xyXG4gICAgXHJcbiAgICAjIENoZWNrIHZvaWNlIGNsb25pbmcgKHRyeSBsb2FkaW5nIG1vZGVsIGJyaWVmbHkpXHJcbiAgICB0cnk6XHJcbiAgICAgICAgbW9kZWwgPSBUVFNNb2RlbC5sb2FkX21vZGVsKClcclxuICAgICAgICByZXN1bHRbXCJ2b2ljZUNsb25pbmdBdmFpbGFibGVcIl0gPSBnZXRhdHRyKG1vZGVsLCAnaGFzX3ZvaWNlX2Nsb25pbmcnLCBGYWxzZSlcclxuICAgICAgICBkZWwgbW9kZWxcclxuICAgIGV4Y2VwdDogcGFzc1xyXG5leGNlcHQgSW1wb3J0RXJyb3I6XHJcbiAgICBwYXNzXHJcblxyXG5wcmludChqc29uLmR1bXBzKHJlc3VsdCkpXHJcbmA7XHJcblxyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB7IHNwYXduIH0gPSByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gcHl0aG9uSW5mby5jb21tYW5kLnNwbGl0KCcgJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNtZCA9IHBhcnRzWzBdO1xyXG4gICAgICAgICAgICBjb25zdCBhcmdzID0gWy4uLnBhcnRzLnNsaWNlKDEpLCAnLWMnLCBjaGVja1NjcmlwdF07XHJcblxyXG4gICAgICAgICAgICBjb25zdCBwcm9jID0gc3Bhd24oY21kLCBhcmdzLCB7XHJcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiA2MDAwMCxcclxuICAgICAgICAgICAgICAgIHNoZWxsOiBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbGV0IHN0ZG91dCA9ICcnO1xyXG4gICAgICAgICAgICBwcm9jLnN0ZG91dC5vbignZGF0YScsIChkYXRhOiBCdWZmZXIpID0+IHsgc3Rkb3V0ICs9IGRhdGEudG9TdHJpbmcoKTsgfSk7XHJcblxyXG4gICAgICAgICAgICBwcm9jLm9uKCdjbG9zZScsIChjb2RlOiBudW1iZXIpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShzdGRvdXQudHJpbSgpKTtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBweXRob25JbmZvLnZlcnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkNvbW1hbmQ6IHB5dGhvbkluZm8uY29tbWFuZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogcHl0aG9uSW5mby5wYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5yZXN1bHRcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25JbnN0YWxsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvblZlcnNpb246IHB5dGhvbkluZm8udmVyc2lvbixcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uQ29tbWFuZDogcHl0aG9uSW5mby5jb21tYW5kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25QYXRoOiBweXRob25JbmZvLnBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvY2tldFR0c0luc3RhbGxlZDogcHl0aG9uSW5mby5oYXNQb2NrZXRUdHMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZvaWNlQ2xvbmluZ0F2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGh1Z2dpbmdGYWNlTG9nZ2VkSW46IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXR1cENvbXBsZXRlOiBweXRob25JbmZvLmhhc1BvY2tldFR0c1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHByb2Mub24oJ2Vycm9yJywgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvblZlcnNpb246IHB5dGhvbkluZm8udmVyc2lvbixcclxuICAgICAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBweXRob25JbmZvLmNvbW1hbmQsXHJcbiAgICAgICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogcHl0aG9uSW5mby5wYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIHBvY2tldFR0c0luc3RhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgdm9pY2VDbG9uaW5nQXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBodWdnaW5nRmFjZUxvZ2dlZEluOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBzZXR1cENvbXBsZXRlOiBmYWxzZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IHNldHVwIGluc3RydWN0aW9ucyBiYXNlZCBvbiBjdXJyZW50IHN0YXR1c1xyXG4gICAgICovXHJcbiAgICBzdGF0aWMgZ2V0U2V0dXBJbnN0cnVjdGlvbnMoc3RhdHVzOiBTZXR1cFN0YXR1cyk6IHN0cmluZyB7XHJcbiAgICAgICAgY29uc3QgaW5zdHJ1Y3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgICAgICBpZiAoIXN0YXR1cy5weXRob25JbnN0YWxsZWQpIHtcclxuICAgICAgICAgICAgaW5zdHJ1Y3Rpb25zLnB1c2goXHJcbiAgICAgICAgICAgICAgICAnMS4gSW5zdGFsbCBQeXRob24gMy4xMCBvciBoaWdoZXI6JyxcclxuICAgICAgICAgICAgICAgICcgICAtIERvd25sb2FkIGZyb206IGh0dHBzOi8vd3d3LnB5dGhvbi5vcmcvZG93bmxvYWRzLycsXHJcbiAgICAgICAgICAgICAgICAnICAgLSBNYWtlIHN1cmUgdG8gY2hlY2sgXCJBZGQgUHl0aG9uIHRvIFBBVEhcIiBkdXJpbmcgaW5zdGFsbGF0aW9uJ1xyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoIXN0YXR1cy5wb2NrZXRUdHNJbnN0YWxsZWQpIHtcclxuICAgICAgICAgICAgaW5zdHJ1Y3Rpb25zLnB1c2goXHJcbiAgICAgICAgICAgICAgICBgMS4gSW5zdGFsbCBwb2NrZXQtdHRzIHBhY2thZ2UgKHVzaW5nICR7c3RhdHVzLnB5dGhvbkNvbW1hbmR9KTpgLFxyXG4gICAgICAgICAgICAgICAgYCAgICR7c3RhdHVzLnB5dGhvbkNvbW1hbmR9IC1tIHBpcCBpbnN0YWxsIHBvY2tldC10dHNgXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoc3RhdHVzLnBvY2tldFR0c0luc3RhbGxlZCAmJiAhc3RhdHVzLnZvaWNlQ2xvbmluZ0F2YWlsYWJsZSkge1xyXG4gICAgICAgICAgICBpbnN0cnVjdGlvbnMucHVzaChcclxuICAgICAgICAgICAgICAgICcnLFxyXG4gICAgICAgICAgICAgICAgJ1ZvaWNlIENsb25pbmcgU2V0dXAgKG9wdGlvbmFsKTonLFxyXG4gICAgICAgICAgICAgICAgJyAgIDEuIEFjY2VwdCB0ZXJtcyBhdDogaHR0cHM6Ly9odWdnaW5nZmFjZS5jby9reXV0YWkvcG9ja2V0LXR0cycsXHJcbiAgICAgICAgICAgICAgICAnICAgMi4gTG9naW4gd2l0aDogdXZ4IGhmIGF1dGggbG9naW4nLFxyXG4gICAgICAgICAgICAgICAgJycsXHJcbiAgICAgICAgICAgICAgICAnTm90ZTogUHJlZGVmaW5lZCB2b2ljZXMgKGFsYmEsIG1hcml1cywgZXRjLikgd29yayB3aXRob3V0IHRoaXMgc2V0dXAuJ1xyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGluc3RydWN0aW9ucy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuICdTZXR1cCBjb21wbGV0ZSEgWW91IGNhbiB1c2UgUG9ja2V0VFRTLic7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gaW5zdHJ1Y3Rpb25zLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSW5pdGlhbGl6ZSB0aGUgVFRTIGVuZ2luZVxyXG4gICAgICogTXVzdCBiZSBjYWxsZWQgYmVmb3JlIGdlbmVyYXRlKClcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaW5pdCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBpZiAodGhpcy5pbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBhd2FpdCB0aGlzLmJyaWRnZS5zdGFydCgpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYnJpZGdlLmluaXRNb2RlbCgpO1xyXG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgc3BlZWNoIGZyb20gdGV4dFxyXG4gICAgICogQHJldHVybnMgQXVkaW8gYnVmZmVyIChXQVYgZm9ybWF0KVxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZShvcHRpb25zOiBHZW5lcmF0ZU9wdGlvbnMpOiBQcm9taXNlPEJ1ZmZlcj4ge1xyXG4gICAgICAgIGlmICghdGhpcy5pbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXQoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHtcclxuICAgICAgICAgICAgdGV4dCxcclxuICAgICAgICAgICAgdm9pY2UgPSAnYWxiYScsXHJcbiAgICAgICAgICAgIHZvbHVtZSA9IDEuMCxcclxuICAgICAgICAgICAgcGxheWJhY2tTcGVlZCA9IDEuMCxcclxuICAgICAgICAgICAgb3V0cHV0UGF0aFxyXG4gICAgICAgIH0gPSBvcHRpb25zO1xyXG5cclxuICAgICAgICAvLyBWYWxpZGF0ZSBhdWRpbyBvcHRpb25zXHJcbiAgICAgICAgdmFsaWRhdGVBdWRpb09wdGlvbnMoeyB2b2x1bWUsIHBsYXliYWNrU3BlZWQgfSk7XHJcblxyXG4gICAgICAgIC8vIFZhbGlkYXRlIHRleHRcclxuICAgICAgICBpZiAoIXRleHQgfHwgdGV4dC50cmltKCkubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdUZXh0IGNhbm5vdCBiZSBlbXB0eScpIGFzIFRUU0Vycm9yO1xyXG4gICAgICAgICAgICBlcnJvci5jb2RlID0gJ0dFTkVSQVRJT05fRkFJTEVEJztcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBHZW5lcmF0ZSBhdWRpbyB2aWEgUHl0aG9uIGJyaWRnZVxyXG4gICAgICAgIGxldCBhdWRpb0J1ZmZlciA9IGF3YWl0IHRoaXMuYnJpZGdlLmdlbmVyYXRlKHRleHQsIHZvaWNlKTtcclxuXHJcbiAgICAgICAgLy8gQXBwbHkgYXVkaW8gcHJvY2Vzc2luZyBpZiBuZWVkZWRcclxuICAgICAgICBpZiAodm9sdW1lICE9PSAxLjAgfHwgcGxheWJhY2tTcGVlZCAhPT0gMS4wKSB7XHJcbiAgICAgICAgICAgIGF1ZGlvQnVmZmVyID0gYXdhaXQgcHJvY2Vzc0F1ZGlvKGF1ZGlvQnVmZmVyLCB7IHZvbHVtZSwgcGxheWJhY2tTcGVlZCB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNhdmUgdG8gZmlsZSBpZiBvdXRwdXRQYXRoIHNwZWNpZmllZFxyXG4gICAgICAgIGlmIChvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IHBhdGguZGlybmFtZShvdXRwdXRQYXRoKTtcclxuICAgICAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGRpcikpIHtcclxuICAgICAgICAgICAgICAgIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMob3V0cHV0UGF0aCwgYXVkaW9CdWZmZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGF1ZGlvQnVmZmVyO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgc3BlZWNoIGFuZCBzYXZlIGRpcmVjdGx5IHRvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIFBhdGggdG8gdGhlIHNhdmVkIGZpbGVcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGVUb0ZpbGUob3B0aW9uczogR2VuZXJhdGVPcHRpb25zICYgeyBvdXRwdXRQYXRoOiBzdHJpbmcgfSk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5nZW5lcmF0ZShvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gb3B0aW9ucy5vdXRwdXRQYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGxpc3Qgb2YgYXZhaWxhYmxlIHZvaWNlc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRWb2ljZXNMaXN0KCk6IFByb21pc2U8Vm9pY2VMaXN0UmVzcG9uc2U+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB2b2ljZXMgPSBhd2FpdCB0aGlzLmJyaWRnZS5nZXRWb2ljZXNMaXN0KCk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgdm9pY2VzLFxyXG4gICAgICAgICAgICBkZWZhdWx0OiAnYWxiYScsXHJcbiAgICAgICAgICAgIHRvdGFsOiB2b2ljZXMubGVuZ3RoXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByZS1sb2FkIGEgdm9pY2UgZm9yIGZhc3RlciBnZW5lcmF0aW9uXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGxvYWRWb2ljZSh2b2ljZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLmluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCB0aGlzLmJyaWRnZS5sb2FkVm9pY2Uodm9pY2UpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgYSB2b2ljZSBpcyBhIHByZWRlZmluZWQgdm9pY2UgKG5vIHZvaWNlIGNsb25pbmcgbmVlZGVkKVxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgaXNQcmVkZWZpbmVkVm9pY2Uodm9pY2U6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgICAgIHJldHVybiBQUkVERUZJTkVEX1ZPSUNFUy5pbmNsdWRlcyh2b2ljZSBhcyBhbnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xvc2UgdGhlIFRUUyBlbmdpbmUgYW5kIGNsZWFudXAgcmVzb3VyY2VzXHJcbiAgICAgKi9cclxuICAgIGNsb3NlKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMuYnJpZGdlLmNsb3NlKCk7XHJcbiAgICAgICAgdGhpcy5pbml0aWFsaXplZCA9IGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogRmFjdG9yeSBmdW5jdGlvbiBmb3IgcXVpY2sgaW5pdGlhbGl6YXRpb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUVFMoKTogUG9ja2V0VFRTIHtcclxuICAgIHJldHVybiBuZXcgUG9ja2V0VFRTKCk7XHJcbn1cclxuIl19