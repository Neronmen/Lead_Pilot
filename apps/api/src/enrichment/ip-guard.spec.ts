import { isPublicAddress } from './ip-guard';

describe('isPublicAddress (SSRF guard)', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.5.5',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4 loopback in disguise
    '::ffff:7f00:1', // the same, hex form
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64 to 127.0.0.1
    '2002:7f00:1::', // 6to4 of 127.0.0.1
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    'localhost',
    'example.com',
    '',
    '999.1.1.1',
    '1.2.3',
    '0x7f.0.0.1',
    '2130706433', // 127.0.0.1 as one number
    'http://127.0.0.1',
  ])('refuses %j: not an IP address at all', (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255', // just outside 172.16/12
    '172.32.0.1',
    '100.63.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:81b::200e',
    '::ffff:8.8.8.8',
  ])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
