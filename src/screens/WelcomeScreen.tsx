import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { RootStackParamList } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Welcome'>;
};

export function WelcomeScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>{t('welcome.description')}</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title={t('welcome.createWallet')}
          onPress={() => navigation.navigate('CreateWallet')}
        />
        <View style={styles.spacer} />
        <Button
          title={t('welcome.importWallet')}
          variant="secondary"
          onPress={() => navigation.navigate('ImportWallet')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24 },
  header: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 48, fontWeight: 'bold', color: '#0D61FF' },
  subtitle: { fontSize: 18, color: '#666', marginTop: 8 },
  content: { flex: 1, justifyContent: 'center' },
  description: { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24 },
  actions: { paddingBottom: 32 },
  spacer: { height: 16 },
});
