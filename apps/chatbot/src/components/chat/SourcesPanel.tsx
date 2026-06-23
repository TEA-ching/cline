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
import React from 'react';
import { X, ExternalLink, FileText } from 'lucide-react';

export interface Source {
  id: number;
  title: string;
  url: string;
  snippet: string;
}

interface Props {
  sources: Source[];
  onClose: () => void;
}

export const SourcesPanel: React.FC<Props> = ({ sources, onClose }) => {
  return (
    <div className="w-80 border-l border-default-200 bg-background flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">📚 Sources ({sources.length})</h3>
        <button onClick={onClose} className="p-1 hover:bg-default-100 rounded">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sources.map((src) => (
          <div key={src.id} id={`source-${src.id}`} className="border-l-2 border-primary-400 pl-3 py-1">
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-1">
              {src.title} <ExternalLink className="h-3 w-3" />
            </a>
            <p className="text-xs text-default-500 mt-1 line-clamp-2">{src.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
