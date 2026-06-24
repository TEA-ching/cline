/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'

interface WeatherToolContext {
  weatherApiKeys?: Array<{ key: string; sharedSecret?: string; signatureType?: string }>
  weatherApiEndpoint?: string
}

let callCount = 0

async function hmacSHA256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function createSearchLocationTool(ctx?: WeatherToolContext): AgentTool<any, any> {
  return createTool({
    name: 'search_location',
    description:
      'Search for a location by name using the Meteoblue Location Search API. ' +
      'Returns up to 5 matching places with their coordinates (lat/lon), timezone, country, and admin region. ' +
      'Use this tool BEFORE get_weather_forecast whenever the user provides a city name instead of coordinates.',
    inputSchema: z.object({
      query: z.string().describe('City or location name to search for (e.g. "Lyon", "New York", "Paris FR")'),
      countryCode: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code to narrow results (e.g. "FR", "DE")'),
      limit: z.number().int().min(1).max(10).optional().default(5).describe('Maximum number of results to return'),
    }),
    execute: async ({ query, countryCode, limit }) => {
      const keys = ctx?.weatherApiKeys ?? []
      if (keys.length === 0) {
        throw new Error('No meteoblue API key configured. Add a weatherApi key in the vault.')
      }
      const apiKey = keys[callCount % keys.length].key
      const params = new URLSearchParams({
        query,
        apikey: apiKey,
        limit: String(limit ?? 5),
        format: 'json',
      })
      if (countryCode) params.set('countryCode', countryCode)

      const url = `https://www.meteoblue.com/en/server/search/query3?${params.toString()}`
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Meteoblue location search error (${response.status}): ${errText}`)
      }
      const data = await response.json()
      // biome-ignore lint/suspicious/noExplicitAny: API shape varies
      const results: any[] = data.results ?? []
      if (results.length === 0) return { message: 'No location found for the given query.', results: [] }
      return {
        results: results.map((r: any) => ({
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          countryCode: r.countryCode,
          country: r.country,
          adminName: r.adminName,
          timezone: r.timezone,
          population: r.population,
        })),
      }
    },
  })
}

export function createWeatherForecastTool(ctx?: WeatherToolContext): AgentTool<any, any> {
  return createTool({
    name: 'get_weather_forecast',
    description: [
      'Get weather forecast for a location using the Meteoblue Packages API.',
      'IMPORTANT: requires decimal coordinates (lat/lon). Use search_location first if you only have a city name.',
      'Supports combining packages for a single API call (e.g. "basic-1h,current" counts as one request).',
      'Returns structured JSON with metadata, units, and time-series forecast data.',
    ].join(' '),
    inputSchema: z.object({
      lat: z.number().min(-90).max(90).describe('Latitude in decimal degrees (WGS 84)'),
      lon: z.number().min(-180).max(180).describe('Longitude in decimal degrees (WGS 84)'),
      packages: z.string().default('basic-1h').describe(
        'Comma-separated package names (e.g. "basic-1h", "basic-1h,current", "basic-day,clouds-day"). ' +
        'Combining packages counts as a single API request.',
      ),
      forecastDays: z.number().int().min(0).optional().describe('Number of forecast days (0 = all available)'),
      historyDays: z.number().int().min(0).max(4).optional().describe('Number of past days to include (max 4)'),
      timezone: z.string().optional().describe('IANA timezone (e.g. "Europe/Paris", "UTC"). Auto-detected if omitted.'),
      temperatureUnit: z.enum(['C', 'K', 'F']).default('C').describe('Temperature unit'),
      windSpeedUnit: z.enum(['m/s', 'km/h', 'mph', 'kn', 'bft']).default('km/h').describe('Wind speed unit'),
      precipitationUnit: z.enum(['metric', 'imperial']).default('metric').describe('Precipitation unit'),
    }),
    execute: async (input) => {
      const keys = ctx?.weatherApiKeys ?? []
      if (keys.length === 0) {
        throw new Error('No meteoblue API key configured. Add a weatherApi key in the vault.')
      }
      const keyEntry = keys[callCount++ % keys.length]
      const baseHost = ctx?.weatherApiEndpoint?.replace(/\/$/, '') ?? 'https://my.meteoblue.com'

      const expire = Math.floor(Date.now() / 1000) + 3600
      const params = new URLSearchParams({
        lat: input.lat.toString(),
        lon: input.lon.toString(),
        apikey: keyEntry.key,
        expire: String(expire),
        format: 'json',
        temperatureUnit: input.temperatureUnit,
        windspeedUnit: input.windSpeedUnit,
        precipitationUnit: input.precipitationUnit,
      })
      if (input.forecastDays !== undefined) params.set('forecast_days', String(input.forecastDays))
      if (input.historyDays !== undefined) params.set('history_days', String(input.historyDays))
      if (input.timezone) params.set('tz', input.timezone)

      const pathWithQuery = `/packages/${encodeURIComponent(input.packages)}?${params.toString()}`

      let finalUrl = `${baseHost}${pathWithQuery}`
      if (keyEntry.sharedSecret && (!keyEntry.signatureType || keyEntry.signatureType === 'hmac-sha256')) {
        const sig = await hmacSHA256Hex(keyEntry.sharedSecret, pathWithQuery)
        finalUrl = `${finalUrl}&sig=${sig}`
      }

      const response = await fetch(finalUrl, { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Meteoblue forecast API error (${response.status}): ${errText}`)
      }
      return response.json()
    },
  })
}
