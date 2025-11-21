import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ImportWallet'>;
};

export function ImportWalletScreen({ navigation }: Props) {
  const [mnemonic, setMnemonic] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert('Invalid Phrase', 'Please enter a valid 12 or 24 word recovery phrase.');
      return;
    }

    setLoading(true);
    try {
      await WalletService.importWallet(mnemonic);
      navigation.replace('Wallet');
    } catch (error) {
      Alert.alert('Error', 'Failed to import wallet. Please check your recovery phrase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Import Wallet</Text>
      <Text style={styles.description}>
        Enter your 12 or 24 word recovery phrase to restore your wallet.
      </Text>

      <Input
        label="Recovery Phrase"
        value={mnemonic}
        onChangeText={setMnemonic}
        placeholder="Enter your recovery phrase..."
        multiline
      />

      <View style={styles.actions}>
        <Button title="Import Wallet" onPress={handleImport} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 24,
  },
  actions: {
    marginTop: 24,
  },
});
