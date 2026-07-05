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
// UI-only companion to `focus-modes.ts`: adds React icons for display in
// InputBar/ChatView. Kept separate so the Worker-reachable `focus-modes.ts`
// (imported via `tools/index.ts`) never pulls react/lucide-react into the
// Worker's bundle — see the comment at the top of `focus-modes.ts`.
import {
	Globe,
	GraduationCap,
	MessageSquare,
	Newspaper,
	Video,
} from "lucide-react";
import React from "react";
import { FOCUS_MODES as FOCUS_MODES_DATA, type FocusConfig, type FocusMode } from "./focus-modes";

export type { FocusMode };

export interface FocusConfigWithIcon extends FocusConfig {
	icon: React.ReactNode;
}

function createIcon(
	IconComponent: React.ComponentType<{ className?: string }>,
	className: string = "h-3 w-3",
): React.ReactNode {
	return React.createElement(IconComponent, { className });
}

const FOCUS_ICONS: Record<FocusMode, React.ComponentType<{ className?: string }>> = {
	web: Globe,
	academic: GraduationCap,
	news: Newspaper,
	video: Video,
	social: MessageSquare,
};

export const FOCUS_MODES: Record<FocusMode, FocusConfigWithIcon> = Object.fromEntries(
	(Object.keys(FOCUS_MODES_DATA) as FocusMode[]).map((mode) => [
		mode,
		{ ...FOCUS_MODES_DATA[mode], icon: createIcon(FOCUS_ICONS[mode]) },
	]),
) as Record<FocusMode, FocusConfigWithIcon>;
