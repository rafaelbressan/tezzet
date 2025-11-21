import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateWallet'>;
};

export function CreateWalletScreen({ navigation }: Props) {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const wallet = await WalletService.createWallet();
      setMnemonic(wallet.mnemonic);
      setAddress(wallet.address);
    } catch (error) {
      Alert.alert('Error', 'Failed to create wallet. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    Alert.alert(
      'Backup Confirmed',
      'Make sure you have saved your recovery phrase in a secure location. You will need it to recover your wallet.',
      [
        {
          text: 'I have saved it',
          onPress: () => navigation.replace('Wallet'),
        },
      ]
    );
  };

  if (!mnemonic) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Create New Wallet</Text>
        <Text style={styles.description}>
          We will generate a new wallet with a 24-word recovery phrase. Make sure to write it down and store it securely.
        </Text>
        <View style={styles.actions}>
          <Button title="Generate Wallet" onPress={handleCreate} loading={loading} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>Your Recovery Phrase</Text>
      <Text style={styles.warning}>
        Write down these 24 words in order and store them in a secure location. Never share them with anyone.
      </Text>

      <View style={styles.mnemonicContainer}>
        {mnemonic.split(' ').map((word, index) => (
          <View key={index} style={styles.wordContainer}>
            <Text style={styles.wordNumber}>{index + 1}.</Text>
            <Text style={styles.word}>{word}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.address}>Address: {address}</Text>

      <View style={styles.actions}>
        <Button title="I Have Saved My Recovery Phrase" onPress={handleConfirm} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
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
  warning: {
    fontSize: 14,
    color: '#e74c3c',
    lineHeight: 20,
    marginBottom: 24,
    backgroundColor: '#fef5f5',
    padding: 16,
    borderRadius: 12,
  },
  mnemonicContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  wordContainer: {
    width: '50%',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  wordNumber: {
    fontSize: 14,
    color: '#999',
    width: 28,
  },
  word: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  address: {
    fontSize: 12,
    color: '#666',
    marginBottom: 24,
    fontFamily: 'monospace',
  },
  actions: {
    marginTop: 16,
  },
});
