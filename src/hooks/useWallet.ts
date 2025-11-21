import { useState, useEffect, useCallback } from 'react';
import { WalletService } from '../services/wallet';
import { StorageService } from '../services/storage';

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0.000000');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const walletAddress = await WalletService.loadWallet();
      setAddress(walletAddress);
      if (walletAddress) {
        const bal = await WalletService.getBalance(walletAddress);
        setBalance(bal);
      }
    } catch (error) {
      console.error('Error loading wallet:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const bal = await WalletService.getBalance(address);
      setBalance(bal);
    } catch (error) {
      console.error('Error refreshing balance:', error);
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  return {
    address,
    balance,
    loading,
    refreshing,
    refreshBalance,
    loadWallet,
  };
}
