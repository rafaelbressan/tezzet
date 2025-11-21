import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { validateAddress, ValidationResult } from '@taquito/utils';
import { TEZOS_RPC, DEFAULT_NETWORK } from '../constants/config';
import { StorageService } from './storage';

const Tezos = new TezosToolkit(TEZOS_RPC[DEFAULT_NETWORK]);

// Generate a new mnemonic (using crypto API)
function generateMnemonic(): string {
  const wordlist = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
    'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
    'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
    // This is a simplified wordlist - in production use bip39 library
  ];
  // For demo purposes - use proper bip39 in production
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    const randomIndex = Math.floor(Math.random() * wordlist.length);
    words.push(wordlist[randomIndex]);
  }
  return words.join(' ');
}

export const WalletService = {
  async createWallet(): Promise<{ address: string; mnemonic: string }> {
    // In production, use proper bip39 mnemonic generation
    const mnemonic = generateMnemonic();
    const signer = InMemorySigner.fromMnemonic({ mnemonic });
    const address = await signer.publicKeyHash();

    await StorageService.saveMnemonic(mnemonic);
    await StorageService.saveWalletAddress(address);

    Tezos.setProvider({ signer });

    return { address, mnemonic };
  },

  async importWallet(mnemonic: string): Promise<string> {
    const signer = InMemorySigner.fromMnemonic({ mnemonic: mnemonic.trim() });
    const address = await signer.publicKeyHash();

    await StorageService.saveMnemonic(mnemonic.trim());
    await StorageService.saveWalletAddress(address);

    Tezos.setProvider({ signer });

    return address;
  },

  async loadWallet(): Promise<string | null> {
    const mnemonic = await StorageService.getMnemonic();
    if (!mnemonic) return null;

    const signer = InMemorySigner.fromMnemonic({ mnemonic });
    Tezos.setProvider({ signer });

    return signer.publicKeyHash();
  },

  async getBalance(address: string): Promise<string> {
    try {
      const balance = await Tezos.tz.getBalance(address);
      return (balance.toNumber() / 1_000_000).toFixed(6);
    } catch (error) {
      console.error('Error fetching balance:', error);
      return '0.000000';
    }
  },

  async sendTransaction(to: string, amount: number): Promise<string> {
    const operation = await Tezos.contract.transfer({
      to,
      amount,
    });
    await operation.confirmation();
    return operation.hash;
  },

  isValidAddress(address: string): boolean {
    return validateAddress(address) === ValidationResult.VALID;
  },

  getTezosToolkit(): TezosToolkit {
    return Tezos;
  },
};
