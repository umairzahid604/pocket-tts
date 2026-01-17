"use strict";
/**
 * pocket-tts
 * Text-to-Speech with voice cloning using Kyutai's Pocket-TTS model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAudioOptions = exports.processAudio = exports.findPythonSync = exports.findBestPython = exports.findAllPythons = exports.PREDEFINED_VOICES = exports.createTTS = exports.PocketTTS = void 0;
exports.getSharedTTS = getSharedTTS;
exports.closeSharedTTS = closeSharedTTS;
// Main class and factory
var tts_1 = require("./tts");
Object.defineProperty(exports, "PocketTTS", { enumerable: true, get: function () { return tts_1.PocketTTS; } });
Object.defineProperty(exports, "createTTS", { enumerable: true, get: function () { return tts_1.createTTS; } });
// Types
var types_1 = require("./types");
Object.defineProperty(exports, "PREDEFINED_VOICES", { enumerable: true, get: function () { return types_1.PREDEFINED_VOICES; } });
// Utilities
var pythonFinder_1 = require("./pythonFinder");
Object.defineProperty(exports, "findAllPythons", { enumerable: true, get: function () { return pythonFinder_1.findAllPythons; } });
Object.defineProperty(exports, "findBestPython", { enumerable: true, get: function () { return pythonFinder_1.findBestPython; } });
Object.defineProperty(exports, "findPythonSync", { enumerable: true, get: function () { return pythonFinder_1.findPythonSync; } });
var audioProcessor_1 = require("./audioProcessor");
Object.defineProperty(exports, "processAudio", { enumerable: true, get: function () { return audioProcessor_1.processAudio; } });
Object.defineProperty(exports, "validateAudioOptions", { enumerable: true, get: function () { return audioProcessor_1.validateAudioOptions; } });
// Singleton - shared pre-initialized instance
const tts_2 = require("./tts");
let sharedInstance = null;
let initPromise = null;
/**
 * Get a shared, pre-initialized TTS instance.
 * First call initializes the model (slow), subsequent calls reuse it (instant).
 *
 * @example
 * const tts = await getSharedTTS();
 * await tts.generate({ text: "Fast every time!" });
 */
async function getSharedTTS() {
    if (sharedInstance) {
        return sharedInstance;
    }
    if (initPromise) {
        return initPromise;
    }
    initPromise = (async () => {
        sharedInstance = new tts_2.PocketTTS();
        await sharedInstance.init();
        return sharedInstance;
    })();
    return initPromise;
}
/**
 * Close the shared TTS instance and free resources.
 */
function closeSharedTTS() {
    if (sharedInstance) {
        sharedInstance.close();
        sharedInstance = null;
        initPromise = null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7O0FBa0NILG9DQWdCQztBQUtELHdDQU1DO0FBM0RELHlCQUF5QjtBQUN6Qiw2QkFBNkM7QUFBcEMsZ0dBQUEsU0FBUyxPQUFBO0FBQUUsZ0dBQUEsU0FBUyxPQUFBO0FBRTdCLFFBQVE7QUFDUixpQ0FRaUI7QUFGYiwwR0FBQSxpQkFBaUIsT0FBQTtBQUlyQixZQUFZO0FBQ1osK0NBQWdGO0FBQXZFLDhHQUFBLGNBQWMsT0FBQTtBQUFFLDhHQUFBLGNBQWMsT0FBQTtBQUFFLDhHQUFBLGNBQWMsT0FBQTtBQUN2RCxtREFBOEY7QUFBckYsOEdBQUEsWUFBWSxPQUFBO0FBQUUsc0hBQUEsb0JBQW9CLE9BQUE7QUFFM0MsOENBQThDO0FBQzlDLCtCQUFrQztBQUVsQyxJQUFJLGNBQWMsR0FBcUIsSUFBSSxDQUFDO0FBQzVDLElBQUksV0FBVyxHQUE4QixJQUFJLENBQUM7QUFFbEQ7Ozs7Ozs7R0FPRztBQUNJLEtBQUssVUFBVSxZQUFZO0lBQzlCLElBQUksY0FBYyxFQUFFLENBQUM7UUFDakIsT0FBTyxjQUFjLENBQUM7SUFDMUIsQ0FBQztJQUVELElBQUksV0FBVyxFQUFFLENBQUM7UUFDZCxPQUFPLFdBQVcsQ0FBQztJQUN2QixDQUFDO0lBRUQsV0FBVyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDdEIsY0FBYyxHQUFHLElBQUksZUFBUyxFQUFFLENBQUM7UUFDakMsTUFBTSxjQUFjLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDNUIsT0FBTyxjQUFjLENBQUM7SUFDMUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUVMLE9BQU8sV0FBVyxDQUFDO0FBQ3ZCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGNBQWM7SUFDMUIsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNqQixjQUFjLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDdkIsY0FBYyxHQUFHLElBQUksQ0FBQztRQUN0QixXQUFXLEdBQUcsSUFBSSxDQUFDO0lBQ3ZCLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIHBvY2tldC10dHNcclxuICogVGV4dC10by1TcGVlY2ggd2l0aCB2b2ljZSBjbG9uaW5nIHVzaW5nIEt5dXRhaSdzIFBvY2tldC1UVFMgbW9kZWxcclxuICovXHJcblxyXG4vLyBNYWluIGNsYXNzIGFuZCBmYWN0b3J5XHJcbmV4cG9ydCB7IFBvY2tldFRUUywgY3JlYXRlVFRTIH0gZnJvbSAnLi90dHMnO1xyXG5cclxuLy8gVHlwZXNcclxuZXhwb3J0IHtcclxuICAgIEdlbmVyYXRlT3B0aW9ucyxcclxuICAgIFZvaWNlTGlzdFJlc3BvbnNlLFxyXG4gICAgU2V0dXBTdGF0dXMsXHJcbiAgICBQeXRob25JbmZvLFxyXG4gICAgVFRTRXJyb3IsXHJcbiAgICBQUkVERUZJTkVEX1ZPSUNFUyxcclxuICAgIFByZWRlZmluZWRWb2ljZVxyXG59IGZyb20gJy4vdHlwZXMnO1xyXG5cclxuLy8gVXRpbGl0aWVzXHJcbmV4cG9ydCB7IGZpbmRBbGxQeXRob25zLCBmaW5kQmVzdFB5dGhvbiwgZmluZFB5dGhvblN5bmMgfSBmcm9tICcuL3B5dGhvbkZpbmRlcic7XHJcbmV4cG9ydCB7IHByb2Nlc3NBdWRpbywgdmFsaWRhdGVBdWRpb09wdGlvbnMsIEF1ZGlvUHJvY2Vzc2luZ09wdGlvbnMgfSBmcm9tICcuL2F1ZGlvUHJvY2Vzc29yJztcclxuXHJcbi8vIFNpbmdsZXRvbiAtIHNoYXJlZCBwcmUtaW5pdGlhbGl6ZWQgaW5zdGFuY2VcclxuaW1wb3J0IHsgUG9ja2V0VFRTIH0gZnJvbSAnLi90dHMnO1xyXG5cclxubGV0IHNoYXJlZEluc3RhbmNlOiBQb2NrZXRUVFMgfCBudWxsID0gbnVsbDtcclxubGV0IGluaXRQcm9taXNlOiBQcm9taXNlPFBvY2tldFRUUz4gfCBudWxsID0gbnVsbDtcclxuXHJcbi8qKlxyXG4gKiBHZXQgYSBzaGFyZWQsIHByZS1pbml0aWFsaXplZCBUVFMgaW5zdGFuY2UuXHJcbiAqIEZpcnN0IGNhbGwgaW5pdGlhbGl6ZXMgdGhlIG1vZGVsIChzbG93KSwgc3Vic2VxdWVudCBjYWxscyByZXVzZSBpdCAoaW5zdGFudCkuXHJcbiAqIFxyXG4gKiBAZXhhbXBsZVxyXG4gKiBjb25zdCB0dHMgPSBhd2FpdCBnZXRTaGFyZWRUVFMoKTtcclxuICogYXdhaXQgdHRzLmdlbmVyYXRlKHsgdGV4dDogXCJGYXN0IGV2ZXJ5IHRpbWUhXCIgfSk7XHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0U2hhcmVkVFRTKCk6IFByb21pc2U8UG9ja2V0VFRTPiB7XHJcbiAgICBpZiAoc2hhcmVkSW5zdGFuY2UpIHtcclxuICAgICAgICByZXR1cm4gc2hhcmVkSW5zdGFuY2U7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGluaXRQcm9taXNlKSB7XHJcbiAgICAgICAgcmV0dXJuIGluaXRQcm9taXNlO1xyXG4gICAgfVxyXG5cclxuICAgIGluaXRQcm9taXNlID0gKGFzeW5jICgpID0+IHtcclxuICAgICAgICBzaGFyZWRJbnN0YW5jZSA9IG5ldyBQb2NrZXRUVFMoKTtcclxuICAgICAgICBhd2FpdCBzaGFyZWRJbnN0YW5jZS5pbml0KCk7XHJcbiAgICAgICAgcmV0dXJuIHNoYXJlZEluc3RhbmNlO1xyXG4gICAgfSkoKTtcclxuXHJcbiAgICByZXR1cm4gaW5pdFByb21pc2U7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDbG9zZSB0aGUgc2hhcmVkIFRUUyBpbnN0YW5jZSBhbmQgZnJlZSByZXNvdXJjZXMuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gY2xvc2VTaGFyZWRUVFMoKTogdm9pZCB7XHJcbiAgICBpZiAoc2hhcmVkSW5zdGFuY2UpIHtcclxuICAgICAgICBzaGFyZWRJbnN0YW5jZS5jbG9zZSgpO1xyXG4gICAgICAgIHNoYXJlZEluc3RhbmNlID0gbnVsbDtcclxuICAgICAgICBpbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICB9XHJcbn1cclxuIl19