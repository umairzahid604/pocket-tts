/**
 * Quick test for pocket-tts
 */

const { PocketTTS } = require('../dist/index');
const fs = require('fs');

async function test() {
    console.log('🧪 Testing pocket-tts package\n');

    // Test 1: Check setup
    console.log('1. Checking setup...');
    const status = await PocketTTS.checkSetup();
    console.log('   Python:', status.pythonVersion, `(${status.pythonCommand})`);
    console.log('   pocket-tts installed:', status.pocketTtsInstalled);
    console.log('   Voice cloning available:', status.voiceCloningAvailable);
    console.log('   Setup complete:', status.setupComplete);
    console.log('');

    if (!status.setupComplete) {
        console.log(PocketTTS.getSetupInstructions(status));
        return;
    }

    // Test 2: Initialize and generate
    console.log('2. Initializing TTS...');
    const tts = new PocketTTS();
    await tts.init();
    console.log('   ✅ Initialized\n');

    // Test 3: List voices
    console.log('3. Getting voices list...');
    const voices = await tts.getVoicesList();
    console.log('   Voices:', voices.voices.join(', '));
    console.log('');

    // Test 4: Generate audio
    console.log('4. Generating audio...');
    const startTime = Date.now();
    const audio = await tts.generate({
        text: "Hello! This is a test of the pocket TTS npm package.",
        voice: "alba"
    });
    const duration = Date.now() - startTime;
    console.log(`   ✅ Generated ${audio.length} bytes in ${duration}ms\n`);

    // Test 5: Save to file
    const outputPath = './test_output.wav';
    fs.writeFileSync(outputPath, audio);
    console.log(`5. Saved to ${outputPath}\n`);

    // Cleanup
    tts.close();
    console.log('🎉 All tests passed!');
}

test().catch(err => {
    console.error('❌ Test failed:', err.message);
    if (err.setupInstructions) {
        console.log('\nSetup instructions:');
        console.log(err.setupInstructions);
    }
    process.exit(1);
});
