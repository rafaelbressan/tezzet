import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import './src/i18n';
import {
  WelcomeScreen,
  CreateWalletScreen,
  ImportWalletScreen,
  WalletScreen,
  SendScreen,
  ReceiveScreen,
  SettingsScreen,
} from './src/screens';
import { StorageService } from './src/services/storage';
import { ThemeProvider, useTheme } from './src/hooks/useTheme';
import { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { t } = useTranslation();
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    const checkWallet = async () => {
      const hasWallet = await StorageService.hasWallet();
      setInitialRoute(hasWallet ? 'Wallet' : 'Welcome');
    };
    checkWallet();
  }, []);

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.headerBackground,
      text: colors.text,
      border: colors.border,
    },
  };

  if (!initialRoute) {
    return null;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBackground },
          headerTintColor: colors.headerText,
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
          options={{ title: t('createWallet.title') }}
        />
        <Stack.Screen
          name="ImportWallet"
          component={ImportWalletScreen}
          options={{ title: t('importWallet.title') }}
        />
        <Stack.Screen
          name="Wallet"
          component={WalletScreen}
          options={{ title: 'Tezzet', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Send"
          component={SendScreen}
          options={{ title: t('sendScreen.title') }}
        />
        <Stack.Screen
          name="Receive"
          component={ReceiveScreen}
          options={{ title: t('receiveScreen.title') }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: t('settings.title') }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppNavigator />
    </ThemeProvider>
  );
}
