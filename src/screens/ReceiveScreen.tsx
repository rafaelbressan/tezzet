import React from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useWallet } from '../hooks/useWallet';

export function ReceiveScreen() {
  const { t } = useTranslation();
  const { address } = useWallet();

  const handleCopy = async () => {
    if (address) {
      await Clipboard.setStringAsync(address);
      Alert.alert(t('receiveScreen.copied'), t('receiveScreen.copiedMessage'));
    }
  };

  const handleShare = async () => {
    if (address) {
      await Share.share({ message: address, title: t('receiveScreen.yourAddress') });
    }
  };

  if (!address) {
    return (
      <View style={styles.container}>
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('receiveScreen.title')}</Text>
      <Text style={styles.description}>{t('receiveScreen.description')}</Text>
      <View style={styles.qrContainer}>
        <QRCode value={address} size={200} />
      </View>
      <View style={styles.addressContainer}>
        <Text style={styles.addressLabel}>{t('receiveScreen.yourAddress')}</Text>
        <Text style={styles.address} selectable>{address}</Text>
      </View>
      <View style={styles.actions}>
        <Button title={t('receiveScreen.copyAddress')} onPress={handleCopy} />
        <View style={styles.spacer} />
        <Button title={t('common.share')} variant="secondary" onPress={handleShare} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  description: { fontSize: 16, color: '#666', marginBottom: 32 },
  qrContainer: { alignItems: 'center', backgroundColor: '#fff', padding: 24, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4, marginBottom: 24 },
  addressContainer: { backgroundColor: '#f5f5f5', padding: 16, borderRadius: 12, marginBottom: 24 },
  addressLabel: { fontSize: 12, color: '#999', marginBottom: 8 },
  address: { fontSize: 14, color: '#333', fontFamily: 'monospace' },
  actions: {},
  spacer: { height: 12 },
});
