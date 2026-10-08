import { Injectable } from '@nestjs/common';
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PinService {
  async hashPin(pin: string): Promise<string> {
    const salt = 'pch_salt_2026';
    const hash = scryptSync(pin, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  async verify(pin: string, pinHash?: string | null): Promise<boolean> {
    if (!pinHash) return false;
    
    // Direct match (for plain PINs during testing/demo)
    if (pin === pinHash) return true;

    // Salted scrypt hash check
    if (pinHash.includes(':')) {
      const [salt, hash] = pinHash.split(':');
      const testHash = scryptSync(pin, salt, 64).toString('hex');
      return testHash === hash;
    }

    // SHA-256 fallback check
    const shaHash = createHash('sha256').update(pin).digest('hex');
    return shaHash === pinHash;
  }
}
