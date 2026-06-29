// Email executor — real SMTP via nodemailer (Gmail, Outlook, corporate relay).

import type { SendMailOptions } from 'nodemailer';
import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';
import {
  buildSmtpTransporter,
  integrationHasSmtpCredentials,
  parseSmtpConfig,
  resolveSmtpFrom,
} from './smtp-config';

function findEmailIntegration(ctx: ExecutionContext) {
  const keys = ['email', 'smtp', 'email_smtp', 'mail'];
  for (const k of keys) {
    const i = ctx.getIntegration(k);
    if (i) return i;
  }
  return null;
}

export async function executeEmail(
  node: WFNode,
  ctx: ExecutionContext,
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const start = Date.now();
  const logs: NodeExecutorResult['logs'] = [];

  const integration = findEmailIntegration(ctx);
  const smtpCfg = (integration?.config || {}) as Record<string, unknown>;
  const smtpParsed = parseSmtpConfig(smtpCfg);

  let to = resolveTemplate(String(cfg.to || ''), ctx).trim();
  // Unresolved templates (e.g. empty {{trigger.to}}) → treat as missing
  if (!to || (to.includes('{{') && to.includes('}}'))) {
    to = '';
  }
  // Trigger aliases used in workflows / builder
  if (!to) {
    const trig = ctx.trigger as Record<string, unknown>;
    for (const key of ['to', 'email', 'recipient', 'default_to']) {
      const v = trig[key];
      if (v != null && String(v).trim()) {
        to = String(v).trim();
        break;
      }
    }
  }
  if (!to && smtpParsed?.defaultTo) {
    to = smtpParsed.defaultTo;
  }

  const cc = resolveTemplate(String(cfg.cc || ''), ctx);
  const bcc = resolveTemplate(String(cfg.bcc || ''), ctx);
  const subject = resolveTemplate(String(cfg.subject || 'SOAR Notification'), ctx);
  const body = resolveTemplate(String(cfg.body || cfg.message || ''), ctx);
  const isHtml = cfg.html === true || cfg.format === 'html';

  if (!to) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: 'Email: recipient required — set node "To" or integration default_to / test_to',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  if (!integration) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: 'Email failed: add an Email (SMTP) integration on the Integrations page',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  if (integration.status !== 'connected') {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: 'Email failed: SMTP integration not connected — use Save & Test on Integrations',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  if (!integrationHasSmtpCredentials(smtpCfg)) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: 'Email failed: SMTP host/service + username + password required in integration',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  const from = resolveTemplate(String(cfg.from || ''), ctx) || resolveSmtpFrom(smtpCfg);

  try {
    const transporter = buildSmtpTransporter(smtpCfg);
    if (!transporter) {
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id, nodeLabel: node.data.label,
        message: 'Email failed: could not build SMTP transporter',
        level: 'error', duration: Date.now() - start,
      });
      return { success: false, logs };
    }

    const mailOptions: SendMailOptions = {
      from,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      ...(isHtml ? { html: body || subject } : { text: body || subject }),
    };

    const info = await transporter.sendMail(mailOptions);
    const via = smtpParsed?.service || smtpParsed?.host || 'smtp';
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: `Email sent via ${via}: to=${to}, subject="${subject}" (messageId=${info.messageId})`,
      level: 'success', duration: Date.now() - start,
      data: { to, cc, subject, from, messageId: info.messageId, response: info.response },
    });
    return {
      success: true,
      output: {
        email: {
          ok: true, sent: true, to, cc, subject, from,
          messageId: info.messageId, response: info.response,
        },
      },
      logs,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id, nodeLabel: node.data.label,
      message: `Email send failed: ${msg}`,
      level: 'error', duration: Date.now() - start,
      data: { to, subject, error: msg },
    });
    return { success: false, logs };
  }
}

export async function sendTestEmail(
  integration: { config: Record<string, unknown>; name: string },
  to: string,
): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const cfg = integration.config || {};
  if (!integrationHasSmtpCredentials(cfg)) {
    return { ok: false, message: 'SMTP host (or service) + username + password are required' };
  }
  const transporter = buildSmtpTransporter(cfg);
  if (!transporter) {
    return { ok: false, message: 'Could not build SMTP transporter — check host/port/service' };
  }
  try {
    await transporter.verify();
  } catch (err: unknown) {
    return {
      ok: false,
      message: `SMTP verify failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const from = resolveSmtpFrom(cfg);
    const info = await transporter.sendMail({
      from,
      to,
      subject: `[SOAR] Test email from ${integration.name}`,
      text: `This is a real test email from LumiSec SOAR at ${new Date().toISOString()}.\n\nIntegration: ${integration.name}\n\nIf you received this, SMTP is configured correctly.`,
    });
    return {
      ok: true,
      message: `Real email sent to ${to} (messageId=${info.messageId})`,
      data: { messageId: info.messageId, response: info.response, from },
    };
  } catch (err: unknown) {
    return { ok: false, message: `Email send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
