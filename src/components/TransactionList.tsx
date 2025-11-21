import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Transaction } from '../types';

interface TransactionListProps {
  transactions: Transaction[];
  currentAddress: string;
}

function TransactionItem({ transaction, currentAddress }: { transaction: Transaction; currentAddress: string }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { colors } = theme;
  const isSent = transaction.sender === currentAddress;
  const displayAddress = isSent ? transaction.destination : transaction.sender;

  return (
    <View style={[styles.item, { backgroundColor: colors.card }]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.inputBackground }]}>
        <Text style={[styles.icon, isSent ? { color: colors.error } : { color: colors.success }]}>
          {isSent ? '↑' : '↓'}
        </Text>
      </View>
      <View style={styles.details}>
        <Text style={[styles.type, { color: colors.text }]}>{isSent ? t('wallet.sent') : t('wallet.received')}</Text>
        <Text style={[styles.address, { color: colors.textMuted }]} numberOfLines={1} ellipsizeMode="middle">{displayAddress}</Text>
        <Text style={[styles.date, { color: colors.textMuted }]}>{transaction.timestamp.toLocaleDateString()}</Text>
      </View>
      <View style={styles.amountContainer}>
        <Text style={[styles.amount, isSent ? { color: colors.error } : { color: colors.success }]}>
          {isSent ? '-' : '+'}{transaction.amount} XTZ
        </Text>
      </View>
    </View>
  );
}

export function TransactionList({ transactions, currentAddress }: TransactionListProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { colors } = theme;

  if (transactions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('wallet.noTransactions')}</Text>
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
  item: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, marginBottom: 8 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  icon: { fontSize: 20, fontWeight: 'bold' },
  details: { flex: 1 },
  type: { fontSize: 16, fontWeight: '600' },
  address: { fontSize: 12, marginTop: 2, maxWidth: 150 },
  date: { fontSize: 12, marginTop: 2 },
  amountContainer: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 16 },
});
