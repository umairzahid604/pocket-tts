#!/usr/bin/env node
/**
 * Post-install script
 * Auto-installs Python pocket-tts package if not found
 */

const { execSync, spawnSync } = require('child_process');

const PYTHON_COMMANDS = process.platform === 'win32'
    ? ['py -3.14', 'py -3.13', 'py -3.12', 'py -3.11', 'py -3.10', 'python3', 'python', 'py']
    : ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'];

function findPython() {
    for (const cmd of PYTHON_COMMANDS) {
        try {
            const parts = cmd.split(' ');
            const fullCmd = `${parts[0]} ${parts.slice(1).join(' ')} -c "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}.{v.micro}')"`.trim();
            const version = execSync(fullCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const [major, minor] = version.split('.').map(Number);
            if (major === 3 && minor >= 10 && minor < 15) {
                return { cmd, version };
            }
        } catch (e) {
            // Continue
        }
    }
    return null;
}

function checkPocketTts(pythonCmd) {
    try {
        const parts = pythonCmd.split(' ');
        const fullCmd = `${parts[0]} ${parts.slice(1).join(' ')} -c "import pocket_tts; print('ok')"`.trim();
        execSync(fullCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return true;
    } catch {
        return false;
    }
}

function installPocketTts(pythonCmd) {
    console.log('📥 Installing pocket-tts Python package...');
    console.log(`   Running: ${pythonCmd} -m pip install pocket-tts\n`);

    try {
        const parts = pythonCmd.split(' ');
        const pipCmd = `${parts[0]} ${parts.slice(1).join(' ')} -m pip install pocket-tts`.trim();

        // Run pip install with output visible
        const result = spawnSync(parts[0], [...parts.slice(1), '-m', 'pip', 'install', 'pocket-tts'], {
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });

        return result.status === 0;
    } catch (e) {
        console.error('   Installation failed:', e.message);
        return false;
    }
}

console.log('\n📦 pocket-tts post-install setup\n');

const python = findPython();

if (!python) {
    console.log('⚠️  No compatible Python found (3.10 - 3.14 required)');
    console.log('');
    console.log('   Please install Python 3.10+:');
    console.log('   https://www.python.org/downloads/');
    console.log('');
    process.exit(0);  // Don't fail npm install
}

console.log(`✅ Python ${python.version} found (${python.cmd})\n`);

if (checkPocketTts(python.cmd)) {
    console.log('✅ pocket-tts Python package already installed\n');
    console.log('🎉 Ready to use!');
    console.log('');
    console.log('   const { getSharedTTS } = require("pocket-tts");');
    console.log('   const tts = await getSharedTTS();');
    console.log('   await tts.generate({ text: "Hello!", outputPath: "./out.wav" });');
    console.log('');
} else {
    // Auto-install pocket-tts
    const installed = installPocketTts(python.cmd);

    if (installed && checkPocketTts(python.cmd)) {
        console.log('\n✅ pocket-tts Python package installed successfully!\n');
        console.log('🎉 Ready to use!');
        console.log('');
        console.log('   const { getSharedTTS } = require("pocket-tts");');
        console.log('   const tts = await getSharedTTS();');
        console.log('   await tts.generate({ text: "Hello!", outputPath: "./out.wav" });');
        console.log('');
    } else {
        console.log('\n⚠️  Auto-install failed. Please install manually:');
        console.log(`   ${python.cmd} -m pip install pocket-tts`);
        console.log('');
    }
}
