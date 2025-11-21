describe('Address Utils', () => {
  const truncateAddress = (address: string, start = 8, end = 4): string => {
    if (address.length <= start + end) return address;
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  };

  it('should truncate long addresses', () => {
    const address = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
    expect(truncateAddress(address)).toBe('tz1VSUr8...jcjb');
  });

  it('should not truncate short strings', () => {
    const short = 'tz1abc';
    expect(truncateAddress(short)).toBe('tz1abc');
  });
});

describe('Amount Validation', () => {
  const isValidAmount = (amount: string): boolean => {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
  };

  it('should validate positive numbers', () => {
    expect(isValidAmount('1.5')).toBe(true);
    expect(isValidAmount('0.001')).toBe(true);
    expect(isValidAmount('100')).toBe(true);
  });

  it('should reject invalid amounts', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-1')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('')).toBe(false);
  });
});

describe('QR Code Parsing', () => {
  const parseQRCode = (data: string): string => {
    if (data.startsWith('tezos:')) {
      return data.replace('tezos:', '').split('?')[0];
    }
    return data;
  };

  it('should extract address from tezos: URI', () => {
    const uri = 'tezos:tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
    expect(parseQRCode(uri)).toBe('tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb');
  });

  it('should handle URI with query params', () => {
    const uri = 'tezos:tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb?amount=10';
    expect(parseQRCode(uri)).toBe('tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb');
  });

  it('should return plain address as-is', () => {
    const address = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
    expect(parseQRCode(address)).toBe(address);
  });
});
