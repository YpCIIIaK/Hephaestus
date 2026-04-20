// Example Tool Skills - Pre-built integrations for common APIs
// These combine LLM instructions with actual API execution

import { createRapidAPIToolSkill, createWebhookToolSkill } from './tool-skill'

// Weather API via RapidAPI
export const weatherToolSkill = createRapidAPIToolSkill(
  'rapidapi-weather',
  'Weather Lookup',
  'Get current weather and forecast for any location via RapidAPI',
  {
    endpoint: '/weather',
    host: 'weatherapi-com.p.rapidapi.com',
    requiredParams: ['q'], // location query
    optionalParams: ['days', 'dt', 'hour'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// Currency Exchange Rates
export const currencyToolSkill = createRapidAPIToolSkill(
  'rapidapi-currency',
  'Currency Exchange',
  'Get real-time currency exchange rates via RapidAPI',
  {
    endpoint: '/exchange',
    host: 'currency-exchange.p.rapidapi.com',
    requiredParams: ['from', 'to'],
    optionalParams: ['q'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// Domain/IP Info (Whois/DNS lookup)
export const domainInfoToolSkill = createRapidAPIToolSkill(
  'rapidapi-domain',
  'Domain Info',
  'Get WHOIS, DNS, and domain information via RapidAPI',
  {
    endpoint: '/v1/domain',
    host: 'domainr.p.rapidapi.com',
    requiredParams: ['domain'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// URL Shortener
export const urlShortenerToolSkill = createRapidAPIToolSkill(
  'rapidapi-shorturl',
  'URL Shortener',
  'Shorten long URLs via RapidAPI',
  {
    method: 'POST',
    endpoint: '/shorten',
    host: 'url-shortener.p.rapidapi.com',
    requiredParams: ['url'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// QR Code Generator
export const qrCodeToolSkill = createRapidAPIToolSkill(
  'rapidapi-qrcode',
  'QR Code Generator',
  'Generate QR codes for URLs or text via RapidAPI',
  {
    endpoint: '/qrcode',
    host: 'qrcode-generator.p.rapidapi.com',
    requiredParams: ['text'],
    optionalParams: ['size', 'color'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// Text Translation
export const translationToolSkill = createRapidAPIToolSkill(
  'rapidapi-translate',
  'Text Translation',
  'Translate text between languages via RapidAPI',
  {
    method: 'POST',
    endpoint: '/translate',
    host: 'text-translator.p.rapidapi.com',
    requiredParams: ['text', 'source', 'target'],
    apiKeyEnvVar: 'RAPIDAPI_KEY',
  }
)

// Webhook examples
export const slackWebhookToolSkill = createWebhookToolSkill(
  'webhook-slack',
  'Slack Webhook',
  'Send messages to Slack channel via incoming webhook',
  {
    url: process.env.SLACK_WEBHOOK_URL || 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
    method: 'POST',
  }
)

export const discordWebhookToolSkill = createWebhookToolSkill(
  'webhook-discord',
  'Discord Webhook',
  'Send messages to Discord channel via webhook',
  {
    url: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/ID/TOKEN',
    method: 'POST',
  }
)

// Export all for easy registration
export const exampleToolSkills = [
  weatherToolSkill,
  currencyToolSkill,
  domainInfoToolSkill,
  urlShortenerToolSkill,
  qrCodeToolSkill,
  translationToolSkill,
  slackWebhookToolSkill,
  discordWebhookToolSkill,
]
