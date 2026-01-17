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
                reject(new Error('Python bridge startup timeout'));
            }, 30000);
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
     * Generate audio
     */
    async generate(text, voice) {
        const response = await this.sendCommand({ cmd: 'generate', text, voice });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHl0aG9uQnJpZGdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3B5dGhvbkJyaWRnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGlEQUFvRDtBQUNwRCwyQ0FBNkI7QUFDN0IsbURBQXFDO0FBQ3JDLGlEQUFnRDtBQWVoRCxNQUFhLFlBQVk7SUFBekI7UUFDWSxZQUFPLEdBQXdCLElBQUksQ0FBQztRQUNwQyxlQUFVLEdBQXNCLElBQUksQ0FBQztRQUNyQyxzQkFBaUIsR0FBOEIsSUFBSSxDQUFDO1FBQ3BELHNCQUFpQixHQUF5RCxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ3BGLGNBQVMsR0FBRyxDQUFDLENBQUM7UUFDZCxrQkFBYSxHQUFHLEtBQUssQ0FBQztJQTBQbEMsQ0FBQztJQXhQRzs7T0FFRztJQUNLLG1CQUFtQjtRQUN2Qiw0Q0FBNEM7UUFDNUMsdURBQXVEO1FBQ3ZELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDdEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRWpFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN6QixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxPQUFPLENBQUM7UUFDM0MsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztZQUFFLE9BQU8sUUFBUSxDQUFDO1FBRTdDLDBDQUEwQztRQUMxQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lB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QUFHLElBQUksQ0FBQztRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQztJQUMvQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxhQUFhO1FBQ1QsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQzNCLENBQUM7Q0FDSjtBQWhRRCxvQ0FnUUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUHl0aG9uIEJyaWRnZSAtIE1hbmFnZXMgY29tbXVuaWNhdGlvbiB3aXRoIFB5dGhvbiBUVFMgcHJvY2Vzc1xyXG4gKi9cclxuXHJcbmltcG9ydCB7IHNwYXduLCBDaGlsZFByb2Nlc3MgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgcmVhZGxpbmUgZnJvbSAncmVhZGxpbmUnO1xyXG5pbXBvcnQgeyBmaW5kQmVzdFB5dGhvbiB9IGZyb20gJy4vcHl0aG9uRmluZGVyJztcclxuaW1wb3J0IHsgU2V0dXBTdGF0dXMsIFRUU0Vycm9yLCBQeXRob25JbmZvIH0gZnJvbSAnLi90eXBlcyc7XHJcblxyXG5pbnRlcmZhY2UgQnJpZGdlQ29tbWFuZCB7XHJcbiAgICBjbWQ6IHN0cmluZztcclxuICAgIFtrZXk6IHN0cmluZ106IGFueTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEJyaWRnZVJlc3BvbnNlIHtcclxuICAgIHN0YXR1czogJ29rJyB8ICdlcnJvcicgfCAnYXVkaW8nO1xyXG4gICAgZGF0YT86IGFueTtcclxuICAgIG1lc3NhZ2U/OiBzdHJpbmc7XHJcbiAgICBhdWRpbz86IHN0cmluZzsgIC8vIGJhc2U2NCBlbmNvZGVkIGF1ZGlvXHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQeXRob25CcmlkZ2Uge1xyXG4gICAgcHJpdmF0ZSBwcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgcHl0aG9uSW5mbzogUHl0aG9uSW5mbyB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSByZWFkbGluZUludGVyZmFjZTogcmVhZGxpbmUuSW50ZXJmYWNlIHwgbnVsbCA9IG51bGw7XHJcbiAgICBwcml2YXRlIHJlc3BvbnNlQ2FsbGJhY2tzOiBNYXA8bnVtYmVyLCB7IHJlc29sdmU6IEZ1bmN0aW9uOyByZWplY3Q6IEZ1bmN0aW9uIH0+ID0gbmV3IE1hcCgpO1xyXG4gICAgcHJpdmF0ZSByZXF1ZXN0SWQgPSAwO1xyXG4gICAgcHJpdmF0ZSBpc0luaXRpYWxpemVkID0gZmFsc2U7XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgcGF0aCB0byBidW5kbGVkIFB5dGhvbiBicmlkZ2Ugc2NyaXB0XHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgZ2V0QnJpZGdlU2NyaXB0UGF0aCgpOiBzdHJpbmcge1xyXG4gICAgICAgIC8vIEluIGRldmVsb3BtZW50LCBpdCdzIGluIHRoZSBweXRob24gZm9sZGVyXHJcbiAgICAgICAgLy8gSW4gaW5zdGFsbGVkIHBhY2thZ2UsIGl0J3MgaW4gdGhlIGRpc3QvcHl0aG9uIGZvbGRlclxyXG4gICAgICAgIGNvbnN0IGRldlBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAncHl0aG9uJywgJ3R0c19icmlkZ2UucHknKTtcclxuICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICdweXRob24nLCAndHRzX2JyaWRnZS5weScpO1xyXG5cclxuICAgICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZGV2UGF0aCkpIHJldHVybiBkZXZQYXRoO1xyXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKGRpc3RQYXRoKSkgcmV0dXJuIGRpc3RQYXRoO1xyXG5cclxuICAgICAgICAvLyBGYWxsYmFjazogbG9vayByZWxhdGl2ZSB0byBwYWNrYWdlIHJvb3RcclxuICAgICAgICByZXR1cm4gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ3B5dGhvbicsICd0dHNfYnJpZGdlLnB5Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTdGFydCB0aGUgUHl0aG9uIGJyaWRnZSBwcm9jZXNzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3MpIHtcclxuICAgICAgICAgICAgcmV0dXJuOyAvLyBBbHJlYWR5IHJ1bm5pbmdcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEZpbmQgYmVzdCBQeXRob25cclxuICAgICAgICB0aGlzLnB5dGhvbkluZm8gPSBhd2FpdCBmaW5kQmVzdFB5dGhvbigpO1xyXG4gICAgICAgIGlmICghdGhpcy5weXRob25JbmZvKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdObyBjb21wYXRpYmxlIFB5dGhvbiAoMy4xMCspIGZvdW5kIG9uIHlvdXIgc3lzdGVtLicpIGFzIFRUU0Vycm9yO1xyXG4gICAgICAgICAgICBlcnJvci5jb2RlID0gJ1BZVEhPTl9OT1RfRk9VTkQnO1xyXG4gICAgICAgICAgICBlcnJvci5zZXR1cEluc3RydWN0aW9ucyA9ICdQbGVhc2UgaW5zdGFsbCBQeXRob24gMy4xMCBvciBoaWdoZXIgZnJvbSBodHRwczovL3d3dy5weXRob24ub3JnL2Rvd25sb2Fkcy8nO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGJyaWRnZVNjcmlwdCA9IHRoaXMuZ2V0QnJpZGdlU2NyaXB0UGF0aCgpO1xyXG5cclxuICAgICAgICAvLyBTdGFydCBQeXRob24gcHJvY2Vzc1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gdGhpcy5weXRob25JbmZvLmNvbW1hbmQuc3BsaXQoJyAnKTtcclxuICAgICAgICBjb25zdCBjbWQgPSBwYXJ0c1swXTtcclxuICAgICAgICBjb25zdCBhcmdzID0gWy4uLnBhcnRzLnNsaWNlKDEpLCBicmlkZ2VTY3JpcHRdO1xyXG5cclxuICAgICAgICB0aGlzLnByb2Nlc3MgPSBzcGF3bihjbWQsIGFyZ3MsIHtcclxuICAgICAgICAgICAgc3RkaW86IFsncGlwZScsICdwaXBlJywgJ3BpcGUnXSxcclxuICAgICAgICAgICAgc2hlbGw6IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMidcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gU2V0dXAgcmVhZGxpbmUgZm9yIGxpbmUtYnktbGluZSByZWFkaW5nXHJcbiAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZSA9IHJlYWRsaW5lLmNyZWF0ZUludGVyZmFjZSh7XHJcbiAgICAgICAgICAgIGlucHV0OiB0aGlzLnByb2Nlc3Muc3Rkb3V0ISxcclxuICAgICAgICAgICAgY3JsZkRlbGF5OiBJbmZpbml0eVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlLm9uKCdsaW5lJywgKGxpbmUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5oYW5kbGVSZXNwb25zZShsaW5lKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gSGFuZGxlIHN0ZGVyciBmb3IgZGVidWdnaW5nXHJcbiAgICAgICAgdGhpcy5wcm9jZXNzLnN0ZGVycj8ub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBtc2cgPSBkYXRhLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIC8vIE9ubHkgbG9nIGFjdHVhbCBlcnJvcnMsIG5vdCBwcm9ncmVzcyBpbmZvXHJcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoJ0Vycm9yJykgfHwgbXNnLmluY2x1ZGVzKCdUcmFjZWJhY2snKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BvY2tldFRUUyBQeXRob25dJywgbXNnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGlzLnByb2Nlc3Mub24oJ2Nsb3NlJywgKGNvZGUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5pc0luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMucHJvY2VzcyA9IG51bGw7XHJcbiAgICAgICAgICAgIC8vIFJlamVjdCBhbGwgcGVuZGluZyBjYWxsYmFja3NcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbaWQsIHsgcmVqZWN0IH1dIG9mIHRoaXMucmVzcG9uc2VDYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYFB5dGhvbiBwcm9jZXNzIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfWApKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmNsZWFyKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMucHJvY2Vzcy5vbignZXJyb3InLCAoZXJyKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQb2NrZXRUVFNdIFB5dGhvbiBwcm9jZXNzIGVycm9yOicsIGVycik7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFdhaXQgZm9yIHJlYWR5IHNpZ25hbFxyXG4gICAgICAgIGF3YWl0IHRoaXMud2FpdEZvclJlYWR5KCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBXYWl0IGZvciB0aGUgUHl0aG9uIHByb2Nlc3MgdG8gYmUgcmVhZHlcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUmVhZHkoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignUHl0aG9uIGJyaWRnZSBzdGFydHVwIHRpbWVvdXQnKSk7XHJcbiAgICAgICAgICAgIH0sIDMwMDAwKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVhZHkgPSAobGluZTogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAobGluZS5pbmNsdWRlcygnXCJzdGF0dXNcIjpcInJlYWR5XCInKSB8fCBsaW5lLmluY2x1ZGVzKCdcInN0YXR1c1wiOiBcInJlYWR5XCInKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlPy5yZW1vdmVMaXN0ZW5lcignbGluZScsIGNoZWNrUmVhZHkpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaXNJbml0aWFsaXplZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZT8ub24oJ2xpbmUnLCBjaGVja1JlYWR5KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSByZXNwb25zZSBmcm9tIFB5dGhvbiBwcm9jZXNzXHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgaGFuZGxlUmVzcG9uc2UobGluZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBKU09OLnBhcnNlKGxpbmUpIGFzIEJyaWRnZVJlc3BvbnNlICYgeyBpZD86IG51bWJlciB9O1xyXG5cclxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLmlkICE9PSB1bmRlZmluZWQgJiYgdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5oYXMocmVzcG9uc2UuaWQpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB7IHJlc29sdmUsIHJlamVjdCB9ID0gdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5nZXQocmVzcG9uc2UuaWQpITtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MuZGVsZXRlKHJlc3BvbnNlLmlkKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSAnZXJyb3InKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IocmVzcG9uc2UubWVzc2FnZSB8fCAnVW5rbm93biBlcnJvcicpIGFzIFRUU0Vycm9yO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZS5tZXNzYWdlPy5pbmNsdWRlcygndm9pY2UgY2xvbmluZycpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnVk9JQ0VfQ0xPTklOR19OT1RfQVZBSUxBQkxFJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3Iuc2V0dXBJbnN0cnVjdGlvbnMgPVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJzEuIEFjY2VwdCB0ZXJtcyBhdDogaHR0cHM6Ly9odWdnaW5nZmFjZS5jby9reXV0YWkvcG9ja2V0LXR0c1xcbicgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJzIuIExvZ2luIHdpdGg6IHV2eCBoZiBhdXRoIGxvZ2luJztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLm1lc3NhZ2U/LmluY2x1ZGVzKCdwb2NrZXRfdHRzJykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IuY29kZSA9ICdQT0NLRVRfVFRTX05PVF9JTlNUQUxMRUQnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5zZXR1cEluc3RydWN0aW9ucyA9ICdSdW46IHBpcCBpbnN0YWxsIHBvY2tldC10dHMnO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnR0VORVJBVElPTl9GQUlMRUQnO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgLy8gTm90IEpTT04sIG1pZ2h0IGJlIGxvZyBvdXRwdXQgLSBpZ25vcmVcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZW5kIGNvbW1hbmQgdG8gUHl0aG9uIHByb2Nlc3MgYW5kIHdhaXQgZm9yIHJlc3BvbnNlXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHNlbmRDb21tYW5kKGNvbW1hbmQ6IEJyaWRnZUNvbW1hbmQpOiBQcm9taXNlPEJyaWRnZVJlc3BvbnNlPiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3MgfHwgIXRoaXMucHJvY2Vzcy5zdGRpbikge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1B5dGhvbiBicmlkZ2Ugbm90IHN0YXJ0ZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlkID0gKyt0aGlzLnJlcXVlc3RJZDtcclxuICAgICAgICBjb25zdCBjb21tYW5kV2l0aElkID0geyAuLi5jb21tYW5kLCBpZCB9O1xyXG5cclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLnNldChpZCwgeyByZXNvbHZlLCByZWplY3QgfSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBDb21tYW5kIHRpbWVvdXQ6ICR7Y29tbWFuZC5jbWR9YCkpO1xyXG4gICAgICAgICAgICB9LCAxMjAwMDApOyAvLyAyIG1pbnV0ZSB0aW1lb3V0IGZvciBnZW5lcmF0aW9uXHJcblxyXG4gICAgICAgICAgICB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLnNldChpZCwge1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZTogKHJlc3BvbnNlOiBCcmlkZ2VSZXNwb25zZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICByZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3MhLnN0ZGluIS53cml0ZShKU09OLnN0cmluZ2lmeShjb21tYW5kV2l0aElkKSArICdcXG4nKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEluaXRpYWxpemUgdGhlIFRUUyBtb2RlbFxyXG4gICAgICovXHJcbiAgICBhc3luYyBpbml0TW9kZWwoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnaW5pdCcgfSk7XHJcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyAhPT0gJ29rJykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIFRUUyBtb2RlbCcpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENoZWNrIHNldHVwIHN0YXR1c1xyXG4gICAgICovXHJcbiAgICBhc3luYyBjaGVja1NldHVwKCk6IFByb21pc2U8U2V0dXBTdGF0dXM+IHtcclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc2VuZENvbW1hbmQoeyBjbWQ6ICdjaGVja19zZXR1cCcgfSk7XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEgYXMgU2V0dXBTdGF0dXM7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBMb2FkIGEgdm9pY2VcclxuICAgICAqL1xyXG4gICAgYXN5bmMgbG9hZFZvaWNlKHZvaWNlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc2VuZENvbW1hbmQoeyBjbWQ6ICdsb2FkX3ZvaWNlJywgdm9pY2UgfSk7XHJcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyAhPT0gJ29rJykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHZvaWNlOiAke3ZvaWNlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIGF1ZGlvXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdlbmVyYXRlKHRleHQ6IHN0cmluZywgdm9pY2U6IHN0cmluZyk6IFByb21pc2U8QnVmZmVyPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnZ2VuZXJhdGUnLCB0ZXh0LCB2b2ljZSB9KTtcclxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSAnb2snIHx8ICFyZXNwb25zZS5hdWRpbykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBnZW5lcmF0ZSBhdWRpbycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gQnVmZmVyLmZyb20ocmVzcG9uc2UuYXVkaW8sICdiYXNlNjQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBsaXN0IG9mIGF2YWlsYWJsZSB2b2ljZXNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2V0Vm9pY2VzTGlzdCgpOiBQcm9taXNlPHN0cmluZ1tdPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlbmRDb21tYW5kKHsgY21kOiAnbGlzdF92b2ljZXMnIH0pO1xyXG4gICAgICAgIHJldHVybiByZXNwb25zZS5kYXRhPy52b2ljZXMgfHwgW107XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTdG9wIHRoZSBQeXRob24gcHJvY2Vzc1xyXG4gICAgICovXHJcbiAgICBjbG9zZSgpOiB2b2lkIHtcclxuICAgICAgICBpZiAodGhpcy5wcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3Muc3RkaW4/LndyaXRlKEpTT04uc3RyaW5naWZ5KHsgY21kOiAnc2h1dGRvd24nIH0pICsgJ1xcbicpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIHsgfVxyXG5cclxuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5wcm9jZXNzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzLmtpbGwoKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3MgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LCAxMDAwKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMucmVhZGxpbmVJbnRlcmZhY2U/LmNsb3NlKCk7XHJcbiAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5pc0luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgUHl0aG9uIGluZm9cclxuICAgICAqL1xyXG4gICAgZ2V0UHl0aG9uSW5mbygpOiBQeXRob25JbmZvIHwgbnVsbCB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMucHl0aG9uSW5mbztcclxuICAgIH1cclxufVxyXG4iXX0=