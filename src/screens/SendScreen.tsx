import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, Modal, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { QRScanner } from '../components/QRScanner';
import { useTheme } from '../hooks/useTheme';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Send'>;
  route: RouteProp<RootStackParamList, 'Send'>;
};

export function SendScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { colors } = theme;
  const [recipient, setRecipient] = useState(route.params?.address || '');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const handleScan = (address: string) => {
    setShowScanner(false);
    if (WalletService.isValidAddress(address)) {
      setRecipient(address);
    } else {
      Alert.alert(t('sendScreen.invalidQR'), t('sendScreen.invalidQRMessage'));
    }
  };

  const handleSend = async () => {
    if (!WalletService.isValidAddress(recipient)) {
      Alert.alert(t('sendScreen.invalidAddress'), t('sendScreen.invalidAddressMessage'));
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert(t('sendScreen.invalidAmount'), t('sendScreen.invalidAmountMessage'));
      return;
    }

    Alert.alert(
      t('sendScreen.confirmTitle'),
      t('sendScreen.confirmMessage', { amount, address: recipient.substring(0, 10) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            setLoading(true);
            try {
              const hash = await WalletService.sendTransaction(recipient, numAmount);
              Alert.alert(t('common.success'), t('sendScreen.successMessage', { hash: hash.substring(0, 20) }), [
                { text: t('common.ok'), onPress: () => navigation.goBack() },
              ]);
            } catch (error: any) {
              Alert.alert(t('common.error'), error?.message || t('sendScreen.errorMessage'));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={[styles.title, { color: colors.text }]}>{t('sendScreen.title')}</Text>
      <View style={styles.inputRow}>
        <View style={styles.inputContainer}>
          <Input label={t('sendScreen.recipientLabel')} value={recipient} onChangeText={setRecipient} placeholder={t('sendScreen.recipientPlaceholder')} />
        </View>
        <TouchableOpacity style={[styles.scanButton, { backgroundColor: colors.primary }]} onPress={() => setShowScanner(true)}>
          <Text style={styles.scanButtonText}>{t('common.scan')}</Text>
        </TouchableOpacity>
      </View>
      <Input label={t('sendScreen.amountLabel')} value={amount} onChangeText={setAmount} placeholder={t('sendScreen.amountPlaceholder')} keyboardType="decimal-pad" />
      <View style={styles.actions}>
        <Button title={t('common.send')} onPress={handleSend} loading={loading} />
      </View>
      <Modal visible={showScanner} animationType="slide">
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  inputContainer: { flex: 1 },
  scanButton: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, marginLeft: 8, marginBottom: 16 },
  scanButtonText: { color: '#fff', fontWeight: '600' },
  actions: { marginTop: 24 },
});
