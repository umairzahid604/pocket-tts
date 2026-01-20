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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHl0aG9uQnJpZGdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3B5dGhvbkJyaWRnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGlEQUFvRDtBQUNwRCwyQ0FBNkI7QUFDN0IsbURBQXFDO0FBQ3JDLGlEQUFnRDtBQWVoRCxNQUFhLFlBQVk7SUFBekI7UUFDWSxZQUFPLEdBQXdCLElBQUksQ0FBQztRQUNwQyxlQUFVLEdBQXNCLElBQUksQ0FBQztRQUNyQyxzQkFBaUIsR0FBOEIsSUFBSSxDQUFDO1FBQ3BELHNCQUFpQixHQUF5RCxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ3BGLGNBQVMsR0FBRyxDQUFDLENBQUM7UUFDZCxrQkFBYSxHQUFHLEtBQUssQ0FBQztJQXNRbEMsQ0FBQztJQXBRRzs7T0FFRztJQUNLLG1CQUFtQjtRQUN2Qiw0Q0FBNEM7UUFDNUMsdURBQXVEO1FBQ3ZELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDdEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRWpFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN6QixJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxPQUFPLENBQUM7UUFDM0MsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztZQUFFLE9BQU8sUUFBUSxDQUFDO1FBRTdDLDBDQUEwQztRQUMxQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lB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Q0FBQyxDQUFDLENBQUM7WUFFWCxVQUFVLENBQUMsR0FBRyxFQUFFO2dCQUNaLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO29CQUNmLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUN4QixDQUFDO1lBQ0wsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ2IsQ0FBQztRQUVELElBQUksQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFDO1FBQzlCLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDO0lBQy9CLENBQUM7SUFFRDs7T0FFRztJQUNILGFBQWE7UUFDVCxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUM7SUFDM0IsQ0FBQztDQUNKO0FBNVFELG9DQTRRQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQeXRob24gQnJpZGdlIC0gTWFuYWdlcyBjb21tdW5pY2F0aW9uIHdpdGggUHl0aG9uIFRUUyBwcm9jZXNzXHJcbiAqL1xyXG5cclxuaW1wb3J0IHsgc3Bhd24sIENoaWxkUHJvY2VzcyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyByZWFkbGluZSBmcm9tICdyZWFkbGluZSc7XHJcbmltcG9ydCB7IGZpbmRCZXN0UHl0aG9uIH0gZnJvbSAnLi9weXRob25GaW5kZXInO1xyXG5pbXBvcnQgeyBTZXR1cFN0YXR1cywgVFRTRXJyb3IsIFB5dGhvbkluZm8gfSBmcm9tICcuL3R5cGVzJztcclxuXHJcbmludGVyZmFjZSBCcmlkZ2VDb21tYW5kIHtcclxuICAgIGNtZDogc3RyaW5nO1xyXG4gICAgW2tleTogc3RyaW5nXTogYW55O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQnJpZGdlUmVzcG9uc2Uge1xyXG4gICAgc3RhdHVzOiAnb2snIHwgJ2Vycm9yJyB8ICdhdWRpbyc7XHJcbiAgICBkYXRhPzogYW55O1xyXG4gICAgbWVzc2FnZT86IHN0cmluZztcclxuICAgIGF1ZGlvPzogc3RyaW5nOyAgLy8gYmFzZTY0IGVuY29kZWQgYXVkaW9cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFB5dGhvbkJyaWRnZSB7XHJcbiAgICBwcml2YXRlIHByb2Nlc3M6IENoaWxkUHJvY2VzcyB8IG51bGwgPSBudWxsO1xyXG4gICAgcHJpdmF0ZSBweXRob25JbmZvOiBQeXRob25JbmZvIHwgbnVsbCA9IG51bGw7XHJcbiAgICBwcml2YXRlIHJlYWRsaW5lSW50ZXJmYWNlOiByZWFkbGluZS5JbnRlcmZhY2UgfCBudWxsID0gbnVsbDtcclxuICAgIHByaXZhdGUgcmVzcG9uc2VDYWxsYmFja3M6IE1hcDxudW1iZXIsIHsgcmVzb2x2ZTogRnVuY3Rpb247IHJlamVjdDogRnVuY3Rpb24gfT4gPSBuZXcgTWFwKCk7XHJcbiAgICBwcml2YXRlIHJlcXVlc3RJZCA9IDA7XHJcbiAgICBwcml2YXRlIGlzSW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBwYXRoIHRvIGJ1bmRsZWQgUHl0aG9uIGJyaWRnZSBzY3JpcHRcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBnZXRCcmlkZ2VTY3JpcHRQYXRoKCk6IHN0cmluZyB7XHJcbiAgICAgICAgLy8gSW4gZGV2ZWxvcG1lbnQsIGl0J3MgaW4gdGhlIHB5dGhvbiBmb2xkZXJcclxuICAgICAgICAvLyBJbiBpbnN0YWxsZWQgcGFja2FnZSwgaXQncyBpbiB0aGUgZGlzdC9weXRob24gZm9sZGVyXHJcbiAgICAgICAgY29uc3QgZGV2UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICdweXRob24nLCAndHRzX2JyaWRnZS5weScpO1xyXG4gICAgICAgIGNvbnN0IGRpc3RQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJ3B5dGhvbicsICd0dHNfYnJpZGdlLnB5Jyk7XHJcblxyXG4gICAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhkZXZQYXRoKSkgcmV0dXJuIGRldlBhdGg7XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZGlzdFBhdGgpKSByZXR1cm4gZGlzdFBhdGg7XHJcblxyXG4gICAgICAgIC8vIEZhbGxiYWNrOiBsb29rIHJlbGF0aXZlIHRvIHBhY2thZ2Ugcm9vdFxyXG4gICAgICAgIHJldHVybiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAncHl0aG9uJywgJ3R0c19icmlkZ2UucHknKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFN0YXJ0IHRoZSBQeXRob24gYnJpZGdlIHByb2Nlc3NcclxuICAgICAqL1xyXG4gICAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzcykge1xyXG4gICAgICAgICAgICByZXR1cm47IC8vIEFscmVhZHkgcnVubmluZ1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gRmluZCBiZXN0IFB5dGhvblxyXG4gICAgICAgIHRoaXMucHl0aG9uSW5mbyA9IGF3YWl0IGZpbmRCZXN0UHl0aG9uKCk7XHJcbiAgICAgICAgaWYgKCF0aGlzLnB5dGhvbkluZm8pIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ05vIGNvbXBhdGlibGUgUHl0aG9uICgzLjEwKykgZm91bmQgb24geW91ciBzeXN0ZW0uJykgYXMgVFRTRXJyb3I7XHJcbiAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnUFlUSE9OX05PVF9GT1VORCc7XHJcbiAgICAgICAgICAgIGVycm9yLnNldHVwSW5zdHJ1Y3Rpb25zID0gJ1BsZWFzZSBpbnN0YWxsIFB5dGhvbiAzLjEwIG9yIGhpZ2hlciBmcm9tIGh0dHBzOi8vd3d3LnB5dGhvbi5vcmcvZG93bmxvYWRzLyc7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgYnJpZGdlU2NyaXB0ID0gdGhpcy5nZXRCcmlkZ2VTY3JpcHRQYXRoKCk7XHJcblxyXG4gICAgICAgIC8vIFN0YXJ0IFB5dGhvbiBwcm9jZXNzXHJcbiAgICAgICAgY29uc3QgcGFydHMgPSB0aGlzLnB5dGhvbkluZm8uY29tbWFuZC5zcGxpdCgnICcpO1xyXG4gICAgICAgIGNvbnN0IGNtZCA9IHBhcnRzWzBdO1xyXG4gICAgICAgIGNvbnN0IGFyZ3MgPSBbLi4ucGFydHMuc2xpY2UoMSksIGJyaWRnZVNjcmlwdF07XHJcblxyXG4gICAgICAgIHRoaXMucHJvY2VzcyA9IHNwYXduKGNtZCwgYXJncywge1xyXG4gICAgICAgICAgICBzdGRpbzogWydwaXBlJywgJ3BpcGUnLCAncGlwZSddLFxyXG4gICAgICAgICAgICBzaGVsbDogcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBTZXR1cCByZWFkbGluZSBmb3IgbGluZS1ieS1saW5lIHJlYWRpbmdcclxuICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlID0gcmVhZGxpbmUuY3JlYXRlSW50ZXJmYWNlKHtcclxuICAgICAgICAgICAgaW5wdXQ6IHRoaXMucHJvY2Vzcy5zdGRvdXQhLFxyXG4gICAgICAgICAgICBjcmxmRGVsYXk6IEluZmluaXR5XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMucmVhZGxpbmVJbnRlcmZhY2Uub24oJ2xpbmUnLCAobGluZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmhhbmRsZVJlc3BvbnNlKGxpbmUpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBIYW5kbGUgc3RkZXJyIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICB0aGlzLnByb2Nlc3Muc3RkZXJyPy5vbignZGF0YScsIChkYXRhKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGRhdGEudG9TdHJpbmcoKTtcclxuICAgICAgICAgICAgLy8gT25seSBsb2cgYWN0dWFsIGVycm9ycywgbm90IHByb2dyZXNzIGluZm9cclxuICAgICAgICAgICAgaWYgKG1zZy5pbmNsdWRlcygnRXJyb3InKSB8fCBtc2cuaW5jbHVkZXMoJ1RyYWNlYmFjaycpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUG9ja2V0VFRTIFB5dGhvbl0nLCBtc2cpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMucHJvY2Vzcy5vbignY2xvc2UnLCAoY29kZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmlzSW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzID0gbnVsbDtcclxuICAgICAgICAgICAgLy8gUmVqZWN0IGFsbCBwZW5kaW5nIGNhbGxiYWNrc1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtpZCwgeyByZWplY3QgfV0gb2YgdGhpcy5yZXNwb25zZUNhbGxiYWNrcykge1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgUHl0aG9uIHByb2Nlc3MgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9YCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MuY2xlYXIoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgdGhpcy5wcm9jZXNzLm9uKCdlcnJvcicsIChlcnIpID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BvY2tldFRUU10gUHl0aG9uIHByb2Nlc3MgZXJyb3I6JywgZXJyKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gV2FpdCBmb3IgcmVhZHkgc2lnbmFsXHJcbiAgICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yUmVhZHkoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFdhaXQgZm9yIHRoZSBQeXRob24gcHJvY2VzcyB0byBiZSByZWFkeVxyXG4gICAgICovXHJcbiAgICBwcml2YXRlIGFzeW5jIHdhaXRGb3JSZWFkeSgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdQeXRob24gYnJpZGdlIHN0YXJ0dXAgdGltZW91dCcpKTtcclxuICAgICAgICAgICAgfSwgMzAwMDApO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgY2hlY2tSZWFkeSA9IChsaW5lOiBzdHJpbmcpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChsaW5lLmluY2x1ZGVzKCdcInN0YXR1c1wiOlwicmVhZHlcIicpIHx8IGxpbmUuaW5jbHVkZXMoJ1wic3RhdHVzXCI6IFwicmVhZHlcIicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVhZGxpbmVJbnRlcmZhY2U/LnJlbW92ZUxpc3RlbmVyKCdsaW5lJywgY2hlY2tSZWFkeSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pc0luaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlPy5vbignbGluZScsIGNoZWNrUmVhZHkpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHJlc3BvbnNlIGZyb20gUHl0aG9uIHByb2Nlc3NcclxuICAgICAqL1xyXG4gICAgcHJpdmF0ZSBoYW5kbGVSZXNwb25zZShsaW5lOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IEpTT04ucGFyc2UobGluZSkgYXMgQnJpZGdlUmVzcG9uc2UgJiB7IGlkPzogbnVtYmVyIH07XHJcblxyXG4gICAgICAgICAgICBpZiAocmVzcG9uc2UuaWQgIT09IHVuZGVmaW5lZCAmJiB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmhhcyhyZXNwb25zZS5pZCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHsgcmVzb2x2ZSwgcmVqZWN0IH0gPSB0aGlzLnJlc3BvbnNlQ2FsbGJhY2tzLmdldChyZXNwb25zZS5pZCkhO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZXNwb25zZUNhbGxiYWNrcy5kZWxldGUocmVzcG9uc2UuaWQpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09ICdlcnJvcicpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihyZXNwb25zZS5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJykgYXMgVFRTRXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlLm1lc3NhZ2U/LmluY2x1ZGVzKCd2b2ljZSBjbG9uaW5nJykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IuY29kZSA9ICdWT0lDRV9DTE9OSU5HX05PVF9BVkFJTEFCTEUnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5zZXR1cEluc3RydWN0aW9ucyA9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnMS4gQWNjZXB0IHRlcm1zIGF0OiBodHRwczovL2h1Z2dpbmdmYWNlLmNvL2t5dXRhaS9wb2NrZXQtdHRzXFxuJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnMi4gTG9naW4gd2l0aDogdXZ4IGhmIGF1dGggbG9naW4nO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2UubWVzc2FnZT8uaW5jbHVkZXMoJ3BvY2tldF90dHMnKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5jb2RlID0gJ1BPQ0tFVF9UVFNfTk9UX0lOU1RBTExFRCc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLnNldHVwSW5zdHJ1Y3Rpb25zID0gJ1J1bjogcGlwIGluc3RhbGwgcG9ja2V0LXR0cyc7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IuY29kZSA9ICdHRU5FUkFUSU9OX0ZBSUxFRCc7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAvLyBOb3QgSlNPTiwgbWlnaHQgYmUgbG9nIG91dHB1dCAtIGlnbm9yZVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNlbmQgY29tbWFuZCB0byBQeXRob24gcHJvY2VzcyBhbmQgd2FpdCBmb3IgcmVzcG9uc2VcclxuICAgICAqL1xyXG4gICAgYXN5bmMgc2VuZENvbW1hbmQoY29tbWFuZDogQnJpZGdlQ29tbWFuZCk6IFByb21pc2U8QnJpZGdlUmVzcG9uc2U+IHtcclxuICAgICAgICBpZiAoIXRoaXMucHJvY2VzcyB8fCAhdGhpcy5wcm9jZXNzLnN0ZGluKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUHl0aG9uIGJyaWRnZSBub3Qgc3RhcnRlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaWQgPSArK3RoaXMucmVxdWVzdElkO1xyXG4gICAgICAgIGNvbnN0IGNvbW1hbmRXaXRoSWQgPSB7IC4uLmNvbW1hbmQsIGlkIH07XHJcblxyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3Muc2V0KGlkLCB7IHJlc29sdmUsIHJlamVjdCB9KTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3MuZGVsZXRlKGlkKTtcclxuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYENvbW1hbmQgdGltZW91dDogJHtjb21tYW5kLmNtZH1gKSk7XHJcbiAgICAgICAgICAgIH0sIDEyMDAwMCk7IC8vIDIgbWludXRlIHRpbWVvdXQgZm9yIGdlbmVyYXRpb25cclxuXHJcbiAgICAgICAgICAgIHRoaXMucmVzcG9uc2VDYWxsYmFja3Muc2V0KGlkLCB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlOiAocmVzcG9uc2U6IEJyaWRnZVJlc3BvbnNlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHJlamVjdDogKGVycm9yOiBFcnJvcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2VzcyEuc3RkaW4hLndyaXRlKEpTT04uc3RyaW5naWZ5KGNvbW1hbmRXaXRoSWQpICsgJ1xcbicpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSW5pdGlhbGl6ZSB0aGUgVFRTIG1vZGVsXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGluaXRNb2RlbCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc2VuZENvbW1hbmQoeyBjbWQ6ICdpbml0JyB9KTtcclxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSAnb2snKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGluaXRpYWxpemUgVFRTIG1vZGVsJyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgc2V0dXAgc3RhdHVzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNoZWNrU2V0dXAoKTogUHJvbWlzZTxTZXR1cFN0YXR1cz4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZW5kQ29tbWFuZCh7IGNtZDogJ2NoZWNrX3NldHVwJyB9KTtcclxuICAgICAgICByZXR1cm4gcmVzcG9uc2UuZGF0YSBhcyBTZXR1cFN0YXR1cztcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIExvYWQgYSB2b2ljZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBsb2FkVm9pY2Uodm9pY2U6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZW5kQ29tbWFuZCh7IGNtZDogJ2xvYWRfdm9pY2UnLCB2b2ljZSB9KTtcclxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSAnb2snKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgdm9pY2U6ICR7dm9pY2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTm9ybWFsaXplIHRleHQgdG8gaGFuZGxlIG1hbGZvcm1lZCBjaGFyYWN0ZXJzXHJcbiAgICAgKi9cclxuICAgIHByaXZhdGUgbm9ybWFsaXplVFRTKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICAgICAgcmV0dXJuIHRleHRcclxuICAgICAgICAgICAgLnJlcGxhY2UoL1snJ10vZywgXCInXCIpXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC9bXCJcIl0vZywgJ1wiJylcclxuICAgICAgICAgICAgLnJlcGxhY2UoL+KApi9nLCAnLi4uJylcclxuICAgICAgICAgICAgLnJlcGxhY2UoL+KAlC9nLCAnLScpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgYXVkaW9cclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGUodGV4dDogc3RyaW5nLCB2b2ljZTogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXI+IHtcclxuICAgICAgICBjb25zdCBub3JtYWxpemVkVGV4dCA9IHRoaXMubm9ybWFsaXplVFRTKHRleHQpO1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZW5kQ29tbWFuZCh7IGNtZDogJ2dlbmVyYXRlJywgdGV4dDogbm9ybWFsaXplZFRleHQsIHZvaWNlIH0pO1xyXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgIT09ICdvaycgfHwgIXJlc3BvbnNlLmF1ZGlvKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGdlbmVyYXRlIGF1ZGlvJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBCdWZmZXIuZnJvbShyZXNwb25zZS5hdWRpbywgJ2Jhc2U2NCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGxpc3Qgb2YgYXZhaWxhYmxlIHZvaWNlc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRWb2ljZXNMaXN0KCk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc2VuZENvbW1hbmQoeyBjbWQ6ICdsaXN0X3ZvaWNlcycgfSk7XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGE/LnZvaWNlcyB8fCBbXTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFN0b3AgdGhlIFB5dGhvbiBwcm9jZXNzXHJcbiAgICAgKi9cclxuICAgIGNsb3NlKCk6IHZvaWQge1xyXG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3MpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzcy5zdGRpbj8ud3JpdGUoSlNPTi5zdHJpbmdpZnkoeyBjbWQ6ICdzaHV0ZG93bicgfSkgKyAnXFxuJyk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggeyB9XHJcblxyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLnByb2Nlc3MpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3Mua2lsbCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2VzcyA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sIDEwMDApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5yZWFkbGluZUludGVyZmFjZT8uY2xvc2UoKTtcclxuICAgICAgICB0aGlzLnJlYWRsaW5lSW50ZXJmYWNlID0gbnVsbDtcclxuICAgICAgICB0aGlzLmlzSW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBQeXRob24gaW5mb1xyXG4gICAgICovXHJcbiAgICBnZXRQeXRob25JbmZvKCk6IFB5dGhvbkluZm8gfCBudWxsIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5weXRob25JbmZvO1xyXG4gICAgfVxyXG59XHJcbiJdfQ==