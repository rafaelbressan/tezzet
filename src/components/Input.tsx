import React from 'react';
import { TextInput, StyleSheet, View, Text } from 'react-native';
import { useTheme } from '../hooks/useTheme';

interface InputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  multiline,
  secureTextEntry,
  keyboardType = 'default',
}: InputProps) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: colors.text }]}>{label}</Text>}
      <TextInput
        style={[styles.input, multiline && styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
