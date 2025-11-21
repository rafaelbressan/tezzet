import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useTheme } from '../hooks/useTheme';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ImportWallet'>;
};

export function ImportWalletScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { colors } = theme;
  const [mnemonic, setMnemonic] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert(t('importWallet.invalidPhrase'), t('importWallet.invalidPhraseMessage'));
      return;
    }

    setLoading(true);
    try {
      await WalletService.importWallet(mnemonic);
      navigation.replace('Wallet');
    } catch (error) {
      Alert.alert(t('common.error'), t('importWallet.importError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={[styles.title, { color: colors.text }]}>{t('importWallet.title')}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{t('importWallet.description')}</Text>
      <Input
        label={t('importWallet.label')}
        value={mnemonic}
        onChangeText={setMnemonic}
        placeholder={t('importWallet.placeholder')}
        multiline
      />
      <View style={styles.actions}>
        <Button title={t('importWallet.import')} onPress={handleImport} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  description: { fontSize: 16, lineHeight: 24, marginBottom: 24 },
  actions: { marginTop: 24 },
});
