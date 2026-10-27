import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Global: any module may encrypt a secret without importing this one. */
@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
