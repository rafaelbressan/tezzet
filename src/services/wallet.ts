import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { validateAddress, ValidationResult } from '@taquito/utils';
import * as bip39 from 'bip39';
import { TEZOS_RPC, DEFAULT_NETWORK, TZKT_API } from '../constants/config';
import { StorageService } from './storage';
import { Transaction } from '../types';

const Tezos = new TezosToolkit(TEZOS_RPC[DEFAULT_NETWORK]);

export const WalletService = {
  async createWallet(): Promise<{ address: string; mnemonic: string }> {
    const mnemonic = bip39.generateMnemonic(256); // 24 words
    const signer = InMemorySigner.fromMnemonic({ mnemonic });
    const address = await signer.publicKeyHash();

    await StorageService.saveMnemonic(mnemonic);
    await StorageService.saveWalletAddress(address);

    Tezos.setProvider({ signer });

    return { address, mnemonic };
  },

  async importWallet(mnemonic: string): Promise<string> {
    const normalized = mnemonic.trim().toLowerCase();

    if (!bip39.validateMnemonic(normalized)) {
      throw new Error('Invalid mnemonic phrase');
    }

    const signer = InMemorySigner.fromMnemonic({ mnemonic: normalized });
    const address = await signer.publicKeyHash();

    await StorageService.saveMnemonic(normalized);
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

  async getTransactionHistory(address: string, limit = 20): Promise<Transaction[]> {
    try {
      const response = await fetch(
        `${TZKT_API}/accounts/${address}/operations?type=transaction&limit=${limit}`
      );
      const data = await response.json();

      return data.map((op: any) => ({
        hash: op.hash,
        amount: (op.amount / 1_000_000).toFixed(6),
        destination: op.target?.address || op.sender?.address,
        sender: op.sender?.address,
        timestamp: new Date(op.timestamp),
        status: op.status === 'applied' ? 'confirmed' : 'failed',
        type: op.sender?.address === address ? 'sent' : 'received',
      }));
    } catch (error) {
      console.error('Error fetching transaction history:', error);
      return [];
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

  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
  },

  getTezosToolkit(): TezosToolkit {
    return Tezos;
  },
};
