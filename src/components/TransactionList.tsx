import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Transaction } from '../types';

interface TransactionListProps {
  transactions: Transaction[];
  currentAddress: string;
}

function TransactionItem({ transaction, currentAddress }: { transaction: Transaction; currentAddress: string }) {
  const { t } = useTranslation();
  const isSent = transaction.sender === currentAddress;
  const displayAddress = isSent ? transaction.destination : transaction.sender;

  return (
    <View style={styles.item}>
      <View style={styles.iconContainer}>
        <Text style={[styles.icon, isSent ? styles.sentIcon : styles.receivedIcon]}>
          {isSent ? '↑' : '↓'}
        </Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.type}>{isSent ? t('wallet.sent') : t('wallet.received')}</Text>
        <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle">{displayAddress}</Text>
        <Text style={styles.date}>{transaction.timestamp.toLocaleDateString()}</Text>
      </View>
      <View style={styles.amountContainer}>
        <Text style={[styles.amount, isSent ? styles.sentAmount : styles.receivedAmount]}>
          {isSent ? '-' : '+'}{transaction.amount} XTZ
        </Text>
      </View>
    </View>
  );
}

export function TransactionList({ transactions, currentAddress }: TransactionListProps) {
  const { t } = useTranslation();

  if (transactions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('wallet.noTransactions')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={transactions}
      keyExtractor={(item) => item.hash}
      renderItem={({ item }) => <TransactionItem transaction={item} currentAddress={currentAddress} />}
      style={styles.list}
      scrollEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 8 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f5f5f5', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  icon: { fontSize: 20, fontWeight: 'bold' },
  sentIcon: { color: '#e74c3c' },
  receivedIcon: { color: '#27ae60' },
  details: { flex: 1 },
  type: { fontSize: 16, fontWeight: '600', color: '#333' },
  address: { fontSize: 12, color: '#999', marginTop: 2, maxWidth: 150 },
  date: { fontSize: 12, color: '#999', marginTop: 2 },
  amountContainer: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '600' },
  sentAmount: { color: '#e74c3c' },
  receivedAmount: { color: '#27ae60' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#999', fontSize: 16 },
});
