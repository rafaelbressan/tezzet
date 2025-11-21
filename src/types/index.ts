export interface Wallet {
  address: string;
  publicKey: string;
  mnemonic?: string;
}

export interface Transaction {
  hash: string;
  amount: string;
  destination: string;
  sender?: string;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
  type: 'sent' | 'received';
}

export type RootStackParamList = {
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  Wallet: undefined;
  Send: { address?: string };
  Receive: undefined;
  Settings: undefined;
  Scanner: { onScan: (address: string) => void };
};
