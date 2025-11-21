import React from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useWallet } from '../hooks/useWallet';
import { useTheme } from '../hooks/useTheme';

export function ReceiveScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { colors } = theme;
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
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{t('receiveScreen.title')}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{t('receiveScreen.description')}</Text>
      <View style={[styles.qrContainer, { backgroundColor: colors.card }]}>
        <QRCode value={address} size={200} />
      </View>
      <View style={[styles.addressContainer, { backgroundColor: colors.inputBackground }]}>
        <Text style={[styles.addressLabel, { color: colors.textMuted }]}>{t('receiveScreen.yourAddress')}</Text>
        <Text style={[styles.address, { color: colors.text }]} selectable>{address}</Text>
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
  container: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  description: { fontSize: 16, marginBottom: 32 },
  qrContainer: { alignItems: 'center', padding: 24, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4, marginBottom: 24 },
  addressContainer: { padding: 16, borderRadius: 12, marginBottom: 24 },
  addressLabel: { fontSize: 12, marginBottom: 8 },
  address: { fontSize: 14, fontFamily: 'monospace' },
  actions: {},
  spacer: { height: 12 },
});
