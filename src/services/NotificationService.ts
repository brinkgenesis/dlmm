import * as nodemailer from 'nodemailer';
import { Config } from '../models/Config';

export class NotificationService {
  private transporter: nodemailer.Transporter;
  private recipients: string[];

  constructor(config: Config) {
    this.recipients = config.emailSettings.recipients;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.emailSettings.username,
        pass: config.emailSettings.password
      }
    });
  }

  async sendStatusUpdate(subject: string, message: string) {
    const mailOptions = {
      from: 'bot@meteora-dlmm.com',
      to: this.recipients,
      subject: subject,
      text: message
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendErrorAlert(error: Error) {
    await this.sendStatusUpdate('Meteora Bot Error Alert', error.message);
  }
}
