import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Welcome'>;
};

export function WelcomeScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tezzet</Text>
        <Text style={styles.subtitle}>Tezos Wallet</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>
          A fast, lightweight, and secure wallet for the Tezos blockchain.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          title="Create New Wallet"
          onPress={() => navigation.navigate('CreateWallet')}
        />
        <View style={styles.spacer} />
        <Button
          title="Import Existing Wallet"
          variant="secondary"
          onPress={() => navigation.navigate('ImportWallet')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#0D61FF',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginTop: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  actions: {
    paddingBottom: 32,
  },
  spacer: {
    height: 16,
  },
});
