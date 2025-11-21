import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../constants/config';

export const StorageService = {
  async saveMnemonic(mnemonic: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.MNEMONIC, mnemonic);
  },

  async getMnemonic(): Promise<string | null> {
    return SecureStore.getItemAsync(STORAGE_KEYS.MNEMONIC);
  },

  async saveWalletAddress(address: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.WALLET_ADDRESS, address);
  },

  async getWalletAddress(): Promise<string | null> {
    return SecureStore.getItemAsync(STORAGE_KEYS.WALLET_ADDRESS);
  },

  async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.MNEMONIC);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.WALLET_ADDRESS);
  },

  async hasWallet(): Promise<boolean> {
    const mnemonic = await this.getMnemonic();
    return mnemonic !== null;
  },
};
