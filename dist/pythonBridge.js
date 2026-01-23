"use strict";
/**
 * Python Bridge - Manages communication with Python TTS process
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
exports.PythonBridge = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const pythonFinder_1 = require("./pythonFinder");
class PythonBridge {
    constructor() {
        this.process = null;
        this.pythonInfo = null;
        this.readlineInterface = null;
        this.responseCallbacks = new Map();
        this.requestId = 0;
        this.isInitialized = false;
    }
    /**
     * Get path to bundled Python bridge script
     */
    getBridgeScriptPath() {
        // In development, it's in the python folder
        // In installed package, it's in the dist/python folder
        const devPath = path.join(__dirname, '..', 'python', 'tts_bridge.py');
        const distPath = path.join(__dirname, 'python', 'tts_bridge.py');
        const fs = require('fs');
        if (fs.existsSync(devPath))
            return devPath;
        if (fs.existsSync(distPath))
            return distPath;
        // Fallback: look relative to package root
        return path.join(__dirname, '..', '..', 'python', 'tts_bridge.py');
    }
    /**
     * Start the Python bridge process
     */
    async start() {
        if (this.process) {
            return; // Already running
        }
        // Find best Python
        this.pythonInfo = await (0, pythonFinder_1.findBestPython)();
        if (!this.pythonInfo) {
            const error = new Error('No compatible Python (3.10+) found on your system.');
            error.code = 'PYTHON_NOT_FOUND';
            error.setupInstructions = 'Please install Python 3.10 or higher from https://www.python.org/downloads/';
            throw error;
        }
        const bridgeScript = this.getBridgeScriptPath();
        // Start Python process
        const parts = this.pythonInfo.command.split(' ');
        const cmd = parts[0];
        const args = [...parts.slice(1), bridgeScript];
        this.process = (0, child_process_1.spawn)(cmd, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
        });
        // Setup readline for line-by-line reading
        this.readlineInterface = readline.createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity
        });
        this.readlineInterface.on('line', (line) => {
            this.handleResponse(line);
        });
        // Handle stderr for debugging
        this.process.stderr?.on('data', (data) => {
            const msg = data.toString();
            // Only log actual errors, not progress info
            if (msg.includes('Error') || msg.includes('Traceback')) {
                console.error('[PocketTTS Python]', msg);
            }
        });
        this.process.on('close', (code) => {
            this.isInitialized = false;
            this.process = null;
            // Reject all pending callbacks
            for (const [id, { reject }] of this.responseCallbacks) {
                reject(new Error(`Python process exited with code ${code}`));
            }
            this.responseCallbacks.clear();
        });
        this.process.on('error', (err) => {
            console.error('[PocketTTS] Python process error:', err);
        });
        // Wait for ready signal
        await this.waitForReady();
    }
    /**
     * Wait for the Python process to be ready
     */
    async waitForReady() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Python bridge startup timeout - this may happen if the TTS model is downloading. Please try again.'));
            }, 60000); // 60 seconds timeout for first-time setup
            const checkReady = (line) => {
                if (line.includes('"status":"ready"') || line.includes('"status": "ready"')) {
                    clearTimeout(timeout);
                    this.readlineInterface?.removeListener('line', checkReady);
                    this.isInitialized = true;
                    resolve();
                }
            };
            this.readlineInterface?.on('line', checkReady);
        });
    }
    /**
     * Handle response from Python process
     */
    handleResponse(line) {
        try {
            const response = JSON.parse(line);
            if (response.id !== undefined && this.responseCallbacks.has(response.id)) {
                const { resolve, reject } = this.responseCallbacks.get(response.id);
                this.responseCallbacks.delete(response.id);
                if (response.status === 'error') {
                    const error = new Error(response.message || 'Unknown error');
                    if (response.message?.includes('voice cloning')) {
                        error.code = 'VOICE_CLONING_NOT_AVAILABLE';
                        error.setupInstructions =
                            '1. Accept terms at: https://huggingface.co/kyutai/pocket-tts\n' +
                                '2. Login with: uvx hf auth login';
                    }
                    else if (response.message?.includes('pocket_tts')) {
                        error.code = 'POCKET_TTS_NOT_INSTALLED';
                        error.setupInstructions = 'Run: pip install pocket-tts';
                    }
                    else {
                        error.code = 'GENERATION_FAILED';
                    }
                    reject(error);
                }
                else {
                    resolve(response);
                }
            }
        }
        catch (e) {
            // Not JSON, might be log output - ignore
        }
    }
    /**
     * Send command to Python process and wait for response
     */
    async sendCommand(command) {
        if (!this.process || !this.process.stdin) {
            throw new Error('Python bridge not started');
        }
        const id = ++this.requestId;
        const commandWithId = { ...command, id };
        return new Promise((resolve, reject) => {
            this.responseCallbacks.set(id, { resolve, reject });
            const timeout = setTimeout(() => {
                this.responseCallbacks.delete(id);
                reject(new Error(`Command timeout: ${command.cmd}`));
            }, 120000); // 2 minute timeout for generation
            this.responseCallbacks.set(id, {
                resolve: (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
            this.process.stdin.write(JSON.stringify(commandWithId) + '\n');
        });
    }
    /**
     * Initialize the TTS model
     */
    async initModel() {
        const response = await this.sendCommand({ cmd: 'init' });
        if (response.status !== 'ok') {
            throw new Error('Failed to initialize TTS model');
        }
    }
    /**
     * Check setup status
     */
    async checkSetup() {
        const response = await this.sendCommand({ cmd: 'check_setup' });
        return response.data;
    }
    /**
     * Load a voice
     */
    async loadVoice(voice) {
        const response = await this.sendCommand({ cmd: 'load_voice', voice });
        if (response.status !== 'ok') {
            throw new Error(`Failed to load voice: ${voice}`);
        }
    }
    /**
     * Normalize text to handle malformed characters
     */
    normalizeTTS(text) {
        return text
            .replace(/['']/g, "'")
            .replace(/[""]/g, '"')
            .replace(/…/g, '...')
            .replace(/—/g, '-');
    }
    /**
     * Generate audio
     */
    async generate(text, voice) {
        const normalizedText = this.normalizeTTS(text);
        const response = await this.sendCommand({ cmd: 'generate', text: normalizedText, voice });
        if (response.status !== 'ok' || !response.audio) {
            throw new Error('Failed to generate audio');
        }
        return Buffer.from(response.audio, 'base64');
    }
    /**
     * Get list of available voices
     */
    async getVoicesList() {
        const response = await this.sendCommand({ cmd: 'list_voices' });
        return response.data?.voices || [];
    }
    /**
     * Stop the Python process
     */
    close() {
        if (this.process) {
            try {
                this.process.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n');
            }
            catch { }
            setTimeout(() => {
                if (this.process) {
                    this.process.kill();
                    this.process = null;
                }
            }, 1000);
        }
        this.readlineInterface?.close();
        this.readlineInterface = null;
        this.isInitialized = false;
    }
    /**
     * Get Python info
     */
    getPythonInfo() {
        return this.pythonInfo;
    }
}
exports.PythonBridge = PythonBridge;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHl0aG9uQnJpZGdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3B5dGhvbkJyaWRnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGlEQUFvRDtBQUNwRCwyQ0FBNkI7QUFDN0IsbURBQXFDO0FBQ3JDLGlEQUFnRDtBQWVoRCxNQUFhLFlBQVk7SUFBekI7UUFDWSxZQUFPLEdBQXdCLElBQUksQ0FBQztRQUNwQyxlQUFVLEdBQXNCLElBQUksQ0FBQztRQUNyQyxzQkFBaUIsR0FBOEIsSUFBSSxDQUFDO1FBQ3BELHNCQUFpQixHQUF5RCxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ3BGLGNBQVMsR0FBRyxDQUFDLENBQUM7UUFDZCxrQkFBYSxHQUFHLEtBQUssQ0FBQztJQXNRbEMsQ0FBQztJQXBRRzs7T0FFRztJQUNLLG1CQUFtQjtRQUN2Qiw0Q0FBNEM7UUFDNUMsdURBQXVEO1FBQ3ZELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDdEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRWpFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN6QixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxPQUFPLENBQUM7UUFDM0MsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztZQUFFLE9BQU8sUUFBUSxDQUFDO1FBRTdDLDBDQUEwQztRQUMxQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lB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QUM7WUFBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBRVgsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDWixJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDZixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO29CQUNwQixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQztnQkFDeEIsQ0FBQztZQUNMLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNiLENBQUM7UUFFRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQztJQUMvQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxhQUFhO1FBQ1QsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQzNCLENBQUM7Q0FDSjtBQTVRRCxvQ0E0UUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUHl0aG9uIEJyaWRnZSAtIE1hbmFnZXMgY29tbXVuaWNhdGlvbiB3aXRoIFB5dGhvbiBUVFMgcHJvY2Vzc1xyXG4gKi9cclxuXHJcbmltcG9ydCB7IHNwYXduLCBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgcmVhZGxpbmUgZnJvbSAncmVhZGxpbmUnO1xyXG5pbXBvcnQgeyBmaW5kQmVzdFB5dGhvbiB9IGZyb20gJy4vcHl0aG9uRmluZGVyJztcclxuaW1wb3J0IHsgU2V0dXBTdGF0dXMsIFRUU0Vycm9yLCBQeXRob25JbmZvIH0gZnJvbSAnLi90eXBlcyc7XHJcblxyXG5pbnRlcmZhY2UgQnJpZGdlQ29tbWFuZCB7XHJcbiAgICBjbWQ6IHN0cmluZztcclxuICAgIFtrZXk6IHN0cmluZ106IGFueTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEJyaWRnZVJlc3BvbnNlIHtcclxuICAgIHN0YXR1czogJ29rJyB8ICdlcnJvcicgfCAnYXVkaW8nO1xyXG4gICAgZGF0YT86IGFueTtcclxuICAgIG1lc3NhZ2U/OiBzdHJpbmc7XHJcbiAgICBhdWRpbz86IHN0cmluZzsgIC8vIGJhc2U2NCBlbmNvZGVkIGF1ZGlvXHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQeXRob25CcmlkZ2Uge1xyXG4gICAgcHJpdmF0ZSBwcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgcHl0aG9uSW5mbzogUHl0aG9uSW5mbyB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSByZWFkbGluZUludGVyZmFjZTogcmVhZGxpbmUuSW50ZXJmYWNlIHwgbnVsbCA9IG51bGw7XHJcbiAgICBwcml2YXRlIHJlc3BvbnNlQ2FsbGJhY2tzOiBNYXA8bnVtYmVyLCB7IHJlc29sdmU6IEZ1bmN0aW9uOyByZWplY3Q6IEZ1bmN0aW9uIH0+ID0gbmV3IE1hcCgpO1xyXG4gICAgcHJpdmF0ZSByZXF1ZXN0SWQgPSAwO1xyXG4gICAgcHJpdmF0ZSBpc0luaXRpYWxpemVkID0gZmFsc2U7XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgcGF0aCB0byBidW5kbGVkIFB5dGhvbiBicmlkZ2Ugc2NyaXB0XHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgZ2V0QnJpZGdlU2NyaXB0UGF0aCgpOiBzdHJpbmcge1xyXG4gICAgICAgIC8vIEluIGRldmVsb3BtZW50LCBpdCdzIGluIHRoZSBweXRob24gZm9sZGVyXHJcbiAgICAgICAgLy8gSW4gaW5zdGFsbGVkIHBhY2thZ2UsIGl0J3MgaW4gdGhlIGRpc3QvcHl0aG9uIGZvbGRlclxyXG4gICAgICAgIGNvbnN0IGRldlBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAncHl0aG9uJywgJ3R0c19icmlkZ2UucHknKTtcclxuICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICdweXRob24nLCAndHRzX2JyaWRnZS5weScpO1xyXG5cclxuICAgICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZGV2UGF0aCkpIHJldHVybiBkZXZQYXRoO1xyXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKGRpc3RQYXRoKSkgcmV0dXJuIGRpc3RQYXRoO1xyXG5cclxuICAgICAgICAvLyBGYWxsYmFjazogbG9vayByZWxhdGl2ZSB0byBwYWNrYWdlIHJvb3RcclxuICAgICAgICByZXR1cm4gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ3B5dGhvbicsICd0dHNfYnJpZGdlLnB5Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTdGFydCB0aGUgUHl0aG9uIGJyaWRnZSBwcm9jZXNzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3MpIHtcclxuICAgICAgICAgICAgcmV0dXJuOyAvLyBBbHJlYWR5IHJ1bm5pbmdcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEZpbmQgYmVzdCBQeXRob25cclxuICAgICAgICB0aGlzLnB5dGhvbkluZm8gPSBhd2FpdCBmaW5kQmVzdFB5dGhvbigpO1xyXG4gICAgICAgIGlmICghdGhpcy5weXRob25JbmZvKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdObyBjb21wYXRpYmxlIFB5dGhvbiAoMy4xMCspIGZvdW5kIG9uIHlvdXIgc3lzdGVtLicpIGFzIFRUU0Vycm9yO1xyXG4gICAgICAgICAgICBlcnJvci5jb2RlID0gJ1BZVEhPTl9OT1RfRk9VTkQnO1xyXG4gICAgICAgICAgICBlcnJvci5zZXR1cEluc3RydWN0aW9ucyA9ICdQbGVhc2UgaW5zdGFsbCBQeXRob24gMy4xMCBvciBoaWdoZXIgZnJvbSBodHRwczovL3d3dy5weXRob24ub3JnL2Rvd25sb2Fkcy8nO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGJyaWRnZVNjcmlwdCA9IHRoaXMuZ2V0QnJpZGdlU2NyaXB0UGF0aCgpO1xyXG5cclxuICAgICAgICAvLyBTdGFydCBQeXRob24gcHJvY2Vzc1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gdGhpcy5weXRob25JbmZvLmNvbW1hbmQuc3BsaXQoJyAnKTtcclxuICAgICAgICBjb25zdCBjbWQgPSBwYXJ0c1swXTtcclxuICAgICAgICBjb25zdCBhcmdzID0gWy4uLnBhcnRzLnNsaWNlKDEpLCBicmlkZ2VTY3JpcHRdO1xyXG5cclxuICAgICAgICB0aGlzLnByb2Nlc3MgPSBzcGF3bihjbWQsIGFyZ3MsIHtcclxuICAgICAgICAgICAgc3RkaW86IFsncGlwZScsICdwaXBlJywgJ3BpcGUnXSxcclxuICAgICAgICAgICAgc2hlbGw6IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMidcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gU2V0dXAgcmVhZGxpbmUgZm9yIGxpbmUtYnktbGluZSByZWFkaW5nXHJcbiAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZSA9IHJlYWRsaW5lLmNyZWF0ZUludGVyZmFjZSh7XHJcbiAgICAgICAgICAgIGlucHV0OiB0aGlzLnByb2Nlc3Muc3Rkb3V0ISxcclxuICAgICAgICAgICAgY3JsZkRlbGF5OiBJbmZpbml0eVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlLm9uKCdsaW5lJywgKGxpbmUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5oYW5kbGVSZXNwb25zZShsaW5lKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gSGFuZGxlIHN0ZGVyciBmb3IgZGVidWdnaW5nXHJcbiAgICAgICAgdGhpcy5wcm9jZXNzLnN0ZGVycj8ub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBtc2cgPSBkYXRhLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIC8vIE9ubHkgbG9nIGFjdHVhbCBlcnJvcnMsIG5vdCBwcm9ncmVzcyBpbmZvXHJcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoJ0Vycm9yJykgfHwgbXNnLmluY2x1ZGVzKCdUcmFjZWJhY2snKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BvY2tldFRUUyBQeXRob25dJywgbXNnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGlzLnByb2Nlc3Mub24oJ2Nsb3NlJywgKGNvZGUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5pc0luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMucHJvY2VzcyA9IG51bGw7XHJcbiAgICAgICAgICAgIC8vIFJlamVjdCBhbGwgcGVuZGluZyBjYWxsYmFja3NcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbaWQsIHsgcmVqZWN0IH1dIG9mIHRoaXMucmVzcG9uc2VDYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYFB5dGhvbiBwcm9jZXNzIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfWApKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmNsZWFyKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMucHJvY2Vzcy5vbignZXJyb3InLCAoZXJyKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQb2NrZXRUVFNdIFB5dGhvbiBwcm9jZXNzIGVycm9yOicsIGVycik7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFdhaXQgZm9yIHJlYWR5IHNpZ25hbFxyXG4gICAgICAgIGF3YWl0IHRoaXMud2FpdEZvclJlYWR5KCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBXYWl0IGZvciB0aGUgUHl0aG9uIHByb2Nlc3MgdG8gYmUgcmVhZHlcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUmVhZHkoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignUHl0aG9uIGJyaWRnZSBzdGFydHVwIHRpbWVvdXQgLSB0aGlzIG1heSBoYXBwZW4gaWYgdGhlIFRUUyBtb2RlbCBpcyBkb3dubG9hZGluZy4gUGxlYXNlIHRyeSBhZ2Fpbi4nKSk7XHJcbiAgICAgICAgICAgIH0sIDYwMDAwKTsgLy8gNjAgc2Vjb25kcyB0aW1lb3V0IGZvciBmaXJzdC10aW1lIHNldHVwXHJcblxyXG4gICAgICAgICAgICBjb25zdCBjaGVja1JlYWR5ID0gKGxpbmU6IHN0cmluZykgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKGxpbmUuaW5jbHVkZXMoJ1wic3RhdHVzXCI6XCJyZWFkeVwiJykgfHwgbGluZS5pbmNsdWRlcygnXCJzdGF0dXNcIjogXCJyZWFkeVwiJykpIHtcclxuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZT8ucmVtb3ZlTGlzdGVuZXIoJ2xpbmUnLCBjaGVja1JlYWR5KTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmlzSW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMucmVhZGxpbmVJbnRlcmZhY2U/Lm9uKCdsaW5lJywgY2hlY2tSZWFkeSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgcmVzcG9uc2UgZnJvbSBQeXRob24gcHJvY2Vzc1xyXG4gICAgICovXHJcbiAgICBwcml2YXRlIGhhbmRsZVJlc3BvbnNlKGxpbmU6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZShsaW5lKSBhcyBCcmlkZ2VSZXNwb25zZSAmIHsgaWQ/OiBudW1iZXIgfTtcclxuXHJcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5pZCAhPT0gdW5kZWZpbmVkICYmIHRoaXMucmVzcG9uc2VDYWxsYmFja3MuaGFzKHJlc3BvbnNlLmlkKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgeyByZXNvbHZlLCByZWplY3QgfSA9IHRoaXMucmVzcG9uc2VDYWxsYmFja3MuZ2V0KHJlc3BvbnNlLmlkKSE7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmRlbGV0ZShyZXNwb25zZS5pZCk7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gJ2Vycm9yJykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKHJlc3BvbnNlLm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3InKSBhcyBUVFNFcnJvcjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2UubWVzc2FnZT8uaW5jbHVkZXMoJ3ZvaWNlIGNsb25pbmcnKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5jb2RlID0gJ1ZPSUNFX0NMT05JTkdfTk9UX0FWQUlMQUJMRSc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLnNldHVwSW5zdHJ1Y3Rpb25zID1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICcxLiBBY2NlcHQgdGVybXMgYXQ6IGh0dHBzOi8vaHVnZ2luZ2ZhY2UuY28va3l1dGFpL3BvY2tldC10dHNcXG4nICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICcyLiBMb2dpbiB3aXRoOiB1dnggaGYgYXV0aCBsb2dpbic7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5tZXNzYWdlPy5pbmNsdWRlcygncG9ja2V0X3R0cycpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnUE9DS0VUX1RUU19OT1RfSU5TVEFMTEVEJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3Iuc2V0dXBJbnN0cnVjdGlvbnMgPSAnUnVuOiBwaXAgaW5zdGFsbCBwb2NrZXQtdHRzJztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5jb2RlID0gJ0dFTkVSQVRJT05fRkFJTEVEJztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXNwb25zZSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIC8vIE5vdCBKU09OLCBtaWdodCBiZSBsb2cgb3V0cHV0IC0gaWdub3JlXHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2VuZCBjb21tYW5kIHRvIFB5dGhvbiBwcm9jZXNzIGFuZCB3YWl0IGZvciByZXNwb25zZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBzZW5kQ29tbWFuZChjb21tYW5kOiBCcmlkZ2VDb21tYW5kKTogUHJvbWlzZTxCcmlkZ2VSZXNwb25zZT4ge1xyXG4gICAgICAgIGlmICghdGhpcy5wcm9jZXNzIHx8ICF0aGlzLnByb2Nlc3Muc3RkaW4pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQeXRob24gYnJpZGdlIG5vdCBzdGFydGVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBpZCA9ICsrdGhpcy5yZXF1ZXN0SWQ7XHJcbiAgICAgICAgY29uc3QgY29tbWFuZFdpdGhJZCA9IHsgLi4uY29tbWFuZCwgaWQgfTtcclxuXHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5zZXQoaWQsIHsgcmVzb2x2ZSwgcmVqZWN0IH0pO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQ29tbWFuZCB0aW1lb3V0OiAke2NvbW1hbmQuY21kfWApKTtcclxuICAgICAgICAgICAgfSwgMTIwMDAwKTsgLy8gMiBtaW51dGUgdGltZW91dCBmb3IgZ2VuZXJhdGlvblxyXG5cclxuICAgICAgICAgICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5zZXQoaWQsIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmU6IChyZXNwb25zZTogQnJpZGdlUmVzcG9uc2UpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXNwb25zZSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgcmVqZWN0OiAoZXJyb3I6IEVycm9yKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzIS5zdGRpbiEud3JpdGUoSlNPTi5zdHJpbmdpZnkoY29tbWFuZFdpdGhJZCkgKyAnXFxuJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBJbml0aWFsaXplIHRoZSBUVFMgbW9kZWxcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaW5pdE1vZGVsKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZW5kQ29tbWFuZCh7IGNtZDogJ2luaXQnIH0pO1xyXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgIT09ICdvaycpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gaW5pdGlhbGl6ZSBUVFMgbW9kZWwnKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBzZXR1cCBzdGF0dXNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgY2hlY2tTZXR1cCgpOiBQcm9taXNlPFNldHVwU3RhdHVzPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnY2hlY2tfc2V0dXAnIH0pO1xyXG4gICAgICAgIHJldHVybiByZXNwb25zZS5kYXRhIGFzIFNldHVwU3RhdHVzO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTG9hZCBhIHZvaWNlXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGxvYWRWb2ljZSh2b2ljZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnbG9hZF92b2ljZScsIHZvaWNlIH0pO1xyXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgIT09ICdvaycpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCB2b2ljZTogJHt2b2ljZX1gKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBOb3JtYWxpemUgdGV4dCB0byBoYW5kbGUgbWFsZm9ybWVkIGNoYXJhY3RlcnNcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBub3JtYWxpemVUVFModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgICAgICByZXR1cm4gdGV4dFxyXG4gICAgICAgICAgICAucmVwbGFjZSgvWycnXS9nLCBcIidcIilcclxuICAgICAgICAgICAgLnJlcGxhY2UoL1tcIlwiXS9nLCAnXCInKVxyXG4gICAgICAgICAgICAucmVwbGFjZSgv4oCmL2csICcuLi4nKVxyXG4gICAgICAgICAgICAucmVwbGFjZSgv4oCUL2csICctJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBhdWRpb1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZSh0ZXh0OiBzdHJpbmcsIHZvaWNlOiBzdHJpbmcpOiBQcm9taXNlPEJ1ZmZlcj4ge1xyXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUZXh0ID0gdGhpcy5ub3JtYWxpemVUVFModGV4dCk7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnZ2VuZXJhdGUnLCB0ZXh0OiBub3JtYWxpemVkVGV4dCwgdm9pY2UgfSk7XHJcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyAhPT0gJ29rJyB8fCAhcmVzcG9uc2UuYXVkaW8pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgYXVkaW8nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJlc3BvbnNlLmF1ZGlvLCAnYmFzZTY0Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgbGlzdCBvZiBhdmFpbGFibGUgdm9pY2VzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFZvaWNlc0xpc3QoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZW5kQ29tbWFuZCh7IGNtZDogJ2xpc3Rfdm9pY2VzJyB9KTtcclxuICAgICAgICByZXR1cm4gcmVzcG9uc2UuZGF0YT8udm9pY2VzIHx8IFtdO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU3RvcCB0aGUgUHl0aG9uIHByb2Nlc3NcclxuICAgICAqL1xyXG4gICAgY2xvc2UoKTogdm9pZCB7XHJcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzcykge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzLnN0ZGluPy53cml0ZShKU09OLnN0cmluZ2lmeSh7IGNtZDogJ3NodXRkb3duJyB9KSArICdcXG4nKTtcclxuICAgICAgICAgICAgfSBjYXRjaCB7IH1cclxuXHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzcy5raWxsKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSwgMTAwMCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlPy5jbG9zZSgpO1xyXG4gICAgICAgIHRoaXMucmVhZGxpbmVJbnRlcmZhY2UgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuaXNJbml0aWFsaXplZCA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IFB5dGhvbiBpbmZvXHJcbiAgICAgKi9cclxuICAgIGdldFB5dGhvbkluZm8oKTogUHl0aG9uSW5mbyB8IG51bGwge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnB5dGhvbkluZm87XHJcbiAgICB9XHJcbn1cclxuIl19