export type EmailTemplateType = "sign-in" | "email-verification" | "forget-password";

interface OTPEmailParams {
  otp: string;
  type: EmailTemplateType;
}

const getSubject = (type: EmailTemplateType): string => {
  const subjects: Record<EmailTemplateType, string> = {
    "sign-in": "Sign in to Tails",
    "email-verification": "Verify your email",
    "forget-password": "Reset your password",
  };
  return subjects[type];
};

const getMessage = (type: EmailTemplateType): string => {
  const messages: Record<EmailTemplateType, string> = {
    "sign-in": "Enter this code to sign in to your account:",
    "email-verification": "Enter this code to verify your email:",
    "forget-password": "Enter this code to reset your password:",
  };
  return messages[type];
};

export const emailTemplates = {
  otp: ({ otp, type }: OTPEmailParams) => ({
    subject: getSubject(type),
    html: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; padding: 40px 20px; margin: 0;">
    <div style="max-width: 400px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 8px 0; color: #111;">Tails</h1>
      <p style="color: #666; margin: 0 0 32px 0; font-size: 14px;">Internet Swiss Army Knife</p>
      
      <p style="color: #333; font-size: 15px; margin: 0 0 24px 0;">
        ${getMessage(type)}
      </p>
      
      <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px 0;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111;">${otp}</span>
      </div>
      
      <p style="color: #666; font-size: 13px; margin: 0 0 8px 0;">
        This code expires in 10 minutes.
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">
      &copy; ${new Date().getFullYear()} Tails. All rights reserved.
    </p>
  </body>
</html>
    `.trim(),
  }),

  welcome: (name: string) => ({
    subject: "Welcome to Tails!",
    html: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; padding: 40px 20px; margin: 0;">
    <div style="max-width: 400px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 8px 0; color: #111;">Tails</h1>
      <p style="color: #666; margin: 0 0 32px 0; font-size: 14px;">Internet Swiss Army Knife</p>
      
      <p style="color: #333; font-size: 15px; margin: 0 0 16px 0;">
        Hey ${name || "there"}!
      </p>
      
      <p style="color: #333; font-size: 15px; margin: 0 0 24px 0;">
        Welcome to Tails! You now have access to 12+ developer tools through a single API.
      </p>
      
      <div style="margin: 0 0 24px 0;">
        <a href="https://tail.tools/tools" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px;">
          Explore Tools
        </a>
      </div>
      
      <p style="color: #666; font-size: 13px; margin: 0;">
        Need help? Reply to this email or reach out at hi@tail.tools
      </p>
    </div>
    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">
      &copy; ${new Date().getFullYear()} Tails. All rights reserved.
    </p>
  </body>
</html>
    `.trim(),
  }),
};


