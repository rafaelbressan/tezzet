import * as bip39 from 'bip39';
import { validateAddress, ValidationResult } from '@taquito/utils';

describe('Wallet Utils', () => {
  describe('Mnemonic Generation', () => {
    it('should generate a valid 24-word mnemonic', () => {
      const mnemonic = bip39.generateMnemonic(256);
      const words = mnemonic.split(' ');

      expect(words.length).toBe(24);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
    });

    it('should generate a valid 12-word mnemonic', () => {
      const mnemonic = bip39.generateMnemonic(128);
      const words = mnemonic.split(' ');

      expect(words.length).toBe(12);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
    });

    it('should reject invalid mnemonic', () => {
      const invalidMnemonic = 'invalid words that are not a real mnemonic phrase';
      expect(bip39.validateMnemonic(invalidMnemonic)).toBe(false);
    });
  });

  describe('Address Validation', () => {
    it('should validate correct tz1 address', () => {
      const validAddress = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
      expect(validateAddress(validAddress)).toBe(ValidationResult.VALID);
    });

    it('should validate correct tz2 address', () => {
      const validAddress = 'tz2TSvNTh2epDMhZHrw73nV9piBX7kLZ9K9m';
      expect(validateAddress(validAddress)).toBe(ValidationResult.VALID);
    });

    it('should validate correct tz3 address', () => {
      const validAddress = 'tz3WXYtyDUNL91qfiCJtVUX746QpNv5i5ve5';
      expect(validateAddress(validAddress)).toBe(ValidationResult.VALID);
    });

    it('should reject invalid address', () => {
      const invalidAddress = 'invalid_address';
      expect(validateAddress(invalidAddress)).not.toBe(ValidationResult.VALID);
    });

    it('should reject empty address', () => {
      expect(validateAddress('')).not.toBe(ValidationResult.VALID);
    });

    it('should reject address with wrong prefix', () => {
      const wrongPrefix = 'tz4VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
      expect(validateAddress(wrongPrefix)).not.toBe(ValidationResult.VALID);
    });
  });
});

describe('Balance Formatting', () => {
  const formatBalance = (mutez: number): string => {
    return (mutez / 1_000_000).toFixed(6);
  };

  it('should format mutez to XTZ correctly', () => {
    expect(formatBalance(1_000_000)).toBe('1.000000');
    expect(formatBalance(1_500_000)).toBe('1.500000');
    expect(formatBalance(123_456_789)).toBe('123.456789');
    expect(formatBalance(0)).toBe('0.000000');
  });

  it('should handle small amounts', () => {
    expect(formatBalance(1)).toBe('0.000001');
    expect(formatBalance(100)).toBe('0.000100');
  });
});
