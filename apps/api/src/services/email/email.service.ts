import { Resend } from "resend";
import { createLogger } from "@tails/logger";
import { emailTemplates, type EmailTemplateType } from "./templates";

const log = createLogger("email");

class EmailService {
  private resend: Resend;
  private from: string;
  private isProduction: boolean;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.isProduction = process.env.NODE_ENV === "production";
    this.from = process.env.EMAIL_FROM || "Tails <noreply@tail.tools>";

    if (!apiKey) {
      if (this.isProduction) {
        throw new Error("RESEND_API_KEY is required in production");
      }
      log.warn("RESEND_API_KEY not set - using mock mode");
    }

    this.resend = new Resend(apiKey || "re_mock_key");
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    // In development without API key, log instead of sending
    if (!process.env.RESEND_API_KEY && !this.isProduction) {
      log.info("Email sent (mock)", { to, subject });
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });

    if (error) {
      log.error("Failed to send email", new Error(error.message), { to, subject });
      throw new Error("Failed to send email");
    }

    log.info("Email sent", { to, subject });
  }

  async sendOTP(email: string, otp: string, type: EmailTemplateType): Promise<void> {
    const template = emailTemplates.otp({ otp, type });

    // In dev mode, log the OTP for testing (but redact in logs)
    if (!this.isProduction) {
      log.debug("OTP generated", { email, type, otp });
    }

    await this.sendEmail(email, template.subject, template.html);
  }

  async sendWelcome(email: string, name: string): Promise<void> {
    const template = emailTemplates.welcome(name);

    try {
      await this.sendEmail(email, template.subject, template.html);
    } catch (error) {
      // Welcome emails are not critical - log and continue
      log.warn("Failed to send welcome email", { email });
    }
  }

  async send(options: { to: string; subject: string; html: string }): Promise<void> {
    await this.sendEmail(options.to, options.subject, options.html);
  }
}

export const emailService = new EmailService();
