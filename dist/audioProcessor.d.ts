/**
 * Audio processing using FFmpeg
 * Handles volume and playback speed adjustments
 */
export interface AudioProcessingOptions {
    /** Volume level: 0.0 to 2.0, default 1.0 */
    volume?: number;
    /** Playback speed: 0.5 to 2.0, default 1.0 */
    playbackSpeed?: number;
}
/**
 * Validate audio processing options
 */
export declare function validateAudioOptions(options: AudioProcessingOptions): void;
/**
 * Process audio buffer with FFmpeg
 * @param inputBuffer - Input audio buffer (WAV format)
 * @param options - Processing options (volume, speed)
 * @returns Processed audio buffer
 */
export declare function processAudio(inputBuffer: Buffer, options: AudioProcessingOptions): Promise<Buffer>;
/**
 * Process audio file with FFmpeg and save to output path
 */
export declare function processAudioFile(inputPath: string, outputPath: string, options: AudioProcessingOptions): Promise<void>;
