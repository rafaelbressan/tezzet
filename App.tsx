import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  WelcomeScreen,
  CreateWalletScreen,
  ImportWalletScreen,
  WalletScreen,
  SendScreen,
  ReceiveScreen,
} from './src/screens';
import { StorageService } from './src/services/storage';
import { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    const checkWallet = async () => {
      const hasWallet = await StorageService.hasWallet();
      setInitialRoute(hasWallet ? 'Wallet' : 'Welcome');
    };
    checkWallet();
  }, []);

  if (!initialRoute) {
    return null;
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerStyle: { backgroundColor: '#0D61FF' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      >
        <Stack.Screen
          name="Welcome"
          component={WelcomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CreateWallet"
          component={CreateWalletScreen}
          options={{ title: 'Create Wallet' }}
        />
        <Stack.Screen
          name="ImportWallet"
          component={ImportWalletScreen}
          options={{ title: 'Import Wallet' }}
        />
        <Stack.Screen
          name="Wallet"
          component={WalletScreen}
          options={{ title: 'Tezzet', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Send"
          component={SendScreen}
          options={{ title: 'Send XTZ' }}
        />
        <Stack.Screen
          name="Receive"
          component={ReceiveScreen}
          options={{ title: 'Receive XTZ' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
