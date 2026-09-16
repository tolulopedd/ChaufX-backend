import { env } from "../config/env.js";

type TransactionalEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactionalEmail(message: TransactionalEmail) {
  if (!env.RESEND_API_KEY) {
    throw new Error("Transactional email is not configured. Set RESEND_API_KEY before sending email.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email delivery failed: ${errorText}`);
  }

  return {
    delivered: true as const
  };
}
