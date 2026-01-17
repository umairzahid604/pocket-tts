# pocket-tts

Text-to-Speech with voice cloning using Kyutai's [Pocket-TTS](https://github.com/kyutai-labs/pocket-tts) model.

[![npm version](https://badge.fury.io/js/pocket-tts.svg)](https://www.npmjs.com/package/pocket-tts)

## Features

- 🎙️ **High-quality TTS** - 100M parameter model optimized for CPU
- 🎭 **8 Built-in Voices** - alba, marius, javert, jean, fantine, cosette, eponine, azelma
- 🔊 **Voice Cloning** - Clone any voice from a 5-30 second audio sample
- 🎚️ **Audio Effects** - Adjust volume (0-2x) and playback speed (0.5-2x)
- ⚡ **Fast** - Model loads once, all generations are fast (~600-800ms)
- 🔧 **Auto-Setup Detection** - Guides you through installation

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0.0 |
| Python | 3.10 - 3.14 |

## Installation

```bash
npm install https://github.com/umairzahid604/pocket-tts.git
```

Python package `pocket-tts` will be installed automatically during npm install.

## Quick Start (Recommended)

Use `getSharedTTS()` for best performance - model loads once, all generations are fast:

```javascript
const { getSharedTTS, closeSharedTTS } = require('pocket-tts');

async function main() {
    const tts = await getSharedTTS();
    
    // First call: ~12s (includes model loading)
    await tts.generate({ text: "Hello!", outputPath: "./hello.wav" });
    
    // Subsequent calls: ~600-800ms (fast!)
    await tts.generate({ text: "Fast!", outputPath: "./fast.wav" });
    
    // Cleanup when app exits
    closeSharedTTS();
}

main();
```

## Alternative: Manual Instance

```javascript
const { PocketTTS } = require('pocket-tts');

const tts = new PocketTTS();
await tts.generate({ text: "Hello!", outputPath: "./output.wav" });
tts.close();
```

## API Reference

### `getSharedTTS()` (Recommended)

Get a shared, pre-initialized TTS instance. First call loads the model, subsequent calls reuse it.

```javascript
const { getSharedTTS, closeSharedTTS } = require('pocket-tts');

const tts = await getSharedTTS();  // First: slow, After: instant
await tts.generate({ text: "Always fast!", outputPath: "./out.wav" });
closeSharedTTS();  // Cleanup
```

### `tts.generate(options)`

Generate speech from text.

```javascript
await tts.generate({
    text: "Hello world!",           // Required
    voice: "alba",                  // Optional, default: "alba"
    volume: 1.5,                    // Optional, 0.0-2.0, default: 1.0
    playbackSpeed: 1.2,             // Optional, 0.5-2.0, default: 1.0
    outputPath: "./output.wav"      // Optional, saves directly to file
});
```

### Available Voices

`alba`, `marius`, `javert`, `jean`, `fantine`, `cosette`, `eponine`, `azelma`

```javascript
const voices = await tts.getVoicesList();
```

## Voice Cloning

Requires HuggingFace setup:

1. Accept terms at: https://huggingface.co/kyutai/pocket-tts
2. Login with: `uvx hf auth login`

```javascript
await tts.generate({
    text: "This is my cloned voice!",
    voice: "./my-voice-sample.wav"  // 5-30 second WAV file
});
```

## Audio Effects

```javascript
await tts.generate({
    text: "Louder and faster!",
    volume: 1.5,        // 50% louder (0.0-2.0)
    playbackSpeed: 1.3  // 30% faster (0.5-2.0)
});
```

## Server Example

```javascript
const { getSharedTTS } = require('pocket-tts');
const express = require('express');

const app = express();

// Pre-load model at startup
getSharedTTS().then(() => console.log('TTS ready!'));

app.post('/tts', async (req, res) => {
    const tts = await getSharedTTS();  // Instant - already loaded
    await tts.generate({
        text: req.body.text,
        outputPath: "./temp.wav"
    });
    res.sendFile('./temp.wav');
});

app.listen(3000);
```

## Error Handling

```javascript
try {
    await tts.generate({ text: "Hello", voice: "./missing.wav" });
} catch (err) {
    console.log(err.code);  // 'VOICE_CLONING_NOT_AVAILABLE'
    console.log(err.setupInstructions);
}
```

| Error Code | Meaning |
|-----------|---------|
| `PYTHON_NOT_FOUND` | No Python 3.10+ found |
| `POCKET_TTS_NOT_INSTALLED` | pip package not installed |
| `VOICE_CLONING_NOT_AVAILABLE` | HuggingFace terms not accepted |

## License

MIT

## Credits

- [Kyutai Labs](https://kyutai.org) - Pocket-TTS model
- [FFmpeg](https://ffmpeg.org) - Audio processing
