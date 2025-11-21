import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { TransactionList } from '../components/TransactionList';
import { useWallet } from '../hooks/useWallet';
import { WalletService } from '../services/wallet';
import { RootStackParamList, Transaction } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Wallet'>;
};

export function WalletScreen({ navigation }: Props) {
  const { address, balance, loading, refreshing, refreshBalance } = useWallet();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  const loadTransactions = async () => {
    if (!address) return;
    setLoadingTx(true);
    try {
      const txs = await WalletService.getTransactionHistory(address);
      setTransactions(txs);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoadingTx(false);
    }
  };

  useEffect(() => {
    if (address) {
      loadTransactions();
    }
  }, [address]);

  const handleRefresh = async () => {
    await Promise.all([refreshBalance(), loadTransactions()]);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading wallet...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing || loadingTx} onRefresh={handleRefresh} />
      }
    >
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Balance</Text>
        <Text style={styles.balanceValue}>{balance} XTZ</Text>
        <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle">
          {address}
        </Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <View style={styles.actionButton}>
            <Button title="Send" onPress={() => navigation.navigate('Send', {})} />
          </View>
          <View style={styles.actionSpacer} />
          <View style={styles.actionButton}>
            <Button
              title="Receive"
              variant="secondary"
              onPress={() => navigation.navigate('Receive')}
            />
          </View>
        </View>
      </View>

      <View style={styles.transactionsSection}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        <TransactionList transactions={transactions} currentAddress={address || ''} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  balanceCard: {
    backgroundColor: '#0D61FF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  balanceValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  address: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'monospace',
    maxWidth: '100%',
  },
  actions: {
    marginBottom: 24,
  },
  actionRow: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
  },
  actionSpacer: {
    width: 16,
  },
  transactionsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
});
