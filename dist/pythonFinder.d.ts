/**
 * Multi-version Python detection
 * Finds compatible Python installations (3.10 - 3.14) on the system
 */
import { PythonInfo } from './types';
/**
 * Find all compatible Python installations
 */
export declare function findAllPythons(): Promise<PythonInfo[]>;
/**
 * Find the best Python to use
 * Priority: 1) Has pocket-tts installed, 2) Highest version
 */
export declare function findBestPython(): Promise<PythonInfo | null>;
/**
 * Quick check if any compatible Python exists (sync version for postinstall)
 */
export declare function findPythonSync(): {
    command: string;
    version: string;
} | null;
