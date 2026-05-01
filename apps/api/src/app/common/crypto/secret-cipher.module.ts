import { Global, Module } from '@nestjs/common';

import { SecretCipher } from './secret-cipher';

@Global()
@Module({
  providers: [SecretCipher],
  exports: [SecretCipher],
})
export class SecretCipherModule {}
