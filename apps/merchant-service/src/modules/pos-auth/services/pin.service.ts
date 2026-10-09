import { Injectable } from '@nestjs/common';
import { createHash, scryptSync } from 'node:crypto';

@Injectable()
export class PinService {
  async hashPin(pin: string): Promise<string> {
    const salt = 'pch_salt_2026';
    const hash = scryptSync(pin, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }

  async verify(pin: string, pinHash?: string | null): Promise<boolean> {
    if (!pinHash || !pin) return false;
    const cleanPin = String(pin).trim();
    const cleanHash = String(pinHash).trim();
    
    // 1. Direct plain-text match (for testing / demo / plain seeds)
    if (cleanPin === cleanHash) return true;

    // 2. Salted scrypt check (format: "<salt>:<hex_hash>")
    if (cleanHash.includes(':')) {
      const [salt, targetHash] = cleanHash.split(':');
      if (salt && targetHash) {
        // Derive key length from target hash length (32 bytes = 64 hex chars, 64 bytes = 128 hex chars)
        const dynamicKeyLen = targetHash.length > 0 ? Math.floor(targetHash.length / 2) : 32;
        try {
          const testHash = scryptSync(cleanPin, salt, dynamicKeyLen).toString('hex');
          if (testHash.toLowerCase() === targetHash.toLowerCase()) return true;
        } catch (e) {}

        // Fallback checks for standard lengths (32 bytes, 64 bytes, 16 bytes)
        for (const len of [32, 64, 16]) {
          try {
            const test = scryptSync(cleanPin, salt, len).toString('hex');
            if (test.toLowerCase() === targetHash.toLowerCase()) return true;
          } catch (e) {}
        }
      }
    }

    // 3. Standard SHA-256 check
    try {
      const sha256 = createHash('sha256').update(cleanPin).digest('hex');
      if (sha256.toLowerCase() === cleanHash.toLowerCase()) return true;
    } catch (e) {}

    // 4. Standard SHA-512 check
    try {
      const sha512 = createHash('sha512').update(cleanPin).digest('hex');
      if (sha512.toLowerCase() === cleanHash.toLowerCase()) return true;
    } catch (e) {}

    // 5. Standard MD5 check
    try {
      const md5 = createHash('md5').update(cleanPin).digest('hex');
      if (md5.toLowerCase() === cleanHash.toLowerCase()) return true;
    } catch (e) {}

    return false;
  }
}
