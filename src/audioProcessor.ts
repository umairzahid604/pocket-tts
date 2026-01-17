/**
 * Audio processing using FFmpeg
 * Handles volume and playback speed adjustments
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

export interface AudioProcessingOptions {
    /** Volume level: 0.0 to 2.0, default 1.0 */
    volume?: number;
    /** Playback speed: 0.5 to 2.0, default 1.0 */
    playbackSpeed?: number;
}

/**
 * Validate audio processing options
 */
export function validateAudioOptions(options: AudioProcessingOptions): void {
    if (options.volume !== undefined) {
        if (options.volume < 0 || options.volume > 2) {
            throw new Error('Volume must be between 0.0 and 2.0');
        }
    }
    if (options.playbackSpeed !== undefined) {
        if (options.playbackSpeed < 0.5 || options.playbackSpeed > 2) {
            throw new Error('Playback speed must be between 0.5 and 2.0');
        }
    }
}

/**
 * Process audio buffer with FFmpeg
 * @param inputBuffer - Input audio buffer (WAV format)
 * @param options - Processing options (volume, speed)
 * @returns Processed audio buffer
 */
export async function processAudio(
    inputBuffer: Buffer,
    options: AudioProcessingOptions
): Promise<Buffer> {
    const { volume = 1.0, playbackSpeed = 1.0 } = options;

    // Skip processing if no changes needed
    if (volume === 1.0 && playbackSpeed === 1.0) {
        return inputBuffer;
    }

    // Validate options
    validateAudioOptions(options);

    // Create temp files
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `pocket_tts_input_${timestamp}.wav`);
    const outputPath = path.join(tempDir, `pocket_tts_output_${timestamp}.wav`);

    try {
        // Write input buffer to temp file
        fs.writeFileSync(inputPath, inputBuffer);

        // Build filter chain
        const filters: string[] = [];

        if (volume !== 1.0) {
            filters.push(`volume=${volume}`);
        }

        if (playbackSpeed !== 1.0) {
            // atempo only supports 0.5 to 2.0
            const clampedSpeed = Math.max(0.5, Math.min(2.0, playbackSpeed));
            filters.push(`atempo=${clampedSpeed}`);
        }

        // Process with FFmpeg
        await new Promise<void>((resolve, reject) => {
            let command = ffmpeg(inputPath);

            if (filters.length > 0) {
                command = command.audioFilters(filters);
            }

            command
                .output(outputPath)
                .on('end', () => resolve())
                .on('error', (err: Error) => reject(err))
                .run();
        });

        // Read output file
        const outputBuffer = fs.readFileSync(outputPath);
        return outputBuffer;

    } finally {
        // Cleanup temp files
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch { }
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { }
    }
}

/**
 * Process audio file with FFmpeg and save to output path
 */
export async function processAudioFile(
    inputPath: string,
    outputPath: string,
    options: AudioProcessingOptions
): Promise<void> {
    const { volume = 1.0, playbackSpeed = 1.0 } = options;

    // Skip processing if no changes needed
    if (volume === 1.0 && playbackSpeed === 1.0) {
        // Just copy the file
        fs.copyFileSync(inputPath, outputPath);
        return;
    }

    // Validate options
    validateAudioOptions(options);

    // Build filter chain
    const filters: string[] = [];

    if (volume !== 1.0) {
        filters.push(`volume=${volume}`);
    }

    if (playbackSpeed !== 1.0) {
        const clampedSpeed = Math.max(0.5, Math.min(2.0, playbackSpeed));
        filters.push(`atempo=${clampedSpeed}`);
    }

    // Process with FFmpeg
    await new Promise<void>((resolve, reject) => {
        let command = ffmpeg(inputPath);

        if (filters.length > 0) {
            command = command.audioFilters(filters);
        }

        command
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .run();
    });
}
