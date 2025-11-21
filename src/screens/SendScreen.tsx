import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, Modal, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { QRScanner } from '../components/QRScanner';
import { WalletService } from '../services/wallet';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Send'>;
  route: RouteProp<RootStackParamList, 'Send'>;
};

export function SendScreen({ navigation, route }: Props) {
  const [recipient, setRecipient] = useState(route.params?.address || '');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const handleScan = (address: string) => {
    setShowScanner(false);
    if (WalletService.isValidAddress(address)) {
      setRecipient(address);
    } else {
      Alert.alert('Invalid QR Code', 'The scanned QR code does not contain a valid Tezos address.');
    }
  };

  const handleSend = async () => {
    if (!WalletService.isValidAddress(recipient)) {
      Alert.alert('Invalid Address', 'Please enter a valid Tezos address.');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    Alert.alert(
      'Confirm Transaction',
      `Send ${amount} XTZ to ${recipient.substring(0, 10)}...?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setLoading(true);
            try {
              const hash = await WalletService.sendTransaction(recipient, numAmount);
              Alert.alert('Success', `Transaction sent!\nHash: ${hash.substring(0, 20)}...`, [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to send transaction.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Send XTZ</Text>

      <View style={styles.inputRow}>
        <View style={styles.inputContainer}>
          <Input
            label="Recipient Address"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="tz1..."
          />
        </View>
        <TouchableOpacity style={styles.scanButton} onPress={() => setShowScanner(true)}>
          <Text style={styles.scanButtonText}>Scan</Text>
        </TouchableOpacity>
      </View>

      <Input
        label="Amount (XTZ)"
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <View style={styles.actions}>
        <Button title="Send" onPress={handleSend} loading={loading} />
      </View>

      <Modal visible={showScanner} animationType="slide">
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      </Modal>
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
    marginBottom: 24,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputContainer: {
    flex: 1,
  },
  scanButton: {
    backgroundColor: '#0D61FF',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginLeft: 8,
    marginBottom: 16,
  },
  scanButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  actions: {
    marginTop: 24,
  },
});
