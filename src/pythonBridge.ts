/**
 * Python Bridge - Manages communication with Python TTS process
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { findBestPython } from './pythonFinder';
import { SetupStatus, TTSError, PythonInfo } from './types';

interface BridgeCommand {
    cmd: string;
    [key: string]: any;
}

interface BridgeResponse {
    status: 'ok' | 'error' | 'audio';
    data?: any;
    message?: string;
    audio?: string;  // base64 encoded audio
}

export class PythonBridge {
    private process: ChildProcess | null = null;
    private pythonInfo: PythonInfo | null = null;
    private readlineInterface: readline.Interface | null = null;
    private responseCallbacks: Map<number, { resolve: Function; reject: Function }> = new Map();
    private requestId = 0;
    private isInitialized = false;

    /**
     * Get path to bundled Python bridge script
     */
    private getBridgeScriptPath(): string {
        // In development, it's in the python folder
        // In installed package, it's in the dist/python folder
        const devPath = path.join(__dirname, '..', 'python', 'tts_bridge.py');
        const distPath = path.join(__dirname, 'python', 'tts_bridge.py');

        const fs = require('fs');
        if (fs.existsSync(devPath)) return devPath;
        if (fs.existsSync(distPath)) return distPath;

        // Fallback: look relative to package root
        return path.join(__dirname, '..', '..', 'python', 'tts_bridge.py');
    }

    /**
     * Start the Python bridge process
     */
    async start(): Promise<void> {
        if (this.process) {
            return; // Already running
        }

        // Find best Python
        this.pythonInfo = await findBestPython();
        if (!this.pythonInfo) {
            const error = new Error('No compatible Python (3.10+) found on your system.') as TTSError;
            error.code = 'PYTHON_NOT_FOUND';
            error.setupInstructions = 'Please install Python 3.10 or higher from https://www.python.org/downloads/';
            throw error;
        }

        const bridgeScript = this.getBridgeScriptPath();

        // Start Python process
        const parts = this.pythonInfo.command.split(' ');
        const cmd = parts[0];
        const args = [...parts.slice(1), bridgeScript];

        this.process = spawn(cmd, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
        });

        // Setup readline for line-by-line reading
        this.readlineInterface = readline.createInterface({
            input: this.process.stdout!,
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
    private async waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Python bridge startup timeout - this may happen if the TTS model is downloading. Please try again.'));
            }, 60000); // 60 seconds timeout for first-time setup

            const checkReady = (line: string) => {
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
    private handleResponse(line: string): void {
        try {
            const response = JSON.parse(line) as BridgeResponse & { id?: number };

            if (response.id !== undefined && this.responseCallbacks.has(response.id)) {
                const { resolve, reject } = this.responseCallbacks.get(response.id)!;
                this.responseCallbacks.delete(response.id);

                if (response.status === 'error') {
                    const error = new Error(response.message || 'Unknown error') as TTSError;
                    if (response.message?.includes('voice cloning')) {
                        error.code = 'VOICE_CLONING_NOT_AVAILABLE';
                        error.setupInstructions =
                            '1. Accept terms at: https://huggingface.co/kyutai/pocket-tts\n' +
                            '2. Login with: uvx hf auth login';
                    } else if (response.message?.includes('pocket_tts')) {
                        error.code = 'POCKET_TTS_NOT_INSTALLED';
                        error.setupInstructions = 'Run: pip install pocket-tts';
                    } else {
                        error.code = 'GENERATION_FAILED';
                    }
                    reject(error);
                } else {
                    resolve(response);
                }
            }
        } catch (e) {
            // Not JSON, might be log output - ignore
        }
    }

    /**
     * Send command to Python process and wait for response
     */
    async sendCommand(command: BridgeCommand): Promise<BridgeResponse> {
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
                resolve: (response: BridgeResponse) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            this.process!.stdin!.write(JSON.stringify(commandWithId) + '\n');
        });
    }

    /**
     * Initialize the TTS model
     */
    async initModel(): Promise<void> {
        const response = await this.sendCommand({ cmd: 'init' });
        if (response.status !== 'ok') {
            throw new Error('Failed to initialize TTS model');
        }
    }

    /**
     * Check setup status
     */
    async checkSetup(): Promise<SetupStatus> {
        const response = await this.sendCommand({ cmd: 'check_setup' });
        return response.data as SetupStatus;
    }

    /**
     * Load a voice
     */
    async loadVoice(voice: string): Promise<void> {
        const response = await this.sendCommand({ cmd: 'load_voice', voice });
        if (response.status !== 'ok') {
            throw new Error(`Failed to load voice: ${voice}`);
        }
    }

    /**
     * Normalize text to handle malformed characters
     */
    private normalizeTTS(text: string): string {
        return text
            .replace(/['']/g, "'")
            .replace(/[""]/g, '"')
            .replace(/…/g, '...')
            .replace(/—/g, '-');
    }

    /**
     * Generate audio
     */
    async generate(text: string, voice: string): Promise<Buffer> {
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
    async getVoicesList(): Promise<string[]> {
        const response = await this.sendCommand({ cmd: 'list_voices' });
        return response.data?.voices || [];
    }

    /**
     * Stop the Python process
     */
    close(): void {
        if (this.process) {
            try {
                this.process.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n');
            } catch { }

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
    getPythonInfo(): PythonInfo | null {
        return this.pythonInfo;
    }
}
