import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateWallet'>;
};

export function CreateWalletScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const wallet = await WalletService.createWallet();
      setMnemonic(wallet.mnemonic);
      setAddress(wallet.address);
    } catch (error) {
      Alert.alert(t('common.error'), t('createWallet.description'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    Alert.alert(t('createWallet.backupConfirmedTitle'), t('createWallet.backupConfirmedMessage'), [
      { text: t('common.ok'), onPress: () => navigation.replace('Wallet') },
    ]);
  };

  if (!mnemonic) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('createWallet.title')}</Text>
        <Text style={styles.description}>{t('createWallet.description')}</Text>
        <View style={styles.actions}>
          <Button title={t('createWallet.generate')} onPress={handleCreate} loading={loading} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>{t('createWallet.recoveryTitle')}</Text>
      <Text style={styles.warning}>{t('createWallet.recoveryWarning')}</Text>
      <View style={styles.mnemonicContainer}>
        {mnemonic.split(' ').map((word, index) => (
          <View key={index} style={styles.wordContainer}>
            <Text style={styles.wordNumber}>{index + 1}.</Text>
            <Text style={styles.word}>{word}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.address}>{t('common.address')}: {address}</Text>
      <View style={styles.actions}>
        <Button title={t('createWallet.confirmBackup')} onPress={handleConfirm} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  description: { fontSize: 16, color: '#666', lineHeight: 24, marginBottom: 24 },
  warning: { fontSize: 14, color: '#e74c3c', lineHeight: 20, marginBottom: 24, backgroundColor: '#fef5f5', padding: 16, borderRadius: 12 },
  mnemonicContainer: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#f5f5f5', padding: 16, borderRadius: 12, marginBottom: 24 },
  wordContainer: { width: '50%', flexDirection: 'row', paddingVertical: 8 },
  wordNumber: { fontSize: 14, color: '#999', width: 28 },
  word: { fontSize: 16, color: '#333', fontWeight: '500' },
  address: { fontSize: 12, color: '#666', marginBottom: 24, fontFamily: 'monospace' },
  actions: { marginTop: 16 },
});
