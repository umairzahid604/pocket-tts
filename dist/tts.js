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
        .replace(/[•·]/g, '-') // Bullets
        .replace(/[©®™]/g, '') // Copyright/trademark
        .replace(/[°]/g, ' degrees ')
        .replace(/[€£¥₹]/g, '$') // Currency symbols
        .replace(/[×]/g, 'x') // Multiplication
        .replace(/[÷]/g, '/') // Division
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3R0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUErVkgsOEJBRUM7QUEvVkQsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3QixpREFBOEM7QUFDOUMscURBQXNFO0FBQ3RFLGlEQUFnRjtBQUNoRixtQ0FNaUI7QUFFakI7OztHQUdHO0FBQ0gsU0FBUyxhQUFhLENBQUMsSUFBWTtJQUMvQixPQUFPLElBQUk7UUFDUCwwQkFBMEI7U0FDekIsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUM7U0FDdEIsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUM7UUFDdkIscUJBQXFCO1NBQ3BCLE9BQU8sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDO1FBQ3ZCLFdBQVc7U0FDVixPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQztRQUNyQixpQ0FBaUM7U0FDaEMsT0FBTyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUM7UUFDdkIsK0JBQStCO1NBQzlCLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQU0sVUFBVTtTQUNyQyxPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFNLHNCQUFzQjtTQUNqRCxPQUFPLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQztTQUM1QixPQUFPLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxDQUFJLG1CQUFtQjtTQUM5QyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFPLGlCQUFpQjtTQUM1QyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFPLFdBQVc7UUFDdkMsd0JBQXdCO1NBQ3ZCLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDO1NBQ3BCLElBQUksRUFBRSxDQUFDO0FBQ2hCLENBQUM7QUFFRCxNQUFhLFNBQVM7SUFR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RUQ7O09BRUc7SUFDSCxLQUFLO1FBQ0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNwQixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQztJQUM3QixDQUFDOztBQS9TTCw4QkFnVEM7QUE1U0csd0RBQXdEO0FBQ3pDLDRCQUFrQixHQUF1QixJQUFJLEFBQTNCLENBQTRCO0FBQzlDLCtCQUFxQixHQUFnQyxJQUFJLEFBQXBDLENBQXFDO0FBNFM3RTs7R0FFRztBQUNILFNBQWdCLFNBQVM7SUFDckIsT0FBTyxJQUFJLFNBQVMsRUFBRSxDQUFDO0FBQzNCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUG9ja2V0VFRTIC0gTWFpbiBUVFMgY2xhc3NcclxuICogUHJvdmlkZXMgaGlnaC1sZXZlbCBBUEkgZm9yIHRleHQtdG8tc3BlZWNoIGdlbmVyYXRpb25cclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IFB5dGhvbkJyaWRnZSB9IGZyb20gJy4vcHl0aG9uQnJpZGdlJztcclxuaW1wb3J0IHsgcHJvY2Vzc0F1ZGlvLCB2YWxpZGF0ZUF1ZGlvT3B0aW9ucyB9IGZyb20gJy4vYXVkaW9Qcm9jZXNzb3InO1xyXG5pbXBvcnQgeyBmaW5kQmVzdFB5dGhvbiwgZmluZFB5dGhvblN5bmMsIGZpbmRBbGxQeXRob25zIH0gZnJvbSAnLi9weXRob25GaW5kZXInO1xyXG5pbXBvcnQge1xyXG4gICAgR2VuZXJhdGVPcHRpb25zLFxyXG4gICAgVm9pY2VMaXN0UmVzcG9uc2UsXHJcbiAgICBTZXR1cFN0YXR1cyxcclxuICAgIFRUU0Vycm9yLFxyXG4gICAgUFJFREVGSU5FRF9WT0lDRVNcclxufSBmcm9tICcuL3R5cGVzJztcclxuXHJcbi8qKlxyXG4gKiBOb3JtYWxpemUgdGV4dCB0byBBU0NJSS1jbGVhbiB2ZXJzaW9uIGZvciBUVFNcclxuICogQ29udmVydHMgVW5pY29kZSBwdW5jdHVhdGlvbiBhbmQgc3BlY2lhbCBjaGFyYWN0ZXJzIHRoYXQgcG9ja2V0LXR0cyBjYW4ndCBoYW5kbGVcclxuICovXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZVRleHQodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiB0ZXh0XHJcbiAgICAgICAgLy8gU21hcnQgcXVvdGVzIHRvIHJlZ3VsYXJcclxuICAgICAgICAucmVwbGFjZSgvWycnYF0vZywgXCInXCIpXHJcbiAgICAgICAgLnJlcGxhY2UoL1tcIlwi4oCeXS9nLCAnXCInKVxyXG4gICAgICAgIC8vIERhc2hlcyBhbmQgaHlwaGVuc1xyXG4gICAgICAgIC5yZXBsYWNlKC9b4oCU4oCT4oiSXS9nLCAnLScpXHJcbiAgICAgICAgLy8gRWxsaXBzaXNcclxuICAgICAgICAucmVwbGFjZSgv4oCmL2csICcuLi4nKVxyXG4gICAgICAgIC8vIEFtcGVyc2FuZCAtIHJlcGxhY2Ugd2l0aCBcImFuZFwiXHJcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgJyBhbmQgJylcclxuICAgICAgICAvLyBPdGhlciBwcm9ibGVtYXRpYyBjaGFyYWN0ZXJzXHJcbiAgICAgICAgLnJlcGxhY2UoL1vigKLCt10vZywgJy0nKSAgICAgIC8vIEJ1bGxldHNcclxuICAgICAgICAucmVwbGFjZSgvW8Kpwq7ihKJdL2csICcnKSAgICAgIC8vIENvcHlyaWdodC90cmFkZW1hcmtcclxuICAgICAgICAucmVwbGFjZSgvW8KwXS9nLCAnIGRlZ3JlZXMgJylcclxuICAgICAgICAucmVwbGFjZSgvW+KCrMKjwqXigrldL2csICckJykgICAgLy8gQ3VycmVuY3kgc3ltYm9sc1xyXG4gICAgICAgIC5yZXBsYWNlKC9bw5ddL2csICd4JykgICAgICAgLy8gTXVsdGlwbGljYXRpb25cclxuICAgICAgICAucmVwbGFjZSgvW8O3XS9nLCAnLycpICAgICAgIC8vIERpdmlzaW9uXHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgZXh0cmEgc3BhY2VzXHJcbiAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxyXG4gICAgICAgIC50cmltKCk7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQb2NrZXRUVFMge1xyXG4gICAgcHJpdmF0ZSBicmlkZ2U6IFB5dGhvbkJyaWRnZTtcclxuICAgIHByaXZhdGUgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuXHJcbiAgICAvLyBTdGF0aWMgY2FjaGUgZm9yIHNldHVwIHN0YXR1cyAoY29tcHV0ZWQgb25jZSwgcmV1c2VkKVxyXG4gICAgcHJpdmF0ZSBzdGF0aWMgX2NhY2hlZFNldHVwU3RhdHVzOiBTZXR1cFN0YXR1cyB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSBzdGF0aWMgX3NldHVwQ2hlY2tJblByb2dyZXNzOiBQcm9taXNlPFNldHVwU3RhdHVzPiB8IG51bGwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIHRoaXMuYnJpZGdlID0gbmV3IFB5dGhvbkJyaWRnZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xlYXIgdGhlIGNhY2hlZCBzZXR1cCBzdGF0dXMgKGNhbGwgdGhpcyBpZiBzeXN0ZW0gY2hhbmdlcylcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGNsZWFyQ2FjaGUoKTogdm9pZCB7XHJcbiAgICAgICAgUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cyA9IG51bGw7XHJcbiAgICAgICAgUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcyA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBzeXN0ZW0gc2V0dXAgc3RhdHVzXHJcbiAgICAgKiBDYWxsIHRoaXMgYmVmb3JlIGluaXQoKSB0byB2ZXJpZnkgcmVxdWlyZW1lbnRzIGFyZSBtZXQuXHJcbiAgICAgKiBSZXN1bHRzIGFyZSBjYWNoZWQgLSBjYWxsIGNsZWFyQ2FjaGUoKSB0byBmb3JjZSByZS1jaGVjay5cclxuICAgICAqL1xyXG4gICAgc3RhdGljIGFzeW5jIGNoZWNrU2V0dXAoKTogUHJvbWlzZTxTZXR1cFN0YXR1cz4ge1xyXG4gICAgICAgIC8vIFJldHVybiBjYWNoZWQgcmVzdWx0IGlmIGF2YWlsYWJsZVxyXG4gICAgICAgIGlmIChQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSWYgY2hlY2sgaXMgYWxyZWFkeSBpbiBwcm9ncmVzcywgd2FpdCBmb3IgaXRcclxuICAgICAgICBpZiAoUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcykge1xyXG4gICAgICAgICAgICByZXR1cm4gUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFN0YXJ0IG5ldyBjaGVja1xyXG4gICAgICAgIFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3MgPSBQb2NrZXRUVFMuX2RvQ2hlY2tTZXR1cCgpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXMgPSBhd2FpdCBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzO1xyXG4gICAgICAgICAgICByZXR1cm4gUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cztcclxuICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBJbnRlcm5hbCBtZXRob2QgdGhhdCBhY3R1YWxseSBwZXJmb3JtcyB0aGUgc2V0dXAgY2hlY2tcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgX2RvQ2hlY2tTZXR1cCgpOiBQcm9taXNlPFNldHVwU3RhdHVzPiB7XHJcbiAgICAgICAgY29uc3QgcHl0aG9uSW5mbyA9IGF3YWl0IGZpbmRCZXN0UHl0aG9uKCk7XHJcblxyXG4gICAgICAgIGlmICghcHl0aG9uSW5mbykge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHB5dGhvblZlcnNpb246IG51bGwsXHJcbiAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogbnVsbCxcclxuICAgICAgICAgICAgICAgIHBvY2tldFR0c0luc3RhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICB2b2ljZUNsb25pbmdBdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgaHVnZ2luZ0ZhY2VMb2dnZWRJbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBzZXR1cENvbXBsZXRlOiBmYWxzZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2sgcG9ja2V0LXR0cyBhbmQgdm9pY2UgY2xvbmluZyB2aWEgZGlyZWN0IFB5dGhvbiBjYWxsXHJcbiAgICAgICAgY29uc3QgY2hlY2tTY3JpcHQgPSBgXHJcbmltcG9ydCBzeXNcclxuaW1wb3J0IGpzb25cclxuXHJcbnJlc3VsdCA9IHtcclxuICAgIFwicG9ja2V0VHRzSW5zdGFsbGVkXCI6IEZhbHNlLFxyXG4gICAgXCJ2b2ljZUNsb25pbmdBdmFpbGFibGVcIjogRmFsc2UsXHJcbiAgICBcImh1Z2dpbmdGYWNlTG9nZ2VkSW5cIjogRmFsc2UsXHJcbiAgICBcInNldHVwQ29tcGxldGVcIjogRmFsc2VcclxufVxyXG5cclxudHJ5OlxyXG4gICAgZnJvbSBwb2NrZXRfdHRzIGltcG9ydCBUVFNNb2RlbFxyXG4gICAgcmVzdWx0W1wicG9ja2V0VHRzSW5zdGFsbGVkXCJdID0gVHJ1ZVxyXG4gICAgcmVzdWx0W1wic2V0dXBDb21wbGV0ZVwiXSA9IFRydWVcclxuICAgIFxyXG4gICAgIyBDaGVjayBIRiBsb2dpblxyXG4gICAgdHJ5OlxyXG4gICAgICAgIGZyb20gaHVnZ2luZ2ZhY2VfaHViIGltcG9ydCBIZkFwaVxyXG4gICAgICAgIGFwaSA9IEhmQXBpKClcclxuICAgICAgICByZXN1bHRbXCJodWdnaW5nRmFjZUxvZ2dlZEluXCJdID0gYXBpLnRva2VuIGlzIG5vdCBOb25lXHJcbiAgICBleGNlcHQ6IHBhc3NcclxuICAgIFxyXG4gICAgIyBDaGVjayB2b2ljZSBjbG9uaW5nICh0cnkgbG9hZGluZyBtb2RlbCBicmllZmx5KVxyXG4gICAgdHJ5OlxyXG4gICAgICAgIG1vZGVsID0gVFRTTW9kZWwubG9hZF9tb2RlbCgpXHJcbiAgICAgICAgcmVzdWx0W1widm9pY2VDbG9uaW5nQXZhaWxhYmxlXCJdID0gZ2V0YXR0cihtb2RlbCwgJ2hhc192b2ljZV9jbG9uaW5nJywgRmFsc2UpXHJcbiAgICAgICAgZGVsIG1vZGVsXHJcbiAgICBleGNlcHQ6IHBhc3NcclxuZXhjZXB0IEltcG9ydEVycm9yOlxyXG4gICAgcGFzc1xyXG5cclxucHJpbnQoanNvbi5kdW1wcyhyZXN1bHQpKVxyXG5gO1xyXG5cclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgeyBzcGF3biB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xyXG4gICAgICAgICAgICBjb25zdCBwYXJ0cyA9IHB5dGhvbkluZm8uY29tbWFuZC5zcGxpdCgnICcpO1xyXG4gICAgICAgICAgICBjb25zdCBjbWQgPSBwYXJ0c1swXTtcclxuICAgICAgICAgICAgY29uc3QgYXJncyA9IFsuLi5wYXJ0cy5zbGljZSgxKSwgJy1jJywgY2hlY2tTY3JpcHRdO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgcHJvYyA9IHNwYXduKGNtZCwgYXJncywge1xyXG4gICAgICAgICAgICAgICAgdGltZW91dDogNjAwMDAsXHJcbiAgICAgICAgICAgICAgICBzaGVsbDogcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGxldCBzdGRvdXQgPSAnJztcclxuICAgICAgICAgICAgcHJvYy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YTogQnVmZmVyKSA9PiB7IHN0ZG91dCArPSBkYXRhLnRvU3RyaW5nKCk7IH0pO1xyXG5cclxuICAgICAgICAgICAgcHJvYy5vbignY2xvc2UnLCAoY29kZTogbnVtYmVyKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2Uoc3Rkb3V0LnRyaW0oKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uVmVyc2lvbjogcHl0aG9uSW5mby52ZXJzaW9uLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBweXRob25JbmZvLmNvbW1hbmQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IHB5dGhvbkluZm8ucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ucmVzdWx0XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uSW5zdGFsbGVkOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBweXRob25JbmZvLnZlcnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkNvbW1hbmQ6IHB5dGhvbkluZm8uY29tbWFuZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uUGF0aDogcHl0aG9uSW5mby5wYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwb2NrZXRUdHNJbnN0YWxsZWQ6IHB5dGhvbkluZm8uaGFzUG9ja2V0VHRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2b2ljZUNsb25pbmdBdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBodWdnaW5nRmFjZUxvZ2dlZEluOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0dXBDb21wbGV0ZTogcHl0aG9uSW5mby5oYXNQb2NrZXRUdHNcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBwcm9jLm9uKCdlcnJvcicsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBweXRob25JbmZvLnZlcnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcHl0aG9uQ29tbWFuZDogcHl0aG9uSW5mby5jb21tYW5kLFxyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IHB5dGhvbkluZm8ucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBwb2NrZXRUdHNJbnN0YWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHZvaWNlQ2xvbmluZ0F2YWlsYWJsZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgaHVnZ2luZ0ZhY2VMb2dnZWRJbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgc2V0dXBDb21wbGV0ZTogZmFsc2VcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBzZXR1cCBpbnN0cnVjdGlvbnMgYmFzZWQgb24gY3VycmVudCBzdGF0dXNcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGdldFNldHVwSW5zdHJ1Y3Rpb25zKHN0YXR1czogU2V0dXBTdGF0dXMpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IGluc3RydWN0aW9uczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgaWYgKCFzdGF0dXMucHl0aG9uSW5zdGFsbGVkKSB7XHJcbiAgICAgICAgICAgIGluc3RydWN0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgJzEuIEluc3RhbGwgUHl0aG9uIDMuMTAgb3IgaGlnaGVyOicsXHJcbiAgICAgICAgICAgICAgICAnICAgLSBEb3dubG9hZCBmcm9tOiBodHRwczovL3d3dy5weXRob24ub3JnL2Rvd25sb2Fkcy8nLFxyXG4gICAgICAgICAgICAgICAgJyAgIC0gTWFrZSBzdXJlIHRvIGNoZWNrIFwiQWRkIFB5dGhvbiB0byBQQVRIXCIgZHVyaW5nIGluc3RhbGxhdGlvbidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9IGVsc2UgaWYgKCFzdGF0dXMucG9ja2V0VHRzSW5zdGFsbGVkKSB7XHJcbiAgICAgICAgICAgIGluc3RydWN0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgYDEuIEluc3RhbGwgcG9ja2V0LXR0cyBwYWNrYWdlICh1c2luZyAke3N0YXR1cy5weXRob25Db21tYW5kfSk6YCxcclxuICAgICAgICAgICAgICAgIGAgICAke3N0YXR1cy5weXRob25Db21tYW5kfSAtbSBwaXAgaW5zdGFsbCBwb2NrZXQtdHRzYFxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHN0YXR1cy5wb2NrZXRUdHNJbnN0YWxsZWQgJiYgIXN0YXR1cy52b2ljZUNsb25pbmdBdmFpbGFibGUpIHtcclxuICAgICAgICAgICAgaW5zdHJ1Y3Rpb25zLnB1c2goXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgICdWb2ljZSBDbG9uaW5nIFNldHVwIChvcHRpb25hbCk6JyxcclxuICAgICAgICAgICAgICAgICcgICAxLiBBY2NlcHQgdGVybXMgYXQ6IGh0dHBzOi8vaHVnZ2luZ2ZhY2UuY28va3l1dGFpL3BvY2tldC10dHMnLFxyXG4gICAgICAgICAgICAgICAgJyAgIDIuIExvZ2luIHdpdGg6IHV2eCBoZiBhdXRoIGxvZ2luJyxcclxuICAgICAgICAgICAgICAgICcnLFxyXG4gICAgICAgICAgICAgICAgJ05vdGU6IFByZWRlZmluZWQgdm9pY2VzIChhbGJhLCBtYXJpdXMsIGV0Yy4pIHdvcmsgd2l0aG91dCB0aGlzIHNldHVwLidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChpbnN0cnVjdGlvbnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnU2V0dXAgY29tcGxldGUhIFlvdSBjYW4gdXNlIFBvY2tldFRUUy4nO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGluc3RydWN0aW9ucy5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEluaXRpYWxpemUgdGhlIFRUUyBlbmdpbmVcclxuICAgICAqIE11c3QgYmUgY2FsbGVkIGJlZm9yZSBnZW5lcmF0ZSgpXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgaWYgKHRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgdGhpcy5icmlkZ2Uuc3RhcnQoKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmJyaWRnZS5pbml0TW9kZWwoKTtcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHNwZWVjaCBmcm9tIHRleHRcclxuICAgICAqIEByZXR1cm5zIEF1ZGlvIGJ1ZmZlciAoV0FWIGZvcm1hdClcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGUob3B0aW9uczogR2VuZXJhdGVPcHRpb25zKTogUHJvbWlzZTxCdWZmZXI+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB7XHJcbiAgICAgICAgICAgIHRleHQsXHJcbiAgICAgICAgICAgIHZvaWNlID0gJ2FsYmEnLFxyXG4gICAgICAgICAgICB2b2x1bWUgPSAxLjAsXHJcbiAgICAgICAgICAgIHBsYXliYWNrU3BlZWQgPSAxLjAsXHJcbiAgICAgICAgICAgIG91dHB1dFBhdGhcclxuICAgICAgICB9ID0gb3B0aW9ucztcclxuXHJcbiAgICAgICAgLy8gVmFsaWRhdGUgYXVkaW8gb3B0aW9uc1xyXG4gICAgICAgIHZhbGlkYXRlQXVkaW9PcHRpb25zKHsgdm9sdW1lLCBwbGF5YmFja1NwZWVkIH0pO1xyXG5cclxuICAgICAgICAvLyBWYWxpZGF0ZSB0ZXh0XHJcbiAgICAgICAgaWYgKCF0ZXh0IHx8IHRleHQudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVGV4dCBjYW5ub3QgYmUgZW1wdHknKSBhcyBUVFNFcnJvcjtcclxuICAgICAgICAgICAgZXJyb3IuY29kZSA9ICdHRU5FUkFUSU9OX0ZBSUxFRCc7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTm9ybWFsaXplIHRleHQgdG8gQVNDSUktY2xlYW4gdmVyc2lvblxyXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUZXh0ID0gbm9ybWFsaXplVGV4dCh0ZXh0KTtcclxuXHJcbiAgICAgICAgLy8gR2VuZXJhdGUgYXVkaW8gdmlhIFB5dGhvbiBicmlkZ2VcclxuICAgICAgICBsZXQgYXVkaW9CdWZmZXIgPSBhd2FpdCB0aGlzLmJyaWRnZS5nZW5lcmF0ZShub3JtYWxpemVkVGV4dCwgdm9pY2UpO1xyXG5cclxuICAgICAgICAvLyBBcHBseSBhdWRpbyBwcm9jZXNzaW5nIGlmIG5lZWRlZFxyXG4gICAgICAgIGlmICh2b2x1bWUgIT09IDEuMCB8fCBwbGF5YmFja1NwZWVkICE9PSAxLjApIHtcclxuICAgICAgICAgICAgYXVkaW9CdWZmZXIgPSBhd2FpdCBwcm9jZXNzQXVkaW8oYXVkaW9CdWZmZXIsIHsgdm9sdW1lLCBwbGF5YmFja1NwZWVkIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gU2F2ZSB0byBmaWxlIGlmIG91dHB1dFBhdGggc3BlY2lmaWVkXHJcbiAgICAgICAgaWYgKG91dHB1dFBhdGgpIHtcclxuICAgICAgICAgICAgY29uc3QgZGlyID0gcGF0aC5kaXJuYW1lKG91dHB1dFBhdGgpO1xyXG4gICAgICAgICAgICBpZiAoIWZzLmV4aXN0c1N5bmMoZGlyKSkge1xyXG4gICAgICAgICAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhvdXRwdXRQYXRoLCBhdWRpb0J1ZmZlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gYXVkaW9CdWZmZXI7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBzcGVlY2ggYW5kIHNhdmUgZGlyZWN0bHkgdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMgUGF0aCB0byB0aGUgc2F2ZWQgZmlsZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVRvRmlsZShvcHRpb25zOiBHZW5lcmF0ZU9wdGlvbnMgJiB7IG91dHB1dFBhdGg6IHN0cmluZyB9KTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgICAgICBhd2FpdCB0aGlzLmdlbmVyYXRlKG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBvcHRpb25zLm91dHB1dFBhdGg7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgbGlzdCBvZiBhdmFpbGFibGUgdm9pY2VzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFZvaWNlc0xpc3QoKTogUHJvbWlzZTxWb2ljZUxpc3RSZXNwb25zZT4ge1xyXG4gICAgICAgIGlmICghdGhpcy5pbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXQoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHZvaWNlcyA9IGF3YWl0IHRoaXMuYnJpZGdlLmdldFZvaWNlc0xpc3QoKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICB2b2ljZXMsXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6ICdhbGJhJyxcclxuICAgICAgICAgICAgdG90YWw6IHZvaWNlcy5sZW5ndGhcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJlLWxvYWQgYSB2b2ljZSBmb3IgZmFzdGVyIGdlbmVyYXRpb25cclxuICAgICAqL1xyXG4gICAgYXN5bmMgbG9hZFZvaWNlKHZvaWNlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGF3YWl0IHRoaXMuYnJpZGdlLmxvYWRWb2ljZSh2b2ljZSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiBhIHZvaWNlIGlzIGEgcHJlZGVmaW5lZCB2b2ljZSAobm8gdm9pY2UgY2xvbmluZyBuZWVkZWQpXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBpc1ByZWRlZmluZWRWb2ljZSh2b2ljZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICAgICAgcmV0dXJuIFBSRURFRklORURfVk9JQ0VTLmluY2x1ZGVzKHZvaWNlIGFzIGFueSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDbG9zZSB0aGUgVFRTIGVuZ2luZSBhbmQgY2xlYW51cCByZXNvdXJjZXNcclxuICAgICAqL1xyXG4gICAgY2xvc2UoKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5icmlkZ2UuY2xvc2UoKTtcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGYWN0b3J5IGZ1bmN0aW9uIGZvciBxdWljayBpbml0aWFsaXphdGlvblxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRUUygpOiBQb2NrZXRUVFMge1xyXG4gICAgcmV0dXJuIG5ldyBQb2NrZXRUVFMoKTtcclxufVxyXG4iXX0=