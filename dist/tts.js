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
 * Converts Unicode punctuation that pocket-tts can't handle
 */
function normalizeText(text) {
    return text
        .replace(/['']/g, "'") // Smart single quotes
        .replace(/[""]/g, '"') // Smart double quotes  
        .replace(/…/g, '...') // Ellipsis
        .replace(/—/g, '-') // Em-dash
        .replace(/–/g, '-'); // En-dash
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3R0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpVkgsOEJBRUM7QUFqVkQsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3QixpREFBOEM7QUFDOUMscURBQXNFO0FBQ3RFLGlEQUFnRjtBQUNoRixtQ0FNaUI7QUFFakI7OztHQUdHO0FBQ0gsU0FBUyxhQUFhLENBQUMsSUFBWTtJQUMvQixPQUFPLElBQUk7U0FDTixPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFNLHNCQUFzQjtTQUNqRCxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFNLHdCQUF3QjtTQUNuRCxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFPLFdBQVc7U0FDdEMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBUyxVQUFVO1NBQ3JDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBUSxVQUFVO0FBQzlDLENBQUM7QUFFRCxNQUFhLFNBQVM7SUFRbEI7UUFOUSxnQkFBVyxHQUFHLEtBQUssQ0FBQztRQU94QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksMkJBQVksRUFBRSxDQUFDO0lBQ3JDLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxVQUFVO1FBQ2IsU0FBUyxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQztRQUNwQyxTQUFTLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFDO0lBQzNDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVO1FBQ25CLG9DQUFvQztRQUNwQyxJQUFJLFNBQVMsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQy9CLE9BQU8sU0FBUyxDQUFDLGtCQUFrQixDQUFDO1FBQ3hDLENBQUM7UUFF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ZXMgaGlnaC1sZXZlbCBBUEkgZm9yIHRleHQtdG8tc3BlZWNoIGdlbmVyYXRpb25cclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IFB5dGhvbkJyaWRnZSB9IGZyb20gJy4vcHl0aG9uQnJpZGdlJztcclxuaW1wb3J0IHsgcHJvY2Vzc0F1ZGlvLCB2YWxpZGF0ZUF1ZGlvT3B0aW9ucyB9IGZyb20gJy4vYXVkaW9Qcm9jZXNzb3InO1xyXG5pbXBvcnQgeyBmaW5kQmVzdFB5dGhvbiwgZmluZFB5dGhvblN5bmMsIGZpbmRBbGxQeXRob25zIH0gZnJvbSAnLi9weXRob25GaW5kZXInO1xyXG5pbXBvcnQge1xyXG4gICAgR2VuZXJhdGVPcHRpb25zLFxyXG4gICAgVm9pY2VMaXN0UmVzcG9uc2UsXHJcbiAgICBTZXR1cFN0YXR1cyxcclxuICAgIFRUU0Vycm9yLFxyXG4gICAgUFJFREVGSU5FRF9WT0lDRVNcclxufSBmcm9tICcuL3R5cGVzJztcclxuXHJcbi8qKlxyXG4gKiBOb3JtYWxpemUgdGV4dCB0byBBU0NJSS1jbGVhbiB2ZXJzaW9uIGZvciBUVFNcclxuICogQ29udmVydHMgVW5pY29kZSBwdW5jdHVhdGlvbiB0aGF0IHBvY2tldC10dHMgY2FuJ3QgaGFuZGxlXHJcbiAqL1xyXG5mdW5jdGlvbiBub3JtYWxpemVUZXh0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gdGV4dFxyXG4gICAgICAgIC5yZXBsYWNlKC9bJyddL2csIFwiJ1wiKSAgICAgIC8vIFNtYXJ0IHNpbmdsZSBxdW90ZXNcclxuICAgICAgICAucmVwbGFjZSgvW1wiXCJdL2csICdcIicpICAgICAgLy8gU21hcnQgZG91YmxlIHF1b3RlcyAgXHJcbiAgICAgICAgLnJlcGxhY2UoL+KApi9nLCAnLi4uJykgICAgICAgLy8gRWxsaXBzaXNcclxuICAgICAgICAucmVwbGFjZSgv4oCUL2csICctJykgICAgICAgICAvLyBFbS1kYXNoXHJcbiAgICAgICAgLnJlcGxhY2UoL+KAky9nLCAnLScpOyAgICAgICAgLy8gRW4tZGFzaFxyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgUG9ja2V0VFRTIHtcclxuICAgIHByaXZhdGUgYnJpZGdlOiBQeXRob25CcmlkZ2U7XHJcbiAgICBwcml2YXRlIGluaXRpYWxpemVkID0gZmFsc2U7XHJcblxyXG4gICAgLy8gU3RhdGljIGNhY2hlIGZvciBzZXR1cCBzdGF0dXMgKGNvbXB1dGVkIG9uY2UsIHJldXNlZClcclxuICAgIHByaXZhdGUgc3RhdGljIF9jYWNoZWRTZXR1cFN0YXR1czogU2V0dXBTdGF0dXMgfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgc3RhdGljIF9zZXR1cENoZWNrSW5Qcm9ncmVzczogUHJvbWlzZTxTZXR1cFN0YXR1cz4gfCBudWxsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdHJ1Y3RvcigpIHtcclxuICAgICAgICB0aGlzLmJyaWRnZSA9IG5ldyBQeXRob25CcmlkZ2UoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENsZWFyIHRoZSBjYWNoZWQgc2V0dXAgc3RhdHVzIChjYWxsIHRoaXMgaWYgc3lzdGVtIGNoYW5nZXMpXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBjbGVhckNhY2hlKCk6IHZvaWQge1xyXG4gICAgICAgIFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXMgPSBudWxsO1xyXG4gICAgICAgIFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3MgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgc3lzdGVtIHNldHVwIHN0YXR1c1xyXG4gICAgICogQ2FsbCB0aGlzIGJlZm9yZSBpbml0KCkgdG8gdmVyaWZ5IHJlcXVpcmVtZW50cyBhcmUgbWV0LlxyXG4gICAgICogUmVzdWx0cyBhcmUgY2FjaGVkIC0gY2FsbCBjbGVhckNhY2hlKCkgdG8gZm9yY2UgcmUtY2hlY2suXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBhc3luYyBjaGVja1NldHVwKCk6IFByb21pc2U8U2V0dXBTdGF0dXM+IHtcclxuICAgICAgICAvLyBSZXR1cm4gY2FjaGVkIHJlc3VsdCBpZiBhdmFpbGFibGVcclxuICAgICAgICBpZiAoUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cykge1xyXG4gICAgICAgICAgICByZXR1cm4gUG9ja2V0VFRTLl9jYWNoZWRTZXR1cFN0YXR1cztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIElmIGNoZWNrIGlzIGFscmVhZHkgaW4gcHJvZ3Jlc3MsIHdhaXQgZm9yIGl0XHJcbiAgICAgICAgaWYgKFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3MpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBvY2tldFRUUy5fc2V0dXBDaGVja0luUHJvZ3Jlc3M7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTdGFydCBuZXcgY2hlY2tcclxuICAgICAgICBQb2NrZXRUVFMuX3NldHVwQ2hlY2tJblByb2dyZXNzID0gUG9ja2V0VFRTLl9kb0NoZWNrU2V0dXAoKTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBQb2NrZXRUVFMuX2NhY2hlZFNldHVwU3RhdHVzID0gYXdhaXQgUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcztcclxuICAgICAgICAgICAgcmV0dXJuIFBvY2tldFRUUy5fY2FjaGVkU2V0dXBTdGF0dXM7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgUG9ja2V0VFRTLl9zZXR1cENoZWNrSW5Qcm9ncmVzcyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSW50ZXJuYWwgbWV0aG9kIHRoYXQgYWN0dWFsbHkgcGVyZm9ybXMgdGhlIHNldHVwIGNoZWNrXHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgc3RhdGljIGFzeW5jIF9kb0NoZWNrU2V0dXAoKTogUHJvbWlzZTxTZXR1cFN0YXR1cz4ge1xyXG4gICAgICAgIGNvbnN0IHB5dGhvbkluZm8gPSBhd2FpdCBmaW5kQmVzdFB5dGhvbigpO1xyXG5cclxuICAgICAgICBpZiAoIXB5dGhvbkluZm8pIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBweXRob25WZXJzaW9uOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcHl0aG9uQ29tbWFuZDogbnVsbCxcclxuICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBwb2NrZXRUdHNJbnN0YWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdm9pY2VDbG9uaW5nQXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGh1Z2dpbmdGYWNlTG9nZ2VkSW46IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgc2V0dXBDb21wbGV0ZTogZmFsc2VcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENoZWNrIHBvY2tldC10dHMgYW5kIHZvaWNlIGNsb25pbmcgdmlhIGRpcmVjdCBQeXRob24gY2FsbFxyXG4gICAgICAgIGNvbnN0IGNoZWNrU2NyaXB0ID0gYFxyXG5pbXBvcnQgc3lzXHJcbmltcG9ydCBqc29uXHJcblxyXG5yZXN1bHQgPSB7XHJcbiAgICBcInBvY2tldFR0c0luc3RhbGxlZFwiOiBGYWxzZSxcclxuICAgIFwidm9pY2VDbG9uaW5nQXZhaWxhYmxlXCI6IEZhbHNlLFxyXG4gICAgXCJodWdnaW5nRmFjZUxvZ2dlZEluXCI6IEZhbHNlLFxyXG4gICAgXCJzZXR1cENvbXBsZXRlXCI6IEZhbHNlXHJcbn1cclxuXHJcbnRyeTpcclxuICAgIGZyb20gcG9ja2V0X3R0cyBpbXBvcnQgVFRTTW9kZWxcclxuICAgIHJlc3VsdFtcInBvY2tldFR0c0luc3RhbGxlZFwiXSA9IFRydWVcclxuICAgIHJlc3VsdFtcInNldHVwQ29tcGxldGVcIl0gPSBUcnVlXHJcbiAgICBcclxuICAgICMgQ2hlY2sgSEYgbG9naW5cclxuICAgIHRyeTpcclxuICAgICAgICBmcm9tIGh1Z2dpbmdmYWNlX2h1YiBpbXBvcnQgSGZBcGlcclxuICAgICAgICBhcGkgPSBIZkFwaSgpXHJcbiAgICAgICAgcmVzdWx0W1wiaHVnZ2luZ0ZhY2VMb2dnZWRJblwiXSA9IGFwaS50b2tlbiBpcyBub3QgTm9uZVxyXG4gICAgZXhjZXB0OiBwYXNzXHJcbiAgICBcclxuICAgICMgQ2hlY2sgdm9pY2UgY2xvbmluZyAodHJ5IGxvYWRpbmcgbW9kZWwgYnJpZWZseSlcclxuICAgIHRyeTpcclxuICAgICAgICBtb2RlbCA9IFRUU01vZGVsLmxvYWRfbW9kZWwoKVxyXG4gICAgICAgIHJlc3VsdFtcInZvaWNlQ2xvbmluZ0F2YWlsYWJsZVwiXSA9IGdldGF0dHIobW9kZWwsICdoYXNfdm9pY2VfY2xvbmluZycsIEZhbHNlKVxyXG4gICAgICAgIGRlbCBtb2RlbFxyXG4gICAgZXhjZXB0OiBwYXNzXHJcbmV4Y2VwdCBJbXBvcnRFcnJvcjpcclxuICAgIHBhc3NcclxuXHJcbnByaW50KGpzb24uZHVtcHMocmVzdWx0KSlcclxuYDtcclxuXHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgc3Bhd24gfSA9IHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKTtcclxuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBweXRob25JbmZvLmNvbW1hbmQuc3BsaXQoJyAnKTtcclxuICAgICAgICAgICAgY29uc3QgY21kID0gcGFydHNbMF07XHJcbiAgICAgICAgICAgIGNvbnN0IGFyZ3MgPSBbLi4ucGFydHMuc2xpY2UoMSksICctYycsIGNoZWNrU2NyaXB0XTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHByb2MgPSBzcGF3bihjbWQsIGFyZ3MsIHtcclxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IDYwMDAwLFxyXG4gICAgICAgICAgICAgICAgc2hlbGw6IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMidcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBsZXQgc3Rkb3V0ID0gJyc7XHJcbiAgICAgICAgICAgIHByb2Muc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGE6IEJ1ZmZlcikgPT4geyBzdGRvdXQgKz0gZGF0YS50b1N0cmluZygpOyB9KTtcclxuXHJcbiAgICAgICAgICAgIHByb2Mub24oJ2Nsb3NlJywgKGNvZGU6IG51bWJlcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKHN0ZG91dC50cmltKCkpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25JbnN0YWxsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvblZlcnNpb246IHB5dGhvbkluZm8udmVyc2lvbixcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uQ29tbWFuZDogcHl0aG9uSW5mby5jb21tYW5kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25QYXRoOiBweXRob25JbmZvLnBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnJlc3VsdFxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvbkluc3RhbGxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHl0aG9uVmVyc2lvbjogcHl0aG9uSW5mby52ZXJzaW9uLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBweXRob25Db21tYW5kOiBweXRob25JbmZvLmNvbW1hbmQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB5dGhvblBhdGg6IHB5dGhvbkluZm8ucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcG9ja2V0VHRzSW5zdGFsbGVkOiBweXRob25JbmZvLmhhc1BvY2tldFR0cyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdm9pY2VDbG9uaW5nQXZhaWxhYmxlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgaHVnZ2luZ0ZhY2VMb2dnZWRJbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldHVwQ29tcGxldGU6IHB5dGhvbkluZm8uaGFzUG9ja2V0VHRzXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcHJvYy5vbignZXJyb3InLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcclxuICAgICAgICAgICAgICAgICAgICBweXRob25JbnN0YWxsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcHl0aG9uVmVyc2lvbjogcHl0aG9uSW5mby52ZXJzaW9uLFxyXG4gICAgICAgICAgICAgICAgICAgIHB5dGhvbkNvbW1hbmQ6IHB5dGhvbkluZm8uY29tbWFuZCxcclxuICAgICAgICAgICAgICAgICAgICBweXRob25QYXRoOiBweXRob25JbmZvLnBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgcG9ja2V0VHRzSW5zdGFsbGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICB2b2ljZUNsb25pbmdBdmFpbGFibGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGh1Z2dpbmdGYWNlTG9nZ2VkSW46IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHNldHVwQ29tcGxldGU6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgc2V0dXAgaW5zdHJ1Y3Rpb25zIGJhc2VkIG9uIGN1cnJlbnQgc3RhdHVzXHJcbiAgICAgKi9cclxuICAgIHN0YXRpYyBnZXRTZXR1cEluc3RydWN0aW9ucyhzdGF0dXM6IFNldHVwU3RhdHVzKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBpbnN0cnVjdGlvbnM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgICAgIGlmICghc3RhdHVzLnB5dGhvbkluc3RhbGxlZCkge1xyXG4gICAgICAgICAgICBpbnN0cnVjdGlvbnMucHVzaChcclxuICAgICAgICAgICAgICAgICcxLiBJbnN0YWxsIFB5dGhvbiAzLjEwIG9yIGhpZ2hlcjonLFxyXG4gICAgICAgICAgICAgICAgJyAgIC0gRG93bmxvYWQgZnJvbTogaHR0cHM6Ly93d3cucHl0aG9uLm9yZy9kb3dubG9hZHMvJyxcclxuICAgICAgICAgICAgICAgICcgICAtIE1ha2Ugc3VyZSB0byBjaGVjayBcIkFkZCBQeXRob24gdG8gUEFUSFwiIGR1cmluZyBpbnN0YWxsYXRpb24nXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfSBlbHNlIGlmICghc3RhdHVzLnBvY2tldFR0c0luc3RhbGxlZCkge1xyXG4gICAgICAgICAgICBpbnN0cnVjdGlvbnMucHVzaChcclxuICAgICAgICAgICAgICAgIGAxLiBJbnN0YWxsIHBvY2tldC10dHMgcGFja2FnZSAodXNpbmcgJHtzdGF0dXMucHl0aG9uQ29tbWFuZH0pOmAsXHJcbiAgICAgICAgICAgICAgICBgICAgJHtzdGF0dXMucHl0aG9uQ29tbWFuZH0gLW0gcGlwIGluc3RhbGwgcG9ja2V0LXR0c2BcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChzdGF0dXMucG9ja2V0VHRzSW5zdGFsbGVkICYmICFzdGF0dXMudm9pY2VDbG9uaW5nQXZhaWxhYmxlKSB7XHJcbiAgICAgICAgICAgIGluc3RydWN0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgJycsXHJcbiAgICAgICAgICAgICAgICAnVm9pY2UgQ2xvbmluZyBTZXR1cCAob3B0aW9uYWwpOicsXHJcbiAgICAgICAgICAgICAgICAnICAgMS4gQWNjZXB0IHRlcm1zIGF0OiBodHRwczovL2h1Z2dpbmdmYWNlLmNvL2t5dXRhaS9wb2NrZXQtdHRzJyxcclxuICAgICAgICAgICAgICAgICcgICAyLiBMb2dpbiB3aXRoOiB1dnggaGYgYXV0aCBsb2dpbicsXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgICdOb3RlOiBQcmVkZWZpbmVkIHZvaWNlcyAoYWxiYSwgbWFyaXVzLCBldGMuKSB3b3JrIHdpdGhvdXQgdGhpcyBzZXR1cC4nXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoaW5zdHJ1Y3Rpb25zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gJ1NldHVwIGNvbXBsZXRlISBZb3UgY2FuIHVzZSBQb2NrZXRUVFMuJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBpbnN0cnVjdGlvbnMuam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBJbml0aWFsaXplIHRoZSBUVFMgZW5naW5lXHJcbiAgICAgKiBNdXN0IGJlIGNhbGxlZCBiZWZvcmUgZ2VuZXJhdGUoKVxyXG4gICAgICovXHJcbiAgICBhc3luYyBpbml0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGlmICh0aGlzLmluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IHRoaXMuYnJpZGdlLnN0YXJ0KCk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5icmlkZ2UuaW5pdE1vZGVsKCk7XHJcbiAgICAgICAgdGhpcy5pbml0aWFsaXplZCA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBzcGVlY2ggZnJvbSB0ZXh0XHJcbiAgICAgKiBAcmV0dXJucyBBdWRpbyBidWZmZXIgKFdBViBmb3JtYXQpXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdlbmVyYXRlKG9wdGlvbnM6IEdlbmVyYXRlT3B0aW9ucyk6IFByb21pc2U8QnVmZmVyPiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLmluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdCgpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qge1xyXG4gICAgICAgICAgICB0ZXh0LFxyXG4gICAgICAgICAgICB2b2ljZSA9ICdhbGJhJyxcclxuICAgICAgICAgICAgdm9sdW1lID0gMS4wLFxyXG4gICAgICAgICAgICBwbGF5YmFja1NwZWVkID0gMS4wLFxyXG4gICAgICAgICAgICBvdXRwdXRQYXRoXHJcbiAgICAgICAgfSA9IG9wdGlvbnM7XHJcblxyXG4gICAgICAgIC8vIFZhbGlkYXRlIGF1ZGlvIG9wdGlvbnNcclxuICAgICAgICB2YWxpZGF0ZUF1ZGlvT3B0aW9ucyh7IHZvbHVtZSwgcGxheWJhY2tTcGVlZCB9KTtcclxuXHJcbiAgICAgICAgLy8gVmFsaWRhdGUgdGV4dFxyXG4gICAgICAgIGlmICghdGV4dCB8fCB0ZXh0LnRyaW0oKS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1RleHQgY2Fubm90IGJlIGVtcHR5JykgYXMgVFRTRXJyb3I7XHJcbiAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnR0VORVJBVElPTl9GQUlMRUQnO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIE5vcm1hbGl6ZSB0ZXh0IHRvIEFTQ0lJLWNsZWFuIHZlcnNpb25cclxuICAgICAgICBjb25zdCBub3JtYWxpemVkVGV4dCA9IG5vcm1hbGl6ZVRleHQodGV4dCk7XHJcblxyXG4gICAgICAgIC8vIEdlbmVyYXRlIGF1ZGlvIHZpYSBQeXRob24gYnJpZGdlXHJcbiAgICAgICAgbGV0IGF1ZGlvQnVmZmVyID0gYXdhaXQgdGhpcy5icmlkZ2UuZ2VuZXJhdGUobm9ybWFsaXplZFRleHQsIHZvaWNlKTtcclxuXHJcbiAgICAgICAgLy8gQXBwbHkgYXVkaW8gcHJvY2Vzc2luZyBpZiBuZWVkZWRcclxuICAgICAgICBpZiAodm9sdW1lICE9PSAxLjAgfHwgcGxheWJhY2tTcGVlZCAhPT0gMS4wKSB7XHJcbiAgICAgICAgICAgIGF1ZGlvQnVmZmVyID0gYXdhaXQgcHJvY2Vzc0F1ZGlvKGF1ZGlvQnVmZmVyLCB7IHZvbHVtZSwgcGxheWJhY2tTcGVlZCB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNhdmUgdG8gZmlsZSBpZiBvdXRwdXRQYXRoIHNwZWNpZmllZFxyXG4gICAgICAgIGlmIChvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IHBhdGguZGlybmFtZShvdXRwdXRQYXRoKTtcclxuICAgICAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGRpcikpIHtcclxuICAgICAgICAgICAgICAgIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMob3V0cHV0UGF0aCwgYXVkaW9CdWZmZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGF1ZGlvQnVmZmVyO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgc3BlZWNoIGFuZCBzYXZlIGRpcmVjdGx5IHRvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIFBhdGggdG8gdGhlIHNhdmVkIGZpbGVcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGVUb0ZpbGUob3B0aW9uczogR2VuZXJhdGVPcHRpb25zICYgeyBvdXRwdXRQYXRoOiBzdHJpbmcgfSk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5nZW5lcmF0ZShvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gb3B0aW9ucy5vdXRwdXRQYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGxpc3Qgb2YgYXZhaWxhYmxlIHZvaWNlc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRWb2ljZXNMaXN0KCk6IFByb21pc2U8Vm9pY2VMaXN0UmVzcG9uc2U+IHtcclxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0KCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB2b2ljZXMgPSBhd2FpdCB0aGlzLmJyaWRnZS5nZXRWb2ljZXNMaXN0KCk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgdm9pY2VzLFxyXG4gICAgICAgICAgICBkZWZhdWx0OiAnYWxiYScsXHJcbiAgICAgICAgICAgIHRvdGFsOiB2b2ljZXMubGVuZ3RoXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByZS1sb2FkIGEgdm9pY2UgZm9yIGZhc3RlciBnZW5lcmF0aW9uXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGxvYWRWb2ljZSh2b2ljZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLmluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCB0aGlzLmJyaWRnZS5sb2FkVm9pY2Uodm9pY2UpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgYSB2b2ljZSBpcyBhIHByZWRlZmluZWQgdm9pY2UgKG5vIHZvaWNlIGNsb25pbmcgbmVlZGVkKVxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgaXNQcmVkZWZpbmVkVm9pY2Uodm9pY2U6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgICAgIHJldHVybiBQUkVERUZJTkVEX1ZPSUNFUy5pbmNsdWRlcyh2b2ljZSBhcyBhbnkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xvc2UgdGhlIFRUUyBlbmdpbmUgYW5kIGNsZWFudXAgcmVzb3VyY2VzXHJcbiAgICAgKi9cclxuICAgIGNsb3NlKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMuYnJpZGdlLmNsb3NlKCk7XHJcbiAgICAgICAgdGhpcy5pbml0aWFsaXplZCA9IGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogRmFjdG9yeSBmdW5jdGlvbiBmb3IgcXVpY2sgaW5pdGlhbGl6YXRpb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUVFMoKTogUG9ja2V0VFRTIHtcclxuICAgIHJldHVybiBuZXcgUG9ja2V0VFRTKCk7XHJcbn1cclxuIl19