/**
 * Multi-version Python detection
 * Finds compatible Python installations (3.10 - 3.14) on the system
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import { PythonInfo } from './types';

// Python commands to try, in priority order (highest version first)
const PYTHON_COMMANDS_UNIX = [
    'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10',
    'python3', 'python'
];

const PYTHON_COMMANDS_WINDOWS = [
    'py -3.14', 'py -3.13', 'py -3.12', 'py -3.11', 'py -3.10',
    'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10',
    'python3', 'python', 'py'
];

const MIN_VERSION = [3, 10];
const MAX_VERSION = [3, 15]; // exclusive

/**
 * Parse Python version string to [major, minor, patch]
 */
function parseVersion(versionStr: string): [number, number, number] | null {
    const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Check if version is compatible (3.10 <= version < 3.15)
 */
function isCompatibleVersion(version: [number, number, number]): boolean {
    const [major, minor] = version;
    if (major !== 3) return false;
    if (minor < MIN_VERSION[1]) return false;
    if (minor >= MAX_VERSION[1]) return false;
    return true;
}

/**
 * Try to get Python info for a given command (async)
 */
async function tryPythonCommand(command: string): Promise<PythonInfo | null> {
    return new Promise((resolve) => {
        try {
            // Build command based on format
            const script = 'import sys; print(sys.version.split()[0]); print(sys.executable)';
            let fullCmd: string;

            if (command.startsWith('py ')) {
                // Windows py launcher: py -3.11 -c "..."
                fullCmd = `${command} -c "${script}"`;
            } else {
                // Regular python command
                fullCmd = `${command} -c "${script}"`;
            }

            const { exec } = require('child_process');
            exec(fullCmd, { timeout: 10000 }, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    resolve(null);
                    return;
                }

                const lines = stdout.trim().split('\n').map((s: string) => s.trim());
                if (lines.length < 2) {
                    resolve(null);
                    return;
                }

                const version = lines[0];
                const pythonPath = lines[1];

                const parsed = parseVersion(version);
                if (!parsed || !isCompatibleVersion(parsed)) {
                    resolve(null);
                    return;
                }

                resolve({
                    command,
                    version,
                    path: pythonPath,
                    hasPocketTts: false
                });
            });
        } catch {
            resolve(null);
        }
    });
}

/**
 * Check if pocket-tts is installed for a given Python command
 */
async function checkPocketTtsInstalled(pythonCommand: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const script = "import pocket_tts; print('ok')";
            let fullCmd: string;

            if (pythonCommand.startsWith('py ')) {
                fullCmd = `${pythonCommand} -c "${script}"`;
            } else {
                fullCmd = `${pythonCommand} -c "${script}"`;
            }

            const { exec } = require('child_process');
            exec(fullCmd, { timeout: 15000 }, (error: Error | null, stdout: string) => {
                resolve(!error && stdout.includes('ok'));
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Find all compatible Python installations
 */
export async function findAllPythons(): Promise<PythonInfo[]> {
    const commands = process.platform === 'win32'
        ? PYTHON_COMMANDS_WINDOWS
        : PYTHON_COMMANDS_UNIX;

    const results: PythonInfo[] = [];
    const seenPaths = new Set<string>();

    for (const command of commands) {
        const info = await tryPythonCommand(command);
        if (info && !seenPaths.has(info.path)) {
            // Check if pocket-tts is installed
            info.hasPocketTts = await checkPocketTtsInstalled(command);
            results.push(info);
            seenPaths.add(info.path);
        }
    }

    return results;
}

/**
 * Find the best Python to use
 * Priority: 1) Has pocket-tts installed, 2) Highest version
 */
export async function findBestPython(): Promise<PythonInfo | null> {
    const pythons = await findAllPythons();

    if (pythons.length === 0) {
        return null;
    }

    // First, try to find one with pocket-tts already installed
    const withPocketTts = pythons.filter(p => p.hasPocketTts);
    if (withPocketTts.length > 0) {
        // Return highest version with pocket-tts
        return withPocketTts[0];
    }

    // Otherwise, return highest compatible version
    return pythons[0];
}

/**
 * Quick check if any compatible Python exists (sync version for postinstall)
 */
export function findPythonSync(): { command: string; version: string } | null {
    const commands = process.platform === 'win32'
        ? PYTHON_COMMANDS_WINDOWS
        : PYTHON_COMMANDS_UNIX;

    for (const command of commands) {
        try {
            const parts = command.split(' ');
            const cmd = parts[0];
            const args = [...parts.slice(1), '-c', 'import sys; print(sys.version.split()[0])'];

            const result = execSync(`${cmd} ${args.join(' ')}`, {
                timeout: 5000,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();

            const parsed = parseVersion(result);
            if (parsed && isCompatibleVersion(parsed)) {
                return { command, version: result };
            }
        } catch {
            // Continue to next command
        }
    }

    return null;
}
