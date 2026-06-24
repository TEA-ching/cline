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
import type { VirtualFS } from '@/vfs/virtual-fs'

interface ChartToolContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
}

export function createChartTool(ctx?: ChartToolContext): AgentTool<any, any> {
  return createTool({
    name: 'create_chart',
    description: [
      'Generate a chart (bar, line, pie, scatter) from two parallel arrays: labels and values.',
      'CRITICAL: labels[i] and values[i] must correspond to the same data point — the two arrays MUST have equal length.',
      'For time series: labels are date strings (e.g. "2026-01-15"), values are numbers.',
      'For categories: labels are category names, values are measurements.',
      'Do NOT send more values than labels, or more labels than values.',
    ].join(' '),
    inputSchema: z.object({
      chartType: z.enum(['bar', 'line', 'pie', 'scatter']).describe('Chart type'),
      labels: z.array(z.string()).describe('X-axis labels — one string per data point, same count as values'),
      values: z.array(z.number()).describe('Y-axis numeric values — one number per data point, same count as labels'),
      title: z.string().optional().describe('Chart title'),
      seriesLabel: z.string().optional().describe('Unit or series name shown as caption (e.g. "USD/Bbl")'),
    }),
    execute: async ({ chartType, labels, values, title, seriesLabel }) => {
      if (!labels?.length || !values?.length) return { error: 'No data provided' };
      const n = Math.min(labels.length, values.length);
      const trimmed = labels.length !== values.length;
      labels = labels.slice(0, n);
      values = values.slice(0, n);

      const COLORS = ['#4f87c5','#e07b39','#5cad6e','#c05c7e','#9b59b6','#16a085','#f39c12','#2980b9'];

      function escSvg(s: string): string {
        return String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
      }

      function fmtNum(v: number): string {
        if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+'M';
        if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+'k';
        if (Number.isInteger(v)) return String(v);
        return parseFloat(v.toFixed(2)).toString();
      }

      function niceTicks(min: number, max: number, n = 5): number[] {
        if (min === max) { max = min + 1; min = min - 1; }
        const raw = (max - min) / n;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
        const nice = [1,2,2.5,5,10].map(x => x * mag).find(x => x >= raw) || raw;
        const start = Math.floor(min / nice) * nice;
        const result: number[] = [];
        for (let v = start; v <= max + nice * 0.01; v = parseFloat((v + nice).toFixed(10))) {
          result.push(parseFloat(v.toFixed(10)));
          if (result.length > 20) break;
        }
        return result;
      }

      function barChart(ls: string[], vs: number[], t?: string, sl?: string): string {
        const W = 600, H = 400, pL = 60, pR = 20, pT = t ? 50 : 20, pB = 80;
        const cW = W - pL - pR, cH = H - pT - pB;
        const yTicks = niceTicks(Math.min(0, ...vs), Math.max(0, ...vs));
        const yMin = yTicks[0], yMax = yTicks[yTicks.length-1], vRange = yMax - yMin || 1;
        const n = ls.length, slotW = cW / n, bW = slotW * 0.65;
        const toY = (v: number) => pT + (1 - (v - yMin) / vRange) * cH;
        const zeroY = toY(0);
        let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font-family:Arial,sans-serif">`;
        if (t) o += `<text x="${W/2}" y="28" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${escSvg(t)}</text>`;
        for (const tv of yTicks) {
          const ty = toY(tv);
          o += `<line x1="${pL}" y1="${ty.toFixed(1)}" x2="${W-pR}" y2="${ty.toFixed(1)}" stroke="#e8e8e8" stroke-width="1"/>`;
          o += `<text x="${pL-8}" y="${(ty+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${fmtNum(tv)}</text>`;
        }
        o += `<line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT+cH}" stroke="#aaa" stroke-width="1.5"/>`;
        o += `<line x1="${pL}" y1="${zeroY.toFixed(1)}" x2="${W-pR}" y2="${zeroY.toFixed(1)}" stroke="#aaa" stroke-width="1.5"/>`;
        for (let i = 0; i < n; i++) {
          const bX = pL + i * slotW + (slotW - bW) / 2;
          const y1 = Math.min(toY(vs[i]), zeroY), y2 = Math.max(toY(vs[i]), zeroY);
          o += `<rect x="${bX.toFixed(1)}" y="${y1.toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(y2-y1,1).toFixed(1)}" fill="${COLORS[i%COLORS.length]}" rx="2" opacity="0.9"/>`;
          const lx = pL + i * slotW + slotW / 2, ly = pT + cH + 15;
          const lbl = ls[i].length > 12 ? ls[i].slice(0,11)+'…' : ls[i];
          if (n > 6) o += `<text transform="rotate(-40,${lx.toFixed(1)},${ly.toFixed(1)})" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end" font-size="10" fill="#555">${escSvg(lbl)}</text>`;
          else o += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" fill="#555">${escSvg(lbl)}</text>`;
        }
        if (sl) o += `<text x="${W/2}" y="${H-5}" text-anchor="middle" font-size="10" fill="#999">${escSvg(sl)}</text>`;
        return o + '</svg>';
      }

      function lineChart(ls: string[], vs: number[], t?: string, sl?: string): string {
        const W = 600, H = 400, pL = 60, pR = 20, pT = t ? 50 : 20, pB = 80;
        const cW = W - pL - pR, cH = H - pT - pB;
        const yTicks = niceTicks(Math.min(...vs), Math.max(...vs));
        const yMin = yTicks[0], yMax = yTicks[yTicks.length-1], vRange = yMax - yMin || 1;
        const n = ls.length;
        const toX = (i: number) => pL + (i / Math.max(n-1,1)) * cW;
        const toY = (v: number) => pT + (1 - (v - yMin) / vRange) * cH;
        let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font-family:Arial,sans-serif">`;
        if (t) o += `<text x="${W/2}" y="28" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${escSvg(t)}</text>`;
        for (const tv of yTicks) {
          const ty = toY(tv);
          o += `<line x1="${pL}" y1="${ty.toFixed(1)}" x2="${W-pR}" y2="${ty.toFixed(1)}" stroke="#e8e8e8" stroke-width="1"/>`;
          o += `<text x="${pL-8}" y="${(ty+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${fmtNum(tv)}</text>`;
        }
        o += `<line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT+cH}" stroke="#aaa" stroke-width="1.5"/>`;
        o += `<line x1="${pL}" y1="${pT+cH}" x2="${W-pR}" y2="${pT+cH}" stroke="#aaa" stroke-width="1.5"/>`;
        if (n > 1) {
          const pts = vs.map((v,i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
          o += `<polygon points="${pL},${pT+cH} ${pts} ${toX(n-1).toFixed(1)},${pT+cH}" fill="${COLORS[0]}" opacity="0.1"/>`;
          o += `<polyline points="${pts}" fill="none" stroke="${COLORS[0]}" stroke-width="2.5" stroke-linejoin="round"/>`;
        }
        const step = n > 10 ? Math.ceil(n/10) : 1;
        for (let i = 0; i < n; i++) {
          const px = toX(i), py = toY(vs[i]);
          o += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${COLORS[0]}" stroke="#fff" stroke-width="1.5"/>`;
          if (i % step === 0) {
            const lbl = ls[i].length > 10 ? ls[i].slice(0,9)+'…' : ls[i];
            if (n > 6) o += `<text transform="rotate(-40,${px.toFixed(1)},${(pT+cH+15).toFixed(1)})" x="${px.toFixed(1)}" y="${(pT+cH+15).toFixed(1)}" text-anchor="end" font-size="10" fill="#555">${escSvg(lbl)}</text>`;
            else o += `<text x="${px.toFixed(1)}" y="${(pT+cH+15).toFixed(1)}" text-anchor="middle" font-size="11" fill="#555">${escSvg(lbl)}</text>`;
          }
        }
        if (sl) o += `<text x="${W/2}" y="${H-5}" text-anchor="middle" font-size="10" fill="#999">${escSvg(sl)}</text>`;
        return o + '</svg>';
      }

      function pieChart(ls: string[], vs: number[], t?: string): string {
        const W = 600, H = 400, cx = 210, cy = H/2, r = 150;
        const total = vs.reduce((a,b) => a + Math.abs(b), 0) || 1;
        let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font-family:Arial,sans-serif">`;
        if (t) o += `<text x="${W/2}" y="24" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${escSvg(t)}</text>`;
        let start = -Math.PI/2;
        const legendX = cx + r + 30;
        let legendY = t ? 60 : 40;
        for (let i = 0; i < ls.length; i++) {
          const angle = (Math.abs(vs[i]) / total) * 2 * Math.PI;
          const end = start + angle;
          if (angle > 0.02) {
            const x1 = cx + r*Math.cos(start), y1 = cy + r*Math.sin(start);
            const x2 = cx + r*Math.cos(end), y2 = cy + r*Math.sin(end);
            o += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${angle>Math.PI?1:0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${COLORS[i%COLORS.length]}" stroke="#fff" stroke-width="2"/>`;
          }
          o += `<rect x="${legendX}" y="${legendY-10}" width="14" height="14" fill="${COLORS[i%COLORS.length]}" rx="2"/>`;
          const lbl = ls[i].length > 20 ? ls[i].slice(0,19)+'…' : ls[i];
          o += `<text x="${legendX+20}" y="${legendY}" font-size="11" fill="#444">${escSvg(lbl)} (${((Math.abs(vs[i])/total)*100).toFixed(1)}%)</text>`;
          legendY += 22;
          start = end;
        }
        return o + '</svg>';
      }

      function scatterChart(ls: string[], vs: number[], t?: string, sl?: string): string {
        const W = 600, H = 400, pL = 60, pR = 20, pT = t ? 50 : 20, pB = 70;
        const cW = W - pL - pR, cH = H - pT - pB;
        const xVals = ls.map((l,i) => { const n = parseFloat(l); return isNaN(n) ? i : n; });
        const xTicks = niceTicks(Math.min(...xVals), Math.max(...xVals));
        const yTicks = niceTicks(Math.min(...vs), Math.max(...vs));
        const xMin = xTicks[0], xMax = xTicks[xTicks.length-1];
        const yMin = yTicks[0], yMax = yTicks[yTicks.length-1];
        const toX = (v: number) => pL + ((v-xMin)/(xMax-xMin||1))*cW;
        const toY = (v: number) => pT + (1-(v-yMin)/(yMax-yMin||1))*cH;
        let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font-family:Arial,sans-serif">`;
        if (t) o += `<text x="${W/2}" y="28" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${escSvg(t)}</text>`;
        for (const tv of yTicks) {
          const ty = toY(tv);
          o += `<line x1="${pL}" y1="${ty.toFixed(1)}" x2="${W-pR}" y2="${ty.toFixed(1)}" stroke="#e8e8e8" stroke-width="1"/>`;
          o += `<text x="${pL-8}" y="${(ty+4).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${fmtNum(tv)}</text>`;
        }
        for (const tx of xTicks) {
          const x = toX(tx);
          o += `<line x1="${x.toFixed(1)}" y1="${pT}" x2="${x.toFixed(1)}" y2="${pT+cH}" stroke="#e8e8e8" stroke-width="1"/>`;
          o += `<text x="${x.toFixed(1)}" y="${(pT+cH+14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#666">${fmtNum(tx)}</text>`;
        }
        o += `<line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT+cH}" stroke="#aaa" stroke-width="1.5"/>`;
        o += `<line x1="${pL}" y1="${pT+cH}" x2="${W-pR}" y2="${pT+cH}" stroke="#aaa" stroke-width="1.5"/>`;
        for (let i = 0; i < xVals.length; i++)
          o += `<circle cx="${toX(xVals[i]).toFixed(1)}" cy="${toY(vs[i]).toFixed(1)}" r="5" fill="${COLORS[0]}" opacity="0.7" stroke="#fff" stroke-width="1.5"/>`;
        if (sl) o += `<text x="${W/2}" y="${H-5}" text-anchor="middle" font-size="10" fill="#999">${escSvg(sl)}</text>`;
        return o + '</svg>';
      }

      let svg: string;
      switch (chartType) {
        case 'bar':     svg = barChart(labels, values, title, seriesLabel); break;
        case 'line':    svg = lineChart(labels, values, title, seriesLabel); break;
        case 'pie':     svg = pieChart(labels, values, title); break;
        case 'scatter': svg = scatterChart(labels, values, title, seriesLabel); break;
        default: return { error: `Unknown chart type: ${chartType}` };
      }

      // encodeURIComponent handles Unicode safely (no btoa Latin1 limitation)
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;

      const vfsPath = `charts/chart_${Date.now()}.svg`;
      if (ctx?.vfs) {
        ctx.vfs.write(vfsPath, svg, 'image/svg+xml');
        ctx.onFileCreated?.(vfsPath, dataUrl);
      }

      return {
        success: true,
        image: dataUrl,
        vfsPath,
        pointsRendered: n,
        warning: trimmed ? `labels and values had different lengths — chart rendered with the first ${n} points` : undefined,
        message: `Chart generated. Display it with: ![chart](${dataUrl})`,
      };
    },
  })
}
