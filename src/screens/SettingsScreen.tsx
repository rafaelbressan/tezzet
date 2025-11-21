import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { ThemeMode } from '../constants/theme';

export function SettingsScreen() {
  const { t } = useTranslation();
  const { theme, themeMode, setThemeMode } = useTheme();
  const { colors } = theme;

  const options: { mode: ThemeMode; label: string }[] = [
    { mode: 'system', label: t('settings.system') },
    { mode: 'light', label: t('settings.light') },
    { mode: 'dark', label: t('settings.dark') },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('settings.appearance')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {options.map((option, index) => (
          <TouchableOpacity
            key={option.mode}
            style={[
              styles.option,
              index < options.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
            ]}
            onPress={() => setThemeMode(option.mode)}
          >
            <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
            {themeMode === option.mode && (
              <Text style={[styles.checkmark, { color: colors.primary }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase' },
  card: { borderRadius: 12, overflow: 'hidden' },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  optionText: { fontSize: 16 },
  checkmark: { fontSize: 18, fontWeight: '600' },
});
