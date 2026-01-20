/**
 * Python Bridge - Manages communication with Python TTS process
 */
import { SetupStatus, PythonInfo } from './types';
interface BridgeCommand {
    cmd: string;
    [key: string]: any;
}
interface BridgeResponse {
    status: 'ok' | 'error' | 'audio';
    data?: any;
    message?: string;
    audio?: string;
}
export declare class PythonBridge {
    private process;
    private pythonInfo;
    private readlineInterface;
    private responseCallbacks;
    private requestId;
    private isInitialized;
    /**
     * Get path to bundled Python bridge script
     */
    private getBridgeScriptPath;
    /**
     * Start the Python bridge process
     */
    start(): Promise<void>;
    /**
     * Wait for the Python process to be ready
     */
    private waitForReady;
    /**
     * Handle response from Python process
     */
    private handleResponse;
    /**
     * Send command to Python process and wait for response
     */
    sendCommand(command: BridgeCommand): Promise<BridgeResponse>;
    /**
     * Initialize the TTS model
     */
    initModel(): Promise<void>;
    /**
     * Check setup status
     */
    checkSetup(): Promise<SetupStatus>;
    /**
     * Load a voice
     */
    loadVoice(voice: string): Promise<void>;
    /**
     * Normalize text to handle malformed characters
     */
    private normalizeTTS;
    /**
     * Generate audio
     */
    generate(text: string, voice: string): Promise<Buffer>;
    /**
     * Get list of available voices
     */
    getVoicesList(): Promise<string[]>;
    /**
     * Stop the Python process
     */
    close(): void;
    /**
     * Get Python info
     */
    getPythonInfo(): PythonInfo | null;
}
export {};
