import { SigningWallet } from '../../../models/signing-wallet';

export const alice = () =>
  SigningWallet.fromJson({
    // 0x11115FAf6f1BF263e81956F0Cc68aEc8426607cf
    privateKey:
      '0x95942b296854c97024ca3145abef8930bf329501b718c0f66d57dba596ff1318',
  });

export const bob = () =>
  SigningWallet.fromJson({
    // 0x2222E21c8019b14dA16235319D34b5Dd83E644A9
    privateKey:
      '0xb3ab7b031311fe1764b657a6ae7133f19bac97acd1d7edca9409daa35892e727',
  });
