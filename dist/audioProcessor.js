"use strict";
/**
 * Audio processing using FFmpeg
 * Handles volume and playback speed adjustments
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAudioOptions = validateAudioOptions;
exports.processAudio = processAudio;
exports.processAudioFile = processAudioFile;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
// Set FFmpeg path
fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_1.default.path);
/**
 * Validate audio processing options
 */
function validateAudioOptions(options) {
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
async function processAudio(inputBuffer, options) {
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
        const filters = [];
        if (volume !== 1.0) {
            filters.push(`volume=${volume}`);
        }
        if (playbackSpeed !== 1.0) {
            // atempo only supports 0.5 to 2.0
            const clampedSpeed = Math.max(0.5, Math.min(2.0, playbackSpeed));
            filters.push(`atempo=${clampedSpeed}`);
        }
        // Process with FFmpeg
        await new Promise((resolve, reject) => {
            let command = (0, fluent_ffmpeg_1.default)(inputPath);
            if (filters.length > 0) {
                command = command.audioFilters(filters);
            }
            command
                .output(outputPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .run();
        });
        // Read output file
        const outputBuffer = fs.readFileSync(outputPath);
        return outputBuffer;
    }
    finally {
        // Cleanup temp files
        try {
            if (fs.existsSync(inputPath))
                fs.unlinkSync(inputPath);
        }
        catch { }
        try {
            if (fs.existsSync(outputPath))
                fs.unlinkSync(outputPath);
        }
        catch { }
    }
}
/**
 * Process audio file with FFmpeg and save to output path
 */
async function processAudioFile(inputPath, outputPath, options) {
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
    const filters = [];
    if (volume !== 1.0) {
        filters.push(`volume=${volume}`);
    }
    if (playbackSpeed !== 1.0) {
        const clampedSpeed = Math.max(0.5, Math.min(2.0, playbackSpeed));
        filters.push(`atempo=${clampedSpeed}`);
    }
    // Process with FFmpeg
    await new Promise((resolve, reject) => {
        let command = (0, fluent_ffmpeg_1.default)(inputPath);
        if (filters.length > 0) {
            command = command.audioFilters(filters);
        }
        command
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaW9Qcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYXVkaW9Qcm9jZXNzb3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFxQkgsb0RBV0M7QUFRRCxvQ0E2REM7QUFLRCw0Q0EyQ0M7QUFuSkQsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQUN6Qix1Q0FBeUI7QUFDekIsa0VBQW1DO0FBQ25DLHNFQUFrRDtBQUVsRCxrQkFBa0I7QUFDbEIsdUJBQU0sQ0FBQyxhQUFhLENBQUMsZ0JBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQVN0Qzs7R0FFRztBQUNILFNBQWdCLG9CQUFvQixDQUFDLE9BQStCO0lBQ2hFLElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO1FBQzFELENBQUM7SUFDTCxDQUFDO0lBQ0QsSUFBSSxPQUFPLENBQUMsYUFBYSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQ3RDLElBQUksT0FBTyxDQUFDLGFBQWEsR0FBRyxHQUFHLElBQUksT0FBTyxDQUFDLGFBQWEsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMzRCxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7UUFDbEUsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSSxLQUFLLFVBQVUsWUFBWSxDQUM5QixXQUFtQixFQUNuQixPQUErQjtJQUUvQixNQUFNLEVBQUUsTUFBTSxHQUFHLEdBQUcsRUFBRSxhQUFhLEdBQUcsR0FBRyxFQUFFLEdBQUcsT0FBTyxDQUFDO0lBRXRELHVDQUF1QztJ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QyxHQUFVLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUN4QyxHQUFHLEVBQUUsQ0FBQztJQUNmLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBBdWRpbyBwcm9jZXNzaW5nIHVzaW5nIEZGbXBlZ1xyXG4gKiBIYW5kbGVzIHZvbHVtZSBhbmQgcGxheWJhY2sgc3BlZWQgYWRqdXN0bWVudHNcclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcclxuaW1wb3J0IGZmbXBlZyBmcm9tICdmbHVlbnQtZmZtcGVnJztcclxuaW1wb3J0IGZmbXBlZ1BhdGggZnJvbSAnQGZmbXBlZy1pbnN0YWxsZXIvZmZtcGVnJztcclxuXHJcbi8vIFNldCBGRm1wZWcgcGF0aFxyXG5mZm1wZWcuc2V0RmZtcGVnUGF0aChmZm1wZWdQYXRoLnBhdGgpO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBBdWRpb1Byb2Nlc3NpbmdPcHRpb25zIHtcclxuICAgIC8qKiBWb2x1bWUgbGV2ZWw6IDAuMCB0byAyLjAsIGRlZmF1bHQgMS4wICovXHJcbiAgICB2b2x1bWU/OiBudW1iZXI7XHJcbiAgICAvKiogUGxheWJhY2sgc3BlZWQ6IDAuNSB0byAyLjAsIGRlZmF1bHQgMS4wICovXHJcbiAgICBwbGF5YmFja1NwZWVkPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKipcclxuICogVmFsaWRhdGUgYXVkaW8gcHJvY2Vzc2luZyBvcHRpb25zXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBdWRpb09wdGlvbnMob3B0aW9uczogQXVkaW9Qcm9jZXNzaW5nT3B0aW9ucyk6IHZvaWQge1xyXG4gICAgaWYgKG9wdGlvbnMudm9sdW1lICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAob3B0aW9ucy52b2x1bWUgPCAwIHx8IG9wdGlvbnMudm9sdW1lID4gMikge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZvbHVtZSBtdXN0IGJlIGJldHdlZW4gMC4wIGFuZCAyLjAnKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAob3B0aW9ucy5wbGF5YmFja1NwZWVkICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAob3B0aW9ucy5wbGF5YmFja1NwZWVkIDwgMC41IHx8IG9wdGlvbnMucGxheWJhY2tTcGVlZCA+IDIpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGF5YmFjayBzcGVlZCBtdXN0IGJlIGJldHdlZW4gMC41IGFuZCAyLjAnKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIGF1ZGlvIGJ1ZmZlciB3aXRoIEZGbXBlZ1xyXG4gKiBAcGFyYW0gaW5wdXRCdWZmZXIgLSBJbnB1dCBhdWRpbyBidWZmZXIgKFdBViBmb3JtYXQpXHJcbiAqIEBwYXJhbSBvcHRpb25zIC0gUHJvY2Vzc2luZyBvcHRpb25zICh2b2x1bWUsIHNwZWVkKVxyXG4gKiBAcmV0dXJucyBQcm9jZXNzZWQgYXVkaW8gYnVmZmVyXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc0F1ZGlvKFxyXG4gICAgaW5wdXRCdWZmZXI6IEJ1ZmZlcixcclxuICAgIG9wdGlvbnM6IEF1ZGlvUHJvY2Vzc2luZ09wdGlvbnNcclxuKTogUHJvbWlzZTxCdWZmZXI+IHtcclxuICAgIGNvbnN0IHsgdm9sdW1lID0gMS4wLCBwbGF5YmFja1NwZWVkID0gMS4wIH0gPSBvcHRpb25zO1xyXG5cclxuICAgIC8vIFNraXAgcHJvY2Vzc2luZyBpZiBubyBjaGFuZ2VzIG5lZWRlZFxyXG4gICAgaWYgKHZvbHVtZSA9PT0gMS4wICYmIHBsYXliYWNrU3BlZWQgPT09IDEuMCkge1xyXG4gICAgICAgIHJldHVybiBpbnB1dEJ1ZmZlcjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBvcHRpb25zXHJcbiAgICB2YWxpZGF0ZUF1ZGlvT3B0aW9ucyhvcHRpb25zKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGVtcCBmaWxlc1xyXG4gICAgY29uc3QgdGVtcERpciA9IG9zLnRtcGRpcigpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5ub3coKTtcclxuICAgIGNvbnN0IGlucHV0UGF0aCA9IHBhdGguam9pbih0ZW1wRGlyLCBgcG9ja2V0X3R0c19pbnB1dF8ke3RpbWVzdGFtcH0ud2F2YCk7XHJcbiAgICBjb25zdCBvdXRwdXRQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsIGBwb2NrZXRfdHRzX291dHB1dF8ke3RpbWVzdGFtcH0ud2F2YCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICAvLyBXcml0ZSBpbnB1dCBidWZmZXIgdG8gdGVtcCBmaWxlXHJcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhpbnB1dFBhdGgsIGlucHV0QnVmZmVyKTtcclxuXHJcbiAgICAgICAgLy8gQnVpbGQgZmlsdGVyIGNoYWluXHJcbiAgICAgICAgY29uc3QgZmlsdGVyczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgaWYgKHZvbHVtZSAhPT0gMS4wKSB7XHJcbiAgICAgICAgICAgIGZpbHRlcnMucHVzaChgdm9sdW1lPSR7dm9sdW1lfWApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHBsYXliYWNrU3BlZWQgIT09IDEuMCkge1xyXG4gICAgICAgICAgICAvLyBhdGVtcG8gb25seSBzdXBwb3J0cyAwLjUgdG8gMi4wXHJcbiAgICAgICAgICAgIGNvbnN0IGNsYW1wZWRTcGVlZCA9IE1hdGgubWF4KDAuNSwgTWF0aC5taW4oMi4wLCBwbGF5YmFja1NwZWVkKSk7XHJcbiAgICAgICAgICAgIGZpbHRlcnMucHVzaChgYXRlbXBvPSR7Y2xhbXBlZFNwZWVkfWApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gUHJvY2VzcyB3aXRoIEZGbXBlZ1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgbGV0IGNvbW1hbmQgPSBmZm1wZWcoaW5wdXRQYXRoKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbW1hbmQgPSBjb21tYW5kLmF1ZGlvRmlsdGVycyhmaWx0ZXJzKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29tbWFuZFxyXG4gICAgICAgICAgICAgICAgLm91dHB1dChvdXRwdXRQYXRoKVxyXG4gICAgICAgICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKCkpXHJcbiAgICAgICAgICAgICAgICAub24oJ2Vycm9yJywgKGVycjogRXJyb3IpID0+IHJlamVjdChlcnIpKVxyXG4gICAgICAgICAgICAgICAgLnJ1bigpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBSZWFkIG91dHB1dCBmaWxlXHJcbiAgICAgICAgY29uc3Qgb3V0cHV0QnVmZmVyID0gZnMucmVhZEZpbGVTeW5jKG91dHB1dFBhdGgpO1xyXG4gICAgICAgIHJldHVybiBvdXRwdXRCdWZmZXI7XHJcblxyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAvLyBDbGVhbnVwIHRlbXAgZmlsZXNcclxuICAgICAgICB0cnkgeyBpZiAoZnMuZXhpc3RzU3luYyhpbnB1dFBhdGgpKSBmcy51bmxpbmtTeW5jKGlucHV0UGF0aCk7IH0gY2F0Y2ggeyB9XHJcbiAgICAgICAgdHJ5IHsgaWYgKGZzLmV4aXN0c1N5bmMob3V0cHV0UGF0aCkpIGZzLnVubGlua1N5bmMob3V0cHV0UGF0aCk7IH0gY2F0Y2ggeyB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIGF1ZGlvIGZpbGUgd2l0aCBGRm1wZWcgYW5kIHNhdmUgdG8gb3V0cHV0IHBhdGhcclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcm9jZXNzQXVkaW9GaWxlKFxyXG4gICAgaW5wdXRQYXRoOiBzdHJpbmcsXHJcbiAgICBvdXRwdXRQYXRoOiBzdHJpbmcsXHJcbiAgICBvcHRpb25zOiBBdWRpb1Byb2Nlc3NpbmdPcHRpb25zXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgeyB2b2x1bWUgPSAxLjAsIHBsYXliYWNrU3BlZWQgPSAxLjAgfSA9IG9wdGlvbnM7XHJcblxyXG4gICAgLy8gU2tpcCBwcm9jZXNzaW5nIGlmIG5vIGNoYW5nZXMgbmVlZGVkXHJcbiAgICBpZiAodm9sdW1lID09PSAxLjAgJiYgcGxheWJhY2tTcGVlZCA9PT0gMS4wKSB7XHJcbiAgICAgICAgLy8gSnVzdCBjb3B5IHRoZSBmaWxlXHJcbiAgICAgICAgZnMuY29weUZpbGVTeW5jKGlucHV0UGF0aCwgb3V0cHV0UGF0aCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG9wdGlvbnNcclxuICAgIHZhbGlkYXRlQXVkaW9PcHRpb25zKG9wdGlvbnMpO1xyXG5cclxuICAgIC8vIEJ1aWxkIGZpbHRlciBjaGFpblxyXG4gICAgY29uc3QgZmlsdGVyczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICBpZiAodm9sdW1lICE9PSAxLjApIHtcclxuICAgICAgICBmaWx0ZXJzLnB1c2goYHZvbHVtZT0ke3ZvbHVtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocGxheWJhY2tTcGVlZCAhPT0gMS4wKSB7XHJcbiAgICAgICAgY29uc3QgY2xhbXBlZFNwZWVkID0gTWF0aC5tYXgoMC41LCBNYXRoLm1pbigyLjAsIHBsYXliYWNrU3BlZWQpKTtcclxuICAgICAgICBmaWx0ZXJzLnB1c2goYGF0ZW1wbz0ke2NsYW1wZWRTcGVlZH1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBQcm9jZXNzIHdpdGggRkZtcGVnXHJcbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgbGV0IGNvbW1hbmQgPSBmZm1wZWcoaW5wdXRQYXRoKTtcclxuXHJcbiAgICAgICAgaWYgKGZpbHRlcnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBjb21tYW5kID0gY29tbWFuZC5hdWRpb0ZpbHRlcnMoZmlsdGVycyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb21tYW5kXHJcbiAgICAgICAgICAgIC5vdXRwdXQob3V0cHV0UGF0aClcclxuICAgICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKCkpXHJcbiAgICAgICAgICAgIC5vbignZXJyb3InLCAoZXJyOiBFcnJvcikgPT4gcmVqZWN0KGVycikpXHJcbiAgICAgICAgICAgIC5ydW4oKTtcclxuICAgIH0pO1xyXG59XHJcbiJdfQ==