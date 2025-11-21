# TEZZET

**TEZZET** is a fast, lightweight, secure and efficient cross-platform Tezos Wallet.

Built with React Native (Expo) and TypeScript, using the Taquito SDK for Tezos blockchain integration. Available for iOS, Android, and Web.

## Tech Stack

- **Framework**: React Native (Expo)
- **Language**: TypeScript
- **Tezos SDK**: Taquito
- **Navigation**: React Navigation
- **Storage**: Expo Secure Store

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)

### Installation

```bash
# Clone the repository
git clone https://github.com/TezosRio/tezzet.git
cd tezzet

# Install dependencies
npm install

# Start development server
npx expo start
```

### Running on devices

```bash
# iOS (requires macOS)
npx expo run:ios

# Android
npx expo run:android

# Web
npx expo start --web
```

## Features

- Create new wallet with mnemonic backup
- Import existing wallet from recovery phrase
- View XTZ balance
- Send XTZ transactions
- Receive XTZ (QR code + address sharing)
- Cross-platform (iOS, Android, Web)

## Project Structure

```
/src
  /screens      # App screens (Welcome, Wallet, Send, Receive, etc.)
  /components   # Reusable UI components
  /services     # Business logic (wallet, storage)
  /hooks        # React hooks
  /types        # TypeScript types
  /constants    # Configuration constants
/archive
  /android      # Legacy Android (Java) codebase
```

## Legacy Android Version

The original Android Java implementation is preserved in `/archive/android/`. See tag `v1.0.4-android-final` for the last Android-only release.

## Disclaimer

This software is provided as is. It is currently experimental and still under development.

## Resources

- [Issues][project-issues] — To report issues, submit pull requests and get involved
- [Taquito Documentation](https://tezostaquito.io/)
- [Expo Documentation](https://docs.expo.dev/)

## Credits

- TEZZET is a [Tezos.Rio](https://tezos.rio) team open-source product.

## License

**TEZZET** is available under the **MIT License**.

[project-issues]: https://github.com/TezosRio/TEZZET/issues
[project-license]: LICENSE.md
