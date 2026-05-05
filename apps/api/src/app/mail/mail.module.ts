import { Module } from '@nestjs/common';

import { MailService } from './mail.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  providers: [MailService, ReceiptPdfService],
  exports: [MailService, ReceiptPdfService],
})
export class MailModule {}
